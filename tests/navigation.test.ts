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
    displayReady: false,
    question: null,
  };
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
let authorized = true;
let eventResponse: (() => Promise<Response>) | undefined;
let socketResponse: (() => Promise<Response>) | undefined;
let loaders: ReturnType<typeof createRouteLoaders>;
let router: ReturnType<typeof createMemoryRouter>;
beforeEach(() => {
  authorized = true;
  eventResponse = undefined;
  socketResponse = undefined;
  Socket.all = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/config")
        return json({ publicOrigin: "http://localhost" });
      if (path === "/api/events")
        return eventResponse
          ? eventResponse()
          : authorized
            ? json({
                events: [
                  {
                    id: "game",
                    name: "Test game",
                    created_at: 0,
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
      if (path.includes("/session?"))
        return socketResponse
          ? socketResponse()
          : json({}, authorized ? 200 : 401);
      return json({ name: "Test game" });
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
  expect(html()).toContain("大会一覧");
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
  expect(html()).toContain("大会一覧");
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
