import type { Role } from "../shared/types";
import type { GameProgressState } from "./phase-presentation";
import { Countdown } from "./Countdown";

export function GameProgress({
  progress,
  layout,
}: {
  progress: GameProgressState;
  layout: Role;
}) {
  const Heading = layout === "control" ? "h2" : "h1";
  const timer = progress.timer;
  return (
    <section
      className={`game-progress game-progress-${layout}`}
      data-phase={progress.phase}
    >
      <div className="game-progress-message">
        <p className="eyebrow">{progress.questionLabel}</p>
        <Heading>{progress.title}</Heading>
        {progress.description && (
          <p className="game-progress-description">{progress.description}</p>
        )}
        {progress.voidReason && <p>{progress.voidReason}</p>}
        {progress.preparation && (
          <div className="preparation-status" role="status">
            <p className="preparation-count">
              <strong>{progress.preparation.count}</strong>{" "}
              {progress.preparation.label}
            </p>
          </div>
        )}
        {progress.playerCount && (
          <p className="progress-player-count">{progress.playerCount}</p>
        )}
        {layout !== "player" && progress.answerCount && (
          <p className="progress-answer-count">{progress.answerCount}</p>
        )}
      </div>
      {timer && (
        <Countdown
          timer={timer}
          colorScheme={layout === "player" ? "light" : "dark"}
        />
      )}
    </section>
  );
}
