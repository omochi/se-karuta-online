import { eventUrls, normalizePublicOrigin } from "../shared/urls";
import type { Env } from "./env";
import {
  cookie,
  digest,
  hashPassword,
  readSession,
  signSession,
  verifyPassword,
} from "./auth";
import { newGame } from "./game";
import { loadGame, saveGame } from "./repository";
import { tournamentReport } from "./report";
import { validateQuestions } from "../shared/questions";
export { TournamentRoom } from "./room";
export const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 1500000) throw new Error("送信データが大きすぎます。");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("送信形式が不正です。");
  return value;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      const publicOrigin = normalizePublicOrigin(env.PUBLIC_ORIGIN);
      if (url.pathname === "/api/config" && request.method === "GET")
        return json({ publicOrigin });
      if (
        request.method !== "GET" ||
        request.headers.get("Upgrade")?.toLowerCase() === "websocket"
      ) {
        if (request.headers.get("Origin") !== publicOrigin)
          return json({ error: "同じサイトから操作してください。" }, 403);
      }
      const admin = await readSession(request, "se_admin", env.SESSION_SECRET);
      const isAdmin = admin?.role === "admin";
      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        const b = await body(request);
        if (
          typeof b.password !== "string" ||
          !env.ADMIN_PASSWORD ||
          (await digest(b.password)) !== (await digest(env.ADMIN_PASSWORD))
        )
          return json({ error: "パスワードが違います。" }, 401);
        const { token } = await signSession(env.SESSION_SECRET, {
          role: "admin",
        });
        return json({ ok: true }, 200, {
          "Set-Cookie": cookie("se_admin", token, publicOrigin),
        });
      }
      if (url.pathname === "/api/events") {
        if (!isAdmin)
          return json({ error: "管理用パスワードを入力してください。" }, 401);
        if (request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT id,name,created_at FROM tournaments ORDER BY created_at DESC",
          ).all();
          return json({
            events: results.map((row) => ({
              ...row,
              urls: eventUrls(publicOrigin, row.id as string),
            })),
          });
        }
        if (request.method === "POST") {
          const b = await body(request);
          if (
            typeof b.name !== "string" ||
            !b.name.trim() ||
            b.name.trim().length > 80
          )
            return json(
              { error: "大会名を 1〜80 文字で入力してください。" },
              400,
            );
          if (
            typeof b.displayPassword !== "string" ||
            b.displayPassword.length < 4 ||
            b.displayPassword.length > 100
          )
            return json(
              { error: "表示用パスワードを 4〜100 文字で入力してください。" },
              400,
            );
          const questions = validateQuestions(b.questions);
          const game = newGame(
            crypto.randomUUID(),
            b.name.trim(),
            questions,
            Date.now(),
          );
          await saveGame(
            env.DB,
            null,
            game,
            await hashPassword(b.displayPassword),
          );
          return json(
            {
              id: game.id,
              name: game.name,
              urls: eventUrls(publicOrigin, game.id),
            },
            201,
          );
        }
      }
      const match = /^\/api\/e\/([a-zA-Z0-9-]{1,80})(?:\/(.*))?$/.exec(
        url.pathname,
      );
      if (!match) return json({ error: "見つかりません。" }, 404);
      const [, id, action = ""] = match;
      const tournament = await env.DB.prepare(
        "SELECT id,name,display_password_hash FROM tournaments WHERE id = ?",
      )
        .bind(id)
        .first<{ id: string; name: string; display_password_hash: string }>();
      if (!tournament) return json({ error: "大会が見つかりません。" }, 404);
      if (action === "report" && request.method === "GET") {
        if (!isAdmin)
          return json({ error: "管理用パスワードを入力してください。" }, 401);
        const game = await loadGame(env.DB, id);
        if (!game) return json({ error: "大会が見つかりません。" }, 404);
        if (game.phase !== "finished")
          return json({ error: "大会終了後に詳細結果を確認できます。" }, 409);
        return json(tournamentReport(game));
      }
      if (action === "questions" && request.method === "GET") {
        if (!isAdmin)
          return json({ error: "管理用パスワードを入力してください。" }, 401);
        const { results } = await env.DB.prepare(
          "SELECT question_json FROM rounds WHERE tournament_id = ? ORDER BY position",
        )
          .bind(id)
          .all<{ question_json: string }>();
        return json({
          name: tournament.name,
          questions: validateQuestions(
            results.map((row) => JSON.parse(row.question_json)),
          ),
        });
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(id));
      const invoke = (
        path: string,
        headers: Record<string, string>,
        b?: unknown,
      ) =>
        stub.fetch(
          new Request(`https://room/${path}`, {
            method: b === undefined ? "GET" : "POST",
            headers: { "x-event-id": id, ...headers },
            ...(b === undefined ? {} : { body: JSON.stringify(b) }),
          }),
        );
      if (action === "" && request.method === "GET")
        return json({
          id,
          name: tournament.name,
          urls: eventUrls(publicOrigin, id),
        });
      if (action === "display/login" && request.method === "POST") {
        const b = await body(request);
        if (
          typeof b.password !== "string" ||
          b.password.length > 100 ||
          !(await verifyPassword(b.password, tournament.display_password_hash))
        )
          return json({ error: "表示用パスワードが違います。" }, 401);
        const { token } = await signSession(env.SESSION_SECRET, {
          role: "display",
          eventId: id,
        });
        return json({ ok: true }, 200, {
          "Set-Cookie": cookie(`se_display_${id}`, token, publicOrigin),
        });
      }
      if (action === "join" && request.method === "POST") {
        const previous = await readSession(
          request,
          `se_player_${id}`,
          env.SESSION_SECRET,
        );
        if (previous?.role === "player" && previous.eventId === id)
          return invoke("session", {
            "x-role": "player",
            "x-player-id": previous.playerId!,
            "x-session-hash": await digest(previous.nonce),
          });
        const b = await body(request);
        if (
          typeof b.name !== "string" ||
          !b.name.trim() ||
          [...b.name.trim()].length > 20
        )
          return json({ error: "名前を 1〜20 文字で入力してください。" }, 400);
        const playerId = crypto.randomUUID();
        const { token, session } = await signSession(env.SESSION_SECRET, {
          role: "player",
          eventId: id,
          playerId,
        });
        const response = await invoke(
          "join",
          {},
          {
            id: playerId,
            name: b.name.trim(),
            joinedAt: Date.now(),
            sessionHash: await digest(session.nonce),
          },
        );
        if (!response.ok) return response;
        return json({ ok: true, playerId }, 201, {
          "Set-Cookie": cookie(`se_player_${id}`, token, publicOrigin),
        });
      }
      const role = url.searchParams.get("role");
      if (role !== "control" && role !== "display" && role !== "player")
        return json({ error: "画面の種類が不正です。" }, 400);
      const headers: Record<string, string> = { "x-role": role };
      if (role === "control") {
        if (!isAdmin)
          return json({ error: "管理用パスワードを入力してください。" }, 401);
      }
      if (role === "display") {
        const session = await readSession(
          request,
          `se_display_${id}`,
          env.SESSION_SECRET,
        );
        if (session?.role !== "display" || session.eventId !== id)
          return json({ error: "表示用パスワードを入力してください。" }, 401);
      }
      if (role === "player") {
        const session = await readSession(
          request,
          `se_player_${id}`,
          env.SESSION_SECRET,
        );
        if (
          session?.role !== "player" ||
          session.eventId !== id ||
          !session.playerId
        )
          return json({ error: "名前を入力して参加してください。" }, 401);
        headers["x-player-id"] = session.playerId;
        headers["x-session-hash"] = await digest(session.nonce);
      }
      if (action === "session" && request.method === "GET")
        return invoke("session", headers);
      if (
        action === "ws" &&
        request.headers.get("Upgrade")?.toLowerCase() === "websocket"
      )
        return invoke("ws", { ...headers, Upgrade: "websocket" });
      return json({ error: "見つかりません。" }, 404);
    } catch (error) {
      console.error("Request failed", error);
      return json(
        {
          error:
            error instanceof SyntaxError
              ? "JSON の形式を確認してください。"
              : error instanceof Error && !error.message.includes("D1_")
                ? error.message
                : "保存処理に失敗しました。接続を確認して再度お試しください。",
        },
        400,
      );
    }
  },
} satisfies ExportedHandler<Env>;
