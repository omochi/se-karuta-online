import type { Game } from "../shared/types";
import type { PersonalResult } from "../shared/personal-result";
import { choiceLabel } from "../shared/proposal-title";
import { tournamentReport } from "./report";

export function personalResult(game: Game, playerId: string): PersonalResult {
  // 管理用レポートと同じ計算を使い、レスポンスは一人分に限定する。
  const report = tournamentReport(game);
  const player = report.players.find((p) => p.id === playerId);
  if (!player) throw new Error("参加者が見つかりません。");
  const { fastestCorrect: _, ...personalPlayer } = player;
  return {
    eventId: report.id,
    eventName: report.name,
    player: personalPlayer,
    rounds: report.rounds.map((round) => {
      const { playerId: _, ...answer } = round.answers.find(
        (a) => a.playerId === playerId,
      )!;
      return {
        number: round.number,
        title: choiceLabel(round.question, round.question.correctChoice),
        status: round.status,
        correctChoice: round.question.correctChoice,
        answer,
      };
    }),
  };
}
