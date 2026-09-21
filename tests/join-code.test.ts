import { expect, it } from "vitest";
import {
  generateJoinCode,
  normalizeJoinCode,
  formatJoinCode,
} from "../src/shared/join-code";

it("参加コードは読み違えやすい文字を除いた英字6文字", () => {
  for (let i = 0; i < 100; i++)
    expect(generateJoinCode()).toMatch(/^[A-HJKMNP-Z]{6}$/);
});
it("小文字・空白・全角で入力でき、表示は3文字ずつ区切る", () => {
  expect(normalizeJoinCode(" abc dEf \n")).toBe("ABCDEF");
  expect(normalizeJoinCode("ＡＢＣ　ｄｅｆ")).toBe("ABCDEF");
  expect(formatJoinCode("ABCDEF")).toBe("ABC DEF");
  for (const invalid of [
    "",
    "ABCDE",
    "ABCDEFG",
    "AB1DEF",
    "ABIDEF",
    "ABODEF",
    "ABLDEF",
    "ABC-DEF",
  ])
    expect(normalizeJoinCode(invalid)).toBeNull();
});
