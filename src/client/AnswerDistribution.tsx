import {
  CHOICES,
  type AnswerDistribution as Distribution,
  type Choice,
} from "../shared/types";
import "./answer-distribution.css";

export function AnswerDistribution({
  distribution,
  correctChoice,
}: {
  distribution: Distribution;
  correctChoice: Choice;
}) {
  const answered = CHOICES.reduce(
    (sum, choice) => sum + distribution.counts[choice],
    0,
  );
  const eligible = answered + distribution.unanswered;
  return (
    <section className="answer-distribution" aria-label="みんなの回答">
      <div className="distribution-heading">
        <h2>みんなの回答</h2>
        {distribution.sample && <span>サンプル</span>}
      </div>
      <ul className="distribution-bars">
        {CHOICES.map((choice) => {
          const count = distribution.counts[choice];
          const correct = choice === correctChoice;
          return (
            <li
              key={choice}
              className={correct ? "distribution-correct" : ""}
              aria-label={`${choice}：${count}人${correct ? "、正解" : ""}`}
            >
              <div className="distribution-label" aria-hidden="true">
                <strong>{choice}</strong>
                {correct && <span>正解</span>}
              </div>
              <div className="distribution-track" aria-hidden="true">
                <div
                  className="distribution-fill"
                  style={{
                    width: `${eligible ? (count / eligible) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="distribution-count" aria-hidden="true">
                <strong>{count}</strong>
                <span>人</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="distribution-summary">
        回答 {answered}人 · 未回答 {distribution.unanswered}人
      </p>
      {eligible === 0 && (
        <p className="distribution-empty">この問題の回答対象者はいません</p>
      )}
    </section>
  );
}
