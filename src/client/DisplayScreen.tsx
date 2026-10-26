import { choiceLabel } from "../shared/proposal-title";
import type { ReactNode } from "react";
import type { RoomView } from "../shared/types";
import type { GameProgressState } from "./phase-presentation";
import { Brand, Choices, FinalResults, Ranking } from "./components";
import { GameProgress } from "./GameProgress";
import { FittedQuestion } from "./FittedQuestion";
import { QuestionBody } from "./QuestionBody";
import { QuestionDifficulty } from "./QuestionDifficulty";
import type { QuestionFit } from "./fit-question";
import "./display-question.css";
import { AnswerDistribution } from "./AnswerDistribution";
import { DisplayJoinGuide } from "./DisplayJoinGuide";

// 本番と問題ビューワの別窓で、DOM構造・CSS・進行表示を一致させる。
// 通信と時計の更新は呼び出し元が担当する。
export function DisplayScreen({
  view: v,
  progress,
  status,
  onQuestionFit,
}: {
  view: RoomView;
  progress: GameProgressState;
  status: ReactNode;
  onQuestionFit?: (fit: QuestionFit) => void;
}) {
  const q = v.question;
  const revealing = ["answerRevealed", "rankingShown"].includes(v.phase);
  const distribution =
    revealing && q?.correctChoice && v.answerDistribution ? (
      <AnswerDistribution
        distribution={v.answerDistribution}
        correctChoice={q.correctChoice}
      />
    ) : null;
  const fitQuestion = [
    "acceptingAnswers",
    "answersClosed",
    "answerRevealed",
  ].includes(progress.phase);
  return (
    <div
      className={`display-page ${fitQuestion ? "display-page-question" : v.phase === "waiting" ? "display-page-waiting" : ""}`}
    >
      <header className="display-header">
        <Brand small />
        <span className="display-event">{v.name}</span>
        {status}
      </header>
      <main
        className={`display-content phase-${progress.phase}${distribution && v.phase === "answerRevealed" ? " has-distribution" : ""}`}
      >
        {q?.difficulty !== undefined &&
          ["choicesPreparing", "countdown", "choicesReading"].includes(
            v.phase,
          ) && <QuestionDifficulty difficulty={q.difficulty} />}
        {v.phase !== "rankingShown" && (
          <GameProgress progress={progress} layout="display" />
        )}
        {v.phase === "waiting" ? (
          <div className="display-welcome">
            <DisplayJoinGuide
              url={v.urls.play}
              homeUrl={v.urls.home}
              code={v.joinCode}
            />
          </div>
        ) : v.phase === "finished" && v.results ? (
          <FinalResults results={v.results} compact />
        ) : v.phase === "rankingShown" ? (
          <div className="display-ranking">
            <div className="display-ranking-summary">
              <GameProgress progress={progress} layout="display" />
              <p>
                正解 {q?.correctChoice} ·{" "}
                {q?.correctChoice && choiceLabel(q, q.correctChoice)}
              </p>
              {distribution}
            </div>
            <Ranking rows={v.rankings ?? []} limit={8} />
          </div>
        ) : v.phase !== "questionVoided" && v.phase !== "finished" ? (
          <>
            {q?.bodyMarkdown !== undefined &&
              (fitQuestion ? (
                <FittedQuestion
                  key={q.id}
                  text={q.bodyMarkdown}
                  difficulty={q.difficulty}
                  layoutKey={progress.phase}
                  onFit={onQuestionFit}
                />
              ) : (
                <section className="question-body" key={q.id}>
                  <QuestionBody
                    text={q.bodyMarkdown}
                    difficulty={q.difficulty}
                  />
                </section>
              ))}
            {distribution}
            {q && <Choices question={q} showCorrect={revealing} />}
          </>
        ) : null}
      </main>
      <footer className="display-footer">
        <span>Swift Evolution Karuta Online</span>
      </footer>
    </div>
  );
}
