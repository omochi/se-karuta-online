import { CHOICES, type Game } from "../shared/types";
import type {
  ReportAnswer,
  ReportRound,
  TournamentReport,
} from "../shared/report";
import {
  finalResults,
  isScoredRound,
  isDifficultRound,
  roundRanking,
} from "./game";

const average = (values: number[]) =>
  values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
const minimum = (values: number[]) =>
  values.length ? Math.min(...values) : null;
const ratio = (count: number, total: number) => (total ? count / total : null);
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
const times = (answers: ReportAnswer[]) =>
  answers.flatMap((a) => (a.elapsed === null ? [] : [a.elapsed]));

// 終了後の保存済みデータだけを読み、セッション検証情報はレスポンスに含めない。
export function tournamentReport(g: Game): TournamentReport {
  if (g.phase !== "finished")
    throw new Error("大会終了後に詳細結果を確認できます。");
  const results = finalResults(g);
  const rounds: ReportRound[] = g.rounds.map((r, index) => {
    const scored = isScoredRound(r);
    const status = r.isVoided ? "voided" : scored ? "scored" : "unasked";
    const rankings = roundRanking(g, r);
    const ranks = new Map(rankings.map((row) => [row.playerId, row.rank]));
    const answers: ReportAnswer[] = g.players.map((p) => {
      const participation = r.participants[p.id];
      const answer = r.answers[p.id];
      return {
        playerId: p.id,
        status:
          status === "unasked"
            ? "unasked"
            : participation === "resting"
              ? "resting"
              : participation !== "eligible"
                ? "ineligible"
                : r.openedAt === null
                  ? "notOpened"
                  : !answer
                    ? "unanswered"
                    : answer.choice === r.question.correctChoice
                      ? "correct"
                      : "incorrect",
        choice: answer?.choice ?? null,
        elapsed:
          answer && r.openedAt !== null ? answer.receivedAt - r.openedAt : null,
        rank: scored ? (ranks.get(p.id) ?? null) : null,
      };
    });
    const eligible = Object.values(r.participants).filter(
      (s) => s === "eligible",
    ).length;
    const answered = answers.filter((a) => a.choice !== null).length;
    const correct = answers.filter((a) => a.status === "correct").length;
    const elapsed = times(answers);
    return {
      id: r.id,
      number: index + 1,
      question: r.question,
      status,
      voidReason: r.voidReason,
      eligible,
      answered,
      correct,
      unanswered: answers.filter((a) => a.status === "unanswered").length,
      resting: answers.filter((a) => a.status === "resting").length,
      ineligible: answers.filter((a) => a.status === "ineligible").length,
      correctRate: scored ? ratio(correct, eligible) : null,
      difficult: scored && isDifficultRound(g, r, rankings),
      distribution: Object.fromEntries(
        CHOICES.map((c) => [c, answers.filter((a) => a.choice === c).length]),
      ) as Record<(typeof CHOICES)[number], number>,
      averageElapsed: average(elapsed),
      medianElapsed: median(elapsed),
      fastestCorrect: minimum(
        times(answers.filter((a) => a.status === "correct")),
      ),
      answers,
    };
  });
  const valid = rounds.filter((r) => r.status === "scored");
  const players = g.players.map((p) => {
    const answers = valid.map((r) =>
      r.answers.find((a) => a.playerId === p.id)!,
    );
    const correctAnswers = answers.filter((a) => a.status === "correct");
    const eligible = answers.filter((a) =>
      ["correct", "incorrect", "unanswered"].includes(a.status),
    ).length;
    const correct = correctAnswers.length;
    return {
      id: p.id,
      name: p.name,
      eligible,
      correct,
      answered: answers.filter((a) => a.choice !== null).length,
      incorrect: answers.filter((a) => a.status === "incorrect").length,
      unanswered: answers.filter((a) => a.status === "unanswered").length,
      resting: answers.filter((a) => a.status === "resting").length,
      ineligible: answers.filter((a) => a.status === "ineligible").length,
      correctRate: ratio(correct, eligible),
      averageElapsed: average(times(answers)),
      averageCorrectElapsed: average(times(correctAnswers)),
      fastestCorrect: minimum(times(correctAnswers)),
      firstPlaces:
        results.fastest.find((row) => row.playerId === p.id)?.value ?? 0,
      averageRank: average(
        correctAnswers.flatMap((a) => (a.rank === null ? [] : [a.rank])),
      ),
      stableQualified: correct >= results.minimumCorrect,
      difficultCorrect:
        results.difficult.find((row) => row.playerId === p.id)?.value ?? 0,
    };
  });
  const eligible = valid.reduce((sum, r) => sum + r.eligible, 0);
  const correct = valid.reduce((sum, r) => sum + r.correct, 0);
  return {
    id: g.id,
    name: g.name,
    createdAt: g.createdAt,
    difficultyThreshold: g.difficultyThreshold,
    results,
    rounds,
    players,
    summary: {
      scored: valid.length,
      voided: rounds.filter((r) => r.status === "voided").length,
      unasked: rounds.filter((r) => r.status === "unasked").length,
      eligible,
      correct,
      answered: valid.reduce((sum, r) => sum + r.answered, 0),
      correctRate: ratio(correct, eligible),
      averageElapsed: average(valid.flatMap((r) => times(r.answers))),
    },
  };
}
