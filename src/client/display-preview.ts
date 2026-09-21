import type { Question, RoomView } from "../shared/types";
import { eventUrls } from "../shared/urls";
import { DEFAULT_TIMING } from "../shared/timing";
import type { QuestionFit } from "./fit-question";

export type DisplayPreviewPhase =
  "choicesReading" | "acceptingAnswers" | "answerRevealed";

export interface DisplayPreviewSnapshot {
  name: string;
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  phase: DisplayPreviewPhase;
}

export interface DisplayPreviewFit extends QuestionFit {
  questionId: string;
  phase: DisplayPreviewPhase;
  viewportWidth: number;
  viewportHeight: number;
}

export type DisplayPreviewMessage =
  | { type: "display-preview-ready" }
  | { type: "display-preview-closed" }
  | { type: "display-preview-fit"; fit: DisplayPreviewFit }
  | { type: "display-preview-state"; snapshot: DisplayPreviewSnapshot };

export function createDisplayPreviewView(
  snapshot: DisplayPreviewSnapshot,
  origin: string,
): RoomView {
  const { question, phase } = snapshot;
  const phaseDurationMs =
    phase === "answerRevealed"
      ? 0
      : (phase === "choicesReading"
          ? DEFAULT_TIMING.readingSeconds
          : DEFAULT_TIMING.answeringSeconds) * 1000;
  return {
    type: "state",
    id: "preview",
    name: snapshot.name,
    // この状態は描画専用。大会への接続・登録には使用しない。
    urls: eventUrls(origin, "preview"),
    phase,
    revision: 0,
    epoch: "preview",
    serverNow: 0,
    phaseEndsAt: phase === "answerRevealed" ? null : phaseDurationMs,
    phaseDurationMs,
    timing: { ...DEFAULT_TIMING },
    questionNumber: snapshot.questionNumber,
    totalQuestions: snapshot.totalQuestions,
    playerCount: 0,
    eligibleCount: 0,
    readyCount: 0,
    answerCount: 0,
    displayReady: false,
    question: {
      id: question.id,
      choices: question.choices,
      ...(phase !== "choicesReading" && {
        bodyMarkdown: question.bodyMarkdown,
        difficulty: question.difficulty,
      }),
      ...(phase === "answerRevealed" && {
        correctChoice: question.correctChoice,
        explanationMarkdown: question.explanationMarkdown,
      }),
    },
  };
}
