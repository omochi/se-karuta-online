import { describe, it, expect } from "vitest";
import {
  addPlayer,
  advanceTimer,
  applyCommand,
  beginCountdownIfReady,
  currentRound,
  finalResults,
  isDifficultRound,
  newGame,
  receiveAnswer,
  roundRanking,
  viewFor,
} from "../src/worker/game";
import { validateQuestions } from "../src/shared/questions";
import type { Game, Presence, Question } from "../src/shared/types";
const question: Question = {
  id: "test",
  difficulty: 1 as const,
  bodyMarkdown: "SECRET BODY",
  choices: {
    A: {
      number: "SE-0001",
      title: "a",
      titleJa: null,
      explanationUrl: "https://swiftdigest.koherent.org/proposals/se-0001.html",
    },
    B: {
      number: "SE-0002",
      title: "b",
      titleJa: null,
      explanationUrl: "https://swiftdigest.koherent.org/proposals/se-0002.html",
    },
    C: {
      number: "SE-0003",
      title: "c",
      titleJa: null,
      explanationUrl: "https://swiftdigest.koherent.org/proposals/se-0003.html",
    },
    D: {
      number: "SE-0004",
      title: "d",
      titleJa: null,
      explanationUrl: "https://swiftdigest.koherent.org/proposals/se-0004.html",
    },
  },
  correctChoice: "B",
  explanationMarkdown: "SECRET EXPLANATION",
};
function fixture(count = 3): Game {
  const g = newGame(
    "event",
    "Test",
    structuredClone([
      question,
      { ...question, id: "q2" },
      { ...question, id: "q3" },
    ]),
    0,
  );
  // 採点・公開範囲のシナリオは出題開始を20秒に固定し、初期値は別途検証する。
  g.timing.readingSeconds = 15;
  for (let i = 0; i < count; i++)
    addPlayer(g, {
      id: `p${i}`,
      name: `Player ${i}`,
      joinedAt: i,
      sessionHash: "hash",
    });
  return g;
}
function command(
  g: Game,
  c: Parameters<typeof applyCommand>[1]["command"],
  now = 0,
  extra = {},
) {
  applyCommand(g, { command: c, revision: g.revision, ...extra }, now);
}
function open(g: Game, now = 0) {
  command(g, "start", now);
  expect(
    beginCountdownIfReady(g, new Set(g.players.map((p) => p.id)), now),
  ).toBe(true);
  advanceTimer(g, now + 5000);
  advanceTimer(g, now + 20000);
}
const presence: Presence = {
  onlinePlayers: new Set(),
  readyPlayers: new Set(),
  displays: [],
};
describe("全員の準備確認と時間進行", () => {
  it("参加者全員が揃うまで進まず、Displayなしでも開始し、同じ人の通知を重複計上しない", () => {
    const g = fixture();
    command(g, "start");
    expect(beginCountdownIfReady(g, new Set(["p0", "p1"]), 100)).toBe(false);
    expect(beginCountdownIfReady(g, new Set(["p0", "p1", "p2"]), 100)).toBe(
      true,
    );
    expect(g.phaseEndsAt).toBe(5100);
    expect(beginCountdownIfReady(g, new Set(["p0", "p1", "p2"]), 500)).toBe(
      false,
    );
    expect(g.phaseEndsAt).toBe(5100);
  });
  it("公開前5秒、選択肢公開後20秒を経て出題し、30秒で締め切る", () => {
    const g = fixture();
    g.timing = newGame("defaults", "Defaults", [], 0).timing;
    command(g, "start");
    beginCountdownIfReady(g, new Set(["p0", "p1", "p2"]), 100);
    expect(advanceTimer(g, 5099)).toBe(false);
    expect(advanceTimer(g, 5100)).toBe(true);
    expect(g.phase).toBe("choicesReading");
    expect(advanceTimer(g, 25099)).toBe(false);
    expect(advanceTimer(g, 25100)).toBe(true);
    expect(g.phase).toBe("acceptingAnswers");
    expect(currentRound(g)?.openedAt).toBe(25100);
    expect(advanceTimer(g, 40100)).toBe(false);
    expect(g.phase).toBe("acceptingAnswers");
    expect(advanceTimer(g, 55099)).toBe(false);
    expect(advanceTimer(g, 55100)).toBe(true);
    expect(g.phase).toBe("answersClosed");
    expect(currentRound(g)?.closedAt).toBe(55100);
    expect(g.phaseEndsAt).toBeNull();
  });
  it("遅延したタイマーで過去の時刻へ出題を遡らせない", () => {
    const g = fixture();
    command(g, "start");
    beginCountdownIfReady(g, new Set(["p0", "p1", "p2"]), 0);
    advanceTimer(g, 20000);
    expect(g.phaseEndsAt).toBe(35000);
    advanceTimer(g, 50000);
    expect(currentRound(g)?.openedAt).toBe(50000);
  });
  it("途中参加は現在の待ち合わせに入らず、次問から参加する", () => {
    const g = fixture(1);
    command(g, "start");
    addPlayer(g, {
      id: "late",
      name: "late",
      joinedAt: 1,
      sessionHash: "hash",
    });
    expect(currentRound(g)?.participants.late).toBeUndefined();
    expect(beginCountdownIfReady(g, new Set(["p0"]), 0)).toBe(true);
    command(g, "void", 1, { reason: "test" });
    command(g, "start", 2);
    expect(currentRound(g)?.participants.late).toBe("eligible");
  });
  it("待たない設定を次問でも維持し、回答資格は変えず、待つ設定への復帰は次問から反映する", () => {
    const g = fixture(2);
    command(g, "start");
    command(g, "setReadyWait", 1, { playerId: "p1", waitForReady: false });
    expect(currentRound(g)?.participants.p1).toBe("eligible");
    expect(beginCountdownIfReady(g, new Set(["p0"]), 2)).toBe(true);
    command(g, "void", 3, { reason: "test" });
    command(g, "start", 4);
    expect(currentRound(g)?.readyWaitPlayerIds).toEqual(["p0"]);
    command(g, "setReadyWait", 5, { playerId: "p1", waitForReady: true });
    expect(currentRound(g)?.readyWaitPlayerIds).toEqual(["p0"]);
    expect(beginCountdownIfReady(g, new Set(["p0"]), 6)).toBe(true);
    command(g, "void", 7, { reason: "test" });
    command(g, "start", 8);
    expect(beginCountdownIfReady(g, new Set(["p0"]), 9)).toBe(false);
    expect(beginCountdownIfReady(g, new Set(["p0", "p1"]), 10)).toBe(true);
  });
  it("全員を待たない設定でも出題し、readyなしの参加者の回答を受け付ける", () => {
    const g = fixture(1);
    command(g, "setReadyWait", 0, { playerId: "p0", waitForReady: false });
    command(g, "start");
    expect(beginCountdownIfReady(g, new Set(), 0)).toBe(true);
    advanceTimer(g, 5000);
    advanceTimer(g, 20000);
    expect(receiveAnswer(g, "p0", currentRound(g)!.id, "B", 20100)).toEqual({
      choice: "B",
      receivedAt: 20100,
    });
  });
  it("待ち合わせ人数だけを減らし、回答・未回答の対象人数は全員のまま表示する", () => {
    const g = fixture(2);
    command(g, "start");
    command(g, "setReadyWait", 1, { playerId: "p1", waitForReady: false });
    const view = viewFor(
      g,
      "control",
      undefined,
      { ...presence, readyPlayers: new Set(["p0", "p1"]) },
      "e",
      1,
      "http://test",
    );
    expect(view).toMatchObject({
      eligibleCount: 2,
      readyCount: 1,
      readyWaitCount: 1,
    });
    expect(view.players?.[1]).toMatchObject({
      participation: "eligible",
      waitForReady: false,
    });
  });
  it("不正な参加者・設定値・終了後の設定変更を拒否する", () => {
    const g = fixture(1);
    expect(() =>
      command(g, "setReadyWait", 0, {
        playerId: "missing",
        waitForReady: false,
      }),
    ).toThrow("参加者");
    expect(() => command(g, "setReadyWait", 0, { playerId: "p0" })).toThrow(
      "設定が不正",
    );
    command(g, "finish");
    expect(() =>
      command(g, "setReadyWait", 0, { playerId: "p0", waitForReady: false }),
    ).toThrow("終了した大会");
  });
  it("古い操作と二重クリックを拒否する", () => {
    const g = fixture();
    command(g, "start");
    expect(() => applyCommand(g, { command: "start", revision: 0 }, 1)).toThrow(
      "更新",
    );
    expect(() => command(g, "reveal")).toThrow("締切");
  });
});
describe("回答の確定と受付境界", () => {
  it("出題前・古い受信時刻・対象外の回答を拒否する", () => {
    const g = fixture();
    command(g, "start");
    const id = currentRound(g)!.id;
    expect(() => receiveAnswer(g, "p0", id, "B", 1)).toThrow("受付中");
    command(g, "setReadyWait", 2, { waitForReady: false, playerId: "p2" });
    beginCountdownIfReady(g, new Set(["p0", "p1"]), 0);
    advanceTimer(g, 5000);
    advanceTimer(g, 20000);
    expect(() => receiveAnswer(g, "p0", id, "B", 19999)).toThrow("受付中");
    expect(receiveAnswer(g, "p2", id, "B", 20001).choice).toBe("B");
    expect(() => receiveAnswer(g, "stranger", id, "B", 20001)).toThrow("対象");
  });
  it("再送・別選択肢・次問移行後も最初の回答と受信時刻を維持する", () => {
    const g = fixture();
    open(g);
    const id = currentRound(g)!.id;
    const first = receiveAnswer(g, "p0", id, "B", 20800);
    expect(receiveAnswer(g, "p0", id, "C", 20900)).toEqual(first);
    command(g, "close", 21000);
    expect(receiveAnswer(g, "p0", id, "A", 22000)).toEqual(first);
    command(g, "reveal");
    command(g, "ranking");
    command(g, "start");
    expect(receiveAnswer(g, "p0", id, "A", 23000)).toEqual(first);
    expect(currentRound(g)?.answers).toEqual({});
  });
  it("出題後の待ち合わせ設定変更は現在の回答・期限を変えず、締切後の初回回答を拒否する", () => {
    const g = fixture();
    open(g);
    const id = currentRound(g)!.id;
    const deadline = g.phaseEndsAt;
    command(g, "setReadyWait", 20001, { waitForReady: false, playerId: "p0" });
    expect(g.phaseEndsAt).toBe(deadline);
    expect(currentRound(g)?.participants.p0).toBe("eligible");
    command(g, "close", 21000);
    expect(() => receiveAnswer(g, "p0", id, "B", 21001)).toThrow("受付中");
  });
  it("同時刻は1,1,3位になり、表示で丸まるだけの時間は区別する", () => {
    const g = fixture(4);
    open(g);
    const r = currentRound(g)!;
    receiveAnswer(g, "p0", r.id, "B", 20100);
    receiveAnswer(g, "p1", r.id, "B", 20100);
    receiveAnswer(g, "p2", r.id, "B", 20101);
    receiveAnswer(g, "p3", r.id, "A", 20001);
    expect(roundRanking(g, r).map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(roundRanking(g, r).map((r) => r.value)).toEqual([100, 100, 101]);
  });
});
describe("権限と公開段階", () => {
  it.each([1, 2, 3] as const)(
    "難易度%iはDisplayに出題前から公開し、Playerには送らない",
    (difficulty) => {
      const g = fixture();
      g.rounds[0].question.difficulty = difficulty;
      command(g, "start");
      const view = (role: "display" | "player" | "control", now: number) =>
        viewFor(g, role, "p0", presence, "e", now, "http://test");
      const checkBeforeBody = (now: number, showChoices: boolean) => {
        const display = view("display", now);
        expect(display.question?.difficulty).toBe(difficulty);
        expect(display.question?.bodyMarkdown).toBeUndefined();
        expect(display.question?.correctChoice).toBeUndefined();
        expect(display.question?.explanationMarkdown).toBeUndefined();
        expect(display.question?.choices).toEqual(
          showChoices ? question.choices : undefined,
        );
        expect(view("player", now).question?.difficulty).toBeUndefined();
      };
      expect(view("control", 0).preview?.difficulty).toBe(difficulty);
      checkBeforeBody(0, false);
      beginCountdownIfReady(g, new Set(g.players.map((p) => p.id)), 0);
      checkBeforeBody(1, false);
      advanceTimer(g, 5000);
      checkBeforeBody(5000, true);
      advanceTimer(g, 20000);
      expect(view("display", 20001).question?.difficulty).toBe(difficulty);
      expect(view("player", 20001).question?.difficulty).toBeUndefined();
      command(g, "close", 21000);
      expect(view("display", 21000).question?.difficulty).toBe(difficulty);
      command(g, "reveal", 22000);
      expect(view("display", 22000).question?.difficulty).toBe(difficulty);
    },
  );
  it.each(["自動締切", "手動締切"])(
    "%s後もDisplayへ本文と回答分布を送り、正解・解説は正解発表まで送らない",
    (closing) => {
      const g = fixture();
      open(g);
      if (closing === "自動締切") advanceTimer(g, 50000);
      else command(g, "close", 21000);
      const display = viewFor(
        g,
        "display",
        undefined,
        presence,
        "e",
        60000,
        "http://test",
      );
      expect(display.phase).toBe("answersClosed");
      expect(display.question?.bodyMarkdown).toBe(question.bodyMarkdown);
      expect(display.question?.difficulty).toBe(question.difficulty);
      expect(display.question?.choices).toEqual(question.choices);
      expect(display.question?.correctChoice).toBeUndefined();
      expect(display.question?.explanationMarkdown).toBeUndefined();
      expect(display.answerDistribution).toEqual({
        counts: { A: 0, B: 0, C: 0, D: 0 },
        unanswered: 3,
      });
      expect(
        viewFor(g, "player", "p0", presence, "e", 60000, "http://test").question
          ?.bodyMarkdown,
      ).toBeUndefined();
    },
  );
  it("出題前に問題文・正解・解説・次問・セッションを公開しない", () => {
    const g = fixture();
    command(g, "start");
    for (const role of ["player", "display"] as const) {
      const v = viewFor(g, role, "p0", presence, "epoch", 0, "http://test");
      expect(v.question?.choices).toBeUndefined();
      expect(v.question?.bodyMarkdown).toBeUndefined();
      expect(v.question?.correctChoice).toBeUndefined();
      expect(v.question?.explanationMarkdown).toBeUndefined();
      expect(v.preview).toBeUndefined();
      expect(v.players).toBeUndefined();
      expect(JSON.stringify(v)).not.toContain("sessionHash");
    }
    expect(
      viewFor(g, "control", undefined, presence, "epoch", 0, "http://test")
        .preview?.bodyMarkdown,
    ).toBe(question.bodyMarkdown);
  });
  it("問題文はDisplay、正誤は正解発表後、全員の順位は順位公開後だけ送る", () => {
    const g = fixture();
    open(g);
    const r = currentRound(g)!;
    receiveAnswer(g, "p0", r.id, "B", 20100);
    expect(
      viewFor(g, "display", undefined, presence, "e", 0, "http://test").question
        ?.bodyMarkdown,
    ).toBe(question.bodyMarkdown);
    expect(
      viewFor(g, "player", "p0", presence, "e", 0, "http://test").question
        ?.bodyMarkdown,
    ).toBeUndefined();
    expect(
      viewFor(g, "player", "p0", presence, "e", 0, "http://test").me?.correct,
    ).toBeUndefined();
    command(g, "close");
    command(g, "reveal");
    const v = viewFor(g, "player", "p0", presence, "e", 0, "http://test");
    expect(v.me?.correct).toBe(true);
    expect(v.me?.rank).toBe(1);
    expect(v.rankings).toBeUndefined();
    command(g, "ranking");
    expect(
      viewFor(g, "display", undefined, presence, "e", 0, "http://test")
        .rankings,
    ).toHaveLength(1);
  });
});
describe("表彰と無効問題", () => {
  it.each([
    { choices: ["A", "A", "B"], expected: ["p0", "p1"] },
    { choices: ["B", "B", "A"], expected: ["p0", "p1"] },
    { choices: ["A", "A", "B", "B", "C"], expected: ["p0", "p1", "p2", "p3"] },
    { choices: ["A", "B", "C", "D"], expected: ["p0", "p1", "p2", "p3"] },
    { choices: [], expected: [] },
  ] as const)(
    "友情王は正誤に関係なく最多得票（同率を含む）の $choices を選んだ人に加算する",
    ({ choices, expected }) => {
      const g = fixture(6);
      open(g);
      const r = currentRound(g)!;
      choices.forEach((choice, i) =>
        receiveAnswer(g, `p${i}`, r.id, choice, 20100 + i),
      );
      expect(finalResults(g).friendship).toEqual([]);
      command(g, "close", 21000);
      expect(finalResults(g).friendship).toEqual(
        expected.map((id) => ({
          playerId: id,
          name: `Player ${id.slice(1)}`,
          rank: 1,
          value: 1,
        })),
      );
      r.isVoided = true;
      expect(finalResults(g).friendship).toEqual([]);
    },
  );
  it("友情王は対象外の回答を票にも加点にも含めず、最多得票を選んだ回数で順位を決める", () => {
    const g = fixture(4);
    for (let i = 0; i < 3; i++) {
      open(g, i * 40000);
      const r = currentRound(g)!;
      receiveAnswer(g, "p0", r.id, "A", i * 40000 + 20100);
      if (i === 0) receiveAnswer(g, "p1", r.id, "A", 20200);
      if (i > 0) receiveAnswer(g, "p2", r.id, "A", i * 40000 + 20200);
      delete r.participants.p3;
      r.answers.p3 = { choice: "B", receivedAt: i * 40000 + 20300 };
      r.answers.unknown = { choice: "B", receivedAt: i * 40000 + 20400 };
      command(g, "close", i * 40000 + 21000);
      command(g, "reveal");
      command(g, "ranking");
    }
    expect(finalResults(g).friendship).toEqual([
      { playerId: "p0", name: "Player 0", rank: 1, value: 3 },
      { playerId: "p2", name: "Player 2", rank: 2, value: 2 },
      { playerId: "p1", name: "Player 1", rank: 3, value: 1 },
    ]);
  });
  it("最多得票以外の正解を難問王に加算し、早い誤答を早押し王に加算しない", () => {
    const g = fixture(5);
    command(g, "start");
    command(g, "setReadyWait", 0, { waitForReady: false, playerId: "p4" });
    beginCountdownIfReady(g, new Set(["p0", "p1", "p2", "p3"]), 0);
    advanceTimer(g, 5000);
    advanceTimer(g, 20000);
    const r = currentRound(g)!;
    receiveAnswer(g, "p0", r.id, "B", 20200);
    receiveAnswer(g, "p1", r.id, "A", 20100);
    receiveAnswer(g, "p2", r.id, "A", 20300);
    command(g, "close", 21000);
    const result = finalResults(g);
    expect(result.difficultQuestions).toBe(1);
    expect(result.difficult[0].playerId).toBe("p0");
    expect(result.fastest).toEqual([
      { playerId: "p0", name: "Player 0", rank: 1, value: 1 },
    ]);
  });
  it("未回答が多くても、正解が最多得票なら難問にしない", () => {
    const g = fixture(4);
    command(g, "start");
    command(g, "setReadyWait", 0, { waitForReady: false, playerId: "p3" });
    beginCountdownIfReady(g, new Set(["p0", "p1", "p2"]), 0);
    advanceTimer(g, 5000);
    advanceTimer(g, 20000);
    receiveAnswer(g, "p0", currentRound(g)!.id, "B", 20200);
    command(g, "close", 21000);
    expect(finalResults(g).difficultQuestions).toBe(0);
  });
  it.each([
    { counts: [8, 7, 3, 2], difficult: true },
    { counts: [8, 8, 2, 2], difficult: false },
    { counts: [5, 5, 5, 5], difficult: false },
    { counts: [2, 3, 0, 0], difficult: false },
    { counts: [0, 1, 0, 0], difficult: false },
    { counts: [1, 0, 0, 0], difficult: true },
    { counts: [0, 0, 0, 0], difficult: false },
  ])(
    "締切時の票数 $counts で難問判定が $difficult になる",
    ({ counts, difficult }) => {
      const g = fixture(20);
      open(g);
      const r = currentRound(g)!;
      let player = 0;
      for (const [index, count] of counts.entries())
        for (let i = 0; i < count; i++)
          receiveAnswer(
            g,
            `p${player++}`,
            r.id,
            (["A", "B", "C", "D"] as const)[index],
            20100 + player,
          );
      expect(isDifficultRound(r)).toBe(false);
      command(g, "close", 21000);
      const results = finalResults(g);
      expect(isDifficultRound(r)).toBe(difficult);
      expect(results.difficultQuestions).toBe(difficult ? 1 : 0);
      expect(results.difficult).toHaveLength(difficult ? counts[1] : 0);
      expect(
        results.difficult.every((row) => row.value === 1 && row.rank === 1),
      ).toBe(true);
      r.isVoided = true;
      expect(isDifficultRound(r)).toBe(false);
      expect(finalResults(g).difficult).toEqual([]);
    },
  );
  it("対象外の票や旧正答率しきい値を難問王の判定に使わない", () => {
    const g = fixture(4);
    open(g);
    const r = currentRound(g)!;
    receiveAnswer(g, "p0", r.id, "B", 20100);
    receiveAnswer(g, "p1", r.id, "A", 20200);
    receiveAnswer(g, "p2", r.id, "A", 20300);
    delete r.participants.p3;
    r.answers.p3 = { choice: "B", receivedAt: 20400 };
    r.answers.late = { choice: "B", receivedAt: 20400 };
    command(g, "close", 21000);
    Object.assign(g, { difficultyThreshold: 0 });
    expect(isDifficultRound(r)).toBe(true);
  });
  it("同着1位を全員に加算し、最速になった回数で早押し王を決める", () => {
    const g = fixture(2);
    for (let i = 0; i < 3; i++) {
      open(g, i * 40000);
      const r = currentRound(g)!;
      receiveAnswer(g, "p0", r.id, "B", i * 40000 + 20100);
      if (i === 0) receiveAnswer(g, "p1", r.id, "B", 20100);
      command(g, "close", i * 40000 + 21000);
      command(g, "reveal");
      command(g, "ranking");
    }
    const result = finalResults(g);
    expect(result.fastest).toEqual([
      { playerId: "p0", name: "Player 0", rank: 1, value: 3 },
      { playerId: "p1", name: "Player 1", rank: 2, value: 1 },
    ]);
  });
  it("無効問題と未出題問題を全集計から除外する", () => {
    const g = fixture();
    open(g);
    receiveAnswer(g, "p0", currentRound(g)!.id, "B", 20100);
    command(g, "void", 21000, { reason: "誤植" });
    command(g, "finish");
    expect(currentRound(g)?.answers.p0).toBeDefined();
    expect(advanceTimer(g, 99999)).toBe(false);
    const result = finalResults(g);
    expect(result.validQuestions).toBe(0);
    expect(result.correct).toEqual([]);
    expect(result.fastest).toEqual([]);
    expect(result.difficult).toEqual([]);
    expect(result.friendship).toEqual([]);
  });
  it("未回答だけの大会では受賞者を作らない", () => {
    const g = fixture();
    open(g);
    command(g, "close");
    command(g, "reveal");
    command(g, "ranking");
    command(g, "finish");
    expect(finalResults(g).correct).toEqual([]);
    expect(finalResults(g).fastest).toEqual([]);
    expect(finalResults(g).friendship).toEqual([]);
  });
});
describe("時間設定と期限", () => {
  it("15秒ずつ繰り返し延長し、回答・計測開始時刻・次問の設定を維持する", () => {
    const g = fixture(3);
    open(g);
    const round = currentRound(g)!;
    const timing = { ...g.timing };
    const answer = receiveAnswer(g, "p0", round.id, "B", 21000);
    command(g, "extendAnswers", 49000);
    expect(g.phaseEndsAt).toBe(65000);
    expect(advanceTimer(g, 50000)).toBe(false);
    receiveAnswer(g, "p1", round.id, "B", 64000);
    command(g, "extendAnswers", 64999);
    expect(g.phaseEndsAt).toBe(80000);
    expect(round.answerExtendedAt).toBe(64999);
    expect(round.openedAt).toBe(20000);
    expect(receiveAnswer(g, "p0", round.id, "A", 70000)).toEqual(answer);
    expect(roundRanking(g, round).map((r) => r.value)).toEqual([1000, 44000]);
    expect(g.timing).toEqual(timing);
    for (const role of ["control", "display", "player"] as const) {
      const view = viewFor(g, role, "p0", presence, "e", 65000, "http://test");
      expect(view.phaseEndsAt).toBe(80000);
      expect(view.phaseDurationMs).toBe(60000);
      expect(view.answerExtendedAt).toBe(64999);
    }
    receiveAnswer(g, "p2", round.id, "B", 79999);
    expect(advanceTimer(g, 80000)).toBe(true);
    expect(round.closedAt).toBe(80000);
    command(g, "reveal", 80001);
    command(g, "ranking", 80002);
    open(g, 80003);
    expect(g.phaseEndsAt).toBe(130003);
    expect(currentRound(g)!.answerExtendedAt).toBeUndefined();
    expect(
      viewFor(g, "player", "p0", presence, "e", 100003, "http://test")
        .answerExtendedAt,
    ).toBeUndefined();
  });
  it.each([50000, 50001])(
    "アラーム未処理でも期限以降の延長を拒否する (%i)",
    (now) => {
      const g = fixture();
      open(g);
      const before = structuredClone(g);
      expect(() => command(g, "extendAnswers", now)).toThrow("締切前");
      expect(g).toEqual(before);
      expect(advanceTimer(g, now)).toBe(true);
      expect(currentRound(g)!.closedAt).toBe(50000);
    },
  );
  it("期限直前の延長だけを受け付け、古い操作による二重延長を拒否する", () => {
    const g = fixture();
    open(g);
    const revision = g.revision;
    applyCommand(g, { command: "extendAnswers", revision }, 49999);
    expect(g.phaseEndsAt).toBe(65000);
    expect(() =>
      applyCommand(g, { command: "extendAnswers", revision }, 50000),
    ).toThrow("更新");
    expect(g.phaseEndsAt).toBe(65000);
    expect(() =>
      receiveAnswer(g, "p0", currentRound(g)!.id, "B", 65000),
    ).toThrow("受付中");
  });
  it.each([
    "waiting",
    "countdown",
    "choicesReading",
    "answersClosed",
    "questionVoided",
    "finished",
  ] as const)("%sでは延長せず、手動締切・無効化後も復活させない", (phase) => {
    const g = fixture();
    open(g);
    g.phase = phase;
    const before = structuredClone(g);
    expect(() => command(g, "extendAnswers", 21000)).toThrow("締切前");
    expect(g).toEqual(before);
  });
  it.each([1, 2, 3] as const)(
    "難易度%iの初期回答時間で配信・受付・自動締切する",
    (difficulty) => {
      const g = fixture(2);
      g.rounds[0].question = { ...question, difficulty };
      open(g);
      const duration = [30, 45, 60][difficulty - 1] * 1000;
      const deadline = 20000 + duration;
      expect(g.phaseEndsAt).toBe(deadline);
      for (const role of ["control", "display", "player"] as const) {
        const view = viewFor(
          g,
          role,
          "p0",
          presence,
          "e",
          20000,
          "http://test",
        );
        expect(view.phaseDurationMs).toBe(duration);
        expect(view.phaseEndsAt).toBe(deadline);
      }
      expect(advanceTimer(g, deadline - 1)).toBe(false);
      receiveAnswer(g, "p0", currentRound(g)!.id, "B", deadline - 1);
      expect(() =>
        receiveAnswer(g, "p1", currentRound(g)!.id, "B", deadline),
      ).toThrow("受付中");
      expect(advanceTimer(g, deadline)).toBe(true);
      expect(g.phase).toBe("answersClosed");
      expect(currentRound(g)!.closedAt).toBe(deadline);
    },
  );
  it.each([1, 2, 3] as const)(
    "難易度%iの回答時間を個別に変更できる",
    (difficulty) => {
      const g = fixture(1);
      g.rounds[0].question = { ...question, difficulty };
      command(g, "updateTiming", 0, {
        timing: {
          countdownSeconds: 5,
          readingSeconds: 15,
          answeringSeconds1: 1,
          answeringSeconds2: 23,
          answeringSeconds3: 600,
        },
      });
      open(g);
      expect(g.phaseEndsAt).toBe(20000 + [1, 23, 600][difficulty - 1] * 1000);
    },
  );
  it("大会ごとに公開前5秒・選択肢20秒・難易度別30/45/60秒で初期化する", () => {
    const g = newGame("defaults", "Defaults", [], 0);
    expect(g.timing).toEqual({
      countdownSeconds: 5,
      readingSeconds: 20,
      answeringSeconds1: 30,
      answeringSeconds2: 45,
      answeringSeconds3: 60,
    });
    g.timing.readingSeconds = 60;
    expect(newGame("other", "Other", [], 0).timing.readingSeconds).toBe(20);
  });
  it("設定は次の段階から使い、進行中の期限とバーの長さを維持する", () => {
    const g = fixture(1);
    command(g, "start");
    beginCountdownIfReady(g, new Set(["p0"]), 0);
    command(g, "updateTiming", 1000, {
      timing: {
        countdownSeconds: 8,
        readingSeconds: 12,
        answeringSeconds1: 7,
        answeringSeconds2: 7,
        answeringSeconds3: 7,
      },
    });
    expect(g.phaseEndsAt).toBe(5000);
    expect(
      viewFor(g, "player", "p0", presence, "e", 1000, "http://test")
        .phaseDurationMs,
    ).toBe(5000);
    advanceTimer(g, 5000);
    expect(g.phaseEndsAt).toBe(17000);
    command(g, "updateTiming", 6000, {
      timing: {
        countdownSeconds: 8,
        readingSeconds: 40,
        answeringSeconds1: 9,
        answeringSeconds2: 9,
        answeringSeconds3: 9,
      },
    });
    expect(g.phaseEndsAt).toBe(17000);
    advanceTimer(g, 17000);
    expect(g.phaseEndsAt).toBe(26000);
    command(g, "updateTiming", 18000, {
      timing: {
        countdownSeconds: 8,
        readingSeconds: 40,
        answeringSeconds1: 60,
        answeringSeconds2: 60,
        answeringSeconds3: 60,
      },
    });
    expect(g.phaseEndsAt).toBe(26000);
    expect(() =>
      receiveAnswer(g, "p0", currentRound(g)!.id, "B", 26000),
    ).toThrow("受付中");
    advanceTimer(g, 26000);
    command(g, "reveal");
    command(g, "ranking");
    command(g, "start", 27000);
    beginCountdownIfReady(g, new Set(["p0"]), 27000);
    expect(g.phaseEndsAt).toBe(35000);
  });
  it.each([
    null,
    {},
    {
      countdownSeconds: 0,
      readingSeconds: 20,
      answeringSeconds1: 30,
      answeringSeconds2: 30,
      answeringSeconds3: 30,
    },
    {
      countdownSeconds: 5,
      readingSeconds: 1.5,
      answeringSeconds1: 30,
      answeringSeconds2: 30,
      answeringSeconds3: 30,
    },
    {
      countdownSeconds: 5,
      readingSeconds: 20,
      answeringSeconds1: 601,
      answeringSeconds2: 601,
      answeringSeconds3: 601,
    },
    {
      countdownSeconds: "5",
      readingSeconds: 20,
      answeringSeconds1: 30,
      answeringSeconds2: 30,
      answeringSeconds3: 30,
    },
  ])("不正な時間設定を保存しない (%#)", (timing) => {
    const g = fixture();
    const before = structuredClone(g);
    expect(() => command(g, "updateTiming", 0, { timing })).toThrow();
    expect(g).toEqual(before);
  });
  it.each([
    "answeringSeconds1",
    "answeringSeconds2",
    "answeringSeconds3",
  ] as const)("%sの不正値や欠落を拒否し、保存済み設定を維持する", (key) => {
    for (const value of [0, 601, 1.5, "30", null, undefined]) {
      const g = fixture();
      const before = structuredClone(g);
      expect(() =>
        command(g, "updateTiming", 0, {
          timing: { ...g.timing, [key]: value },
        }),
      ).toThrow();
      expect(g).toEqual(before);
    }
  });
  it("アラームが遅れても期限直前だけ受理し、期限以降は未回答のまま締め切る", () => {
    const g = fixture(2);
    open(g);
    const r = currentRound(g)!;
    const answer = receiveAnswer(g, "p0", r.id, "B", 49999);
    expect(() => receiveAnswer(g, "p1", r.id, "B", 50000)).toThrow("受付中");
    expect(() => receiveAnswer(g, "p1", r.id, "B", 60000)).toThrow("受付中");
    expect(
      viewFor(g, "display", undefined, presence, "e", 50000, "http://test")
        .question?.bodyMarkdown,
    ).toBe(question.bodyMarkdown);
    advanceTimer(g, 60000);
    expect(r.closedAt).toBe(50000);
    expect(r.answers.p1).toBeUndefined();
    expect(receiveAnswer(g, "p0", r.id, "C", 61000)).toEqual(answer);
    expect(
      viewFor(g, "player", "p1", presence, "e", 60000, "http://test").me
        ?.answer,
    ).toBeNull();
  });
  it("公開前は選択肢を配信せず、公開後の15秒は選択肢だけを送る", () => {
    const g = fixture(1);
    command(g, "start");
    beginCountdownIfReady(g, new Set(["p0"]), 0);
    for (const role of ["player", "display"] as const) {
      expect(
        viewFor(g, role, "p0", presence, "e", 1, "http://test").question
          ?.choices,
      ).toBeUndefined();
    }
    advanceTimer(g, 5000);
    for (const role of ["player", "display"] as const) {
      const q = viewFor(
        g,
        role,
        "p0",
        presence,
        "e",
        5000,
        "http://test",
      ).question;
      expect(q?.choices).toEqual(question.choices);
      expect(q?.bodyMarkdown).toBeUndefined();
    }
  });
  it("次の問題で本人の回答と正誤をクリアする", () => {
    const g = fixture(1);
    open(g);
    receiveAnswer(g, "p0", currentRound(g)!.id, "B", 25100);
    command(g, "close", 26000);
    command(g, "reveal");
    command(g, "ranking");
    command(g, "start", 27000);
    const v = viewFor(g, "player", "p0", presence, "e", 27000, "http://test");
    expect(v.me?.answer).toBeNull();
    expect(v.me?.correct).toBeUndefined();
    expect(v.question?.choices).toBeUndefined();
  });
});
describe("問題JSONの検証", () => {
  it("4択の正しい問題を受け付ける", () =>
    expect(validateQuestions([question])).toEqual([question]));
  it.each(
    [
      [],
      [{ ...question, correctChoice: "E" }],
      [question, question],
      [
        {
          ...question,
          choices: {
            A: {
              number: "SE-0001",
              title: "a",
              titleJa: null,
              explanationUrl:
                "https://swiftdigest.koherent.org/proposals/se-0001.html",
            },
            B: {
              number: "SE-0002",
              title: "b",
              titleJa: null,
              explanationUrl:
                "https://swiftdigest.koherent.org/proposals/se-0002.html",
            },
            C: {
              number: "SE-0003",
              title: "c",
              titleJa: null,
              explanationUrl:
                "https://swiftdigest.koherent.org/proposals/se-0003.html",
            },
          },
        },
      ],
      [{ ...question, bodyMarkdown: " " }],
      [{ ...question, id: "bad/id" }],
    ].map((input) => ({ input })),
  )("不正なファイルは全体を拒否する (%#)", ({ input }) =>
    expect(() => validateQuestions(input)).toThrow(),
  );
});

describe("会場の回答分布", () => {
  it("回答受付からDisplayだけへ対象者の集計を送り、締切・発表・順位公開で維持する", () => {
    const g = fixture(6);
    const view = (role: "display" | "player" | "control" = "display") =>
      viewFor(g, role, "p0", presence, "e", 22000, "http://test");
    expect(view().answerDistribution).toBeUndefined();
    command(g, "start");
    command(g, "setReadyWait", 0, { waitForReady: false, playerId: "p5" });
    beginCountdownIfReady(g, new Set(["p0", "p1", "p2", "p3", "p4"]), 0);
    expect(view().answerDistribution).toBeUndefined();
    advanceTimer(g, 5000);
    expect(view().answerDistribution).toBeUndefined();
    advanceTimer(g, 20000);
    const r = currentRound(g)!;
    expect(view().answerDistribution).toEqual({
      counts: { A: 0, B: 0, C: 0, D: 0 },
      unanswered: 6,
    });
    receiveAnswer(g, "p0", r.id, "B", 20100);
    expect(view().answerDistribution).toEqual({
      counts: { A: 0, B: 1, C: 0, D: 0 },
      unanswered: 5,
    });
    receiveAnswer(g, "p1", r.id, "B", 20200);
    receiveAnswer(g, "p2", r.id, "A", 20300);
    receiveAnswer(g, "p3", r.id, "D", 20400);
    addPlayer(g, {
      id: "late",
      name: "途中参加",
      joinedAt: 20500,
      sessionHash: "hash",
    });
    const expected = { counts: { A: 1, B: 2, C: 0, D: 1 }, unanswered: 2 };
    expect(view().answerDistribution).toEqual(expected);
    expect(view().question?.correctChoice).toBeUndefined();
    expect(view("player").answerDistribution).toBeUndefined();
    expect(view("control").answerDistribution).toBeUndefined();
    command(g, "close", 21000);
    expect(view().answerDistribution).toEqual(expected);
    expect(view().question?.correctChoice).toBeUndefined();
    command(g, "reveal", 22000);
    expect(view().answerDistribution).toEqual(expected);
    expect(view("player").answerDistribution).toBeUndefined();
    expect(view("control").answerDistribution).toBeUndefined();
    command(g, "ranking");
    expect(view().answerDistribution).toEqual(expected);
    command(g, "start");
    expect(view().answerDistribution).toBeUndefined();
    command(g, "void", 23000, { reason: "無効" });
    expect(view().answerDistribution).toBeUndefined();
    command(g, "finish");
    expect(view().answerDistribution).toBeUndefined();
  });
  it("全員未回答でも0人の選択肢を残し、無効にした問題の分布は消す", () => {
    const g = fixture(3);
    open(g);
    command(g, "close", 21000);
    command(g, "reveal", 22000);
    const view = () =>
      viewFor(g, "display", undefined, presence, "e", 22000, "http://test");
    expect(view().answerDistribution).toEqual({
      counts: { A: 0, B: 0, C: 0, D: 0 },
      unanswered: 3,
    });
    command(g, "void", 23000, { reason: "出題ミス" });
    expect(view().answerDistribution).toBeUndefined();
  });
});
