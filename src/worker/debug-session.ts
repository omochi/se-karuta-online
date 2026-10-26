import {
  cookie,
  digest,
  readCookie,
  readSession,
  SESSION_COOKIE,
  type Session,
} from "./auth";
import type { Env } from "./env";
import { debugModeEnabled } from "./debug-mode";

const RETURN_COOKIE = "se_debug_return";
const TICKET_SECONDS = 5 * 60;
const SESSION_SECONDS = 60 * 60;
const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const json = (data: unknown, status = 200, headers = new Headers()) => {
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { status, headers });
};
async function returnSession(request: Request, env: Env) {
  const saved = readCookie(request, RETURN_COOKIE);
  if (!saved) return null;
  const session = await readSession(
    new Request(request.url, {
      headers: { Cookie: `${SESSION_COOKIE}=${saved}` },
    }),
    env.DB,
  );
  return session ? { token: saved, session } : null;
}

export async function debugSessionRoute(
  request: Request,
  env: Env,
  session: Session | null,
  publicOrigin: string,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  // 復帰は機能を無効にした後や確認セッションの期限切れ後でも可能。
  if (path === "/api/debug/session/status" && request.method === "GET")
    return json({
      active: !!session?.debugPlayer,
      canReturn: !!(await returnSession(request, env)),
      player: session?.debugPlayer ?? null,
    });
  if (path === "/api/debug/session/restore" && request.method === "POST") {
    const saved = await returnSession(request, env);
    const currentToken = readCookie(request, SESSION_COOKIE);
    let removed = false;
    if (currentToken && /^[0-9a-f]{64}$/.test(currentToken)) {
      const result = await env.DB.prepare(
        "DELETE FROM client_sessions WHERE token_hash = ? AND EXISTS (SELECT 1 FROM debug_player_sessions ds WHERE ds.token_hash = client_sessions.token_hash)",
      )
        .bind(await digest(currentToken))
        .run();
      removed = result.meta.changes > 0;
    }
    if (!saved && !removed && !readCookie(request, RETURN_COOKIE))
      return json({ error: "終了する動作確認セッションがありません。" }, 409);
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      cookie(
        saved?.token ?? "",
        publicOrigin,
        saved
          ? Math.max(0, Math.floor((saved.session.expires - Date.now()) / 1000))
          : 0,
      ),
    );
    headers.append("Set-Cookie", cookie("", publicOrigin, 0, RETURN_COOKIE));
    return json({ restored: !!saved }, 200, headers);
  }
  if (!debugModeEnabled(env))
    return json({ error: "参加者の動作確認は無効です。" }, 404);
  // 引き継ぎURLを知る端末では管理者ログインの代わりに、一度限りの能力トークンを検証する。
  if (path === "/api/debug/session/redeem" && request.method === "POST") {
    if (session?.debugPlayer || (await returnSession(request, env)))
      return json(
        { error: "現在の動作確認を終了してから切り替えてください。" },
        409,
      );
    const { ticket } = await request.json<{ ticket?: unknown }>();
    if (typeof ticket !== "string" || !/^[0-9a-f]{64}$/.test(ticket))
      return json({ error: "引き継ぎURLが無効です。" }, 400);
    const nextToken = token();
    const nextHash = await digest(nextToken);
    const clientId = crypto.randomUUID();
    const now = Date.now();
    const expires = now + SESSION_SECONDS * 1000;
    // UPDATEの条件判定と専用セッション作成をD1の同一トランザクションで行う。
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE debug_session_tickets SET redeemed_session_hash = ?
        WHERE token_hash = ? AND redeemed_session_hash IS NULL AND expires_at > ?
        AND EXISTS (SELECT 1 FROM client_sessions s JOIN clients c ON c.id = s.client_id
          WHERE s.token_hash = issuer_session_hash AND s.expires_at > ? AND c.is_admin = 1
          AND NOT EXISTS (SELECT 1 FROM debug_player_sessions ds WHERE ds.token_hash = s.token_hash))`,
      ).bind(nextHash, await digest(ticket), now, now),
      env.DB.prepare(
        "INSERT INTO clients (id) SELECT ? FROM debug_session_tickets WHERE redeemed_session_hash = ?",
      ).bind(clientId, nextHash),
      env.DB.prepare(
        "INSERT INTO client_sessions (token_hash,client_id,expires_at) SELECT ?,?,? FROM debug_session_tickets WHERE redeemed_session_hash = ?",
      ).bind(nextHash, clientId, expires, nextHash),
      env.DB.prepare(
        "INSERT INTO debug_player_sessions (token_hash,issuer_session_hash,tournament_id,player_id) SELECT ?,issuer_session_hash,tournament_id,player_id FROM debug_session_tickets WHERE redeemed_session_hash = ?",
      ).bind(nextHash, nextHash),
    ]);
    if (!results[0].meta.changes)
      return json(
        {
          error:
            "引き継ぎURLが期限切れ、使用済み、または発行元が無効です。再発行してください。",
        },
        410,
      );
    const target = await env.DB.prepare(
      "SELECT tournament_id FROM debug_player_sessions WHERE token_hash = ?",
    )
      .bind(nextHash)
      .first<{ tournament_id: string }>();
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      cookie(nextToken, publicOrigin, SESSION_SECONDS),
    );
    const previous = session ? readCookie(request, SESSION_COOKIE) : null;
    headers.append(
      "Set-Cookie",
      cookie(
        previous ?? "",
        publicOrigin,
        previous ? Math.max(0, Math.floor((session!.expires - now) / 1000)) : 0,
        RETURN_COOKIE,
      ),
    );
    return json(
      { playPath: `/e/${target!.tournament_id}/play`, expiresAt: expires },
      200,
      headers,
    );
  }
  if (!session?.isAdmin)
    return json({ error: "管理用パスワードを入力してください。" }, 401);
  if (path === "/api/debug/session/players" && request.method === "GET") {
    const eventId = new URL(request.url).searchParams.get("event") ?? "";
    const { results } = await env.DB.prepare(
      "SELECT id,name FROM players WHERE tournament_id = ? ORDER BY joined_at,id",
    )
      .bind(eventId)
      .all();
    return json({ players: results });
  }
  if (path === "/api/debug/session/tickets" && request.method === "POST") {
    const { eventId, playerId } = await request.json<{
      eventId?: unknown;
      playerId?: unknown;
    }>();
    if (typeof eventId !== "string" || typeof playerId !== "string")
      return json({ error: "大会と参加者を選択してください。" }, 400);
    const player = await env.DB.prepare(
      "SELECT id FROM players WHERE tournament_id = ? AND id = ?",
    )
      .bind(eventId, playerId)
      .first();
    if (!player) return json({ error: "参加者が見つかりません。" }, 404);
    const ticket = token();
    const expiresAt = Date.now() + TICKET_SECONDS * 1000;
    await env.DB.prepare(
      "INSERT INTO debug_session_tickets (token_hash,issuer_session_hash,tournament_id,player_id,expires_at) VALUES (?,?,?,?,?)",
    )
      .bind(
        await digest(ticket),
        session.tokenHash,
        eventId,
        playerId,
        expiresAt,
      )
      .run();
    // フラグメントはHTTPリクエストやRefererへ送信されない。
    return json(
      {
        handoffUrl: `${publicOrigin}/debug/session/start#${ticket}`,
        expiresAt,
      },
      201,
    );
  }
  return json({ error: "見つかりません。" }, 404);
}
