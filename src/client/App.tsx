import { useEffect, useState, type FormEvent } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import type { HomeData, GameData } from "./route-loaders";
import type { RoomSession } from "./RoomSession";
import type { EventUrls } from "../shared/urls";
import type { TimingSettings } from "../shared/types";
import { useRoom, type RoomConnection } from "./useRoom";
import { api } from "./api";
import {
  Choices,
  ConnectionBadge,
  ErrorBox,
  FinalResults,
  Header,
  JoinCode,
  MarkdownBody,
  PasswordForm,
  Ranking,
} from "./components";
import { GameProgress } from "./GameProgress";
import { DisplayScreen } from "./DisplayScreen";
import { useGameProgress } from "./useGameProgress";
import { PlayerAnswerStatus } from "./PlayerAnswerStatus";
export function Home() {
  const { events } = useLoaderData<HomeData>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [questions, setQuestions] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ id: string; urls: EventUrls }>("/api/events", {
        name,
        displayPassword: password,
        questions,
      });
      await navigate(new URL(data.urls.control).pathname);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header>
        <Link className="viewer-home-link" to="/questions">
          問題ビューワ →
        </Link>
      </Header>
      <main className="home">
        <section className="hero">
          <p className="eyebrow">SWIFT EVOLUTION KARUTA ONLINE</p>
          <h1>
            そのひらめきで、
            <br />
            一枚を取ろう。
          </h1>
          <p className="hero-copy">
            あのコードを可能にした Proposal はどれ？
            <br />
            みんなで前を向いて楽しむ、Swift Evolution の4択カルタ。
          </p>
          <div className="hero-cards" aria-hidden="true">
            {["A", "B", "C", "D"].map((c, i) => (
              <div className={`mini-card mini-${i}`} key={c}>
                <span>SE</span>
                <strong>{c}</strong>
                <small>EVOLUTION</small>
              </div>
            ))}
          </div>
        </section>
        <section className="home-panel">
          {events === null ? (
            <>
              <p className="eyebrow">FOR THE HOST</p>
              <h2>大会の準備をはじめる</h2>
              <p className="muted">参加する人は、会場のQRコードからどうぞ。</p>
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
            </>
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">YOUR TOURNAMENTS</p>
                  <h2>大会一覧</h2>
                </div>
                <button
                  className="primary"
                  onClick={() => setShowCreate(!showCreate)}
                >
                  ＋ 大会をつくる
                </button>
              </div>
              <ErrorBox message={error} />
              {showCreate && (
                <form className="create-form stack" onSubmit={create}>
                  <label>
                    大会名
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={80}
                      required
                      placeholder="Swift好きのためのカルタ大会"
                    />
                  </label>
                  <label>
                    Display 用パスワード
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={4}
                      required
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="file-picker">
                    問題ファイル（JSON）
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        setQuestions(null);
                        if (!file) return;
                        try {
                          const input = JSON.parse(await file.text());
                          setQuestions(input.questions ?? input);
                          setFileName(file.name);
                          setError("");
                        } catch {
                          setError("JSONファイルを読み込めませんでした。");
                        }
                      }}
                    />
                    <span>{fileName || "レビュー済みの問題を選択"}</span>
                  </label>
                  <button className="primary" disabled={busy || !questions}>
                    {busy ? "作成中…" : "大会を作成する →"}
                  </button>
                </form>
              )}
              {events.length === 0 ? (
                <p className="empty-small muted">
                  まだ大会はありません。最初の大会をつくろう。
                </p>
              ) : (
                <div className="event-list">
                  {events.map((event) => (
                    <Link
                      className="event-card"
                      key={event.id}
                      to={new URL(event.urls.control).pathname}
                    >
                      <div>
                        <small>
                          {new Date(event.created_at).toLocaleDateString(
                            "ja-JP",
                          )}
                        </small>
                        <h3>{event.name}</h3>
                      </div>
                      <span>進行画面へ →</span>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
        <footer>SE Karuta · Made for people who love Swift.</footer>
      </main>
    </>
  );
}
export function GamePage() {
  const data = useLoaderData<GameData>();
  return data.session ? (
    <ConnectedGame session={data.session} />
  ) : (
    <GameGate key={`${data.id}:${data.role}`} data={data} />
  );
}
function ConnectedGame({ session }: { session: RoomSession }) {
  const room = useRoom(session);
  const revalidator = useRevalidator();
  const unauthorized = session.getSnapshot().unauthorized;
  useEffect(() => {
    if (unauthorized) void revalidator.revalidate();
  }, [unauthorized, revalidator.revalidate]);
  return session.role === "control" ? (
    <Control room={room} />
  ) : session.role === "display" ? (
    <Display room={room} />
  ) : (
    <Player room={room} />
  );
}
function GameGate({ data }: { data: GameData }) {
  const { id, role, name: eventName } = data;
  const revalidator = useRevalidator();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/e/${id}/join`, { name });
      await revalidator.revalidate();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header />
      <main className="gate">
        <p className="eyebrow">
          {role === "player"
            ? "READY TO PLAY?"
            : role === "display"
              ? "SHARED DISPLAY"
              : "HOST CONTROL"}
        </p>
        <h1>{eventName || "SE Karuta"}</h1>
        {role === "player" ? (
          <>
            <p className="muted">名前を入れたら、前のモニターを見て待とう。</p>
            <form onSubmit={join} className="stack">
              <label>
                みんなに表示する名前
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={20}
                  placeholder="なまえ"
                  autoComplete="nickname"
                  required
                  autoFocus
                />
              </label>
              <ErrorBox message={error} />
              <button className="primary" disabled={busy}>
                {busy ? "参加中…" : "参加する →"}
              </button>
            </form>
          </>
        ) : (
          <PasswordForm
            label={
              role === "control" ? "管理用パスワード" : "Display 用パスワード"
            }
            error={error}
            onSubmit={async (password) => {
              try {
                await api(
                  role === "control"
                    ? "/api/admin/login"
                    : `/api/e/${id}/display/login`,
                  { password },
                );
                await revalidator.revalidate();
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        )}
      </main>
    </>
  );
}
function TimingSettingsForm({ room }: { room: RoomConnection }) {
  const v = room.view!;
  const [draft, setDraft] = useState<TimingSettings | null>(null);
  const values = draft ?? v.timing;
  const fields = [
    ["countdownSeconds", "選択肢公開前のカウントダウン"],
    ["readingSeconds", "選択肢を読んで出題を待つ時間"],
    ["answeringSeconds", "問題の表示・回答時間"],
  ] as const;
  // サーバーが保存した値を受信して初めて編集状態を解除する。
  useEffect(() => {
    if (draft && fields.every(([key]) => draft[key] === v.timing[key]))
      setDraft(null);
  }, [draft, v.timing]);
  return (
    <section className="panel">
      <h2>時間の設定</h2>
      <form
        className="stack timing-settings"
        onSubmit={(e) => {
          e.preventDefault();
          room.command("updateTiming", { timing: values });
        }}
      >
        {fields.map(([key, label]) => (
          <label key={key}>
            {label}（秒）
            <input
              type="number"
              min={1}
              max={600}
              step={1}
              required
              value={Number.isNaN(values[key]) ? "" : values[key]}
              disabled={v.phase === "finished"}
              onChange={(e) =>
                setDraft({ ...values, [key]: e.target.valueAsNumber })
              }
            />
          </label>
        ))}
        <p className="muted">
          進行中の時間は変わりません。次に始まる段階から反映します。
        </p>
        <button
          className="secondary"
          disabled={
            !draft || room.busy || !room.connected || v.phase === "finished"
          }
        >
          {room.busy ? "保存中…" : "時間設定を保存"}
        </button>
      </form>
    </section>
  );
}
export function Control({ room }: { room: RoomConnection }) {
  const v = room.view!;
  const progress = useGameProgress(room);
  const [reason, setReason] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const preparatory = [
    "choicesPreparing",
    "choicesReading",
    "countdown",
  ].includes(v.phase);
  const readyForNext = ["waiting", "rankingShown", "questionVoided"].includes(
    v.phase,
  );
  const canVoid =
    v.question && !["finished", "questionVoided"].includes(v.phase);
  const disabled = !room.connected || room.busy;
  return (
    <>
      <Header>
        <span className="role-tag">CONTROL</span>
        <ConnectionBadge connected={room.connected} />
      </Header>
      <main className="control">
        <div className="page-title">
          <div>
            <p className="eyebrow">HOST YOUR GAME</p>
            <h1>{v.name}</h1>
          </div>
          <div className="links">
            <Link className="button secondary" to={`/questions?event=${v.id}`}>
              問題ビューワ →
            </Link>
            <a
              className="button secondary"
              href={v.urls.display}
              target="_blank"
              rel="noreferrer"
            >
              Display を開く ↗
            </a>
            <a
              className="button secondary"
              href={v.urls.play}
              target="_blank"
              rel="noreferrer"
            >
              参加画面 ↗
            </a>
          </div>
        </div>
        <ErrorBox message={room.error} />
        <div className="control-layout">
          <section className="control-main">
            <div className="progress-panel">
              <GameProgress progress={progress} layout="control" />
              <div className="host-actions">
                {readyForNext && v.hasNext && (
                  <button
                    className="primary"
                    disabled={disabled || v.playerCount === 0}
                    onClick={() => room.command("start")}
                  >
                    {v.questionNumber
                      ? "次の問題を開始"
                      : "全員の準備確認を開始"}{" "}
                    →
                  </button>
                )}
                {progress.answering && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => room.command("close")}
                  >
                    回答を締め切る
                  </button>
                )}
                {v.phase === "answersClosed" && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => room.command("reveal")}
                  >
                    正解を発表する →
                  </button>
                )}
                {v.phase === "answerRevealed" && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => room.command("ranking")}
                  >
                    ランキングを表示 →
                  </button>
                )}
                {readyForNext && (
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() => setFinishOpen(true)}
                  >
                    大会を終了する
                  </button>
                )}
              </div>
            </div>
            {finishOpen && (
              <div className="confirmation">
                <h3>大会を終了しますか？</h3>
                <p>未出題の問題は集計せず、最終結果を公開します。</p>
                <div className="links">
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => {
                      room.command("finish");
                      setFinishOpen(false);
                    }}
                  >
                    終了して結果を公開
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setFinishOpen(false)}
                  >
                    戻る
                  </button>
                </div>
              </div>
            )}
            {v.phase === "finished" && v.results ? (
              <FinalResults results={v.results} />
            ) : (
              <>
                {v.phase === "rankingShown" && (
                  <section className="panel">
                    <Ranking rows={v.rankings ?? []} />
                  </section>
                )}
                {v.preview && (
                  <section className="panel preview">
                    <p className="eyebrow">
                      {readyForNext ? "NEXT QUESTION" : "HOST PREVIEW"} ·
                      進行役だけに表示
                    </p>
                    <MarkdownBody text={v.preview.bodyMarkdown} />
                    <Choices
                      question={{
                        id: v.preview.id,
                        choices: v.preview.choices,
                        correctChoice: v.preview.correctChoice,
                      }}
                      showCorrect
                    />
                    <div className="explanation">
                      <strong>正解 {v.preview.correctChoice}</strong>
                      <MarkdownBody text={v.preview.explanationMarkdown} />
                    </div>
                  </section>
                )}
                {v.phase === "waiting" && (
                  <section className="panel">
                    <JoinCode url={v.urls.play} />
                  </section>
                )}
              </>
            )}
            {canVoid && (
              <div className="danger-zone">
                {!voidOpen ? (
                  <button
                    className="text-button danger"
                    onClick={() => setVoidOpen(true)}
                  >
                    この問題を無効にしてスキップ…
                  </button>
                ) : (
                  <div className="stack">
                    <label>
                      無効にする理由
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="問題の誤り・会場の通信トラブルなど"
                        maxLength={300}
                      />
                    </label>
                    <p className="muted">
                      回答は記録に残し、すべての集計から除外します。
                    </p>
                    <div className="links">
                      <button
                        className="danger-button"
                        disabled={disabled || !reason.trim()}
                        onClick={() => {
                          room.command("void", { reason });
                          setVoidOpen(false);
                          setReason("");
                        }}
                      >
                        この問題を無効にする
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setVoidOpen(false)}
                      >
                        戻る
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
          <aside className="control-sidebar">
            <TimingSettingsForm room={room} />
            <section className="panel">
              <div className="section-heading">
                <h2>参加者</h2>
                <span className="pill">{v.playerCount} 人</span>
              </div>
              <div className="roster">
                {v.players?.map((p) => (
                  <div className="person" key={p.id}>
                    <i className={`presence-dot ${p.online ? "online" : ""}`} />
                    <div>
                      <strong>{p.name}</strong>
                      <small>
                        {p.id.slice(0, 4)} ·{" "}
                        {p.participation === "resting"
                          ? "お休み"
                          : p.answered
                            ? "回答済み"
                            : p.ready
                              ? "準備完了"
                              : p.online
                                ? "接続中"
                                : "未接続"}
                      </small>
                    </div>
                    {preparatory && p.participation === "eligible" && (
                      <button
                        className="rest-button"
                        disabled={disabled}
                        onClick={() => room.command("rest", { playerId: p.id })}
                      >
                        この問題はお休み
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {!v.playerCount && (
                <p className="muted empty-small">
                  参加者の入室を待っています。
                </p>
              )}
            </section>
            <section className="panel">
              <h2>共有画面</h2>
              {v.displays?.length ? (
                v.displays.map((d) => (
                  <div className="display-device" key={d.id}>
                    <div>
                      <strong>{d.label}</strong>
                      <small>
                        {d.selected ? "会場用" : "閲覧のみ"} ·{" "}
                        {d.ready ? "準備完了" : "準備待ち"}
                      </small>
                    </div>
                    {!d.selected && (
                      <button
                        className="secondary compact-button"
                        disabled={
                          disabled ||
                          ![
                            "waiting",
                            "choicesPreparing",
                            "rankingShown",
                            "questionVoided",
                          ].includes(v.phase)
                        }
                        onClick={() =>
                          room.command("selectDisplay", { displayId: d.id })
                        }
                      >
                        会場用にする
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted">共有画面を開いて接続してください。</p>
              )}
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
export function Display({ room }: { room: RoomConnection }) {
  const progress = useGameProgress(room);
  return (
    <DisplayScreen
      view={room.view!}
      progress={progress}
      status={<ConnectionBadge connected={room.connected} />}
    />
  );
}
export function Player({ room }: { room: RoomConnection }) {
  const v = room.view!;
  const me = v.me;
  const q = v.question;
  const progress = useGameProgress(room);
  const eligible = me?.participation === "eligible";
  const revealed = ["answerRevealed", "rankingShown"].includes(v.phase);
  const active =
    room.connected &&
    progress.answering &&
    eligible &&
    !me?.answer &&
    !room.pending;
  const showChoices =
    eligible && !["waiting", "questionVoided", "finished"].includes(v.phase);
  return (
    <>
      <Header>
        <ConnectionBadge connected={room.connected} />
      </Header>
      <main className="player-page">
        <div className="player-heading">
          <p className="eyebrow">{v.name}</p>
          <span className="player-name">{me?.name}</span>
        </div>
        <ErrorBox message={room.error} />
        {!room.connected && (
          <p className="connection-notice" role="status">
            接続を取り戻しています。画面を開いたままお待ちください。
          </p>
        )}
        <GameProgress progress={progress} layout="player" />
        <PlayerAnswerStatus room={room} progress={progress} />
        {v.phase === "finished" && v.results && (
          <FinalResults results={v.results} />
        )}
        {showChoices && q && (
          <Choices
            key={q.id}
            question={q}
            selected={me?.answer?.choice ?? room.pending?.choice}
            disabled={!active}
            onChoose={room.answer}
            showCorrect={revealed}
          />
        )}
        {active && (
          <p className="answer-hint">
            回答は一度だけ。押したら変更できません。
          </p>
        )}
      </main>
    </>
  );
}
