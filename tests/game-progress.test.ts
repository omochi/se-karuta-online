import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Control, Display, Player } from "../src/client/App";
import { getGameProgress } from "../src/client/phase-presentation";
import type { RoomConnection } from "../src/client/useRoom";
import type { Phase, RoomView } from "../src/shared/types";
import { eventUrls } from "../src/shared/urls";

const phases: Phase[] = [
  "waiting",
  "choicesPreparing",
  "countdown",
  "choicesReading",
  "acceptingAnswers",
  "answersClosed",
  "answerRevealed",
  "rankingShown",
  "questionVoided",
  "finished",
];
function fixture(phase: Phase): RoomConnection {
  const timed = ["countdown", "choicesReading", "acceptingAnswers"].includes(
    phase,
  );
  const view: RoomView = {
    type: "state",
    joinCode: null,
    urls: eventUrls("http://test", "game"),
    id: "game",
    name: "Test",
    phase,
    revision: 0,
    epoch: "epoch",
    serverNow: 1000,
    phaseEndsAt: timed ? 16000 : null,
    phaseDurationMs: timed ? 15000 : 0,
    timing: { countdownSeconds: 5, readingSeconds: 15, answeringSeconds: 15 },
    questionNumber: phase === "waiting" ? 0 : 1,
    totalQuestions: 3,
    playerCount: 3,
    eligibleCount: 3,
    readyCount: 2,
    answerCount: 1,
    question: {
      id: "q1",
      choices: { A: "Choice A", B: "Choice B", C: "Choice C", D: "Choice D" },
      bodyMarkdown: "SHARED QUESTION BODY",
      voidReason: phase === "questionVoided" ? "問題文の誤り" : null,
    },
    me: {
      id: "p1",
      name: "Alice",
      participation: "eligible",
      answer: null,
      elapsed: null,
    },
    hasNext: true,
  };
  return {
    view,
    connected: true,
    error: "",
    busy: false,
    pending: null,
    answer: vi.fn(),
    command: vi.fn(),
    receivedAt: { current: 1000 },
  };
}
const screens = [Player, Display, Control];
const render = (screen: typeof Player, room: RoomConnection) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(screen, { room })),
  );
