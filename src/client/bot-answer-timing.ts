// 問題を読んで考える時間を取り、締切直前に全員が集中するのも避ける。
// 途中から接続した場合は、その時点の残り時間を使う。
export function botAnswerDelay(
  remainingMs: number,
  random: () => number = Math.random,
): number | null {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  return remainingMs * (0.2 + random() * 0.7);
}
