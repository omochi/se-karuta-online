import type { Difficulty, TimingSettings } from "./types";

export const ANSWER_EXTENSION_SECONDS = 15;
export const ANSWER_EXTENSION_NOTICE_MS = 5000;

export const DEFAULT_TIMING: Readonly<TimingSettings> = {
  countdownSeconds: 5,
  readingSeconds: 20,
  answeringSeconds1: 30,
  answeringSeconds2: 45,
  answeringSeconds3: 60,
};

export function answeringSeconds(
  timing: Readonly<TimingSettings>,
  difficulty: Difficulty,
): number {
  return timing[`answeringSeconds${difficulty}`];
}

// 旧形式の共通回答時間は全難易度へ引き継ぎ、設定のない大会には初期値を使う。
export function restoreTiming(input: unknown): TimingSettings {
  if (!input || typeof input !== "object") return { ...DEFAULT_TIMING };
  const saved = input as Record<string, unknown>;
  return validateTiming({
    ...DEFAULT_TIMING,
    ...saved,
    answeringSeconds1:
      saved.answeringSeconds1 ??
      saved.answeringSeconds ??
      DEFAULT_TIMING.answeringSeconds1,
    answeringSeconds2:
      saved.answeringSeconds2 ??
      saved.answeringSeconds ??
      DEFAULT_TIMING.answeringSeconds2,
    answeringSeconds3:
      saved.answeringSeconds3 ??
      saved.answeringSeconds ??
      DEFAULT_TIMING.answeringSeconds3,
  });
}

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
