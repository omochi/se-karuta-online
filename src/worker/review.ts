import type { TournamentReview } from "../shared/review";
import type { Game } from "../shared/types";
import { roundAnswerDistribution } from "./answer-distribution";
import { isScoredRound } from "./game";

export function tournamentReview(game: Game): TournamentReview {
  if (game.phase !== "finished")
    throw new Error("大会終了後に復習資料を確認できます。");
  return {
    id: game.id,
    name: game.name,
    rounds: game.rounds.map((round, index) => ({
      number: index + 1,
      question: round.question,
      status: round.isVoided
        ? "voided"
        : isScoredRound(round)
          ? "scored"
          : "unasked",
      distribution:
        round.openedAt === null ? null : roundAnswerDistribution(round),
    })),
  };
}
