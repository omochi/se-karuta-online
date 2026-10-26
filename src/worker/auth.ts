const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export async function digest(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
export async function hashPassword(
  password: string,
  salt: string = crypto.randomUUID(),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `${salt}:${hex(bits)}`;
}
export async function verifyPassword(password: string, stored: string) {
  return (await hashPassword(password, stored.split(":")[0])) === stored;
}
export const SESSION_COOKIE = "se_session";
export const SESSION_MAX_AGE = 30 * 86400;
export interface Session {
  tokenHash: string;
  clientId: string;
  expires: number;
  isAdmin: boolean;
  debugPlayer?: { eventId: string; playerId: string };
}
export interface Authorization extends Session {
  playerId: string | null;
  canDisplay: boolean;
}
// Cookieには256bitのランダムなトークンだけを置き、DBにはそのハッシュを保存する。
export async function createSession(
  db: D1Database,
): Promise<{ token: string; session: Session }> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const session: Session = {
    tokenHash: await digest(token),
    clientId: crypto.randomUUID(),
    expires: Date.now() + SESSION_MAX_AGE * 1000,
    isAdmin: false,
  };
  await db.batch([
    db.prepare("INSERT INTO clients (id) VALUES (?)").bind(session.clientId),
    db
      .prepare(
        "INSERT INTO client_sessions (token_hash,client_id,expires_at) VALUES (?,?,?)",
      )
      .bind(session.tokenHash, session.clientId, session.expires),
  ]);
  return { token, session };
}
export async function readSession(
  request: Request,
  db: D1Database,
  debugEnabled = false,
): Promise<Session | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await digest(token);
  const row = await db
    .prepare(
      `SELECT s.client_id, s.expires_at, c.is_admin, ds.tournament_id, ds.player_id
       FROM client_sessions s JOIN clients c ON c.id = s.client_id
       LEFT JOIN debug_player_sessions ds ON ds.token_hash = s.token_hash
       WHERE s.token_hash = ? AND s.expires_at > ? AND ${validDebugSession}`,
    )
    .bind(tokenHash, Date.now(), debugEnabled ? 1 : 0, Date.now())
    .first<{
      client_id: string;
      expires_at: number;
      is_admin: number;
      tournament_id: string | null;
      player_id: string | null;
    }>();
  // DB障害を無効セッションとして扱わない。呼び出し側でエラーとして返す。
  return row
    ? {
        tokenHash,
        clientId: row.client_id,
        expires: row.expires_at,
        isAdmin: !row.tournament_id && row.is_admin === 1,
        ...(row.tournament_id && row.player_id
          ? {
              debugPlayer: {
                eventId: row.tournament_id,
                playerId: row.player_id,
              },
            }
          : {}),
      }
    : null;
}
export function readCookie(request: Request, name: string): string | undefined {
  return request.headers
    .get("Cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
// 確認セッションは機能が有効で、発行元の通常管理者セッションが存続する間だけ有効。
const validDebugSession = `(ds.token_hash IS NULL OR (? = 1 AND EXISTS (
  SELECT 1 FROM client_sessions issuer JOIN clients ic ON ic.id = issuer.client_id
  WHERE issuer.token_hash = ds.issuer_session_hash AND issuer.expires_at > ? AND ic.is_admin = 1
  AND NOT EXISTS (SELECT 1 FROM debug_player_sessions nested WHERE nested.token_hash = issuer.token_hash)
)))`;
// 接続中の失効確認は大会ごとにまとめて行い、回答の受信ごとにはDB認証しない。
export async function readAuthorizations(
  db: D1Database,
  eventId: string,
  tokenHashes: string[],
  debugEnabled = false,
): Promise<Map<string, Authorization>> {
  const result = new Map<string, Authorization>();
  const unique = [...new Set(tokenHashes)];
  // D1のバインド変数上限を超えないように分割する。
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const { results } = await db
      .prepare(
        `SELECT s.token_hash, s.client_id, s.expires_at, c.is_admin,
        CASE WHEN ds.token_hash IS NULL THEN p.player_id WHEN ds.tournament_id = ? THEN ds.player_id END AS player_id,
        d.client_id AS display_client_id, ds.token_hash AS debug_token_hash
       FROM client_sessions s JOIN clients c ON c.id = s.client_id
       LEFT JOIN client_players p ON p.client_id = c.id AND p.tournament_id = ?
       LEFT JOIN client_displays d ON d.client_id = c.id AND d.tournament_id = ?
       LEFT JOIN debug_player_sessions ds ON ds.token_hash = s.token_hash
       WHERE s.expires_at > ? AND s.token_hash IN (${chunk.map(() => "?").join(",")}) AND ${validDebugSession}`,
      )
      .bind(
        eventId,
        eventId,
        eventId,
        Date.now(),
        ...chunk,
        debugEnabled ? 1 : 0,
        Date.now(),
      )
      .all<{
        token_hash: string;
        client_id: string;
        expires_at: number;
        is_admin: number;
        player_id: string | null;
        display_client_id: string | null;
        debug_token_hash: string | null;
      }>();
    for (const row of results)
      result.set(row.token_hash, {
        tokenHash: row.token_hash,
        clientId: row.client_id,
        expires: row.expires_at,
        isAdmin: !row.debug_token_hash && row.is_admin === 1,
        playerId: row.player_id,
        canDisplay: !row.debug_token_hash && row.display_client_id !== null,
      });
  }
  return result;
}
export function cookie(
  token: string,
  url: string,
  maxAge = SESSION_MAX_AGE,
  name = SESSION_COOKIE,
): string {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(url).protocol === "https:" ? "; Secure" : ""}`;
}
