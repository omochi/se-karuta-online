import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { QRCodeSVG } from "qrcode.react";
import { api } from "./api";
import { ErrorBox, Header, PasswordForm } from "./components";
import type { DebugSessionData } from "./route-loaders";
import "./debug-session.css";

export default function DebugSession() {
  const { events, eventId, players } = useLoaderData<DebugSessionData>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [playerId, setPlayerId] = useState("");
  const [issued, setIssued] = useState<{
    handoffUrl: string;
    expiresAt: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Header>
        <Link to="/">トップへ戻る →</Link>
      </Header>
      <main className="gate debug-session-page">
        <h1>参加者の動作確認</h1>
        <p>
          選んだ参加者として操作します。回答や成績の共有設定は実際に保存されます。
        </p>
        <p className="muted">
          ローカル環境のデバッグ専用です。確認用セッションに管理者・共有画面・他大会の権限は渡りません。
        </p>
        {events === null ? (
          <PasswordForm
            label="管理用パスワード"
            error={error}
            onSubmit={async (password) => {
              try {
                await api("/api/admin/login", { password });
                setError("");
                await revalidator.revalidate();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        ) : (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setIssued(null);
              try {
                setIssued(
                  await api("/api/debug/session/tickets", {
                    eventId,
                    playerId,
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              大会
              <select
                required
                value={eventId}
                disabled={busy}
                onChange={(e) => {
                  setPlayerId("");
                  setIssued(null);
                  setError("");
                  void navigate(`?event=${encodeURIComponent(e.target.value)}`);
                }}
              >
                <option value="">大会を選択</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              参加者
              <select
                required
                value={playerId}
                disabled={!eventId || busy}
                onChange={(e) => {
                  setPlayerId(e.target.value);
                  setIssued(null);
                }}
              >
                <option value="">参加者を選択</option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}（{player.id.slice(0, 8)}）
                  </option>
                ))}
              </select>
            </label>
            {eventId && !players.length && (
              <p>この大会には参加者がいません。</p>
            )}
            <ErrorBox message={error} />
            <button
              className="primary"
              disabled={
                !eventId || !players.some((p) => p.id === playerId) || busy
              }
            >
              {busy ? "発行中…" : "セッション取得用URLを発行"}
            </button>
          </form>
        )}
        {issued && (
          <section className="panel stack" aria-label="セッション取得用URL">
            <h2>確認を始める端末で開く</h2>
            <p>
              有効期限は{" "}
              {new Date(issued.expiresAt).toLocaleTimeString("ja-JP")}
              （発行から5分）、一度だけ使えます。URLを開き「確認を始める」を押すと、そのブラウザのセッションが切り替わります。
            </p>
            <div className="debug-qr">
              <QRCodeSVG value={issued.handoffUrl} size={180} />
            </div>
            <label>
              引き継ぎURL
              <input
                readOnly
                value={issued.handoffUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            <a className="button primary" href={issued.handoffUrl}>
              このブラウザで確認する →
            </a>
            <p className="muted">
              スマホではQRコードを読み取ってください。確認セッションは1時間で失効します。発行元の管理者権限が失効しても使えなくなります。
            </p>
          </section>
        )}
      </main>
    </>
  );
}

export function DebugSessionStart() {
  const [ticket] = useState(() => location.hash.slice(1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      location.pathname + location.search,
    );
  }, []);
  return (
    <>
      <Header />
      <main className="gate debug-session-page">
        <h1>参加者として動作確認を始める</h1>
        <p>
          このブラウザのセッションを、指定された参加者の確認用セッションに切り替えます。回答や共有設定の変更は実際の大会に反映されます。
        </p>
        <p>
          確認中は管理者・共有画面・他大会の操作ができません。画面上部から確認を終了し、切替前のセッションに戻れます。元のセッションが期限切れの場合はログインし直してください。
        </p>
        <p>
          引き継ぎURLは発行から5分以内、一度限りです。確認用セッションの有効期間は1時間です。
        </p>
        <ErrorBox message={error} />
        <button
          className="primary"
          disabled={busy || !ticket}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await api<{ playPath: string }>(
                "/api/debug/session/redeem",
                { ticket },
              );
              location.assign(result.playPath);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "切替中…" : "確認を始める"}
        </button>
        {!ticket && (
          <p role="alert">引き継ぎURLを管理画面から開き直してください。</p>
        )}
      </main>
    </>
  );
}

export function DebugSessionBanner() {
  const [status, setStatus] = useState<{
    active: boolean;
    canReturn: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ active: boolean; canReturn: boolean }>(
      "/api/debug/session/status",
      undefined,
      controller.signal,
    )
      .then(setStatus)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return status && (status.active || status.canReturn) ? (
    <aside className="debug-session-banner" aria-label="動作確認セッション">
      <span>
        {status.active ? "参加者の動作確認中" : "元のセッションへ戻れます"}
      </span>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/api/debug/session/restore", {});
            location.assign("/");
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {status.canReturn
          ? "確認を終了して元のセッションに戻る"
          : "動作確認を終了"}
      </button>
      <ErrorBox message={error} />
    </aside>
  ) : null;
}
