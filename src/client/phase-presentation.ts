import type { Phase, RoomView } from "../shared/types";

interface PhaseMessage {
  title: string;
  description?: string;
  timerLabel?: string;
}

// 画面ごとに文言を上書きせず、進行案内はここを唯一の定義にする。
export const PHASE_MESSAGES: Record<Phase, PhaseMessage> = {
  waiting: {
    title: "大会の開始を待っています",
    description: "開始すると画面が自動で切り替わります",
  },
  choicesPreparing: { title: "全員の接続を待っています" },
  countdown: {
    title: "まもなく選択肢を公開します",
    description: "選択肢が表示されるまでお待ちください",
    timerLabel: "選択肢の公開まで",
  },
  choicesReading: {
    title: "まもなく出題されます",
    description: "今のうちに選択肢を読んでおこう",
    timerLabel: "出題まで",
  },
  acceptingAnswers: {
    title: "回答受付中",
    description: "共有画面の問題を見て、スマホで回答しよう",
    timerLabel: "回答締切まで",
  },
  answersClosed: {
    title: "回答を締め切りました",
    description: "正解発表を待とう",
  },
  answerRevealed: { title: "正解発表" },
  rankingShown: { title: "この問題の結果" },
  questionVoided: {
    title: "この問題は無効です",
    description: "この問題の回答は成績に含めません。次の問題を待とう",
  },
  finished: { title: "大会終了", description: "おつかれさまでした！" },
};

export function getGameProgress(view: RoomView, elapsedMs: number) {
  const remainingMs =
    view.phaseEndsAt === null
      ? null
      : Math.max(0, view.phaseEndsAt - view.serverNow - Math.max(0, elapsedMs));
  // 期限到達時の表示だけを揃える。問題公開やサーバーの進行状態は先に進めない。
  const phase: Phase =
    view.phase === "acceptingAnswers" && remainingMs === 0
      ? "answersClosed"
      : view.phase;
  const message = PHASE_MESSAGES[phase];
  const seconds = remainingMs === null ? 0 : Math.ceil(remainingMs / 1000);
  return {
    phase,
    ...message,
    questionLabel:
      view.questionNumber > 0
        ? `QUESTION ${String(view.questionNumber).padStart(2, "0")} / ${view.totalQuestions}`
        : "大会開始前",
    timer:
      message.timerLabel && remainingMs !== null
        ? {
            label: message.timerLabel,
            seconds,
            remainingLabel: `残り ${seconds} 秒`,
            durationSeconds: view.phaseDurationMs / 1000,
            // 数字とバーは同じ残り時間を使う。分母は開始時に確定した時間。
            fraction:
              view.phaseDurationMs > 0
                ? Math.min(1, remainingMs / view.phaseDurationMs)
                : 0,
          }
        : null,
    preparation:
      phase === "choicesPreparing"
        ? {
            count: `${view.readyCount} / ${view.eligibleCount}`,
            label: "人が準備完了",
          }
        : null,
    playerCount: phase === "waiting" ? `${view.playerCount} 人が参加中` : null,
    answerCount: [
      "acceptingAnswers",
      "answersClosed",
      "answerRevealed",
      "rankingShown",
    ].includes(phase)
      ? `${view.answerCount} / ${view.eligibleCount} 人が回答済み`
      : null,
    voidReason: phase === "questionVoided" ? view.question?.voidReason : null,
    answering:
      view.phase === "acceptingAnswers" &&
      remainingMs !== null &&
      remainingMs > 0,
    closed: phase === "answersClosed",
  };
}
export type GameProgressState = ReturnType<typeof getGameProgress>;
