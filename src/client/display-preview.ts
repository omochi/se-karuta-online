import type { Question, RoomView } from "../shared/types";
import { eventUrls } from "../shared/urls";
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
    phaseEndsAt: phase === "answerRevealed" ? null : 15000,
    phaseDurationMs: phase === "answerRevealed" ? 0 : 15000,
    timing: { countdownSeconds: 5, readingSeconds: 15, answeringSeconds: 15 },
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
      }),
      ...(phase === "answerRevealed" && {
        correctChoice: question.correctChoice,
        explanationMarkdown: question.explanationMarkdown,
      }),
    },
  };
}
