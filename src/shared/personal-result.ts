import type { ReportAnswer, ReportPlayer, ReportRound } from "./report";
import type { Choice } from "./types";

// 他の参加者の識別子・名前・個別回答や、全員のランキングは含めない。
export interface PersonalResult {
  eventId: string;
  eventName: string;
  player: Omit<ReportPlayer, "fastestCorrect">;
  rounds: Array<{
    number: number;
    title: string;
    status: ReportRound["status"];
    correctChoice: Choice;
    answer: Omit<ReportAnswer, "playerId">;
  }>;
}
export interface PersonalResultData {
  result: PersonalResult;
  // 共有URLからの閲覧では、本人セッションがあっても操作を表示しない。
  owner: boolean;
  shareUrl: string | null;
}
