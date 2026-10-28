import type { Choice, Question, Results } from "./types";
import type { PlayerTitle } from "./awards";

export type ReportRoundStatus = "scored" | "voided" | "unasked";
export type ReportAnswerStatus =
  | "correct"
  | "incorrect"
  | "unanswered"
  | "ineligible"
  | "unasked"
  | "notOpened";
export interface ReportAnswer {
  playerId: string;
  status: ReportAnswerStatus;
  choice: Choice | null;
  elapsed: number | null;
  rank: number | null;
}
export interface ReportRound {
  id: string;
  number: number;
  question: Question;
  status: ReportRoundStatus;
  voidReason: string | null;
  eligible: number;
  answered: number;
  correct: number;
  unanswered: number;
  ineligible: number;
  correctRate: number | null;
  distribution: Record<Choice, number>;
  averageElapsed: number | null;
  medianElapsed: number | null;
  fastestCorrect: number | null;
  answers: ReportAnswer[];
}
export interface ReportPlayer {
  id: string;
  name: string;
  titles: PlayerTitle[];
  // 大会全体の有効問題数。途中参加前も未回答として含む。
  eligible: number;
  answered: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  correctRate: number | null;
  averageElapsed: number | null;
  averageCorrectElapsed: number | null;
  fastestCorrect: number | null;
  firstPlaces: number;
  fastestScore: number;
  averageRank: number | null;
  difficultScore: number;
  friendshipScore: number;
}
export interface TournamentReport {
  id: string;
  name: string;
  createdAt: number;
  results: Results;
  summary: {
    scored: number;
    voided: number;
    unasked: number;
    eligible: number;
    answered: number;
    correct: number;
    correctRate: number | null;
    averageElapsed: number | null;
  };
  rounds: ReportRound[];
  players: ReportPlayer[];
}
