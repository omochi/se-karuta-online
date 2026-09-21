import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicOrigin } from "./config";
import type {
  Choice,
  ClientMessage,
  Command,
  Role,
  RoomView,
  ServerMessage,
  TimingSettings,
} from "../shared/types";
// LAN の HTTP 接続でも動くよう、Secure Context 限定の randomUUID に依存しない。
function clientRequestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function api<T = { ok: boolean }>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? "通信に失敗しました。"), {
      status: response.status,
    });
  return data;
}
interface Pending {
  type: "answer";
  requestId: string;
  roundId: string;
  choice: Choice;
}
export function useRoom(
  id: string,
  role: Role,
  enabled: boolean,
  onUnauthorized: () => void,
) {
  const publicOrigin = usePublicOrigin();
  const [view, setView] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const busyRef = useRef<string | null>(null);
  const lastReady = useRef("");
  const receivedAt = useRef(performance.now());
  const storageKey = `se-pending-${id}`;
  const remember = useCallback(
    (value: Pending | null) => {
      pendingRef.current = value;
      setPending(value);
      try {
        if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
        else sessionStorage.removeItem(storageKey);
      } catch {}
    },
    [storageKey],
  );
  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(JSON.stringify(message));
    return true;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    if (role === "player") {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (saved?.type === "answer") remember(saved);
      } catch {}
    }
    const connect = async () => {
      try {
        await api(`/api/e/${id}/session?role=${role}`);
      } catch (e) {
        if (stopped) return;
        if ((e as { status?: number }).status === 401) {
          onUnauthorized();
          return;
        }
        setError("接続を待っています…");
        retry = setTimeout(connect, 2000);
        return;
      }
      if (stopped) return;
      const url = new URL(`/api/e/${id}/ws?role=${role}`, publicOrigin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setConnected(true);
        setError("");
        lastReady.current = "";
        send({ type: "ping" });
        if (pendingRef.current) send(pendingRef.current);
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "state") {
          receivedAt.current = performance.now();
          setView(message);
          if (
            pendingRef.current &&
            (pendingRef.current.roundId !== message.question?.id ||
              message.me?.answer)
          )
            remember(null);
        } else if (message.type === "ack") {
          if (message.requestId === pendingRef.current?.requestId)
            remember(null);
          if (message.requestId === busyRef.current) {
            busyRef.current = null;
            setBusy(false);
          }
        } else {
          setError(message.message);
          if (message.requestId === pendingRef.current?.requestId)
            remember(null);
          if (message.requestId === busyRef.current) {
            busyRef.current = null;
            setBusy(false);
          }
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setConnected(false);
        lastReady.current = "";
        busyRef.current = null;
        setBusy(false);
        retry = setTimeout(connect, Math.min(5000, 500 * 2 ** attempts++));
      };
      ws.onerror = () => ws.close();
    };
    void connect();
    const heartbeat = setInterval(() => {
      send({ type: "ping" });
      if (pendingRef.current) send(pendingRef.current);
    }, 10000);
    const visible = () => {
      if (document.visibilityState === "visible") {
        lastReady.current = "";
        send({ type: "ping" });
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", visible);
      socket.current?.close();
      socket.current = null;
      setConnected(false);
    };
  }, [
    publicOrigin,
    id,
    role,
    enabled,
    remember,
    send,
    storageKey,
    onUnauthorized,
  ]);
  useEffect(() => {
    if (
      !connected ||
      !view?.question ||
      view.phase !== "choicesPreparing" ||
      role === "control" ||
      document.visibilityState !== "visible"
    )
      return;
    const key = `${view.epoch}:${view.question.id}`;
    if (lastReady.current === key) return;
    let second = 0;
    // 選択肢はまだ配信せず、待機画面の描画機会を経て準備完了を通知する。
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (
          document.visibilityState === "visible" &&
          send({ type: "ready", roundId: view.question!.id, epoch: view.epoch })
        )
          lastReady.current = key;
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [connected, view, role, send]);
  function answer(choice: Choice) {
    if (
      !view?.question ||
      view.me?.answer ||
      pendingRef.current ||
      !connected ||
      view.phase !== "acceptingAnswers" ||
      view.me?.participation !== "eligible" ||
      view.phaseEndsAt === null ||
      view.serverNow + performance.now() - receivedAt.current >=
        view.phaseEndsAt
    )
      return;
    const message: Pending = {
      type: "answer",
      requestId: clientRequestId(),
      roundId: view.question.id,
      choice,
    };
    remember(message);
    setError("");
    send(message);
  }
  function command(
    command: Command,
    extra: {
      playerId?: string;
      displayId?: string;
      reason?: string;
      timing?: TimingSettings;
    } = {},
  ) {
    if (!view || busyRef.current || !connected) return;
    const requestId = clientRequestId();
    busyRef.current = requestId;
    setBusy(true);
    setError("");
    if (
      !send({
        type: "command",
        command,
        requestId,
        revision: view.revision,
        ...extra,
      })
    ) {
      busyRef.current = null;
      setBusy(false);
    }
  }
  // 前問の未確認送信を、次問の選択状態や回答可否へ持ち越さない。
  const currentPending =
    pending?.roundId === view?.question?.id ? pending : null;
  return {
    view,
    connected,
    error,
    busy,
    pending: currentPending,
    answer,
    command,
    receivedAt,
  };
}
export type RoomConnection = ReturnType<typeof useRoom>;
