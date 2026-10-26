import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ADMIN_PASSWORD: "test-admin",

          PUBLIC_ORIGIN: "http://test",
        },
      },
    }),
  ],
  test: {
    include: ["tests/worker.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
