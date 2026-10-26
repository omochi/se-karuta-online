import { expect, it } from "vitest";
import { debugModeEnabled } from "../src/worker/debug-mode";

it.each([
  "http://localhost:5218",
  "https://LOCALHOST",
  "http://127.0.0.1",
  "http://127.255.255.255:5218",
  "http://192.168.0.0",
  "http://192.168.255.255",
])("明示的な設定と許可された公開ホストで有効になる: %s", (PUBLIC_ORIGIN) => {
  expect(debugModeEnabled({ DEBUG_MODE: "true", PUBLIC_ORIGIN })).toBe(true);
});
it.each([
  "http://localhost.example",
  "http://localhost.",
  "http://sub.localhost",
  "http://127.example",
  "http://127.0.0.1.example",
  "http://192.168.1.2.example",
  "http://192.168.example",
  "http://192.169.0.1",
  "http://126.255.255.255",
  "http://128.0.0.0",
  "http://10.0.0.1",
  "http://172.16.0.1",
  "http://[::1]",
  "https://karuta.example",
  "http://192.168.256.1",
  "http://localhost/path",
  "http://user:pass@localhost",
  "invalid",
  "",
])("設定しても許可外ホストでは無効になる: %s", (PUBLIC_ORIGIN) => {
  expect(debugModeEnabled({ DEBUG_MODE: "true", PUBLIC_ORIGIN })).toBe(false);
});
it.each([undefined, "false", "1", "TRUE", " true", "true ", ""])(
  "true以外では既定で無効になる: %s",
  (DEBUG_MODE) => {
    expect(
      debugModeEnabled({ DEBUG_MODE, PUBLIC_ORIGIN: "http://localhost:5218" }),
    ).toBe(false);
  },
);
