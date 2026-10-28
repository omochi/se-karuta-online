import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import type {
  PersonalResult as Result,
  PersonalResultData,
} from "../shared/personal-result";
import type { ResultData } from "./route-loaders";
import { personalResultPath } from "../shared/urls";
import { Brand, ErrorBox, Header } from "./components";
import { api } from "./api";
import { AnswerStatus } from "./AnswerStatus";
import "./personal-result.css";

const seconds = (value: number | null) =>
  value === null ? "—" : `${(value / 1000).toFixed(3)} 秒`;

export default function PersonalResult() {
  const { data, status } = useLoaderData<ResultData>();
  const revalidator = useRevalidator();
  if (!data)
    return (
      <>
        <Header />
        <main className="gate">
          <h1>
            {status === 409
              ? "大会終了後に成績を確認できます"
              : "成績を開けませんでした"}
          </h1>
          <p>
            {status === 401
              ? "参加したブラウザーで開いてください。セッションが失効している場合は確認できません。"
              : status === 404
                ? "ページが見つからないか、共有が停止されています。"
                : "大会が終了したら、もう一度確認してください。"}
          </p>
          {status === 409 && (
            <button
              className="primary"
              disabled={revalidator.state !== "idle"}
              onClick={() => revalidator.revalidate()}
            >
              もう一度確認する
            </button>
          )}
        </main>
      </>
    );
  return (
    <PersonalResultContent
      key={`${data.result.eventId}/${data.result.player.id}/${data.owner}/${data.shareUrl}`}
      data={data}
    />
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="result-metric">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
export function ResultSummary({
  result,
  onShare,
}: {
  result: Result;
  onShare?: () => void;
}) {
  const p = result.player;
  return (
    <section className="result-summary" aria-label="成績サマリ">
      <div className="result-brand">
        <Brand small />
        <div className="result-summary-actions">
          <span>MY RESULT</span>
          {onShare && (
            <button
              className="secondary result-open-sharing"
              onClick={onShare}
              aria-label="成績を共有"
            >
              共有
            </button>
          )}
        </div>
      </div>
      <h1>{result.eventName}</h1>
      <p className="result-player-name">{p.name}</p>
      {p.titles.length > 0 && (
        <ul className="result-titles" aria-label="取得した称号">
          {p.titles.map((t) => (
            <li key={t.key}>
              {t.title} <strong>{t.rank}位</strong>
            </li>
          ))}
        </ul>
      )}
      <dl className="result-main-metrics">
        <Metric label="正解数 / 有効問題数">
          {p.correct} <small>/ {p.eligible} 問</small>
        </Metric>
        <Metric label="正答率">
          {p.correctRate === null
            ? "—"
            : `${(p.correctRate * 100).toFixed(1)}%`}
        </Metric>
        <Metric label="正解者内1位">
          {p.firstPlaces} <small>回</small>
        </Metric>
        <Metric label="早押し王の得点（小数第3位まで表示）">
          {p.fastestScore.toFixed(3)} <small>点</small>
        </Metric>
        <Metric label="平均順位（正解者内）">
          {p.averageRank === null ? (
            "—"
          ) : (
            <>
              {p.averageRank.toFixed(2)} <small>位</small>
            </>
          )}
        </Metric>
        <Metric label="難問王の得点（小数第3位まで表示）">
          {p.difficultScore.toFixed(3)} <small>点</small>
        </Metric>
        <Metric label="みんなと同じ答え">
          {p.friendshipMatches} <small>回</small>
        </Metric>
        <Metric label="平均回答時間（正解のみ）">
          {seconds(p.averageCorrectElapsed)}
        </Metric>
        <Metric label="平均回答時間（全回答）">
          {seconds(p.averageElapsed)}
        </Metric>
        <Metric label="不正解">
          {p.incorrect} <small>問</small>
        </Metric>
        <Metric label="未回答">
          {p.unanswered} <small>問</small>
        </Metric>
      </dl>
    </section>
  );
}

function ShareDialog({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      className="result-share-dialog"
      ref={dialog}
      aria-labelledby="result-share-heading"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="result-share-dialog-content">
        <header className="result-share-dialog-heading">
          <h2 id="result-share-heading">成績を共有</h2>
          <button
            className="secondary"
            onClick={onClose}
            aria-label="共有メニューを閉じる"
          >
            閉じる
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function PersonalResultContent({ data }: { data: PersonalResultData }) {
  const { result, owner } = data;
  const [shareUrl, setShareUrl] = useState(data.shareUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sharingOpen, setSharingOpen] = useState(false);
  const shareInput = useRef<HTMLInputElement>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(messageTimer.current), []);
  const p = result.player;
  function showMessage(value: string, temporary = false) {
    clearTimeout(messageTimer.current);
    setMessage(value);
    if (temporary) {
      messageTimer.current = setTimeout(() => setMessage(""), 2000);
    }
  }
  async function changeSharing(stop: boolean) {
    setBusy(true);
    setError("");
    showMessage("");
    try {
      const response = await api<{ shareUrl: string | null }>(
        `/api${personalResultPath(result.eventId, p.id)}/share${stop ? "/stop" : ""}`,
        {},
      );
      setShareUrl(response.shareUrl);
      showMessage(
        stop
          ? "共有を停止しました。以前のURLは使えません。"
          : "共有URLを発行しました。",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function copyShareUrl() {
    if (!shareUrl) return;
    setError("");
    showMessage("");
    const temporaryInput = document.createElement("textarea");
    const previousFocus = document.activeElement;
    const setClipboardText = (event: ClipboardEvent) => {
      if (event.clipboardData) {
        event.clipboardData.setData("text/plain", shareUrl);
        event.preventDefault();
      }
    };
    try {
      // 見えない一時領域を使ってコピーし、表示中のURL欄には触れない。
      // モーダルの外はinertになるため、開いているdialog内に置く。
      temporaryInput.value = shareUrl;
      temporaryInput.readOnly = true;
      temporaryInput.tabIndex = -1;
      temporaryInput.style.cssText =
        "position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;z-index:-1;font-size:16px;";
      const container =
        shareInput.current?.closest<HTMLDialogElement>("dialog") ??
        document.body;
      container.appendChild(temporaryInput);
      temporaryInput.focus({ preventScroll: true });
      temporaryInput.select();
      temporaryInput.setSelectionRange(0, shareUrl.length);
      document.addEventListener("copy", setClipboardText, true);
      if (!document.execCommand("copy"))
        throw new Error("コピーに失敗しました。");
      showMessage("コピーしました", true);
    } catch {
      setError("コピーできませんでした。もう一度お試しください。");
    } finally {
      document.removeEventListener("copy", setClipboardText, true);
      temporaryInput.remove();
      if (previousFocus instanceof HTMLElement)
        previousFocus.focus({ preventScroll: true });
    }
  }
  return (
    <main className="personal-result-page">
      <ResultSummary
        result={result}
        onShare={
          owner
            ? () => {
                setError("");
                showMessage("");
                setSharingOpen(true);
              }
            : undefined
        }
      />
      {owner && sharingOpen && (
        <ShareDialog
          onClose={() => {
            showMessage("");
            setSharingOpen(false);
          }}
        >
          <section className="result-sharing" aria-label="成績の共有">
            <p>
              共有URLを知っている人は、このページの名前・成績・全問の回答履歴を見ることができます。
            </p>
            {shareUrl ? (
              <>
                <label>
                  共有URL
                  <input ref={shareInput} readOnly value={shareUrl} />
                </label>
                <div className="result-share-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={copyShareUrl}
                  >
                    URLをコピー
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => changeSharing(true)}
                  >
                    共有を停止
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  現在、共有URLは無効です。通常のページURLは本人だけが開けます。
                </p>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => changeSharing(false)}
                >
                  共有URLを発行
                </button>
              </>
            )}
            <p className="result-share-message" role="status">
              {message}
            </p>
            <ErrorBox message={error} />
          </section>
        </ShareDialog>
      )}
      <section className="result-history" aria-label="全問の回答履歴">
        <h2>全問の回答履歴</h2>
        <ol>
          {result.rounds.map((r) => (
            <li key={r.number}>
              <div className="result-round-heading">
                <strong>Q{r.number}</strong>
                <AnswerStatus
                  status={r.answer.status}
                  suffix={r.status === "voided" ? "（無効）" : undefined}
                />
              </div>
              <p className="result-round-title">{r.title}</p>
              <dl className="result-round-metrics">
                <Metric label="回答 / 正解">
                  {r.answer.choice ?? "—"} / {r.correctChoice}
                </Metric>
                <Metric label="回答時間">{seconds(r.answer.elapsed)}</Metric>
                <Metric label="正解者内順位">
                  {r.answer.rank === null ? "—" : `${r.answer.rank} 位`}
                </Metric>
              </dl>
            </li>
          ))}
        </ol>
        {!result.rounds.length && <p>出題された問題はありません。</p>}
      </section>
      <Link
        className="button secondary"
        to={`/e/${encodeURIComponent(result.eventId)}/review`}
      >
        問題文・解説を復習する →
      </Link>
      <p className="result-note">
        正答率は正解数 ÷
        大会全体の有効問題数。途中参加前も未回答に含みます。無効・未出題の問題は除きます。平均時間は回答済みの記録だけで計算します。「—」は対象データなしです。
      </p>
    </main>
  );
}
