import { expect, it, vi } from "vitest";
import {
  findQuestionFontSize,
  MAX_QUESTION_FONT_SIZE,
} from "../src/client/fit-question";

it("折り返しで高さが急増する境界でも、収まる最大サイズを最後に適用する", () => {
  let applied = 0;
  const measure = vi.fn((size: number) => {
    applied = size;
    // 23.4pxを超えると一行増え、領域を超えるテキストを想定する。
    return size <= 23.4;
  });
  const result = findQuestionFontSize(measure);
  expect(result).toEqual({ fontSize: 23.25, fits: true });
  expect(applied).toBe(result.fontSize);
  expect(measure.mock.calls.length).toBeLessThanOrEqual(10);
});

it("高さに余裕があっても、長いコードの横幅を満たすサイズにする", () => {
  const result = findQuestionFontSize(
    (size) => size * 0.6 * 100 <= 1110 && size * 1.35 * 3 <= 600,
  );
  expect(result).toEqual({ fontSize: 18.5, fits: true });
});

it("短い問題を最大文字サイズ以上に拡大せず、計測も一度で済ませる", () => {
  const measure = vi.fn(() => true);
  expect(findQuestionFontSize(measure)).toEqual({
    fontSize: MAX_QUESTION_FONT_SIZE,
    fits: true,
  });
  expect(measure).toHaveBeenCalledTimes(1);
});

it("最小サイズでも収まらない入力を、収まったと報告しない", () => {
  let applied = 0;
  const result = findQuestionFontSize((size) => {
    applied = size;
    return false;
  });
  expect(result.fits).toBe(false);
  expect(applied).toBe(result.fontSize);
  expect(applied).toBeGreaterThan(0);
});
