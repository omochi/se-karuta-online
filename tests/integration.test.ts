import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type {
  ClientMessage,
  Command,
  RoomView,
  ServerMessage,
} from "../src/shared/types";
const origin = "http://localhost";
class Peer {
  state: RoomView | null = null;
  private listeners = new Set<(message: ServerMessage) => void>();
  private replies = new Map<string, ServerMessage>();
  private heartbeat: ReturnType<typeof setInterval>;
  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === "state") this.state = message;
      else if (message.requestId) this.replies.set(message.requestId, message);
      for (const listener of this.listeners) listener(message);
    });
    ws.accept();
    this.heartbeat = setInterval(() => {
      try {
        this.send({ type: "ping" });
      } catch {}
    }, 10000);
  }
  send(message: ClientMessage) {
    this.ws.send(JSON.stringify(message));
  }
  close() {
    clearInterval(this.heartbeat);
    try {
      this.ws.close();
    } catch {}
  }
  wait(predicate: (v: RoomView) => boolean, timeout = 7000): Promise<RoomView> {
    if (this.state && predicate(this.state)) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const listener = (message: ServerMessage) => {
        if (message.type === "state" && predicate(message)) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(message);
        }
      };
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(
          new Error(
            `state timeout: ${this.state?.phase}, ${this.state?.readyCount}/${this.state?.eligibleCount}`,
          ),
        );
      }, timeout);
      this.listeners.add(listener);
    });
  }
  reply(requestId: string): Promise<ServerMessage> {
    if (this.replies.has(requestId))
      return Promise.resolve(this.replies.get(requestId)!);
    return new Promise((resolve, reject) => {
      const listener = (m: ServerMessage) => {
        if (m.type !== "state" && m.requestId === requestId) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(m);
        }
      };
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error("reply timeout"));
      }, 7000);
      this.listeners.add(listener);
    });
  }
  async command(command: Command, extra: Record<string, string> = {}) {
    const revision = this.state!.revision;
    const requestId = crypto.randomUUID();
    this.send({ type: "command", requestId, revision, command, ...extra });
    const reply = await this.reply(requestId);
    assert.equal(reply.type, "ack", JSON.stringify(reply));
    return this.wait((v) => v.revision > revision);
  }
}
test(
  "40人のWebSocket・D1・Durable Objectsで準備確認から表彰まで遊べる",
  { timeout: 65000 },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), "se-karuta-integration-"));
    const bundle = await build({
      entryPoints: ["src/worker/index.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["cloudflare:workers"],
    });
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-09-20",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        d1Persist: join(folder, "d1"),
        durableObjects: {
          ROOMS: { className: "TournamentRoom", useSQLite: true },
        },
        durableObjectsPersist: join(folder, "do"),
        bindings: {
          ADMIN_PASSWORD: "test-admin",
          SESSION_SECRET: "integration-only-secret",
          PUBLIC_ORIGIN: origin,
        },
      }),
    );
    const peers: Peer[] = [];
    t.after(async () => {
      for (const p of peers) p.close();
      await mf.dispose();
      await rm(folder, { recursive: true, force: true });
    });
    const db = await mf.getD1Database("DB");
    const schema = await readFile("migrations/0001_initial.sql", "utf8");
    await db.batch(
      schema
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
    async function request(path: string, data?: unknown, cookie = "") {
      return mf.dispatchFetch(origin + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    }
    const cookieOf = (r: { headers: { get(name: string): string | null } }) =>
      r.headers.get("set-cookie")!.split(";")[0];
    const anonymous = await request("/api/events");
    assert.equal(anonymous.status, 401);
    const crossOrigin = await mf.dispatchFetch(origin + "/api/admin/login", {
      method: "POST",
      headers: { Origin: "https://other.example" },
      body: JSON.stringify({ password: "test-admin" }),
    });
    assert.equal(crossOrigin.status, 403);
    const login = await request("/api/admin/login", { password: "test-admin" });
    assert.equal(login.status, 200);
    const adminCookie = cookieOf(login);
    const demo = JSON.parse(await readFile("data/questions/demo.json", "utf8"));
    const create = await request("/api/events", demo, adminCookie);
    assert.equal(create.status, 201);
    const { id } = (await create.json()) as { id: string };
    const displayLogin = await request(`/api/e/${id}/display/login`, {
      password: "display-karuta",
    });
    assert.equal(displayLogin.status, 200);
    const displayCookie = cookieOf(displayLogin);
    async function connect(
      role: "control" | "display" | "player",
      cookie: string,
    ) {
      const response = await mf.dispatchFetch(
        `${origin}/api/e/${id}/ws?role=${role}`,
        { headers: { Origin: origin, Upgrade: "websocket", Cookie: cookie } },
      );
      assert.equal(response.status, 101);
      const peer = new Peer(response.webSocket as unknown as WebSocket);
      peers.push(peer);
      await peer.wait(() => true);
      return peer;
    }
    const control = await connect("control", adminCookie);
    const display = await connect("display", displayCookie);
    const joins = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        request(`/api/e/${id}/join`, { name: `Player ${i}` }),
      ),
    );
    const cookies = joins.map(cookieOf);
    const players = await Promise.all(cookies.map((c) => connect("player", c)));
    await control.wait((v) => v.playerCount === 40);
    await control.command("start");
    await display.wait((v) => v.phase === "choicesPreparing");
    await Promise.all(
      players.map((p) => p.wait((v) => v.phase === "choicesPreparing")),
    );
    const roundId = control.state!.question!.id;
    assert.equal(display.state!.question!.bodyMarkdown, undefined);
    assert.equal(display.state!.question!.correctChoice, undefined);
    assert.equal(players[0].state!.preview, undefined);
    display.send({ type: "ready", roundId, epoch: display.state!.epoch });
    // 古い世代の通知を送っても準備完了にしない。
    players[0].send({ type: "ready", roundId, epoch: "old-connection" });
    players[0].send({ type: "ping" });
    for (const player of players.slice(0, 39))
      player.send({ type: "ready", roundId, epoch: player.state!.epoch });
    await control.wait((v) => v.readyCount === 39);
    assert.equal(control.state!.phase, "choicesPreparing");
    const lateJoin = await request(`/api/e/${id}/join`, {
      name: "Late player",
    });
    const late = await connect("player", cookieOf(lateJoin));
    assert.equal(late.state!.me!.participation, "waiting");
    const restedId = players[39].state!.me!.id;
    const reading = await control.command("rest", { playerId: restedId });
    assert.equal(reading.phase, "choicesReading");
    assert.equal(reading.eligibleCount, 39);
    assert.equal(reading.phaseEndsAt! - reading.serverNow <= 10000, true);
    const countdown = await control.wait((v) => v.phase === "countdown", 13000);
    assert.equal(countdown.phaseEndsAt! - countdown.serverNow <= 5000, true);
    await control.wait((v) => v.phase === "acceptingAnswers", 8000);
    await display.wait((v) => v.phase === "acceptingAnswers");
    await Promise.all(
      players.map((p) => p.wait((v) => v.phase === "acceptingAnswers")),
    );
    assert.equal(
      display.state!.question!.bodyMarkdown,
      demo.questions[0].bodyMarkdown,
    );
    assert.equal(players[0].state!.question!.bodyMarkdown, undefined);
    const invalidId = crypto.randomUUID();
    players[39].send({
      type: "answer",
      requestId: invalidId,
      roundId,
      choice: "B",
    });
    assert.equal((await players[39].reply(invalidId)).type, "error");
    const hostileId = crypto.randomUUID();
    players[0].send({
      type: "command",
      requestId: hostileId,
      revision: control.state!.revision,
      command: "close",
    });
    assert.equal((await players[0].reply(hostileId)).type, "error");
    // DB障害を一度起こし、未保存の回答を成功扱いしないことを実ランタイムで確認する。
    await db.exec(
      "CREATE TRIGGER fail_test_answer BEFORE INSERT ON answers WHEN NEW.choice = 'A' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    );
    const failedId = crypto.randomUUID();
    players[0].send({
      type: "answer",
      requestId: failedId,
      roundId,
      choice: "A",
    });
    assert.equal((await players[0].reply(failedId)).type, "error");
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM answers WHERE round_id = ?")
          .bind(roundId)
          .first<{ n: number }>()
      )?.n,
      0,
    );
    await db.exec("DROP TRIGGER fail_test_answer;");
    const started = performance.now();
    const ids = players.slice(0, 39).map(() => crypto.randomUUID());
    players
      .slice(0, 39)
      .forEach((p, i) =>
        p.send({ type: "answer", requestId: ids[i], roundId, choice: "B" }),
      );
    const answers = await Promise.all(
      players.slice(0, 39).map((p, i) => p.reply(ids[i])),
    );
    assert(answers.every((a) => a.type === "ack"));
    await control.wait((v) => v.answerCount === 39);
    t.diagnostic(
      `39 simultaneous answers persisted and acknowledged in ${Math.round(performance.now() - started)} ms (local)`,
    );
    const first = answers[0];
    assert.equal(first.type, "ack");
    if (first.type !== "ack") throw new Error("missing ack");
    await control.command("close");
    const retryId = crypto.randomUUID();
    players[0].send({
      type: "answer",
      requestId: retryId,
      roundId,
      choice: "C",
    });
    const retry = await players[0].reply(retryId);
    assert.equal(retry.type, "ack");
    if (retry.type === "ack") assert.deepEqual(retry.answer, first.answer);
    // 同じCookieで再接続しても、新しい参加者や新しい回答を作らない。
    players[0].close();
    const reconnected = await connect("player", cookies[0]);
    assert.deepEqual(reconnected.state!.me!.answer, first.answer);
    await control.command("reveal");
    await reconnected.wait((v) => v.phase === "answerRevealed");
    assert.equal(reconnected.state!.me!.correct, true);
    assert.equal(reconnected.state!.rankings, undefined);
    await control.command("ranking");
    await display.wait((v) => v.phase === "rankingShown");
    assert.equal(display.state!.rankings!.length, 39);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM answers WHERE round_id = ?")
          .bind(roundId)
          .first<{ n: number }>()
      )?.n,
      39,
    );
    await control.command("start");
    await players[39].wait((v) => v.questionNumber === 2);
    assert.equal(players[39].state!.me!.participation, "eligible");
    await late.wait((v) => v.questionNumber === 2);
    assert.equal(late.state!.me!.participation, "eligible");
    await control.command("void", { reason: "試遊のためスキップ" });
    await control.command("finish");
    await reconnected.wait((v) => v.phase === "finished");
    assert.equal(reconnected.state!.results!.validQuestions, 1);
    assert.equal(reconnected.state!.results!.correct.length, 39);
    assert(reconnected.state!.results!.record.length > 0);
  },
);
