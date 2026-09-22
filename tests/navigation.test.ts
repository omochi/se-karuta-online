import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createAppRoutes } from "../src/client/router";
import {
  createRouteLoaders,
  bindRoomSessions,
  type GameData,
} from "../src/client/route-loaders";
import { RoomSession } from "../src/client/RoomSession";
import type { RoomView, ClientMessage } from "../src/shared/types";
import { eventUrls } from "../src/shared/urls";
import { newGame } from "../src/worker/game";
import { tournamentReport } from "../src/worker/report";
import type { EventPage } from "../src/shared/events";

class Socket {
  static OPEN = 1;
  static all: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: ClientMessage[] = [];
  constructor(readonly url: URL) {
    Socket.all.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  state(view = roomView()) {
    this.onmessage?.({ data: JSON.stringify(view) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
function roomView(): RoomView {
  return {
    type: "state",
    joinCode: null,
    id: "game",
    name: "Test game",
    urls: eventUrls("http://localhost", "game"),
    phase: "waiting",
    revision: 0,
    epoch: "epoch",
    serverNow: 1000,
    phaseEndsAt: null,
    phaseDurationMs: 0,
    timing: { countdownSeconds: 5, readingSeconds: 15, answeringSeconds: 15 },
    questionNumber: 0,
    totalQuestions: 3,
    playerCount: 1,
    eligibleCount: 0,
    readyCount: 0,
    answerCount: 0,
    question: null,
  };
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
let authorized = true;
let finished = false;
let eventResponse: (() => Promise<Response>) | undefined;
let socketResponse: (() => Promise<Response>) | undefined;
let loaders: ReturnType<typeof createRouteLoaders>;
let router: ReturnType<typeof createMemoryRouter>;
beforeEach(() => {
  authorized = true;
  finished = false;
  eventResponse = undefined;
  socketResponse = undefined;
  Socket.all = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/config")
        return json({ publicOrigin: "http://localhost" });
      if (path.startsWith("/api/events?"))
        return eventResponse
          ? eventResponse()
          : authorized
            ? json({
                page: 1,
                pageSize: 20,
                pageCount: 1,
                total: 1,
                events: [
                  {
                    id: "game",
                    name: "Test game",
                    created_at: 0,
                    status: "waiting",
                    urls: eventUrls("http://localhost", "game"),
                  },
                ],
              })
            : json({}, 401);
      if (path.endsWith("/questions"))
        return json({
          name: "Test game",
          questions: [
            {
              id: "q1",
              bodyMarkdown: "LOADED QUESTION",
              choices: { A: "a", B: "b", C: "c", D: "d" },
              correctChoice: "A",
              explanationMarkdown: "explanation",
            },
          ],
        });
      if (path.endsWith("/report")) {
        const game = newGame("game", "詳細結果テスト", [], 0);
        game.phase = "finished";
        return authorized ? json(tournamentReport(game)) : json({}, 401);
      }
      if (path.includes("/session?"))
        return socketResponse
          ? socketResponse()
          : json({}, authorized ? 200 : 401);
      return json({ name: "Test game", finished });
    }),
  );
  loaders = createRouteLoaders();
});
afterEach(() => {
  router?.dispose();
  loaders.retain();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function start(path = "/") {
  router = createMemoryRouter(createAppRoutes(loaders), {
    initialEntries: [path],
  });
  bindRoomSessions(router, loaders);
  await vi.waitFor(() => expect(router.state.initialized).toBe(true));
}
function html() {
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}
function mockEventPages(count: number) {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    if (typeof path !== "string" || !path.startsWith("/api/events?"))
      return original(path, init);
    const query = new URL(path, "http://localhost").searchParams;
    const pageSize = Number(query.get("pageSize") ?? 20);
    const page = Number(query.get("page") ?? 1);
    const all = Array.from({ length: count }, (_, index) => ({
      id: `event-${index + 1}`,
      name: `大会その${index + 1}`,
      created_at: count - index,
      status: (["waiting", "active", "finished"] as const)[index % 3],
      urls: eventUrls("http://localhost", `event-${index + 1}`),
    }));
    return json({
      events: all.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: count,
      pageCount: Math.max(1, Math.ceil(count / pageSize)),
    } satisfies EventPage);
  });
}
it("トップは5件だけ取得し、状態と全大会へのリンクを表示する", async () => {
  mockEventPages(21);
  await start();
  expect(html().match(/class="event-card"/g)).toHaveLength(5);
  expect(html()).toContain("準備中");
  expect(html()).toContain("進行中");
  expect(html()).toContain("終了");
  expect(html()).toContain('href="/events"');
  expect(vi.mocked(fetch).mock.calls.map(([path]) => path)).toContain(
    "/api/events?pageSize=5",
  );
});
it("大会一覧を20件ずつ移動し、戻る操作でもページ位置を保つ", async () => {
  mockEventPages(21);
  await start("/events");
  expect(html().match(/class="event-card"/g)).toHaveLength(20);
  expect(html()).toContain("1〜20件");
  expect(html()).toContain("次のページ");
  expect(html()).not.toContain("前のページ");
  await router.navigate("/events?page=2");
  expect(html().match(/class="event-card"/g)).toHaveLength(1);
  expect(html()).toContain("大会その21");
  expect(html()).toContain("21〜21件");
  expect(html()).toContain("前のページ");
  expect(html()).not.toContain("次のページ");
  await router.navigate(-1);
  expect(html().match(/class="event-card"/g)).toHaveLength(20);
});
it("大会一覧の直リンクでも認証を要求し、ログイン後は元のページを表示する", async () => {
  authorized = false;
  await start("/events?page=2");
  expect(html()).toContain("管理用パスワード");
  expect(html()).not.toContain("Test game");
  authorized = true;
  mockEventPages(21);
  await router.revalidate();
  expect(html()).toContain("大会その21");
});
it("大会0件では空表示にし、ページ送りを表示しない", async () => {
  mockEventPages(0);
  await start("/events");
  expect(html()).toContain("まだ大会はありません");
  expect(html()).not.toContain("ページ切り替え");
});
it("問題ビューワでは2ページ目以降の古い大会も選べる", async () => {
  mockEventPages(21);
  await start("/questions");
  expect(html()).toContain("大会その21");
  expect(vi.mocked(fetch).mock.calls.map(([path]) => path)).toContain(
    "/api/events?page=2",
  );
});
it("遅いloaderを待つ間は現在の画面を維持し、準備できてから遷移する", async () => {
  await start();
  let resolve!: (response: Response) => void;
  eventResponse = () =>
    new Promise((r) => {
      resolve = r;
    });
  const navigation = router.navigate("/questions");
  await vi.waitFor(() => expect(router.state.navigation.state).toBe("loading"));
  expect(router.state.location.pathname).toBe("/");
  expect(html()).toContain("最近の大会");
  expect(html()).not.toContain("読み込み中");
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  resolve(json({ events: [] }));
  await navigation;
  expect(router.state.location.pathname).toBe("/questions");
  expect(html()).toContain("問題ビューワ");
});
it("大会は認証だけで遷移せずWebSocketの初回stateまで待つ。readyは先送りしない", async () => {
  await start();
  const navigation = router.navigate("/e/game/control");
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  const socket = Socket.all[0];
  socket.open();
  expect(router.state.location.pathname).toBe("/");
  socket.state();
  await navigation;
  expect(router.state.location.pathname).toBe("/e/game/control");
  expect(html()).toContain("Test game");
  expect(html()).not.toContain("大会に接続しています");
  expect(socket.sent.some((m) => m.type === "ready")).toBe(false);
  socket.state({ ...roomView(), playerCount: 2 });
  expect(
    (router.state.loaderData["game-control"] as GameData).session!.getSnapshot()
      .view!.playerCount,
  ).toBe(2);
});
it("遷移キャンセル時に先読みWebSocketを閉じ、古い大会へ遷移しない", async () => {
  await start();
  const first = router.navigate("/e/game/display");
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  const socket = Socket.all[0];
  socket.open();
  await router.navigate("/questions");
  await first;
  expect(socket.readyState).toBe(3);
  expect(router.state.location.pathname).toBe("/questions");
});
it("ログイン前は認証画面、ログイン後の再検証は初回stateまで認証画面を維持する", async () => {
  authorized = false;
  await start("/e/game/control");
  expect(html()).toContain("管理用パスワード");
  expect(Socket.all).toHaveLength(0);
  authorized = true;
  finished = false;
  const revalidation = router.revalidate();
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  expect(html()).toContain("管理用パスワード");
  Socket.all[0].open();
  Socket.all[0].state();
  await revalidation;
  expect(html()).toContain("大会の開始を待っています");
  expect(html()).not.toContain("管理用パスワード");
});
it("URLで指定した問題集もloaderで取得してから表示する", async () => {
  await start("/questions?event=game");
  expect(html()).toContain("LOADED QUESTION");
});
it("Displayプレビューの直リンクは案内を表示し、大会接続や問題取得を行わない", async () => {
  await start("/questions/display-preview");
  expect(html()).toContain("Displayプレビュー");
  expect(html()).toContain("問題ビューワで問題集を読み込み");
  expect(Socket.all).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls.map(([path]) => path)).toEqual([
    "/api/config",
  ]);
});
it("通信エラーを未認証扱いせずエラー画面に表示する", async () => {
  eventResponse = async () => json({ error: "取得に失敗" }, 503);
  await start();
  expect(html()).toContain("取得に失敗");
  expect(html()).not.toContain("管理用パスワード");
});
it("初回WebSocketデータが来ないとタイムアウトして接続を破棄する", async () => {
  vi.useFakeTimers();
  const session = new RoomSession("game", "display", "http://localhost");
  const failed = expect(session.ready).rejects.toThrow(
    "大会に接続できませんでした",
  );
  await vi.advanceTimersByTimeAsync(15000);
  await failed;
  expect(Socket.all[0].readyState).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});
it("再接続中も既存データを保持し、再接続したstateを反映する", async () => {
  vi.useFakeTimers();
  const session = new RoomSession("game", "display", "http://localhost");
  Socket.all[0].open();
  Socket.all[0].state();
  await session.ready;
  Socket.all[0].close();
  expect(session.getSnapshot().view?.name).toBe("Test game");
  expect(session.getSnapshot().connected).toBe(false);
  await vi.advanceTimersByTimeAsync(500);
  Socket.all[1].open();
  Socket.all[1].state({ ...roomView(), playerCount: 5 });
  expect(session.getSnapshot().connected).toBe(true);
  expect(session.getSnapshot().view?.playerCount).toBe(5);
  session.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it("移動先のデータ取得中は旧WebSocketを保持し、遷移が完了したら閉じる", async () => {
  await start();
  const first = router.navigate("/e/game/control");
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  Socket.all[0].open();
  Socket.all[0].state();
  await first;
  let resolve!: (response: Response) => void;
  eventResponse = () =>
    new Promise((r) => {
      resolve = r;
    });
  const next = router.navigate("/questions");
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  expect(Socket.all[0].readyState).toBe(1);
  expect(html()).toContain("大会の開始を待っています");
  resolve(json({ events: [] }));
  await next;
  expect(Socket.all[0].readyState).toBe(3);
});
it("戻る・進むでも各画面のloaderを通して表示を切り替える", async () => {
  await start();
  await router.navigate("/questions");
  await router.navigate(-1);
  expect(router.state.location.pathname).toBe("/");
  expect(html()).toContain("最近の大会");
  await router.navigate(1);
  expect(router.state.location.pathname).toBe("/questions");
  expect(html()).toContain("問題ビューワ");
});
it("途中で中止したHTTP取得にもAbortSignalを伝える", async () => {
  await start();
  let signal: AbortSignal | undefined;
  vi.mocked(fetch).mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(signal!.reason), {
          once: true,
        });
      }),
  );
  const first = router.navigate("/questions");
  await vi.waitFor(() => expect(signal).toBeDefined());
  await router.navigate("/");
  await first;
  expect(signal!.aborted).toBe(true);
  expect(router.state.location.pathname).toBe("/");
});
it("回答の再送IDを再接続でも維持し、次問に未確認の選択を持ち越さない", async () => {
  vi.useFakeTimers();
  const session = new RoomSession("game", "player", "http://localhost");
  const view: RoomView = {
    ...roomView(),
    phase: "acceptingAnswers",
    phaseEndsAt: 16000,
    phaseDurationMs: 15000,
    question: { id: "q1" },
    me: {
      id: "player",
      name: "Alice",
      participation: "eligible",
      answer: null,
      elapsed: null,
    },
  };
  Socket.all[0].open();
  Socket.all[0].state(view);
  await session.ready;
  session.answer("B");
  const pending = session.getSnapshot().pending;
  expect(pending?.choice).toBe("B");
  Socket.all[0].close();
  await vi.advanceTimersByTimeAsync(500);
  Socket.all[1].open();
  expect(Socket.all[1].sent).toContainEqual(pending);
  Socket.all[1].state({
    ...view,
    question: { id: "q2" },
    phase: "choicesPreparing",
    phaseEndsAt: null,
  });
  expect(session.getSnapshot().pending).toBeNull();
  session.dispose();
});
it("締切後は既存の状態が届いたままでも回答送信しない", async () => {
  vi.useFakeTimers();
  const session = new RoomSession("game", "player", "http://localhost");
  Socket.all[0].open();
  Socket.all[0].state({
    ...roomView(),
    phase: "acceptingAnswers",
    phaseEndsAt: 2000,
    phaseDurationMs: 1000,
    question: { id: "q1" },
    me: {
      id: "p",
      name: "Alice",
      participation: "eligible",
      answer: null,
      elapsed: null,
    },
  });
  await session.ready;
  await vi.advanceTimersByTimeAsync(1001);
  session.answer("A");
  expect(Socket.all[0].sent.some((m) => m.type === "answer")).toBe(false);
  session.dispose();
});
it("遷移完了による接続破棄では旧画面に再接続中の表示を挟まない", async () => {
  const session = new RoomSession("game", "control", "http://localhost");
  Socket.all[0].open();
  Socket.all[0].state();
  await session.ready;
  const snapshot = session.getSnapshot();
  const notify = vi.fn();
  session.subscribe(notify);
  session.dispose();
  expect(Socket.all[0].readyState).toBe(3);
  expect(notify).not.toHaveBeenCalled();
  expect(session.getSnapshot()).toBe(snapshot);
});

