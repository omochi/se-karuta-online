import { eventUrls, normalizePublicOrigin } from "../shared/urls";
import { normalizeJoinCode } from "../shared/join-code";
import type { Env } from "./env";
import {
  cookie,
  digest,
  hashPassword,
  readSession,
  createSession,
  readAuthorizations,
  type Session,
  verifyPassword,
} from "./auth";
import { newGame } from "./game";
import { ensureJoinCode, loadGame, saveGame } from "./repository";
import { tournamentReport } from "./report";
import { listEvents } from "./event-list";
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
// セッションのクライアントから対象大会の参加者を解決する。
async function existingPlayerSession(
  session: Session | null,
  env: Env,
  id: string,
): Promise<Response | null> {
  if (!session) return null;
  const player = await env.DB.prepare(
    "SELECT player_id FROM client_players WHERE client_id = ? AND tournament_id = ?",
  )
    .bind(session.clientId, id)
    .first<{ player_id: string }>();
  if (!player) return null;
  return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(
    new Request("https://room/session", {
      headers: {
        "x-event-id": id,
        "x-role": "player",
        "x-player-id": player.player_id,
        "x-session-hash": session.tokenHash,
      },
    }),
  );
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
      const session = await readSession(request, env.DB);
      const isAdmin = session?.isAdmin === true;
      if (url.pathname === "/api/join-code" && request.method === "GET") {
        const code = normalizeJoinCode(url.searchParams.get("code") ?? "");
        if (!code)
          return json(
            { error: "参加コードを英字6文字で入力してください。" },
            400,
          );
        const tournament = await env.DB.prepare(
          "SELECT id, name, json_extract(state_json, '$.phase') AS phase FROM tournaments WHERE join_code = ?",
        )
          .bind(code)
          .first<{ id: string; name: string; phase: string }>();
        if (!tournament)
          return json(
            { error: "大会が見つかりません。参加コードを確認してください。" },
            404,
          );
        if (tournament.phase === "finished") {
          const previous = await existingPlayerSession(
            session,
            env,
            tournament.id,
          );
          if (!previous?.ok) {
            if (previous && previous.status !== 401) return previous;
            return json({ error: "この大会は終了しました。" }, 410);
          }
        }
        return json({
          id: tournament.id,
          name: tournament.name,
          playUrl: eventUrls(publicOrigin, tournament.id).play,
        });
      }
      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        const b = await body(request);
        if (
          typeof b.password !== "string" ||
          !env.ADMIN_PASSWORD ||
          (await digest(b.password)) !== (await digest(env.ADMIN_PASSWORD))
        )
          return json({ error: "パスワードが違います。" }, 401);
        const current = session
          ? { session, token: null }
          : await createSession(env.DB);
        await env.DB.prepare("UPDATE clients SET is_admin = 1 WHERE id = ?")
          .bind(current.session.clientId)
          .run();
        return json(
          { ok: true },
          200,
          current.token
            ? {
                "Set-Cookie": cookie(current.token, publicOrigin),
              }
            : {},
        );
      }
      if (url.pathname === "/api/events") {
        if (!isAdmin)
          return json({ error: "管理用パスワードを入力してください。" }, 401);
        if (request.method === "GET") {
          const result = await listEvents(
            env.DB,
            url.searchParams,
            publicOrigin,
          );
          return result
            ? json(result)
            : json(
                {
                  error:
                    "ページ番号は1以上、表示件数は1〜20の整数で指定してください。",
                },
                400,
              );
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
              joinCode: game.joinCode,
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
        "SELECT id,name,display_password_hash, json_extract(state_json, '$.phase') AS phase FROM tournaments WHERE id = ?",
      )
        .bind(id)
        .first<{
          id: string;
          name: string;
          display_password_hash: string;
          phase: string;
        }>();
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
          joinCode: await ensureJoinCode(env.DB, id),
          finished: tournament.phase === "finished",
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
        const current = session
          ? { session, token: null }
          : await createSession(env.DB);
        await env.DB.prepare(
          "INSERT INTO client_displays (client_id,tournament_id) VALUES (?,?) ON CONFLICT DO NOTHING",
        )
          .bind(current.session.clientId, id)
          .run();
        return json(
          { ok: true },
          200,
          current.token
            ? {
                "Set-Cookie": cookie(current.token, publicOrigin),
              }
            : {},
        );
      }
      if (action === "join" && request.method === "POST") {
        const previous = await existingPlayerSession(session, env, id);
        if (previous && previous.status !== 401) return previous;
        const b = await body(request);
        if (
          typeof b.name !== "string" ||
          !b.name.trim() ||
          [...b.name.trim()].length > 20
        )
          return json({ error: "名前を 1〜20 文字で入力してください。" }, 400);
        const current = session
          ? { session, token: null }
          : await createSession(env.DB);
        const response = await invoke(
          "join",
          {
            "x-client-id": current.session.clientId,
          },
          { name: b.name.trim() },
        );
        if (!response.ok || !current.token) return response;
        return json(await response.json(), response.status, {
          "Set-Cookie": cookie(current.token, publicOrigin),
        });
      }
      const role = url.searchParams.get("role");
      if (role !== "control" && role !== "display" && role !== "player")
        return json({ error: "画面の種類が不正です。" }, 400);
      const authorization = session
        ? (await readAuthorizations(env.DB, id, [session.tokenHash])).get(
            session.tokenHash,
          )
        : undefined;
      const headers: Record<string, string> = {
        "x-role": role,
        "x-session-hash": session?.tokenHash ?? "",
      };
      if (role === "control" && !authorization?.isAdmin)
        return json({ error: "管理用パスワードを入力してください。" }, 401);
      if (role === "display" && !authorization?.canDisplay)
        return json({ error: "表示用パスワードを入力してください。" }, 401);
      if (role === "player") {
        if (!authorization?.playerId)
          return json({ error: "名前を入力して参加してください。" }, 401);
        headers["x-player-id"] = authorization.playerId;
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
