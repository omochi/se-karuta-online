import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type {
  ClientMessage,
  Game,
  Player,
  Presence,
  Role,
  ServerMessage,
} from "../shared/types";
import {
  addPlayer,
  advanceTimer,
  applyCommand,
  beginCountdownIfReady,
  currentRound,
  receiveAnswer,
  viewFor,
} from "./game";
import { loadGame, saveGame } from "./repository";
interface Connection {
  id: string;
  ws: WebSocket;
  role: Role;
  playerId?: string;
  readyRound?: string;
  lastSeen: number;
}
const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export class TournamentRoom extends DurableObject<Env> {
  private game: Game | null = null;
  private eventId: string | null = null;
  private readonly epoch = crypto.randomUUID();
  private connections = new Map<string, Connection>();
  private tail: Promise<unknown> = Promise.resolve();
  // D1 の await を跨いでも同じ大会の変更を直列に処理する。受信時刻はこの列に入る前に採る。
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async getGame(id?: string): Promise<Game> {
    if (id && !this.eventId) {
      this.eventId = id;
      await this.ctx.storage.put("eventId", id);
    }
    this.eventId ??= (await this.ctx.storage.get<string>("eventId")) ?? null;
    if (!this.eventId) throw new Error("大会が見つかりません。");
    this.game ??= await loadGame(this.env.DB, this.eventId);
    if (!this.game) throw new Error("大会が見つかりません。");
    return this.game;
  }
  private presence(): Presence {
    const roundId = this.game && currentRound(this.game)?.id;
    const active = [...this.connections.values()].filter(
      (c) => Date.now() - c.lastSeen < 45000,
    );
    const displays = active.filter((c) => c.role === "display");
    return {
      onlinePlayers: new Set(
        active.filter((c) => c.role === "player").map((c) => c.playerId!),
      ),
      readyPlayers: new Set(
        active
          .filter(
            (c) => c.role === "player" && !!roundId && c.readyRound === roundId,
          )
          .map((c) => c.playerId!),
      ),
      displays: displays.map((c) => ({
        id: c.id,
        label: `Display ${c.id.slice(0, 4)}`,
      })),
    };
  }
  private send(c: Connection, message: ServerMessage) {
    try {
      c.ws.send(JSON.stringify(message));
    } catch {
      this.connections.delete(c.id);
    }
  }
  private sendState(c: Connection) {
    if (this.game)
      this.send(
        c,
        viewFor(
          this.game,
          c.role,
          c.playerId,
          this.presence(),
          this.epoch,
          Date.now(),
          this.env.PUBLIC_ORIGIN,
        ),
      );
  }
  private broadcast() {
    for (const c of this.connections.values()) this.sendState(c);
  }
  private async commit(next: Game) {
    try {
      await saveGame(this.env.DB, this.game, next);
      this.game = next;
    } catch (error) {
      this.game = null;
      throw error;
    }
  }
  private async schedule() {
    const g = await this.getGame();
    const heartbeat = this.connections.size ? Date.now() + 15000 : null;
    const deadline = g.phaseEndsAt;
    const next =
      deadline === null
        ? heartbeat
        : heartbeat === null
          ? deadline
          : Math.min(deadline, heartbeat);
    if (next !== null)
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
    else await this.ctx.storage.deleteAlarm();
  }
  private async maybeBegin() {
    const g = await this.getGame();
    const next = structuredClone(g);
    const presence = this.presence();
    if (beginCountdownIfReady(next, presence.readyPlayers, Date.now()))
      await this.commit(next);
  }
  async fetch(request: Request): Promise<Response> {
    return this.enqueue(async () => {
      try {
        const g = await this.getGame(
          request.headers.get("x-event-id") ?? undefined,
        );
        const path = new URL(request.url).pathname;
        if (path === "/join" && request.method === "POST") {
          const player = await request.json<Player>();
          const next = structuredClone(g);
          addPlayer(next, player);
          await this.commit(next);
          this.broadcast();
          return response({ ok: true, playerId: player.id });
        }
        const role = request.headers.get("x-role") as Role;
        const playerId = request.headers.get("x-player-id") ?? undefined;
        if (!["player", "control", "display"].includes(role))
          return response({ error: "権限がありません。" }, 403);
        if (
          role === "player" &&
          !g.players.some(
            (p) =>
              p.id === playerId &&
              p.sessionHash === request.headers.get("x-session-hash"),
          )
        )
          return response({ error: "参加情報を確認できません。" }, 401);
        if (path === "/session") return response({ ok: true, playerId });
        if (
          path !== "/ws" ||
          request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
        )
          return response({ error: "見つかりません。" }, 404);
        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        server.accept();
        const c: Connection = {
          id: crypto.randomUUID(),
          ws: server,
          role,
          playerId,
          lastSeen: Date.now(),
        };
        this.connections.set(c.id, c);
        server.addEventListener("message", (event) => {
          const receivedAt = Date.now();
          c.lastSeen = receivedAt;
          this.ctx.waitUntil(
            this.enqueue(() => this.message(c, event.data, receivedAt)).catch(
              (error) => console.error("WebSocket processing failed", error),
            ),
          );
        });
        const disconnected = () => {
          this.ctx.waitUntil(
            this.enqueue(async () => {
              this.connections.delete(c.id);
              await this.maybeBegin();
              this.broadcast();
              await this.schedule();
            }),
          );
        };
        server.addEventListener("close", disconnected);
        server.addEventListener("error", disconnected);
        this.broadcast();
        await this.schedule();
        return new Response(null, { status: 101, webSocket: client });
      } catch (error) {
        console.error(error);
        return response(
          {
            error:
              "大会の読み込み・保存に失敗しました。もう一度お試しください。",
          },
          503,
        );
      }
    });
  }
  private async message(
    c: Connection,
    data: string | ArrayBuffer,
    receivedAt: number,
  ) {
    if (!this.connections.has(c.id)) return;
    let requestId: string | undefined;
    try {
      await this.getGame();
      if (typeof data !== "string" || data.length > 4000)
        throw new Error("送信データが不正です。");
      const m = JSON.parse(data) as ClientMessage;
      if ("requestId" in m && typeof m.requestId === "string")
        requestId = m.requestId;
      if (m.type === "ping") {
        const phase = this.game!.phase;
        await this.maybeBegin();
        if (this.game!.phase !== phase) this.broadcast();
        this.sendState(c);
        await this.schedule();
        return;
      }
      if (m.type === "ready") {
        if (
          c.role === "player" &&
          m.epoch === this.epoch &&
          m.roundId === currentRound(this.game!)?.id
        ) {
          c.readyRound = m.roundId;
          await this.maybeBegin();
        }
      } else if (m.type === "answer") {
        if (c.role !== "player") throw new Error("参加者だけが回答できます。");
        const next = structuredClone(this.game!);
        const answer = receiveAnswer(
          next,
          c.playerId!,
          m.roundId,
          m.choice,
          receivedAt,
        );
        await this.commit(next);
        this.send(c, { type: "ack", requestId: m.requestId, answer });
      } else if (m.type === "command") {
        if (c.role !== "control") throw new Error("進行役だけが操作できます。");
        const next = structuredClone(this.game!);
        applyCommand(next, m, Date.now());
        await this.commit(next);
        await this.maybeBegin();
        this.send(c, { type: "ack", requestId: m.requestId });
      } else throw new Error("不明なメッセージです。");
      this.broadcast();
      await this.schedule();
    } catch (error) {
      console.error("Room message failed", error);
      this.send(c, {
        type: "error",
        requestId,
        message:
          error instanceof Error && !error.message.includes("D1_")
            ? error.message
            : "保存できませんでした。接続を確認して再送してください。",
      });
      try {
        await this.getGame();
        this.sendState(c);
      } catch {
        /* 次の再接続で D1 から再取得する。 */
      }
    }
  }
  async alarm() {
    await this.enqueue(async () => {
      const g = await this.getGame();
      for (const c of this.connections.values())
        if (Date.now() - c.lastSeen >= 45000) {
          this.connections.delete(c.id);
          try {
            c.ws.close(4000, "再接続してください");
          } catch {}
        }
      const next = structuredClone(g);
      if (advanceTimer(next, Date.now())) await this.commit(next);
      await this.maybeBegin();
      this.broadcast();
      await this.schedule();
    });
  }
}
