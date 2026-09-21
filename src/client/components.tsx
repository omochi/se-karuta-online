import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
export { MarkdownBody } from "./MarkdownBody";
import { QRCodeSVG } from "qrcode.react";
import type { Choice, RankRow, Results, RoomView } from "../shared/types";
import { formatJoinCode } from "../shared/join-code";
import { CHOICES } from "../shared/types";
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link className={`brand ${small ? "small" : ""}`} to="/">
      <span className="brand-mark" aria-hidden="true">
        ≋
      </span>
      <span>
        SE <strong>Karuta</strong>
        <small>SWIFT EVOLUTION KARUTA ONLINE</small>
      </span>
    </Link>
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
export function PasswordForm({
  label,
  onSubmit,
  error,
  autoFocus = true,
}: {
  label: string;
  onSubmit: (password: string) => Promise<void>;
  error: string;
  autoFocus?: boolean;
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
          autoFocus={autoFocus}
        />
      </label>
      <ErrorBox message={error} />
      <button className="primary" disabled={busy}>
        {busy ? "確認中…" : "入る"} <span>→</span>
      </button>
    </form>
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
export function JoinCode({
  url,
  homeUrl,
  code,
}: {
  url: string;
  homeUrl: string;
  code: string | null;
}) {
  return (
    <div className="join-code">
      <div className="qr">
        <QRCodeSVG value={url} size={150} level="M" />
      </div>
      <div>
        <p className="eyebrow">JOIN THE GAME</p>
        <h2>スマホで参加しよう</h2>
        <p>QRコード、または参加コードで。</p>
        {code && (
          <div
            className="participation-code"
            aria-label={`参加コード ${formatJoinCode(code)}`}
          >
            {formatJoinCode(code)}
          </div>
        )}
        <a href={homeUrl} target="_blank" rel="noreferrer">
          {homeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
        <p className="join-instruction">
          上のURLを開き、参加コードと名前を入力。
        </p>
      </div>
    </div>
  );
}