const progressMarkup = (html: string) =>
  html
    .match(/<section class="game-progress .*?<\/section>/s)![0]
    .replace(/game-progress-(player|display|control)/g, "game-progress-layout")
    .replace(/data-color-scheme="(light|dark)"/g, 'data-color-scheme="theme"')
    .replace(/h2>/g, "h1>");
afterEach(() => vi.restoreAllMocks());

describe("3画面の進行案内", () => {
  it("Controlに任意の共有画面の接続数と共有URLを表示し、準備を要求しない", () => {
    const room = fixture("choicesPreparing");
    room.view!.displays = [
      { id: "monitor", label: "Display monitor" },
      { id: "satellite", label: "Display satellite" },
    ];
    const html = render(Control, room);
    expect(html).toContain("接続中 2画面");
    expect(html).not.toContain("準備完了 1画面");
    expect(html).not.toContain("共有画面の準備を待っています");
    expect(html).toContain("開始時には待ち合わせません");
    expect(html).toContain("Display monitor");
    expect(html).toContain("Display satellite");
    expect(html).toContain("http://test/e/game/display</a>");
    expect(html).not.toContain("会場用にする");
    expect(html).not.toContain("閲覧のみ");
  });
  it.each(phases)("%sで同じ見出し・補足・人数・タイマーを表示する", (phase) => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const room = fixture(phase);
    const markup = screens.map((screen) =>
      progressMarkup(render(screen, room)),
    );
    expect(markup[0]).toBe(markup[1]);
    expect(markup[0]).toBe(markup[2]);
  });
  it.each([
    [1000, 15],
    [6100, 10],
    [16000, 0],
  ])(
    "読む時間の見出しは全画面で固定し、秒数はタイマーに表示する（時刻%s、残り%s秒）",
    (now, seconds) => {
      vi.spyOn(performance, "now").mockReturnValue(now);
      for (const screen of screens) {
        const html = render(screen, fixture("choicesReading"));
        expect(html).toMatch(/<h[12]>まもなく出題されます<\/h[12]>/);
        expect(html).toContain(`残り ${seconds} 秒`);
        expect(html).toContain("今のうちに選択肢を読んでおこう");
        expect(html).not.toContain("まずは、選択肢を読もう");
      }
    },
  );
  it("期限到達で全画面が締切表示になり、Controlの操作はサーバー確定を待つ", () => {
    vi.spyOn(performance, "now").mockReturnValue(16000);
    const room = fixture("acceptingAnswers");
    for (const screen of screens) {
      const html = render(screen, room);
      expect(html).toContain("回答を締め切りました");
      expect(html).not.toContain("回答受付中");
      expect(html).not.toContain('role="progressbar"');
    }
    const control = render(Control, room);
    expect(control).not.toContain("回答を締め切る");
    expect(control).not.toContain("正解を発表する");
    expect(render(Display, room)).toContain("SHARED QUESTION BODY");
    expect(render(Player, room)).toContain("回答なし");
    expect(room.view!.phase).toBe("acceptingAnswers");
    room.view!.phase = "answersClosed";
    expect(render(Control, room)).toContain("正解を発表する");
    expect(render(Display, room)).toContain("SHARED QUESTION BODY");
  });
  it.each(["countdown", "choicesReading"] as const)(
    "%sは残り0秒でもサーバー通知前に次段階へ進めない",
    (phase) => {
      const room = fixture(phase);
      const progress = getGameProgress(room.view!, 15000);
      expect(progress.phase).toBe(phase);
      expect(progress.timer?.seconds).toBe(0);
      expect(progress.answering).toBe(false);
    },
  );
  it("締切直前の残り秒数とバーは同じ時間を使い、設定変更で全長を変えない", () => {
    const view = fixture("acceptingAnswers").view!;
    view.timing.answeringSeconds = 60;
    const progress = getGameProgress(view, 5000);
    expect(progress.timer).toMatchObject({
      seconds: 10,
      durationSeconds: 15,
      fraction: 2 / 3,
    });
    expect(getGameProgress(view, 14999).answering).toBe(true);
    expect(getGameProgress(view, 15000).closed).toBe(true);
    expect(getGameProgress(view, 30000).closed).toBe(true);
  });
  it.each(["answered", "pending", "unanswered"])(
    "締切案内と本人の%s状態を併記する",
    (state) => {
      vi.spyOn(performance, "now").mockReturnValue(1000);
      const room = fixture("answersClosed");
      if (state === "answered")
        room.view!.me!.answer = { choice: "B", receivedAt: 1200 };
      if (state === "pending")
        room.pending = {
          type: "answer",
          requestId: "request",
          roundId: "q1",
          choice: "B",
        };
      const html = render(Player, room);
      expect(html).toContain("回答を締め切りました");
      expect(html).toContain(
        state === "answered"
          ? "回答しました！"
          : state === "pending"
            ? "回答を送信中…"
            : "回答なし",
      );
      if (state === "pending") expect(html).not.toContain("回答なし");
    },
  );
  it.each(["resting", "waiting"] as const)(
    "%sの参加者にも共通案内を出し、選択肢と回答操作を出さない",
    (participation) => {
      vi.spyOn(performance, "now").mockReturnValue(1000);
      const room = fixture("acceptingAnswers");
      room.view!.me!.participation = participation;
      const html = render(Player, room);
      expect(html).toContain("回答受付中");
      expect(html).toContain(
        participation === "resting"
          ? "この問題はお休みです"
          : "次の問題から参加します",
      );
      expect(html).not.toContain("Choice A");
    },
  );
  it("無効問題を個人のお休みと区別する", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    for (const screen of screens) {
      const room = fixture("questionVoided");
      room.view!.me!.participation = "resting";
      const html = render(screen, room);
      expect(html).toContain("この問題は無効です");
      expect(html).toContain("問題文の誤り");
      expect(html).not.toContain("この問題はお休み");
    }
  });
  it("正解公開時にも進行案内と本人の順位・所要時間を保持する", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const room = fixture("answerRevealed");
    Object.assign(room.view!.me!, {
      answer: { choice: "B", receivedAt: 2234 },
      correct: true,
      rank: 1,
      correctCount: 2,
      elapsed: 1234,
    });
    const html = render(Player, room);
    expect(html).toContain("正解発表");
    expect(html).toContain("正解！");
    expect(html).toContain("1.234");
    expect(html).toContain('aria-pressed="true"');
  });
});
