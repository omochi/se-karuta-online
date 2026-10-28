import type { EventUrls } from "./urls";
export const CHOICES = ["A", "B", "C", "D"] as const;
export type Choice = (typeof CHOICES)[number];
export type Difficulty = 1 | 2 | 3;
export type Role = "control" | "display" | "player";
export type Phase =
  | "waiting"
  | "choicesPreparing"
  | "countdown"
  | "choicesReading"
  | "acceptingAnswers"
  | "answersClosed"
  | "answerRevealed"
  | "rankingShown"
  | "questionVoided"
  | "finished";
export interface ProposalChoice {
  number: string;
  title: string;
  titleJa: string | null;
  explanationUrl: string;
}
export interface Question {
  id: string;
  difficulty: Difficulty;
  bodyMarkdown: string;
  choices: Record<Choice, ProposalChoice>;
  correctChoice: Choice;
  explanationMarkdown: string;
}
export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  isBot?: boolean;
}
export interface Answer {
  choice: Choice;
  receivedAt: number;
}
export interface Round {
  id: string;
  question: Question;
  participants: Record<string, "eligible">;
  readyWaitPlayerIds?: string[];
  answers: Record<string, Answer>;
  readingStartedAt: number | null;
  countdownStartedAt: number | null;
  openedAt: number | null;
  answerExtendedAt?: number;
  closedAt: number | null;
  isVoided: boolean;
  voidReason: string | null;
}
export interface Game {
  joinCode: string;
  id: string;
  name: string;
  createdAt: number;
  revision: number;
  phase: Phase;
  currentIndex: number;
  phaseEndsAt: number | null;
  timing: TimingSettings;
  players: Player[];
  readyExemptPlayerIds: string[];
  rounds: Round[];
}
export interface TimingSettings {
  countdownSeconds: number;
  readingSeconds: number;
  answeringSeconds1: number;
  answeringSeconds2: number;
  answeringSeconds3: number;
}
export interface RankRow {
  playerId: string;
  name: string;
  rank: number;
  value: number;
}
export interface Results {
  correct: RankRow[];
  fastest: RankRow[];
  difficult: RankRow[];
  friendship: RankRow[];
  validQuestions: number;
}
export interface Presence {
  onlinePlayers: Set<string>;
  readyPlayers: Set<string>;
  displays: Array<{
    id: string;
    label: string;
  }>;
}
export interface AnswerDistribution {
  counts: Record<Choice, number>;
  unanswered: number;
  // 問題ビューワの描画用データだけに付ける。
  sample?: boolean;
}
export interface RoomView {
  answerDistribution?: AnswerDistribution;
  joinCode: string | null;
  urls: EventUrls;
  type: "state";
  id: string;
  name: string;
  phase: Phase;
  revision: number;
  epoch: string;
  serverNow: number;
  phaseEndsAt: number | null;
  phaseDurationMs: number;
  answerExtendedAt?: number;
  timing: TimingSettings;
  questionNumber: number;
  totalQuestions: number;
  playerCount: number;
  eligibleCount: number;
  readyCount: number;
  readyWaitCount: number;
  answerCount: number;
  question: null | {
    id: string;
    difficulty?: Difficulty;
    choices?: Record<Choice, ProposalChoice>;
    bodyMarkdown?: string;
    correctChoice?: Choice;
    explanationMarkdown?: string;
    voidReason?: string | null;
  };
  rankings?: RankRow[];
  results?: Results;
  me?: {
    ready?: boolean;
    id: string;
    name: string;
    participation: "eligible" | "waiting";
    answer: Answer | null;
    elapsed: number | null;
    correct?: boolean;
    rank?: number;
    correctCount?: number;
  };
  players?: Array<{
    id: string;
    name: string;
    online: boolean;
    ready: boolean;
    participation: "eligible" | "waiting";
    answered: boolean;
    waitForReady: boolean;
  }>;
  displays?: Presence["displays"];
  preview?: Question;
  hasNext?: boolean;
}
export type Command =
  | "start"
  | "close"
  | "extendAnswers"
  | "reveal"
  | "ranking"
  | "finish"
  | "setReadyWait"
  | "void"
  | "updateTiming";
export type ClientMessage =
  | { type: "ping" }
  | { type: "timeSync"; requestId: string }
  | { type: "ready"; roundId: string; epoch: string }
  | { type: "answer"; requestId: string; roundId: string; choice: Choice }
  | {
      type: "command";
      requestId: string;
      revision: number;
      command: Command;
      playerId?: string;
      waitForReady?: boolean;
      reason?: string;
      timing?: TimingSettings;
    };
export type ServerMessage =
  | RoomView
  | {
      type: "timeSync";
      requestId: string;
      serverReceivedAt: number;
      serverSentAt: number;
    }
  | { type: "ack"; requestId: string; answer?: Answer }
  | { type: "error"; requestId?: string; message: string };
