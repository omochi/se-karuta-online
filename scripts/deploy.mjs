import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--dry-run")) {
  console.error("使い方: npm run deploy [-- --dry-run]");
  process.exit(1);
}
const dryRun = args.includes("--dry-run");
const config = "wrangler.production.jsonc";
const outputConfig = "dist/se_karuta_online/wrangler.json";

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npm", ["run", "build"], {
  CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: config,
});

if (dryRun) {
  console.log("dry-run: 本番D1のマイグレーション適用をスキップします。");
} else {
  // 未適用分だけを自動適用する。確認のキャンセルを成功と扱う経路も避ける。
  run(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--remote",
      "--config",
      config,
    ],
    { CI: "true" },
  );
}

run(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js",
  "deploy",
  "--config",
  outputConfig,
  ...(dryRun ? ["--dry-run"] : []),
]);
