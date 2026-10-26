import type { Difficulty } from "../shared/types";
import "./question-body.css";

export function QuestionDifficulty({ difficulty }: { difficulty: Difficulty }) {
  return (
    <div className="question-difficulty" data-difficulty={difficulty}>
      <span>難易度 {difficulty}</span>
      <span className="question-difficulty-stars" aria-hidden="true">
        {"★".repeat(difficulty)}
        <span className="question-difficulty-empty">
          {"☆".repeat(3 - difficulty)}
        </span>
      </span>
    </div>
  );
}
