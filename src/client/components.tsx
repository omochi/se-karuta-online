import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { usePublicOrigin } from "./config";
import Markdown from "react-markdown";
import { QRCodeSVG } from "qrcode.react";
import type {
  Choice,
  Phase,
  RankRow,
  Results,
  RoomView,
} from "../shared/types";
import { CHOICES } from "../shared/types";
export const PHASE_LABELS: Record<Phase, string> = {
  waiting: "開場中",
  choicesPreparing: "全員の接続を待っています",
  choicesReading: "出題まで",
  countdown: "選択肢の公開まで",
  acceptingAnswers: "回答受付中",
  answersClosed: "回答を締め切りました",
  answerRevealed: "正解発表",
  rankingShown: "この問題の結果",
  questionVoided: "この問題は無効です",
  finished: "大会終了",
};
export function Brand({ small = false }: { small?: boolean }) {
  const origin = usePublicOrigin();
  return (
    <a className={`brand ${small ? "small" : ""}`} href={`${origin}/`}>
      <span className="brand-mark" aria-hidden="true">
        ≋
      </span>
      <span>
        SE <strong>Karuta</strong>
        <small>SWIFT EVOLUTION KARUTA ONLINE</small>
      </span>
    </a>
  );
}
export function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="site-header">
      <Brand small />
      {children}
    </header>
  );
}
export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`connection ${connected ? "online" : ""}`} role="status">
      <i />
      {connected ? "接続中" : "再接続中…"}
    </span>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
