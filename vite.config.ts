import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { normalizePublicOrigin } from "./src/shared/urls.ts";

// Worker と同じ公開ホスト名を、開発サーバー側でも明示的に許可する。
const localVars = existsSync(".dev.vars")
  ? parseEnv(readFileSync(".dev.vars", "utf8"))
  : {};
const publicOrigin = normalizePublicOrigin(
  process.env.PUBLIC_ORIGIN ??
    localVars.PUBLIC_ORIGIN ??
    "http://localhost:5218",
);
export default defineConfig({
  plugins: [react(), cloudflare({ remoteBindings: false })],
  server: {
    port: 5218,
    strictPort: true,
    allowedHosts: [new URL(publicOrigin).hostname],
  },
});
