import { describe, it, expect } from "vitest";
import {
  addPlayer,
  advanceTimer,
  applyCommand,
  beginReadingIfReady,
  currentRound,
  finalResults,
  newGame,
  receiveAnswer,
  roundRanking,
  viewFor,
} from "../src/worker/game";
import { validateQuestions } from "../src/shared/questions";
import type { Game, Presence, Question } from "../src/shared/types";
const question: Question = {
  id: "test",
  bodyMarkdown: "SECRET BODY",
  choices: { A: "a", B: "b", C: "c", D: "d" },
  correctChoice: "B",
  explanationMarkdown: "SECRET EXPLANATION",
};
function fixture(count = 3): Game {
  const g = newGame(
    "event",
    "Test",
    [question, { ...question, id: "q2" }, { ...question, id: "q3" }],
    0,
  );
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
    beginReadingIfReady(g, new Set(g.players.map((p) => p.id)), true, now),
  ).toBe(true);
  advanceTimer(g, now + 10000);
  advanceTimer(g, now + 15000);
}
const presence: Presence = {
  onlinePlayers: new Set(),
  readyPlayers: new Set(),
  displays: [],
};
describe("全員の準備確認と時間進行", () => {
  it("参加者と会場Displayの両方が揃うまで進まず、同じ人の通知を重複計上しない", () => {
    const g = fixture();
    command(g, "start");
    expect(beginReadingIfReady(g, new Set(["p0", "p1"]), true, 100)).toBe(
      false,
    );
    expect(
      beginReadingIfReady(g, new Set(["p0", "p1", "p2"]), false, 100),
    ).toBe(false);
    expect(beginReadingIfReady(g, new Set(["p0", "p1", "p2"]), true, 100)).toBe(
      true,
    );
    expect(g.phaseEndsAt).toBe(10100);
    expect(beginReadingIfReady(g, new Set(["p0", "p1", "p2"]), true, 500)).toBe(
      false,
    );
    expect(g.phaseEndsAt).toBe(10100);
  });
  it("読む時間10秒と予告5秒を経て実際の出題時刻を記録する", () => {
    const g = fixture();
    command(g, "start");
    beginReadingIfReady(g, new Set(["p0", "p1", "p2"]), true, 100);
    expect(advanceTimer(g, 10099)).toBe(false);
    expect(advanceTimer(g, 10100)).toBe(true);
    expect(g.phase).toBe("countdown");
    expect(advanceTimer(g, 15099)).toBe(false);
    expect(advanceTimer(g, 15100)).toBe(true);
    expect(g.phase).toBe("acceptingAnswers");
    expect(currentRound(g)?.openedAt).toBe(15100);
  });
  it("遅延したタイマーで過去の時刻へ出題を遡らせない", () => {
    const g = fixture();
    command(g, "start");
    beginReadingIfReady(g, new Set(["p0", "p1", "p2"]), true, 0);
    advanceTimer(g, 20000);
    expect(g.phaseEndsAt).toBe(25000);
    advanceTimer(g, 30000);
    expect(currentRound(g)?.openedAt).toBe(30000);
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
    expect(beginReadingIfReady(g, new Set(["p0"]), true, 0)).toBe(true);
    command(g, "void", 1, { reason: "test" });
    command(g, "start", 2);
    expect(currentRound(g)?.participants.late).toBe("eligible");
  });
  it("お休みを待ち合わせから外し、次の問題で自動復帰する", () => {
    const g = fixture(2);
    command(g, "start");
    command(g, "rest", 1, { playerId: "p1" });
    expect(beginReadingIfReady(g, new Set(["p0"]), true, 2)).toBe(true);
    command(g, "void", 3, { reason: "test" });
    command(g, "start", 4);
    expect(currentRound(g)?.participants.p1).toBe("eligible");
  });
  it("対象者が0人では開始しない。カウントダウン中に全員お休みなら停止する", () => {
    const g = fixture(1);
    command(g, "start");
    beginReadingIfReady(g, new Set(["p0"]), true, 0);
    advanceTimer(g, 10000);
    command(g, "rest", 11000, { playerId: "p0" });
    expect(g.phase).toBe("choicesPreparing");
    expect(g.phaseEndsAt).toBeNull();
    expect(beginReadingIfReady(g, new Set(), true, 12000)).toBe(false);
    expect(advanceTimer(g, 20000)).toBe(false);
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
    command(g, "rest", 2, { playerId: "p2" });
    beginReadingIfReady(g, new Set(["p0", "p1"]), true, 0);
    advanceTimer(g, 10000);
    advanceTimer(g, 15000);
    expect(() => receiveAnswer(g, "p0", id, "B", 14999)).toThrow("受付中");
    expect(() => receiveAnswer(g, "p2", id, "B", 15001)).toThrow("対象");
    expect(() => receiveAnswer(g, "stranger", id, "B", 15001)).toThrow("対象");
  });
  it("再送・別選択肢・次問移行後も最初の回答と受信時刻を維持する", () => {
    const g = fixture();
    open(g);
    const id = currentRound(g)!.id;
    const first = receiveAnswer(g, "p0", id, "B", 15800);
    expect(receiveAnswer(g, "p0", id, "C", 15900)).toEqual(first);
    command(g, "close", 16000);
    expect(receiveAnswer(g, "p0", id, "A", 17000)).toEqual(first);
    command(g, "reveal");
    command(g, "ranking");
    command(g, "start");
    expect(receiveAnswer(g, "p0", id, "A", 18000)).toEqual(first);
    expect(currentRound(g)?.answers).toEqual({});
  });
  it("締切後の未保存回答と出題後のお休み指定を拒否する", () => {
    const g = fixture();
    open(g);
    const id = currentRound(g)!.id;
    expect(() => command(g, "rest", 15001, { playerId: "p0" })).toThrow(
      "出題前",
    );
    command(g, "close", 16000);
    expect(() => receiveAnswer(g, "p0", id, "B", 16001)).toThrow("受付中");
  });
  it("同時刻は1,1,3位になり、表示で丸まるだけの時間は区別する", () => {
    const g = fixture(4);
    open(g);
    const r = currentRound(g)!;
    receiveAnswer(g, "p0", r.id, "B", 15100);
    receiveAnswer(g, "p1", r.id, "B", 15100);
    receiveAnswer(g, "p2", r.id, "B", 15101);
    receiveAnswer(g, "p3", r.id, "A", 15001);
    expect(roundRanking(g, r).map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(roundRanking(g, r).map((r) => r.value)).toEqual([100, 100, 101]);
  });
});
describe("権限と公開段階", () => {
  it("出題前に問題文・正解・解説・次問・セッションを公開しない", () => {
    const g = fixture();
    command(g, "start");
    for (const role of ["player", "display"] as const) {
      const v = viewFor(g, role, "p0", presence, "epoch", 0, "http://test");
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
    receiveAnswer(g, "p0", r.id, "B", 15100);
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
  it("正答率は未回答を含み、お休みを除く。誤答を最速記録にしない", () => {
    const g = fixture(5);
    command(g, "start");
    command(g, "rest", 0, { playerId: "p4" });
    beginReadingIfReady(g, new Set(["p0", "p1", "p2", "p3"]), true, 0);
    advanceTimer(g, 10000);
    advanceTimer(g, 15000);
    const r = currentRound(g)!;
    receiveAnswer(g, "p0", r.id, "B", 15200);
    receiveAnswer(g, "p1", r.id, "A", 15100);
    command(g, "close", 16000);
    const result = finalResults(g);
    expect(result.difficultQuestions).toBe(1);
    expect(result.difficult[0].playerId).toBe("p0");
    expect(result.record[0].elapsed).toBe(200);
  });
  it("休みを除いた正答率が30%超なら難問にしない", () => {
    const g = fixture(4);
    command(g, "start");
    command(g, "rest", 0, { playerId: "p3" });
    beginReadingIfReady(g, new Set(["p0", "p1", "p2"]), true, 0);
    advanceTimer(g, 10000);
    advanceTimer(g, 15000);
    receiveAnswer(g, "p0", currentRound(g)!.id, "B", 15200);
    command(g, "close", 16000);
    expect(finalResults(g).difficultQuestions).toBe(0);
  });
  it("同着1位を全員に加算し、安定王の最低正解数を大会全体から求める", () => {
    const g = fixture(2);
    for (let i = 0; i < 3; i++) {
      open(g, i * 20000);
      const r = currentRound(g)!;
      receiveAnswer(g, "p0", r.id, "B", i * 20000 + 15100);
      if (i === 0) receiveAnswer(g, "p1", r.id, "B", 15100);
      command(g, "close", i * 20000 + 16000);
      command(g, "reveal");
      command(g, "ranking");
    }
    const result = finalResults(g);
    expect(result.fastest.find((p) => p.playerId === "p1")?.value).toBe(1);
    expect(result.minimumCorrect).toBe(2);
    expect(result.stable.map((p) => p.playerId)).toEqual(["p0"]);
  });
  it("無効問題と未出題問題を全集計から除外する", () => {
    const g = fixture();
    open(g);
    receiveAnswer(g, "p0", currentRound(g)!.id, "B", 15100);
    command(g, "void", 16000, { reason: "誤植" });
    command(g, "finish");
    expect(currentRound(g)?.answers.p0).toBeDefined();
    expect(advanceTimer(g, 99999)).toBe(false);
    const result = finalResults(g);
    expect(result.validQuestions).toBe(0);
    expect(result.correct).toEqual([]);
    expect(result.record).toEqual([]);
    expect(result.stable).toEqual([]);
  });
  it("未回答だけの大会では受賞者を作らない", () => {
    const g = fixture();
    open(g);
    command(g, "close");
    command(g, "reveal");
    command(g, "ranking");
    command(g, "finish");
    expect(finalResults(g).correct).toEqual([]);
    expect(finalResults(g).record).toEqual([]);
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
      [{ ...question, choices: { A: "a", B: "b", C: "c" } }],
      [{ ...question, bodyMarkdown: " " }],
      [{ ...question, id: "bad/id" }],
    ].map((input) => ({ input })),
  )("不正なファイルは全体を拒否する (%#)", ({ input }) =>
    expect(() => validateQuestions(input)).toThrow(),
  );
});