export function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown skipHtml>{text}</Markdown>
    </div>
  );
}
export function PasswordForm({
  label,
  onSubmit,
  error,
}: {
  label: string;
  onSubmit: (password: string) => Promise<void>;
  error: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(value);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <label>
        {label}
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          autoComplete="current-password"
          autoFocus
        />
      </label>
      <ErrorBox message={error} />
      <button className="primary" disabled={busy}>
        {busy ? "確認中…" : "入る"} <span>→</span>
      </button>
    </form>
  );
}
export function useRemainingTime(
  view: RoomView,
  receivedAt: RefObject<number>,
) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (view.phaseEndsAt === null) return;
    const timer = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(timer);
  }, [view.phaseEndsAt]);
  return view.phaseEndsAt === null
    ? null
    : Math.max(
        0,
        view.phaseEndsAt -
          view.serverNow -
          (performance.now() - receivedAt.current),
      );
}
export function Countdown({
  view,
  receivedAt,
}: {
  view: RoomView;
  receivedAt: RefObject<number>;
}) {
  const remainingMs = useRemainingTime(view, receivedAt);
  if (remainingMs === null) return null;
  const seconds = Math.ceil(remainingMs / 1000);
  // 数字とバーは同じ期限・同じ残り時間から計算する。設定変更でも進行中の長さは変えない。
  const fraction =
    view.phaseDurationMs > 0
      ? Math.min(1, remainingMs / view.phaseDurationMs)
      : 0;
  const label =
    view.phase === "countdown"
      ? "選択肢の公開まで"
      : view.phase === "choicesReading"
        ? "問題の表示まで"
        : "回答締切まで";
  return (
    <div className={`countdown ${seconds <= 5 ? "final-countdown" : ""}`}>
      <div className="countdown-heading">
        <span className="countdown-value">{seconds}</span>
        <span className="countdown-label">
          {label}
          <small>残り {seconds} 秒</small>
        </span>
      </div>
      <div
        className="countdown-bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={view.phaseDurationMs / 1000}
        aria-valuenow={Math.min(seconds, view.phaseDurationMs / 1000)}
        aria-valuetext={`残り ${seconds} 秒`}
      >
        <div
          className="countdown-bar-fill"
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
    </div>
  );
}
export function PreparationStatus({ view }: { view: RoomView }) {
  return (
    <div className="preparation-status" role="status">
      <p className="preparation-count">
        <strong>
          {view.readyCount} / {view.eligibleCount}
        </strong>{" "}
        人が準備完了
      </p>
      <p className="muted">
        {view.displayReady
          ? "共有画面も準備できています"
          : "共有画面の準備を待っています"}
      </p>
    </div>
  );
}
export function Choices({
  question,
  selected,
  disabled = true,
  onChoose,
  showCorrect = false,
}: {
  question: NonNullable<RoomView["question"]>;
  selected?: Choice;
  disabled?: boolean;
  onChoose?: (c: Choice) => void;
  showCorrect?: boolean;
}) {
  const choices = question.choices;
  if (!choices) return null;
  return (
    <div className="choices">
      {CHOICES.map((c) => (
        <button
          key={c}
          className={`choice choice-${c.toLowerCase()} ${selected === c ? "selected" : ""} ${showCorrect && question.correctChoice === c ? "correct" : ""}`}
          disabled={disabled}
          aria-pressed={selected === c}
          onClick={() => onChoose?.(c)}
          aria-label={`${c}. ${choices[c]}`}
        >
          <span className="choice-letter">{c}</span>
          <span className="choice-text">{choices[c]}</span>
          {selected === c && <span className="choice-check">✓</span>}
        </button>
      ))}
    </div>
  );
}
export function Ranking({
  rows,
  unit = "sec",
  limit,
}: {
  rows: RankRow[];
  unit?: string;
  limit?: number;
}) {
  return rows.length ? (
    <ol className="ranking">
      {rows.slice(0, limit ?? rows.length).map((row) => (
        <li key={row.playerId}>
          <span className={`rank rank-${row.rank}`}>{row.rank}</span>
          <strong>{row.name}</strong>
          <span className="rank-value">
            {unit === "sec"
              ? (row.value / 1000).toFixed(3)
              : unit === "平均位"
                ? row.value.toFixed(2)
                : row.value}
            <small>{unit}</small>
          </span>
        </li>
      ))}
    </ol>
  ) : (
    <p className="muted empty-small">該当者なし</p>
  );
}
export function FinalResults({
  results,
  compact = false,
}: {
  results: Results;
  compact?: boolean;
}) {
  return (
    <div className={`final-results ${compact ? "compact" : ""}`}>
      <div className="awards-grid">
        {[
          ["正答王", "知識でつかんだ正解", results.correct, "問"],
          ["早押し王", "誰よりも早く、正確に", results.fastest, "回"],
          [
            "安定王",
            `${results.minimumCorrect} 問以上正解した人の平均順位`,
            results.stable,
            "平均位",
          ],
          [
            "難問王",
            `正答率 30% 以下の ${results.difficultQuestions} 問`,
            results.difficult,
            "問",
          ],
        ].map(([title, subtitle, rows, unit]) => (
          <section className="award" key={title as string}>
            <p className="eyebrow">{subtitle as string}</p>
            <h2>{title as string}</h2>
            <Ranking
              rows={rows as RankRow[]}
              unit={unit as string}
              limit={compact ? 3 : undefined}
            />
          </section>
        ))}
      </div>
      <section className="record">
        <div>
          <p className="eyebrow">FASTEST ANSWER</p>
          <h3>大会最速回答</h3>
        </div>
        {results.record.length ? (
          results.record.map((r, i) => (
            <div key={i}>
              <strong className="record-time">
                {(r.elapsed / 1000).toFixed(3)}
                <small>sec</small>
              </strong>
              <p>
                {r.name}{" "}
                <span className="muted">
                  / Q{r.questionNumber} · {r.proposal}
                </span>
              </p>
            </div>
          ))
        ) : (
          <p className="muted">該当者なし</p>
        )}
      </section>
    </div>
  );
}
export function JoinCode({ url }: { url: string }) {
  return (
    <div className="join-code">
      <div className="qr">
        <QRCodeSVG value={url} size={150} level="M" />
      </div>
      <div>
        <p className="eyebrow">JOIN THE GAME</p>
        <h2>スマホで参加しよう</h2>
        <p>QRコードを読み取って、名前を入れるだけ。</p>
        <a href={url} target="_blank" rel="noreferrer">
          {url.replace(/^https?:\/\//, "")}
        </a>
      </div>
    </div>
  );
}
