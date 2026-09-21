import { readFileSync } from "node:fs";
const file = process.argv[2];
if (!file) throw new Error("問題 JSON のパスを指定してください。");
const base = process.env.LOCAL_URL ?? "http://localhost:5218";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
  throw new Error("このスクリプトはローカル接続専用です。");
const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const input = JSON.parse(readFileSync(file, "utf8"));
const login = await fetch(`${base}/api/admin/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: vars.PUBLIC_ORIGIN },
  body: JSON.stringify({ password: vars.ADMIN_PASSWORD }),
});
if (!login.ok) throw new Error(await login.text());
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const response = await fetch(`${base}/api/events`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: vars.PUBLIC_ORIGIN,
    Cookie: cookie,
  },
  body: JSON.stringify({
    name: input.name ?? "SE Karuta 試遊大会",
    displayPassword: input.displayPassword ?? "display-karuta",
    questions: input.questions ?? input,
  }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error);
console.log(
  `大会を作成しました: ${result.name}\n参加コード: ${result.joinCode}\nControl: ${result.urls.control}\nDisplay: ${result.urls.display}\nPlayer: ${result.urls.play}\n表示用パスワード: ${input.displayPassword ?? "display-karuta"}`,
);
