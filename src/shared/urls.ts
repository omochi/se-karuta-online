export interface EventUrls {
  home: string;
  control: string;
  display: string;
  play: string;
}
export function normalizePublicOrigin(value: string): string {
  if (!value) throw new Error("PUBLIC_ORIGIN を設定してください。");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "PUBLIC_ORIGIN は http:// または https:// から始まる公開URLで指定してください。",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "PUBLIC_ORIGIN はパスや認証情報を含まないURLで指定してください。",
    );
  return url.origin;
}
export function eventUrls(origin: string, id: string): EventUrls {
  const base = normalizePublicOrigin(origin);
  return {
    home: `${base}/`,
    control: `${base}/e/${encodeURIComponent(id)}/control`,
    display: `${base}/e/${encodeURIComponent(id)}/display`,
    play: `${base}/e/${encodeURIComponent(id)}/play`,
  };
}
