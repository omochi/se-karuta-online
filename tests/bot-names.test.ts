import { expect, it } from "vitest";
import { BOT_NAMES, pickBotNames } from "../src/worker/bot-names";

it("100人の大会で使えるだけの重複しない名前を事前に持つ", () => {
  expect(new Set(BOT_NAMES).size).toBeGreaterThanOrEqual(100);
  const names = pickBotNames([], 100);
  expect(new Set(names).size).toBe(100);
  expect(
    names.every((name) =>
      BOT_NAMES.includes(name as (typeof BOT_NAMES)[number]),
    ),
  ).toBe(true);
});
it("通常参加者・既存ボットと同名にならず、人数上限近くでも追加できる", () => {
  const used = BOT_NAMES.slice(0, 95);
  const names = pickBotNames(used, 5);
  expect(new Set([...used, ...names]).size).toBe(100);
  expect(() => pickBotNames(BOT_NAMES, 1)).toThrow("名前が足りません");
});
