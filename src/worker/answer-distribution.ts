import type { AnswerDistribution, Round } from "../shared/types";

// 会場表示と終了後レポートで、回答対象・未回答の数え方を揃える。
export function roundAnswerDistribution(round: Round): AnswerDistribution {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  let unanswered = 0;
  for (const [id, status] of Object.entries(round.participants)) {
    if (status !== "eligible") continue;
    const answer = round.answers[id];
    if (answer) counts[answer.choice]++;
    else unanswered++;
  }
  return { counts, unanswered };
}
