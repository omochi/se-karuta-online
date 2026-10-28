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
    timing: {
      countdownSeconds: 5,
      readingSeconds: 15,
      answeringSeconds1: 15,
      answeringSeconds2: 15,
      answeringSeconds3: 15,
    },
    questionNumber: phase === "waiting" ? 0 : 1,
    totalQuestions: 3,
    playerCount: 3,
    eligibleCount: 3,
    readyCount: 2,
    readyWaitCount: 3,
    answerCount: 1,
    question: {
      id: "q1",
      choices: {
        A: {
          number: "SE-0001",
          title: "Choice A",
          titleJa: null,
          explanationUrl:
            "https://swiftdigest.koherent.org/proposals/se-0001.html",
        },
        B: {
          number: "SE-0002",
          title: "Choice B",
          titleJa: null,
          explanationUrl:
            "https://swiftdigest.koherent.org/proposals/se-0002.html",
        },
        C: {
          number: "SE-0003",
          title: "Choice C",
          titleJa: null,
          explanationUrl:
            "https://swiftdigest.koherent.org/proposals/se-0003.html",
        },
        D: {
          number: "SE-0004",
          title: "Choice D",
          titleJa: null,
          explanationUrl:
            "https://swiftdigest.koherent.org/proposals/se-0004.html",
        },
      },
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
    serverNow: () => performance.now(),
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
    .replace(/<p class="progress-answer-count">.*?<\/p>/g, "")
    .replace(/h2>/g, "h1>");
afterEach(() => vi.restoreAllMocks());

describe("回答画面の固定領域", () => {
  it.each(["idle", "pending", "answered", "offline", "error"])(
    "%sでも選択肢の前に同じお知らせ枠を置き、ブランドと接続状態を下端にまとめる",
    (state) => {
      vi.spyOn(performance, "now").mockReturnValue(1000);
      const room = fixture("acceptingAnswers");
      if (state === "pending")
        room.pending = {
          type: "answer",
          requestId: "r",
          roundId: "q1",
          choice: "B",
        };
      if (state === "answered")
        room.view!.me!.answer = { choice: "B", receivedAt: 1200 };
      if (state === "offline") room.connected = false;
      if (state === "error") room.error = "送信に失敗しました";
      const html = render(Player, room);
      const event = html.match(/<div class="player-event-slot".*?<\/div>/s)![0];
      expect(event).toContain('aria-live="polite"');
      expect(event).toContain(
        {
          idle: "回答は一度だけ",
          pending: "回答を送信中",
          answered: "回答しました！",
          offline: "接続を取り戻しています",
          error: "送信に失敗しました",
        }[state]!,
      );
      expect(html.match(/class="player-event-slot"/g)).toHaveLength(1);
      expect(html.indexOf('class="player-event-slot"')).toBeLessThan(
        html.indexOf('class="choices"'),
      );
      expect(html).not.toContain('class="site-header"');
      const footer = html.slice(html.indexOf('<footer class="player-footer"'));
      for (const label of [
        "SE ",
        "Karuta",
        "Test",
        "Alice",
        state === "offline" ? "再接続中" : "接続中",
      ])
        expect(footer).toContain(label);
    },
  );
  it("正解発表の詳しい結果は選択肢の後へ置き、お知らせ枠は短い正誤案内に保つ", () => {
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
    const event = html.match(/<div class="player-event-slot".*?<\/div>/s)![0];
    expect(event).toContain("正解！");
    expect(event).not.toContain("personal-result");
    expect(html.indexOf('class="personal-result"')).toBeGreaterThan(
      html.indexOf('class="choices"'),
    );
  });
});

describe("3画面の進行案内", () => {
  it("延長操作を回答受付中のControlだけに表示し、通信中・切断中は無効にする", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const room = fixture("acceptingAnswers");
    expect(render(Control, room)).toContain("＋15秒");
    for (const screen of [Player, Display])
      expect(render(screen, room)).not.toContain("＋15秒");
    for (const phase of phases.filter((phase) => phase !== "acceptingAnswers"))
      expect(render(Control, fixture(phase))).not.toContain("＋15秒");
    for (const patch of [{ busy: true }, { connected: false }]) {
      const html = render(Control, { ...room, ...patch });
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>＋15秒<\/button>/);
    }
    room.serverNow = () => 16000;
    expect(render(Control, room)).not.toContain("＋15秒");
  });
  it("全画面で延長後の残り時間・バーと5秒間のお知らせを表示する", () => {
    vi.spyOn(performance, "now").mockReturnValue(2000);
    const room = fixture("acceptingAnswers");
    Object.assign(room.view!, {
      answerExtendedAt: 2000,
      phaseEndsAt: 31000,
      phaseDurationMs: 30000,
    });
    for (const screen of screens) {
      const html = render(screen, room);
      expect(html).toContain("15秒延長！");
      expect(html).toContain(
        'role="status" aria-live="polite" aria-atomic="true"',
      );
      expect(html).toContain('aria-valuemax="30"');
      expect(html).toContain("残り 29 秒");
    }
    expect(getGameProgress(room.view!, 6999).timer!.extension).not.toBeNull();
    expect(getGameProgress(room.view!, 7000).timer!.extension).toBeNull();
    vi.spyOn(performance, "now").mockReturnValue(7000);
    // 再接続などで同じ状態を受け取っても、古いお知らせは再表示しない。
    for (const screen of screens) {
      const html = render(screen, room);
      expect(html).not.toContain("15秒延長！");
      expect(html).toContain("回答締切まで");
    }
    room.view!.answerExtendedAt = 7000;
    expect(getGameProgress(room.view!, 7000).timer!.extension?.at).toBe(7000);
    expect(render(Player, room)).toContain("15秒延長！");
    expect(getGameProgress(room.view!, 31000).timer).toBeNull();
  });
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
    expect(html).not.toContain("開始時には待ち合わせません");
    expect(html).toContain("Display monitor");
    expect(html).toContain("Display satellite");
    expect(html).toContain("http://test/e/game/display</a>");
    expect(html).not.toContain("会場用にする");
    expect(html).not.toContain("閲覧のみ");
  });
  it.each([
    "acceptingAnswers",
    "answersClosed",
    "answerRevealed",
    "rankingShown",
  ] as const)(
    "%sの回答済み人数は運営・Displayに表示し、スマホには表示しない",
    (phase) => {
      vi.spyOn(performance, "now").mockReturnValue(1000);
      const room = fixture(phase);
      expect(render(Player, room)).not.toContain("人が回答済み");
      for (const screen of [Control, Display])
        expect(render(screen, room)).toContain("1 / 3 人が回答済み");
    },
  );
  it.each(phases)("%sで共通の見出し・補足・タイマーを表示する", (phase) => {
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
      const progress = getGameProgress(room.view!, 16000);
      expect(progress.phase).toBe(phase);
      expect(progress.timer?.seconds).toBe(0);
      expect(progress.answering).toBe(false);
    },
  );
  it("締切直前の残り秒数とバーは同じ時間を使い、設定変更で全長を変えない", () => {
    const view = fixture("acceptingAnswers").view!;
    view.timing.answeringSeconds2 = 60;
    const progress = getGameProgress(view, 6000);
    expect(progress.timer).toMatchObject({
      seconds: 10,
      durationSeconds: 15,
      fraction: 2 / 3,
    });
    expect(getGameProgress(view, 15999).answering).toBe(true);
    expect(getGameProgress(view, 16000).closed).toBe(true);
    expect(getGameProgress(view, 31000).closed).toBe(true);
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
  it("途中参加者にも共通案内を出し、選択肢と回答操作を出さない", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const room = fixture("acceptingAnswers");
    room.view!.me!.participation = "waiting";
    const html = render(Player, room);
    expect(html).toContain("回答受付中");
    expect(html).toContain("次の問題から参加します");
    expect(html).not.toContain("Choice A");
  });
  it("未回答者にお休みという別の回答結果を表示しない", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const room = fixture("answersClosed");
    room.view!.me!.answer = null;
    const html = render(Player, room);
    expect(html).toContain("回答なし");
    expect(html).not.toContain("お休み");
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

it("管理画面は待ち合わせ人数と回答人数を分け、参加者ごとのトグルを表示する", () => {
  const room = fixture("choicesPreparing");
  room.view!.eligibleCount = 2;
  room.view!.readyWaitCount = 1;
  room.view!.readyCount = 0;
  room.view!.players = [true, false].map((waitForReady, i) => ({
    id: `p${i}`,
    name: `参加者${i}`,
    online: false,
    ready: false,
    participation: "eligible",
    answered: false,
    waitForReady,
  }));
  const html = render(Control, room);
  expect(html).toContain("0 / 1");
  expect(html).toContain('role="switch" aria-checked="true"');
  expect(html).toContain('role="switch" aria-checked="false"');
  expect(html).toContain("開始を待たない");
  expect(html).not.toContain("開始を待たない設定は");
});
