import { expect, it } from "vitest";
import { newGame, finalResults } from "../src/worker/game";
import { tournamentReport } from "../src/worker/report";
import { personalResult } from "../src/worker/personal-result";
import type { Game, Question } from "../src/shared/types";

function fixture(): Game {
  const questions: Question[] = Array.from({ length: 5 }, (_, i) => ({
    id: `q${i}`,
    difficulty: 2,
    bodyMarkdown: "問題",
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
      D: {
        number: "SE-0004",
        title: "d",
        titleJa: null,
        explanationUrl:
          "https://swiftdigest.koherent.org/proposals/se-0004.html",
      },
    },
    correctChoice: "B",
    explanationMarkdown: "解説",
  }));
  const g = newGame("event", "集計テスト", questions, 0);
  g.phase = "finished";
  g.readyExemptPlayerIds = ["p4"];
  g.players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`,
    name: i < 2 ? "同名" : `参加者${i}`,
    joinedAt: i,
  }));
  const [first, second, voided, unasked, beforeOpening] = g.rounds;
  first.openedAt = 1000;
  first.closedAt = 10000;
  first.participants = {
    p0: "eligible",
    p1: "eligible",
    p2: "eligible",
    p3: "eligible",
    p4: "eligible",
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
    p4: "eligible",
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
it("個人成績は管理側と同じ集計を使い、他の参加者や全員の順位表を含めない", () => {
  const game = fixture();
  const player = game.players[2];
  const report = tournamentReport(game);
  const result = personalResult(game, player.id);
  const { fastestCorrect: _, ...expectedPlayer } = report.players[2];
  expect(result.player).toEqual(expectedPlayer);
  expect(result.player).not.toHaveProperty("fastestCorrect");
  expect(result.rounds).toHaveLength(report.rounds.length);
  result.rounds.forEach((round, i) => {
    const { playerId: _, ...answer } = report.rounds[i].answers[2];
    expect(round.answer).toEqual(answer);
  });
  const json = JSON.stringify(result);
  expect(json).not.toContain('"players"');
  expect(json).not.toContain('"results"');
  for (const other of game.players.filter((p) => p.id !== player.id)) {
    expect(json).not.toContain(`"${other.id}"`);
    expect(json).not.toContain(`"${other.name}"`);
  }
  expect(() => personalResult(game, "missing")).toThrow(
    "参加者が見つかりません",
  );
});
it("途中参加前も未回答として分母に含め、無効・未出題は除外する", () => {
  const report = tournamentReport(fixture());
  expect(report.summary).toMatchObject({
    scored: 2,
    voided: 2,
    unasked: 1,
    eligible: 12,
    answered: 4,
    correct: 3,
    correctRate: 3 / 12,
    averageElapsed: 2750,
  });
  expect(report.rounds[0]).toMatchObject({
    eligible: 6,
    answered: 3,
    correct: 2,
    correctRate: 2 / 6,
    unanswered: 3,
    ineligible: 0,
    distribution: { A: 1, B: 2, C: 0, D: 0 },
    averageElapsed: 2000,
    medianElapsed: 1000,
    fastestCorrect: 1000,
  });
  expect(
    report.rounds[0].answers.find((a) => a.playerId === "p4")?.status,
  ).toBe("unanswered");
  expect(
    report.rounds[0].answers.find((a) => a.playerId === "p3")?.status,
  ).toBe("unanswered");
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
    eligible: 2,
    unanswered: 2,
    correctRate: 0,
  });
  expect(report.players.find((p) => p.id === "p4")).toMatchObject({
    eligible: 2,
    unanswered: 2,
    correctRate: 0,
    averageElapsed: null,
  });
});
it("最後の1問だけ正解しても1/8とし、参加前の7問を未回答として共有する", () => {
  const game = fixture();
  const template = game.rounds[1];
  game.rounds = Array.from({ length: 8 }, (_, i) => {
    const round = structuredClone(template);
    round.id = `late-${i}`;
    if (i < 7) delete round.participants.p5;
    else
      round.answers.p5 = { choice: "B", receivedAt: template.openedAt! + 300 };
    return round;
  });
  game.players.push({
    id: "after",
    name: "全問終了後に参加",
    joinedAt: 999999,
  });
  const report = tournamentReport(game);
  const result = personalResult(game, "p5");
  expect(result.player).toMatchObject({
    eligible: 8,
    correct: 1,
    answered: 1,
    unanswered: 7,
    incorrect: 0,
    correctRate: 0.125,
  });
  expect(result.player).toEqual(
    (({ fastestCorrect: _, ...p }) => p)(
      report.players.find((p) => p.id === "p5")!,
    ),
  );
  for (const round of result.rounds.slice(0, 7)) {
    expect(round.answer).toEqual({
      status: "unanswered",
      choice: null,
      elapsed: null,
      rank: null,
    });
  }
  expect(personalResult(game, "after").player).toMatchObject({
    eligible: 8,
    correct: 0,
    unanswered: 8,
    correctRate: 0,
    averageElapsed: null,
  });
  expect(report.summary.eligible).toBe(8 * game.players.length);
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
    fastestScore: 2,
    averageRank: 1,
    averageCorrectElapsed: 3000,
    fastestCorrect: 1000,
    difficultScore: 43 / 30,
    friendshipScore: 5 / 3,
    titles: [
      { key: "correct", title: "正答王", rank: 1 },
      { key: "fastest", title: "早押し王", rank: 1 },
      { key: "difficult", title: "難問王", rank: 1 },
      { key: "friendship", title: "友情王", rank: 1 },
    ],
  });
  expect(report.players[1]).toMatchObject({
    correct: 1,
    firstPlaces: 1,
    friendshipScore: 2 / 3,
  });
  expect(report.players[2]).toMatchObject({
    correct: 0,
    incorrect: 1,
    averageElapsed: 4000,
    averageCorrectElapsed: null,
    fastestCorrect: null,
    friendshipScore: 1 / 3,
    titles: [{ key: "friendship", title: "友情王", rank: 3 }],
  });
  expect(JSON.stringify(report)).not.toContain("PRIVATE_HASH");
  expect(JSON.stringify(report)).not.toContain("sessionHash");
});
it("友情王の得点を結果、レポートと個人成績で共有する", () => {
  const game = fixture();
  const report = tournamentReport(game);
  expect(report.results.friendship[0].value).toBeCloseTo(5 / 3);
  expect(report.players[0].friendshipScore).toBeCloseTo(5 / 3);
  expect(personalResult(game, "p0").player.friendshipScore).toBeCloseTo(5 / 3);
});
it("早押し王の得点と1位回数を個別に集計する", () => {
  const g = fixture();
  g.rounds[0].answers.p2.choice = "B";
  const report = tournamentReport(g);
  expect(report.players[2].firstPlaces).toBe(0);
  expect(report.players[2].fastestScore).toBeCloseTo(1 / 3);
  expect(
    report.results.fastest.find((row) => row.playerId === "p2")?.value,
  ).toBeCloseTo(1 / 3);
  expect(personalResult(g, "p2").player.fastestScore).toBeCloseTo(1 / 3);
});
it("難問王の得点を回答対象者から集計し、レポートと個人成績に反映する", () => {
  const g = fixture();
  const report = tournamentReport(g);
  expect(report.results.difficult[0].value).toBeCloseTo(3 / 5 + 5 / 6);
  expect(report.players[0].difficultScore).toBeCloseTo(3 / 5 + 5 / 6);
  expect(personalResult(g, "p0").player.difficultScore).toBeCloseTo(
    3 / 5 + 5 / 6,
  );
  expect(report.players[1].difficultScore).toBeCloseTo(3 / 5);
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
