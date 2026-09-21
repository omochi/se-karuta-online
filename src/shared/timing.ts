import type { TimingSettings } from "./types";

export const DEFAULT_TIMING: Readonly<TimingSettings> = {
  countdownSeconds: 5,
  readingSeconds: 15,
  answeringSeconds: 30,
};

export function validateTiming(input: unknown): TimingSettings {
  if (!input || typeof input !== "object")
    throw new Error("時間設定を指定してください。");
  const settings = input as Record<string, unknown>;
  const result = { ...DEFAULT_TIMING };
  for (const key of Object.keys(result) as Array<keyof TimingSettings>) {
    const value = settings[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 600
    )
      throw new Error("各時間は 1〜600 秒の整数で入力してください。");
    result[key] = value;
  }
  return result;
}
