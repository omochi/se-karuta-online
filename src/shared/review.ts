import type { AnswerDistribution, Question } from "./types";

// 公開する復習資料には、参加者や個別回答を持たせない。
export interface TournamentReview {
  id: string;
  name: string;
  rounds: Array<{
    number: number;
    question: Question;
    status: "scored" | "voided" | "unasked";
    distribution: AnswerDistribution | null;
  }>;
}
