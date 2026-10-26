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
): Promise<Session | null> {
  const token = request.headers
    .get("Cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await db
    .prepare(
      "SELECT s.client_id, s.expires_at, c.is_admin FROM client_sessions s JOIN clients c ON c.id = s.client_id WHERE s.token_hash = ? AND s.expires_at > ?",
    )
    .bind(await digest(token), Date.now())
    .first<{
      client_id: string;
      expires_at: number;
      is_admin: number;
    }>();
  // DB障害を無効セッションとして扱わない。呼び出し側でエラーとして返す。
  return row
    ? {
        tokenHash: await digest(token),
        clientId: row.client_id,
        expires: row.expires_at,
        isAdmin: row.is_admin === 1,
      }
    : null;
}
// 接続中の失効確認は大会ごとにまとめて行い、回答の受信ごとにはDB認証しない。
export async function readAuthorizations(
  db: D1Database,
  eventId: string,
  tokenHashes: string[],
): Promise<Map<string, Authorization>> {
  const result = new Map<string, Authorization>();
  const unique = [...new Set(tokenHashes)];
  // D1のバインド変数上限を超えないように分割する。
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const { results } = await db
      .prepare(
        `SELECT s.token_hash, s.client_id, s.expires_at, c.is_admin,
        p.player_id, d.client_id AS display_client_id
       FROM client_sessions s JOIN clients c ON c.id = s.client_id
       LEFT JOIN client_players p ON p.client_id = c.id AND p.tournament_id = ?
       LEFT JOIN client_displays d ON d.client_id = c.id AND d.tournament_id = ?
       WHERE s.expires_at > ? AND s.token_hash IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(eventId, eventId, Date.now(), ...chunk)
      .all<{
        token_hash: string;
        client_id: string;
        expires_at: number;
        is_admin: number;
        player_id: string | null;
        display_client_id: string | null;
      }>();
    for (const row of results)
      result.set(row.token_hash, {
        tokenHash: row.token_hash,
        clientId: row.client_id,
        expires: row.expires_at,
        isAdmin: row.is_admin === 1,
        playerId: row.player_id,
        canDisplay: row.display_client_id !== null,
      });
  }
  return result;
}
export function cookie(token: string, url: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}${new URL(url).protocol === "https:" ? "; Secure" : ""}`;
}
