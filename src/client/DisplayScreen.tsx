import type { ReactNode } from "react";
import type { RoomView } from "../shared/types";
import type { GameProgressState } from "./phase-presentation";
import {
  Brand,
  Choices,
  FinalResults,
  JoinCode,
  MarkdownBody,
  Ranking,
} from "./components";
import { GameProgress } from "./GameProgress";

// 本番と問題ビューワの別窓で、DOM構造・CSS・進行表示を一致させる。
// 通信と時計の更新は呼び出し元が担当する。
export function DisplayScreen({
  view: v,
  progress,
  status,
}: {
  view: RoomView;
  progress: GameProgressState;
  status: ReactNode;
}) {
  const q = v.question;
  const revealing = ["answerRevealed", "rankingShown"].includes(v.phase);
  return (
    <div className="display-page">
      <header className="display-header">
        <Brand small />
        <span className="display-event">{v.name}</span>
        {status}
      </header>
      <main className={`display-content phase-${progress.phase}`}>
        <GameProgress progress={progress} layout="display" />
        {v.phase === "waiting" ? (
          <div className="display-welcome">
            <JoinCode url={v.urls.play} />
          </div>
        ) : v.phase === "finished" && v.results ? (
          <FinalResults results={v.results} compact />
        ) : v.phase === "rankingShown" ? (
          <div className="display-ranking">
            <p>
              正解 {q?.correctChoice} ·{" "}
              {q?.correctChoice && q.choices?.[q.correctChoice]}
            </p>
            <Ranking rows={v.rankings ?? []} limit={8} />
          </div>
        ) : v.phase !== "questionVoided" && v.phase !== "finished" ? (
          <>
            {!progress.closed && q?.bodyMarkdown && (
              <section className="question-body" key={q.id}>
                <MarkdownBody text={q.bodyMarkdown} />
              </section>
            )}
            {q && <Choices question={q} showCorrect={revealing} />}
            {revealing && q?.explanationMarkdown && (
              <div className="display-explanation">
                <strong>正解 {q.correctChoice}</strong>
                <MarkdownBody text={q.explanationMarkdown} />
              </div>
            )}
          </>
        ) : null}
      </main>
      <footer className="display-footer">
        <span>Swift Evolution Karuta Online</span>
      </footer>
    </div>
  );
}
