import { choiceLabel } from "../shared/proposal-title";
import type { RoomConnection } from "./useRoom";
import type { GameProgressState } from "./phase-presentation";

// 大会全体の進行案内を置き換えず、本人だけの参加・回答状態を追加する。
export function PlayerAnswerStatus({
  room,
  progress,
}: {
  room: RoomConnection;
  progress: GameProgressState;
}) {
  const v = room.view!;
  const me = v.me;
  if (v.phase === "finished" || v.phase === "questionVoided") return null;
  if (v.phase === "waiting")
    return (
      <div className="player-answer-status">
        <h2>参加できました！</h2>
      </div>
    );
  if (me?.participation === "waiting")
    return (
      <div className="player-answer-status">
        <h2>次の問題から参加します</h2>
        <p>画面は自動で切り替わります。</p>
      </div>
    );
  if (me?.participation === "resting")
    return (
      <div className="player-answer-status">
        <h2>この問題はお休みです</h2>
        <p>次の問題から、また参加できます。</p>
      </div>
    );
  const revealed = ["answerRevealed", "rankingShown"].includes(v.phase);
  const answered = !!me?.answer;
  if (!revealed && !answered && !room.pending && !progress.closed) return null;
  return (
    <section
      className={`player-answer-status ${revealed && me?.correct ? "success" : ""}`}
    >
      <h2>
        {revealed
          ? answered
            ? me?.correct
              ? "正解！"
              : "おしい、不正解。"
            : "今回は未回答でした"
          : room.pending
            ? "回答を送信中…"
            : answered
              ? "回答しました！"
              : "回答なし"}
      </h2>
      {progress.closed && !answered && !room.pending && (
        <p>時間内に回答がありませんでした。</p>
      )}
      {answered && !revealed && (
        <p>
          回答 <strong>{me?.answer?.choice}</strong> を受け付けました。
        </p>
      )}
      {revealed && me?.correct && (
        <div className="personal-result">
          <strong>
            {me.rank}
            <small> 位</small>
          </strong>
          <span>
            正解者 {me.correctCount} 人中
            <br />
            {((me.elapsed ?? 0) / 1000).toFixed(3)} sec
          </span>
        </div>
      )}
      {revealed && v.question?.correctChoice && (
        <p>
          正解は <strong>{v.question.correctChoice}</strong> ·{" "}
          {choiceLabel(v.question, v.question.correctChoice)}
        </p>
      )}
    </section>
  );
}
