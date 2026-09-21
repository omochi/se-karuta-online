import type { EventUrls } from "./urls";
export const CHOICES = ["A", "B", "C", "D"] as const;
export type Choice = (typeof CHOICES)[number];
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
export interface Question {
  id: string;
  bodyMarkdown: string;
  choices: Record<Choice, string>;
  correctChoice: Choice;
  explanationMarkdown: string;
}
export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  sessionHash: string;
}
export interface Answer {
  choice: Choice;
  receivedAt: number;
}
export interface Round {
  id: string;
  question: Question;
  participants: Record<string, "eligible" | "resting">;
  answers: Record<string, Answer>;
  readingStartedAt: number | null;
  countdownStartedAt: number | null;
  openedAt: number | null;
  closedAt: number | null;
  isVoided: boolean;
  voidReason: string | null;
}
export interface Game {
  id: string;
  name: string;
  createdAt: number;
  revision: number;
  phase: Phase;
  currentIndex: number;
  phaseEndsAt: number | null;
  difficultyThreshold: number;
  timing: TimingSettings;
  players: Player[];
  rounds: Round[];
}
export interface TimingSettings {
  countdownSeconds: number;
  readingSeconds: number;
  answeringSeconds: number;
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
  stable: RankRow[];
  difficult: RankRow[];
  validQuestions: number;
  difficultQuestions: number;
  minimumCorrect: number;
  record: Array<{
    playerId: string;
    name: string;
    elapsed: number;
    questionNumber: number;
    proposal: string;
  }>;
}
export interface Presence {
  onlinePlayers: Set<string>;
  readyPlayers: Set<string>;
  displays: Array<{
    id: string;
    label: string;
    ready: boolean;
    selected: boolean;
  }>;
}
export interface RoomView {
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
  timing: TimingSettings;
  questionNumber: number;
  totalQuestions: number;
  playerCount: number;
  eligibleCount: number;
  readyCount: number;
  answerCount: number;
  displayReady: boolean;
  question: null | {
    id: string;
    choices?: Record<Choice, string>;
    bodyMarkdown?: string;
    correctChoice?: Choice;
    explanationMarkdown?: string;
    voidReason?: string | null;
  };
  rankings?: RankRow[];
  results?: Results;
  me?: {
    id: string;
    name: string;
    participation: "eligible" | "resting" | "waiting";
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
    participation: "eligible" | "resting" | "waiting";
    answered: boolean;
  }>;
  displays?: Presence["displays"];
  preview?: Question;
  hasNext?: boolean;
}
export type Command =
  | "start"
  | "close"
  | "reveal"
  | "ranking"
  | "finish"
  | "rest"
  | "void"
  | "selectDisplay"
  | "updateTiming";
export type ClientMessage =
  | { type: "ping" }
  | { type: "ready"; roundId: string; epoch: string }
  | { type: "answer"; requestId: string; roundId: string; choice: Choice }
  | {
      type: "command";
      requestId: string;
      revision: number;
      command: Command;
      playerId?: string;
      displayId?: string;
      reason?: string;
      timing?: TimingSettings;
    };
export type ServerMessage =
  | RoomView
  | { type: "ack"; requestId: string; answer?: Answer }
  | { type: "error"; requestId?: string; message: string };