it("詳細結果の直リンクは管理者認証を要求し、ログイン後はWebSocketなしで表示する", async () => {
  authorized = false;
  await start("/e/game/control/report");
  expect(html()).toContain("管理用パスワード");
  expect(html()).not.toContain("全体の集計");
  authorized = true;
  finished = false;
  await router.revalidate();
  expect(html()).toContain("詳細結果テスト");
  expect(html()).toContain("集計対象の問題はありません");
  expect(Socket.all).toHaveLength(0);
});
it("終了前の詳細結果は終了後の案内を表示する", async () => {
  const original = fetch;
  vi.stubGlobal("fetch", (path: string, options: RequestInit) =>
    path.endsWith("/report")
      ? Promise.resolve(json({}, 409))
      : original(path, options),
  );
  await start("/e/game/control/report");
  expect(html()).toContain("大会終了後に確認できます");
  expect(Socket.all).toHaveLength(0);
});

it("終了済み大会のQRで新規登録を案内せず、既存セッションの接続は維持する", async () => {
  finished = true;
  authorized = false;
  await start("/e/game/play");
  expect(html()).toContain("この大会は終了しました。");
  expect(html()).not.toContain("みんなに表示する名前");
  authorized = true;
  const navigation = router.revalidate();
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  Socket.all[0].open();
  Socket.all[0].state({ ...roomView(), phase: "finished" });
  await navigation;
  expect(
    (router.state.loaderData["game-play"] as GameData).session,
  ).not.toBeNull();
});
it("未ログインでもトップページにコード入力があり、管理用パスワードに自動フォーカスしない", async () => {
  authorized = false;
  await start();
  expect(html()).toContain("参加コードで大会に入る");
  expect(html()).toContain("管理用パスワード");
  expect(html()).not.toContain("autofocus");
});
