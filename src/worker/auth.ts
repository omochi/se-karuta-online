const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const unhex = (str: string) =>
  Uint8Array.from(str.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
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
export interface Session {
  role: "admin" | "display" | "player";
  eventId?: string;
  playerId?: string;
  nonce: string;
  expires: number;
}
async function signingKey(secret: string) {
  if (!secret) throw new Error("SESSION_SECRET を設定してください。");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function signSession(
  secret: string,
  values: Omit<Session, "nonce" | "expires">,
): Promise<{ token: string; session: Session }> {
  const session: Session = {
    ...values,
    nonce: crypto.randomUUID(),
    expires: Date.now() + 30 * 86400000,
  };
  const data = btoa(JSON.stringify(session))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return {
    token: `${data}.${hex(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(data)))}`,
    session,
  };
}
export async function readSession(
  request: Request,
  name: string,
  secret: string,
): Promise<Session | null> {
  try {
    const token = request.headers
      .get("Cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    if (!token || token.length > 2048) return null;
    const [data, sig, ...extra] = token.split(".");
    if (extra.length || !data || !/^[0-9a-f]{64}$/.test(sig ?? "")) return null;
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await signingKey(secret),
        unhex(sig),
        encoder.encode(data),
      ))
    )
      return null;
    const value = JSON.parse(
      atob(data.replaceAll("-", "+").replaceAll("_", "/")),
    ) as Session;
    return value.expires > Date.now() ? value : null;
  } catch {
    return null;
  }
}
export function cookie(name: string, token: string, url: string): string {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${new URL(url).protocol === "https:" ? "; Secure" : ""}`;
}
