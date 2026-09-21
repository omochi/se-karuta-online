import { api } from "./api";
import { getGameProgress } from "./phase-presentation";
import type {
  Choice,
  ClientMessage,
  Command,
  Role,
  RoomView,
  ServerMessage,
  TimingSettings,
} from "../shared/types";
interface Pending {
  type: "answer";
  requestId: string;
  roundId: string;
  choice: Choice;
}
interface Snapshot {
  view: RoomView | null;
  connected: boolean;
  error: string;
  busy: boolean;
  pending: Pending | null;
  unauthorized: boolean;
  generation: number;
}
// LANのHTTPでも使えるID。Secure Context限定のrandomUUIDに依存しない。
function requestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
// loaderで初回stateを待ち、同じ接続をReactに引き渡す。
// 準備完了通知は描画後のuseRoomだけが送る。先読みだけでは大会を進めない。
export class RoomSession {
  readonly receivedAt = { current: performance.now() };
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: unknown) => void;
  private initialDone = false;
  private stopped = false;
  private socket: WebSocket | null = null;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat: ReturnType<typeof setInterval>;
  private initialTimeout: ReturnType<typeof setTimeout>;
  private requests = new AbortController();
  private listeners = new Set<() => void>();
  private busyId: string | null = null;
  private attempts = 0;
  private snapshot: Snapshot = {
    view: null,
    connected: false,
    error: "",
    busy: false,
    pending: null,
    unauthorized: false,
    generation: 0,
  };
  constructor(
    readonly id: string,
    readonly role: Role,
    private origin: string,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    if (role === "player") {
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(this.storageKey) ?? "null",
        );
        if (saved?.type === "answer") this.snapshot.pending = saved;
      } catch {}
    }
    this.initialTimeout = setTimeout(
      () =>
        this.dispose(
          new Error(
            "大会に接続できませんでした。接続を確認して再試行してください。",
          ),
        ),
      15000,
    );
    this.heartbeat = setInterval(() => {
      this.send({ type: "ping" });
      if (this.snapshot.pending) this.send(this.snapshot.pending);
    }, 10000);
    void this.connect(false);
  }
  private get storageKey() {
    return `se-pending-${this.id}`;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private remember(pending: Pending | null) {
    this.update({ pending });
    try {
      if (pending)
        sessionStorage.setItem(this.storageKey, JSON.stringify(pending));
      else sessionStorage.removeItem(this.storageKey);
    } catch {}
  }
  send = (message: ClientMessage) => {
    if (this.stopped || this.socket?.readyState !== WebSocket.OPEN)
      return false;
    this.socket.send(JSON.stringify(message));
    return true;
  };
  private async connect(checkSession: boolean) {
    if (checkSession) {
      try {
        await api(
          `/api/e/${this.id}/session?role=${this.role}`,
          undefined,
          this.requests.signal,
        );
      } catch (error) {
        if (this.stopped) return;
        if ((error as { status?: number }).status === 401) {
          this.update({ unauthorized: true, connected: false, busy: false });
          this.dispose(error);
          return;
        }
        this.update({ error: "接続を待っています…" });
        this.retry = setTimeout(() => this.connect(true), 2000);
        return;
      }
    }
    if (this.stopped) return;
    const url = new URL(`/api/e/${this.id}/ws?role=${this.role}`, this.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      this.dispose(error);
      return;
    }
    this.socket = ws;
    ws.onopen = () => {
      if (this.stopped) return;
      this.attempts = 0;
      this.update({
        connected: true,
        error: "",
        generation: this.snapshot.generation + 1,
      });
      this.send({ type: "ping" });
      if (this.snapshot.pending) this.send(this.snapshot.pending);
    };
    ws.onmessage = (event) => {
      if (this.stopped) return;
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "state") {
        this.receivedAt.current = performance.now();
        const pending = this.snapshot.pending;
        if (
          pending &&
          (pending.roundId !== message.question?.id || message.me?.answer)
        )
          this.remember(null);
        this.update({ view: message });
        if (!this.initialDone) {
          this.initialDone = true;
          clearTimeout(this.initialTimeout);
          this.resolveReady();
        }
      } else {
        if (message.type === "error") this.update({ error: message.message });
        if (message.requestId === this.snapshot.pending?.requestId)
          this.remember(null);
        if (message.requestId === this.busyId) {
          this.busyId = null;
          this.update({ busy: false });
        }
      }
    };
    ws.onclose = () => {
      if (this.stopped) return;
      this.busyId = null;
      this.update({ connected: false, busy: false });
      this.retry = setTimeout(
        () => this.connect(true),
        Math.min(5000, 500 * 2 ** this.attempts++),
      );
    };
    ws.onerror = () => ws.close();
  }
  answer = (choice: Choice) => {
    const { view, connected, pending } = this.snapshot;
    if (
      this.stopped ||
      !view?.question ||
      view.me?.answer ||
      pending ||
      !connected ||
      view.me?.participation !== "eligible" ||
      !getGameProgress(view, performance.now() - this.receivedAt.current)
        .answering
    )
      return;
    const message: Pending = {
      type: "answer",
      requestId: requestId(),
      roundId: view.question.id,
      choice,
    };
    this.remember(message);
    this.update({ error: "" });
    this.send(message);
  };
  command = (
    command: Command,
    extra: {
      playerId?: string;
      displayId?: string;
      reason?: string;
      timing?: TimingSettings;
    } = {},
  ) => {
    const { view, connected } = this.snapshot;
    if (this.stopped || !view || this.busyId || !connected) return;
    this.busyId = requestId();
    this.update({ busy: true, error: "" });
    if (
      !this.send({
        type: "command",
        command,
        requestId: this.busyId,
        revision: view.revision,
        ...extra,
      })
    ) {
      this.busyId = null;
      this.update({ busy: false });
    }
  };
  dispose = (
    reason: unknown = new DOMException("Navigation cancelled", "AbortError"),
  ) => {
    if (this.stopped) return;
    this.stopped = true;
    this.requests.abort();
    clearTimeout(this.retry);
    clearTimeout(this.initialTimeout);
    clearInterval(this.heartbeat);
    this.socket?.close();
    // 遷移完了で廃棄する旧画面に「再接続中」を通知しない。
    // Reactが新画面を反映するまでは最後の表示を維持する。
    this.listeners.clear();
    if (!this.initialDone) {
      this.initialDone = true;
      this.rejectReady(reason);
    }
  };
}
