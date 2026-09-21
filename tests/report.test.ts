import { expect, it } from "vitest";
import { newGame, finalResults } from "../src/worker/game";
import { tournamentReport } from "../src/worker/report";
import type { Game, Question } from "../src/shared/types";

function fixture(): Game {
  const questions: Question[] = Array.from({ length: 5 }, (_, i) => ({
    id: `q${i}`,
    difficulty: 2,
    bodyMarkdown: "問題",
    choices: { A: "a", B: "b", C: "c", D: "d" },
    correctChoice: "B",
    explanationMarkdown: "解説",
  }));
  const g = newGame("event", "集計テスト", questions, 0);
  g.phase = "finished";
  g.players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`,
    name: i < 2 ? "同名" : `参加者${i}`,
    joinedAt: i,
    sessionHash: "PRIVATE_HASH",
  }));
  const [first, second, voided, unasked, beforeOpening] = g.rounds;
  first.openedAt = 1000;
  first.closedAt = 10000;
  first.participants = {
    p0: "eligible",
    p1: "eligible",
    p2: "eligible",
    p3: "eligible",
    p4: "resting",
  };
  first.answers = {
    p0: { choice: "B", receivedAt: 2000 },
    p1: { choice: "B", receivedAt: 2000 },
    p2: { choice: "A", receivedAt: 5000 },
  };
  second.openedAt = 20000;
  second.closedAt = 30000;
  second.participants = {
    p0: "eligible",
    p1: "eligible",
    p2: "eligible",
    p3: "eligible",
    p4: "resting",
    p5: "eligible",
  };
  second.answers = { p0: { choice: "B", receivedAt: 25000 } };
  voided.openedAt = 40000;
  voided.closedAt = 41000;
  voided.isVoided = true;
  voided.voidReason = "出題ミス";
  voided.participants = { p2: "eligible" };
  voided.answers = { p2: { choice: "B", receivedAt: 40001 } };
  beforeOpening.isVoided = true;
  beforeOpening.voidReason = "接続トラブル";
  beforeOpening.closedAt = 42000;
  beforeOpening.participants = { p0: "eligible" };
  return g;
}
it("未回答を分母に含め、お休み・途中参加前・無効・未出題を正しく分離する", () => {
  const report = tournamentReport(fixture());
  expect(report.summary).toMatchObject({
    scored: 2,
    voided: 2,
    unasked: 1,
    eligible: 9,
    answered: 4,
    correct: 3,
    correctRate: 1 / 3,
    averageElapsed: 2750,
  });
  expect(report.rounds[0]).toMatchObject({
    eligible: 4,
    answered: 3,
    correct: 2,
    correctRate: 0.5,
    unanswered: 1,
    resting: 1,
    ineligible: 1,
    distribution: { A: 1, B: 2, C: 0, D: 0 },
    averageElapsed: 2000,
    medianElapsed: 1000,
    fastestCorrect: 1000,
  });
  expect(report.rounds[1].difficult).toBe(true);
  expect(report.rounds[0].difficult).toBe(false);
  expect(report.rounds[2]).toMatchObject({
    status: "voided",
    correctRate: null,
    correct: 1,
    fastestCorrect: 1,
  });
  expect(
    report.rounds[2].answers.find((a) => a.playerId === "p2"),
  ).toMatchObject({ choice: "B", status: "correct", elapsed: 1, rank: null });
  expect(report.rounds[3].answers.every((a) => a.status === "unasked")).toBe(
    true,
  );
  expect(report.rounds[4].answers[0].status).toBe("notOpened");
  expect(report.rounds[4].unanswered).toBe(0);
  expect(report.players.find((p) => p.id === "p5")).toMatchObject({
    eligible: 1,
    ineligible: 1,
    unanswered: 1,
    correctRate: 0,
  });
  expect(report.players.find((p) => p.id === "p4")).toMatchObject({
    eligible: 0,
    resting: 2,
    correctRate: null,
    averageElapsed: null,
  });
});
it("同着順位と表彰の集計を一致させ、誤答の速さを最速正解に使わない", () => {
  const g = fixture();
  const report = tournamentReport(g);
  expect(report.results).toEqual(finalResults(g));
  expect(report.rounds[0].answers.slice(0, 2).map((a) => a.rank)).toEqual([
    1, 1,
  ]);
  expect(report.players[0]).toMatchObject({
    correct: 2,
    firstPlaces: 2,
    averageRank: 1,
    averageCorrectElapsed: 3000,
    fastestCorrect: 1000,
    difficultCorrect: 1,
    stableQualified: true,
  });
  expect(report.players[1]).toMatchObject({
    correct: 1,
    firstPlaces: 1,
    stableQualified: true,
  });
  expect(report.players[2]).toMatchObject({
    correct: 0,
    incorrect: 1,
    averageElapsed: 4000,
    averageCorrectElapsed: null,
    fastestCorrect: null,
    stableQualified: false,
  });
  expect(JSON.stringify(report)).not.toContain("PRIVATE_HASH");
  expect(JSON.stringify(report)).not.toContain("sessionHash");
});
it("偶数件の中央値と0ミリ秒の回答を欠損値と区別する", () => {
  const g = fixture();
  g.rounds[0].answers.p0.receivedAt = 1000;
  delete g.rounds[0].answers.p2;
  const r = tournamentReport(g).rounds[0];
  expect(r.fastestCorrect).toBe(0);
  expect(r.medianElapsed).toBe(500);
  expect(r.averageElapsed).toBe(500);
});
it("参加者も有効問題もない大会を有限値またはnullで表す", () => {
  const g = newGame("empty", "空の大会", [], 0);
  g.phase = "finished";
  const report = tournamentReport(g);
  expect(report.players).toEqual([]);
  expect(report.rounds).toEqual([]);
  expect(report.summary).toEqual({
    scored: 0,
    voided: 0,
    unasked: 0,
    eligible: 0,
    answered: 0,
    correct: 0,
    correctRate: null,
    averageElapsed: null,
  });
});
it("未終了の大会から詳細結果を作らない", () => {
  const g = fixture();
  g.phase = "acceptingAnswers";
  expect(() => tournamentReport(g)).toThrow("大会終了後");
});
