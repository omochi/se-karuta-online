import type { GameProgressState } from "./phase-presentation";
import styles from "./Countdown.module.css";

export function Countdown({
  timer,
  colorScheme,
}: {
  timer: NonNullable<GameProgressState["timer"]>;
  colorScheme: "light" | "dark";
}) {
  return (
    <div
      className={`countdown ${styles.timer}`}
      data-color-scheme={colorScheme}
      data-urgent={timer.seconds <= 5}
    >
      <div className="countdown-heading">
        <span className={`countdown-value ${styles.value}`}>
          {timer.seconds}
        </span>
        <span className={`countdown-label ${styles.label}`}>
          {timer.label}
          <small>{timer.remainingLabel}</small>
        </span>
      </div>
      <div
        className={`countdown-bar ${styles.track}`}
        role="progressbar"
        aria-label={timer.label}
        aria-valuemin={0}
        aria-valuemax={timer.durationSeconds}
        aria-valuenow={Math.min(timer.seconds, timer.durationSeconds)}
        aria-valuetext={timer.remainingLabel}
      >
        <div
          className={`countdown-bar-fill ${styles.fill}`}
          style={{ transform: `scaleX(${timer.fraction})` }}
        />
      </div>
    </div>
  );
}
