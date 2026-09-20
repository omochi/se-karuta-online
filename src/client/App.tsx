import { useCallback, useEffect, useState, type FormEvent } from "react";
import QuestionViewer from "./QuestionViewer";
import { usePublicOrigin } from "./config";
import type { EventUrls } from "../shared/urls";
import type { Role } from "../shared/types";
import { api, useRoom, type RoomConnection } from "./useRoom";
import {
  Brand,
  Choices,
  ConnectionBadge,
  Countdown,
  ErrorBox,
  FinalResults,
  Header,
  JoinCode,
  MarkdownBody,
  PasswordForm,
  PHASE_LABELS,
  Ranking,
} from "./components";
function Home() {
  const origin = usePublicOrigin();
  const [events, setEvents] = useState<Array<{
    id: string;
    name: string;
    created_at: number;
    urls: EventUrls;
  }> | null>(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [questions, setQuestions] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const reload = () =>
    api<{
      events: Array<{
        id: string;
        name: string;
        created_at: number;
        urls: EventUrls;
      }>;
    }>("/api/events")
      .then((data) => setEvents(data.events))
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      });
  useEffect(() => {
    void reload();
  }, []);
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
      location.href = data.urls.control;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header>
        <a className="viewer-home-link" href={`${origin}/questions`}>
          問題ビューワ →
        </a>
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
                    await reload();
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
                    <a
                      className="event-card"
                      key={event.id}
                      href={event.urls.control}
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
                    </a>
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
function GamePage({ id, role }: { id: string; role: Role }) {
  const [granted, setGranted] = useState(false);
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState("");
  const [eventName, setEventName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const unauthorized = useCallback(() => setGranted(false), []);
  const room = useRoom(id, role, granted, unauthorized);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const info = await api<{ name: string }>(`/api/e/${id}`);
        if (live) setEventName(info.name);
        await api(`/api/e/${id}/session?role=${role}`);
        if (live) setGranted(true);
      } catch (e) {
        if (live && (e as { status?: number }).status !== 401)
          setError((e as Error).message);
      } finally {
        if (live) setChecking(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [id, role]);
  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/e/${id}/join`, { name });
      setGranted(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (checking)
    return (
      <div className="loading">
        <Brand />
        <p>大会を読み込んでいます…</p>
      </div>
    );
  if (!granted)
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
              <p className="muted">
                名前を入れたら、前のモニターを見て待とう。
              </p>
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
                  setGranted(true);
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
  if (!room.view)
    return (
      <div className="loading">
        <Brand />
        <p>大会に接続しています…</p>
        <ErrorBox message={room.error} />
      </div>
    );
  return role === "control" ? (
    <Control room={room} />
  ) : role === "display" ? (
    <Display room={room} />
  ) : (
    <Player room={room} />
  );
}
function Control({ room }: { room: RoomConnection }) {
  const v = room.view!;
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
            <a
              className="button secondary"
              href={`${v.urls.home}questions?event=${v.id}`}
            >
              問題ビューワ ↗
            </a>
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
              <div>
                <span className="question-index">
                  QUESTION {String(v.questionNumber).padStart(2, "0")}{" "}
                  <small>/ {v.totalQuestions}</small>
                </span>
                <h2>{PHASE_LABELS[v.phase]}</h2>
              </div>
              {v.phaseEndsAt !== null && (
                <Countdown view={v} receivedAt={room.receivedAt} />
              )}
              <div className="stats">
                <div>
                  <strong>
                    {v.readyCount}
                    <small> / {v.eligibleCount}</small>
                  </strong>
                  <span>表示完了</span>
                </div>
                <div>
                  <strong>
                    {v.answerCount}
                    <small> / {v.eligibleCount}</small>
                  </strong>
                  <span>回答済み</span>
                </div>
                <div>
                  <strong>{v.displayReady ? "✓" : "—"}</strong>
                  <span>Display の準備</span>
                </div>
              </div>
              <div className="host-actions">
                {readyForNext && v.hasNext && (
                  <button
                    className="primary"
                    disabled={disabled || v.playerCount === 0}
                    onClick={() => room.command("start")}
                  >
                    {v.questionNumber
                      ? "次の問題を開始"
                      : "選択肢を公開して開始"}{" "}
                    →
                  </button>
                )}
                {v.phase === "acceptingAnswers" && (
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
              {v.phase === "choicesPreparing" && (
                <p className="muted">
                  全員と Display の準備が整うと、読む時間10秒 →
                  出題まで5秒へ自動で進みます。
                </p>
              )}
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
                    <h2>この問題の結果</h2>
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
                              ? "表示完了"
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
              <h2>共有 Display</h2>
              {v.displays?.length ? (
                v.displays.map((d) => (
                  <div className="display-device" key={d.id}>
                    <div>
                      <strong>{d.label}</strong>
                      <small>
                        {d.selected ? "会場用" : "閲覧のみ"} ·{" "}
                        {d.ready ? "表示完了" : "準備待ち"}
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
                <p className="muted">Display を開いて接続してください。</p>
              )}
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
function Display({ room }: { room: RoomConnection }) {
  const v = room.view!;
  const q = v.question;
  const revealing = ["answerRevealed", "rankingShown"].includes(v.phase);
  return (
    <div className="display-page">
      <header className="display-header">
        <Brand small />
        <span className="display-event">{v.name}</span>
        <ConnectionBadge connected={room.connected} />
      </header>
      <main className={`display-content phase-${v.phase}`}>
        <div className="display-meta">
          <span className="eyebrow">
            {v.questionNumber
              ? `QUESTION ${String(v.questionNumber).padStart(2, "0")} / ${v.totalQuestions}`
              : "WELCOME TO SE KARUTA"}
          </span>
          <span className="phase-pill">{PHASE_LABELS[v.phase]}</span>
        </div>
        {v.phase === "waiting" ? (
          <div className="display-welcome">
            <div>
              <p className="eyebrow">KNOW IT. FIND IT. TAP IT.</p>
              <h1>
                そのコード、
                <br />
                どの Proposal？
              </h1>
              <p>選択肢を読んで、問題が出たらスマホで回答。</p>
              <strong className="player-total">
                {v.playerCount}
                <small> 人が参加中</small>
              </strong>
            </div>
            <JoinCode url={v.urls.play} />
          </div>
        ) : v.phase === "finished" && v.results ? (
          <>
            <h1 className="results-heading">知識とひらめきに、拍手を。</h1>
            <FinalResults results={v.results} compact />
          </>
        ) : v.phase === "questionVoided" ? (
          <div className="center-stage">
            <p className="eyebrow">NEXT CHANCE</p>
            <h1>この問題はお休み。</h1>
            <p>{q?.voidReason}</p>
            <p className="muted">この問題の回答は成績に含めません。</p>
          </div>
        ) : v.phase === "rankingShown" ? (
          <div className="display-ranking">
            <div>
              <p className="eyebrow">QUICK & CORRECT</p>
              <h1>
                この一問の、
                <br />
                先着たち。
              </h1>
              <p>
                正解 {q?.correctChoice} ·{" "}
                {q?.correctChoice && q.choices[q.correctChoice]}
              </p>
            </div>
            <Ranking rows={v.rankings ?? []} limit={8} />
          </div>
        ) : (
          <>
            {q?.bodyMarkdown ? (
              <section className="question-body">
                <MarkdownBody text={q.bodyMarkdown} />
              </section>
            ) : (
              <div className="pre-question">
                <div>
                  <h1>
                    {v.phase === "choicesPreparing"
                      ? "みんなの準備を待っています"
                      : v.phase === "choicesReading"
                        ? "まずは、選択肢を読もう。"
                        : "まもなく、問題です。"}
                  </h1>
                  <p>
                    {v.phase === "choicesPreparing"
                      ? `${v.readyCount} / ${v.eligibleCount} 人の表示が完了`
                      : "問題が出るまで、回答ボタンは押せません。"}
                  </p>
                </div>
                <Countdown view={v} receivedAt={room.receivedAt} />
              </div>
            )}
            {q && <Choices question={q} showCorrect={revealing} />}{" "}
            {revealing && q?.explanationMarkdown && (
              <div className="display-explanation">
                <strong>正解 {q.correctChoice}</strong>
                <MarkdownBody text={q.explanationMarkdown} />
              </div>
            )}
          </>
        )}
      </main>
      <footer className="display-footer">
        <span>Swift Evolution Karuta Online</span>
        <span>
          {v.phase === "acceptingAnswers"
            ? `${v.answerCount} / ${v.eligibleCount} ANSWERED`
            : "知識と、ひらめきと、少しの速さ。"}
        </span>
      </footer>
    </div>
  );
}
function Player({ room }: { room: RoomConnection }) {
  const v = room.view!;
  const me = v.me;
  const q = v.question;
  const resting = me?.participation === "resting";
  const waiting = me?.participation === "waiting";
  const answered = !!me?.answer;
  const revealed = ["answerRevealed", "rankingShown"].includes(v.phase);
  const active =
    room.connected &&
    v.phase === "acceptingAnswers" &&
    !answered &&
    !room.pending &&
    !resting &&
    !waiting;
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
        {v.phase === "finished" && v.results ? (
          <>
            <div className="player-message">
              <p className="eyebrow">THANK YOU FOR PLAYING</p>
              <h1>おつかれさまでした！</h1>
            </div>
            <FinalResults results={v.results} />
          </>
        ) : v.phase === "waiting" || waiting ? (
          <div className="player-waiting">
            <span className="waiting-symbol">✦</span>
            <h1>
              {v.phase === "waiting"
                ? "参加できました！"
                : "次の問題から参加します"}
            </h1>
            <p>
              前のモニターを見て待とう。
              <br />
              画面は自動で切り替わります。
            </p>
            <span className="pill">{v.playerCount} 人が参加中</span>
          </div>
        ) : v.phase === "questionVoided" ? (
          <div className="player-message">
            <p className="eyebrow">QUESTION {v.questionNumber}</p>
            <h1>この問題は無効です</h1>
            <p>{q?.voidReason}</p>
            <p className="muted">次の問題を待とう。</p>
          </div>
        ) : resting ? (
          <div className="player-message">
            <p className="eyebrow">QUESTION {v.questionNumber}</p>
            <h1>
              この問題は
              <br />
              お休みです。
            </h1>
            <p>次の問題から、また参加できます。</p>
          </div>
        ) : (
          <>
            <section
              className={`player-message ${revealed && me?.correct ? "success" : ""}`}
            >
              <p className="eyebrow">
                QUESTION {String(v.questionNumber).padStart(2, "0")} /{" "}
                {v.totalQuestions}
              </p>
              <h1>
                {revealed
                  ? answered
                    ? me?.correct
                      ? "正解！"
                      : "おしい、不正解。"
                    : "今回は未回答でした"
                  : room.pending
                    ? "回答を送信中…"
                    : answered
                      ? "回答しました！"
                      : v.phase === "acceptingAnswers"
                        ? "答えを選ぼう。"
                        : v.phase === "answersClosed"
                          ? "回答を締め切りました"
                          : v.phase === "choicesReading"
                            ? "選択肢を読んでおこう"
                            : v.phase === "countdown"
                              ? "前のモニターに注目！"
                              : "みんなの準備待ち"}
              </h1>
              {v.phaseEndsAt !== null && !answered && (
                <Countdown view={v} receivedAt={room.receivedAt} />
              )}{" "}
              {revealed && me?.correct && (
                <div className="personal-result">
                  <strong>
                    {me.rank}
                    <small> 位</small>
                  </strong>
                  <span>
                    正解者 {me.correctCount} 人中
                    <br />
                    {((me.elapsed ?? 0) / 1000).toFixed(3)} sec
                  </span>
                </div>
              )}
              {answered && !revealed && (
                <p>
                  回答 <strong>{me?.answer?.choice}</strong> を受け付けました。
                  <br />
                  前のモニターで正解発表を待とう。
                </p>
              )}
              {revealed && q?.correctChoice && (
                <p>
                  正解は <strong>{q.correctChoice}</strong> ·{" "}
                  {q.choices[q.correctChoice]}
                </p>
              )}
            </section>
            {q && (
              <Choices
                question={q}
                selected={me?.answer?.choice ?? room.pending?.choice}
                disabled={!active}
                onChoose={room.answer}
                showCorrect={revealed}
              />
            )}{" "}
            {active && (
              <p className="answer-hint">
                回答は一度だけ。押したら変更できません。
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
export default function App() {
  if (/^\/questions\/?$/.test(location.pathname)) return <QuestionViewer />;
  const match = /^\/e\/([a-zA-Z0-9-]+)\/(control|display|play)\/?$/.exec(
    location.pathname,
  );
  return match ? (
    <GamePage
      id={match[1]}
      role={match[2] === "play" ? "player" : (match[2] as Role)}
    />
  ) : (
    <Home />
  );
}
