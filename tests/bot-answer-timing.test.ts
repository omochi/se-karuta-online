import { expect, it } from "vitest";
import { botAnswerDelay } from "../src/client/bot-answer-timing";

it.each([30, 45, 60])(
  "回答時間%s秒の早い回答から遅い回答までを締切内に分散する",
  (seconds) => {
    const remainingMs = seconds * 1000;
    const delays = [0, 0.25, 0.5, 0.75, 1].map((value) =>
      botAnswerDelay(remainingMs, () => value)!,
    );
    expect(delays[0]).toBeCloseTo(remainingMs * 0.2);
    expect(delays[4]).toBeCloseTo(remainingMs * 0.9);
    expect(delays.every((delay) => delay > 5000 && delay < remainingMs)).toBe(
      true,
    );
    expect(new Set(delays).size).toBe(5);
  },
);

it("途中から有効にしても残り時間内に分散し、締切後には回答を予約しない", () => {
  expect(botAnswerDelay(10000, () => 0)).toBeCloseTo(2000);
  expect(botAnswerDelay(10000, () => 1)).toBeCloseTo(9000);
  for (const remaining of [0, -1, NaN, Infinity])
    expect(botAnswerDelay(remaining)).toBeNull();
});
