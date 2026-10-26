import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (!existsSync(".dev.vars")) {
  writeFileSync(
    ".dev.vars",
    `PUBLIC_ORIGIN=http://localhost:5218\nADMIN_PASSWORD=local-karuta\n`,
    { mode: 0o600 },
  );
  console.log("ローカル設定を作成しました。管理用パスワード: local-karuta");
}
const result = spawnSync(
  "npx",
  ["wrangler", "d1", "migrations", "apply", "DB", "--local"],
  { stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
process.exitCode = result.status ?? 1;
