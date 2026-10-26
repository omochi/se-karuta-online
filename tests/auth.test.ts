import { expect, it } from "vitest";
import { cookie, hashPassword, verifyPassword } from "../src/worker/auth";
it("表示用パスワードをソルト付きで保存し、異なるパスワードを拒否する", async () => {
  const hash = await hashPassword("display-test");
  expect(hash).not.toContain("display-test");
  expect(await verifyPassword("display-test", hash)).toBe(true);
  expect(await verifyPassword("wrong", hash)).toBe(false);
});
it("CookieはHttpOnly/SameSiteを使いHTTPSではSecureを付ける", () => {
  expect(cookie("value", "https://test")).toContain("; Secure");
  expect(cookie("value", "http://localhost")).not.toContain("; Secure");
  expect(cookie("value", "http://localhost")).toContain(
    "HttpOnly; SameSite=Strict",
  );
});
