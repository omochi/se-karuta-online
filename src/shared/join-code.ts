// I・L・O は会場で読み間違えやすいため使わない。
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
export function generateJoinCode(): string {
  let code = "";
  while (code.length < 6) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0];
    // 剰余による文字の出現頻度の偏りを避ける。
    if (byte < 256 - (256 % ALPHABET.length))
      code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}
export function normalizeJoinCode(value: string): string | null {
  const code = value.normalize("NFKC").replace(/\s/g, "").toUpperCase();
  return /^[A-HJKMNP-Z]{6}$/.test(code) ? code : null;
}
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
