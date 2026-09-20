import { expect, it } from "vitest";
import {
  cookie,
  hashPassword,
  readSession,
  signSession,
  verifyPassword,
} from "../src/worker/auth";
it("セッションの改ざんと違う署名鍵を拒否する", async () => {
  const { token } = await signSession("test-secret", {
    role: "player",
    eventId: "one",
    playerId: "alice",
  });
  const request = new Request("http://localhost", {
    headers: { Cookie: `se=${token}` },
  });
  expect((await readSession(request, "se", "test-secret"))?.playerId).toBe(
    "alice",
  );
  expect(await readSession(request, "se", "other-secret")).toBeNull();
  const tampered = new Request("http://localhost", {
    headers: {
      Cookie: `se=${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`,
    },
  });
  expect(await readSession(tampered, "se", "test-secret")).toBeNull();
});
it("表示用パスワードをソルト付きで保存し、異なるパスワードを拒否する", async () => {
  const hash = await hashPassword("display-test");
  expect(hash).not.toContain("display-test");
  expect(await verifyPassword("display-test", hash)).toBe(true);
  expect(await verifyPassword("wrong", hash)).toBe(false);
});
it("CookieはHttpOnly/SameSiteを使いHTTPSではSecureを付ける", () => {
  expect(cookie("se", "value", "https://test")).toContain("; Secure");
  expect(cookie("se", "value", "http://localhost")).not.toContain("; Secure");
  expect(cookie("se", "value", "http://localhost")).toContain(
    "HttpOnly; SameSite=Strict",
  );
});
