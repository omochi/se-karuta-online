import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLoaderData } from "react-router";
import { CHOICES } from "../shared/types";
import { api } from "./api";
import { botAnswerDelay } from "./bot-answer-timing";
import { Header, ErrorBox } from "./components";
import { RoomSession } from "./RoomSession";
import type { BotsData } from "./route-loaders";
import "./bots.css";

const emptySnapshot: ReturnType<RoomSession["getSnapshot"]> = {
  view: null,
  connected: false,
  error: "",
  busy: false,
  pending: null,
  unauthorized: false,
  generation: 0,
};
const noSubscribe = () => () => {};
const getEmptySnapshot = () => emptySnapshot;

type Bot = { id: string; name: string };
function BotCard({
  bot,
  eventId,
  origin,
  connect,
  autoReady,
  autoAnswer,
}: {
  bot: Bot;
  eventId: string;
  origin: string;
  connect: boolean;
  autoReady: boolean;
  autoAnswer: boolean;
}) {
  const [enabled, setEnabled] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<RoomSession | null>(null);
  const [failure, setFailure] = useState("");
  const lastReady = useRef("");
  const answerSchedule = useRef<{
    session: RoomSession;
    roundId: string;
    at: number;
  } | null>(null);
  const snapshot = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.getSnapshot ?? getEmptySnapshot,
    getEmptySnapshot,
  );
  const { view, pending, generation, unauthorized, error } = snapshot;
  const connected = connect && enabled && snapshot.connected && !failure;
  const roundId = view?.question?.id;
  const answer = view?.me?.answer;
  const eligible = view?.me?.participation === "eligible";
  const key = `${generation}:${view?.epoch}:${roundId}`;
  useEffect(() => {
    if (connect) setEnabled(true);
  }, [connect]);
  useEffect(() => {
    setFailure("");
    lastReady.current = "";
    if (!connect || !enabled) return;
    const next = new RoomSession(eventId, "player", origin, bot.id);
    setSession(next);
    let active = true;
    void next.ready.catch((e: unknown) => {
      if (active)
        setFailure(e instanceof Error ? e.message : "接続できませんでした。");
    });
    return () => {
      active = false;
      next.dispose();
    };
  }, [eventId, origin, bot.id, connect, enabled, attempt]);
  useEffect(() => {
    if (
      !session ||
      !autoReady ||
      !connected ||
      !eligible ||
      view?.phase !== "choicesPreparing" ||
      !roundId ||
      lastReady.current === key
    )
      return;
    if (session.send({ type: "ready", roundId, epoch: view.epoch })) {
      lastReady.current = key;
    }
  }, [
    session,
    autoReady,
    connected,
    eligible,
    view?.phase,
    view?.epoch,
    roundId,
    key,
  ]);
  useEffect(() => {
    if (!autoAnswer || !connected || view?.phase !== "acceptingAnswers")
      answerSchedule.current = null;
    if (
      !session ||
      !autoAnswer ||
      !connected ||
      !eligible ||
      view?.phase !== "acceptingAnswers" ||
      !roundId ||
      view.phaseEndsAt === null ||
      answer ||
      pending
    )
      return;
    const now = session.serverNow();
    // 配信や締切延長で抽選し直さず、問題ごとに決めた回答予定を保つ。
    if (
      answerSchedule.current?.session !== session ||
      answerSchedule.current.roundId !== roundId
    ) {
      const delay = botAnswerDelay(view.phaseEndsAt - now);
      if (delay === null) return;
      answerSchedule.current = { session, roundId, at: now + delay };
    }
    const timer = setTimeout(
      () => session.answer(CHOICES[Math.floor(Math.random() * CHOICES.length)]),
      Math.max(0, answerSchedule.current.at - now),
    );
    return () => clearTimeout(timer);
  }, [
    session,
    autoAnswer,
    connected,
    eligible,
    view?.phase,
    view?.phaseEndsAt,
    roundId,
    answer,
    pending,
  ]);
  const status = unauthorized
    ? "認証切れ"
    : !connect || !enabled
      ? "切断中"
      : failure
        ? "接続失敗"
        : connected
          ? "接続中"
          : "接続待ち";
  return (
    <article className={`bot-card ${connected ? "is-connected" : ""}`}>
      <div className="bot-card-heading">
        <h2>{bot.name}</h2>
        <span className="bot-status">{status}</span>
      </div>
      <dl>
        <div>
          <dt>準備</dt>
          <dd>
            {!connected
              ? "—"
              : !roundId || !eligible
                ? "対象外"
                : view.me?.ready
                  ? "準備完了"
                  : view?.phase === "choicesPreparing"
                    ? "準備待ち"
                    : "—"}
          </dd>
        </div>
        <div>
          <dt>回答</dt>
          <dd>
            {answer
              ? `${answer.choice} を回答`
              : pending
                ? `${pending.choice} を${connected ? "送信中" : "再送待ち"}`
                : !roundId || !eligible
                  ? "対象外"
                  : view?.phase === "acceptingAnswers"
                    ? "回答待ち"
                    : "未回答"}
          </dd>
        </div>
      </dl>
      {(failure || error) && (
        <p className="bot-error" role="alert">
          {failure || error}
        </p>
      )}
      <div className="links">
        <button
          className="secondary"
          disabled={!connect}
          onClick={() => setEnabled(!enabled)}
        >
          {enabled ? "切断する" : "接続する"}
        </button>
        {(failure || unauthorized) && (
          <button
            className="secondary"
            disabled={!connect || !enabled}
            onClick={() => setAttempt(attempt + 1)}
          >
            再試行
          </button>
        )}
      </div>
    </article>
  );
}
export default function BotPage() {
  const data = useLoaderData<BotsData>();
  const [bots, setBots] = useState<Bot[]>(data.bots);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connect, setConnect] = useState(true);
  const [autoReady, setAutoReady] = useState(true);
  const [autoAnswer, setAutoAnswer] = useState(true);
  async function add(count: number) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ bots: Bot[] }>(`/api/e/${data.id}/bots`, {
        count,
      });
      setBots(result.bots);
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header>
        <span className="role-tag">BOTS</span>
      </Header>
      <main className="bots-page">
        <div className="page-title">
          <div>
            <p className="eyebrow">MULTIPLAYER TEST</p>
            <h1>ボット</h1>
            <p>{data.name}</p>
          </div>
          <span className="bot-total">{bots.length} 人</span>
        </div>
        <section className="panel bot-controls" aria-label="ボット操作">
          <div className="links">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void add(10)}
            >
              10人追加
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void add(1)}
            >
              1人追加
            </button>
            <button className="secondary" onClick={() => setConnect(!connect)}>
              {connect ? "全ボットを切断" : "全ボットを接続"}
            </button>
          </div>
          <div className="bot-options">
            <label>
              <input
                type="checkbox"
                checked={autoReady}
                onChange={(e) => setAutoReady(e.target.checked)}
              />
              自動で準備完了
            </label>
            <label>
              <input
                type="checkbox"
                checked={autoAnswer}
                onChange={(e) => setAutoAnswer(e.target.checked)}
              />
              自動で回答（残り回答時間の20〜90%でランダム選択）
            </label>
          </div>
          <p className="muted">
            このタブでボットが動作します。タブを閉じると接続は終了し、参加者と回答の記録は残ります。追加したボットは次の問題から回答対象になります。
          </p>
        </section>
        <ErrorBox message={error} />
        {bots.length === 0 ? (
          <section className="panel">
            <p>ボットを追加すると、ここに各ボットの状態が表示されます。</p>
          </section>
        ) : (
          <div className="bot-grid">
            {bots.map((bot) => (
              <BotCard
                key={bot.id}
                bot={bot}
                eventId={data.id}
                origin={data.publicOrigin}
                connect={connect}
                autoReady={autoReady}
                autoAnswer={autoAnswer}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
