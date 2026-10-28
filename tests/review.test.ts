import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import tutorial from "../data/questions/tutorial.json";
import { validateQuestions } from "../src/shared/questions";
import { newGame } from "../src/worker/game";
import { tournamentReview } from "../src/worker/review";
import { ReviewContent } from "../src/client/TournamentReview";

function fixture() {
  const question = validateQuestions(tutorial.questions)[0];
  const game = newGame(
    "review-event",
    "復習テスト大会",
    Array.from({ length: 4 }, (_, i) => ({ ...question, id: `q${i}` })),
    0,
  );
  game.phase = "finished";
  game.players = [{ id: "private-id", name: "個人名は非公開", joinedAt: 0 }];
  const [scored, voided, beforeOpening] = game.rounds;
  scored.openedAt = 1000;
  scored.closedAt = 5000;
  scored.participants = { "private-id": "eligible", other: "eligible" };
  scored.answers = {
    "private-id": { choice: "A", receivedAt: 2000 },
    // 回答対象外の記録は人数に含めない。
    ineligible: { choice: "B", receivedAt: 3000 },
  };
  voided.isVoided = true;
  voided.voidReason = "個人名を含む無効理由";
  voided.openedAt = 6000;
  voided.closedAt = 10000;
  voided.participants = { "private-id": "eligible" };
  voided.answers = { "private-id": { choice: "D", receivedAt: 7000 } };
  beforeOpening.isVoided = true;
  beforeOpening.closedAt = 11000;
  beforeOpening.participants = { "private-id": "eligible" };
  return game;
}

it("全問を保存順で公開し、回答対象者の人数だけを集計して個人情報を含めない", () => {
  const game = fixture();
  const review = tournamentReview(game);
  expect(review.rounds.map((r) => r.number)).toEqual([1, 2, 3, 4]);
  expect(review.rounds.map((r) => r.question)).toEqual(
    game.rounds.map((r) => r.question),
  );
  expect(review.rounds.map((r) => r.status)).toEqual([
    "scored",
    "voided",
    "voided",
    "unasked",
  ]);
  expect(review.rounds.map((r) => r.distribution)).toEqual([
    { counts: { A: 1, B: 0, C: 0, D: 0 }, unanswered: 1 },
    { counts: { A: 0, B: 0, C: 0, D: 1 }, unanswered: 0 },
    null,
    null,
  ]);
  expect(Object.keys(review)).toEqual(["id", "name", "rounds"]);
  for (const round of review.rounds)
    expect(Object.keys(round)).toEqual([
      "number",
      "question",
      "status",
      "distribution",
    ]);
  expect(JSON.stringify(review)).not.toMatch(
    /private-id|個人名|receivedAt|players/,
  );
});

it("終了前は復習資料を生成しない", () => {
  const game = fixture();
  game.phase = "rankingShown";
  expect(() => tournamentReview(game)).toThrow("大会終了後");
});

it("全問の本文・正解・解説・Digestリンクを表示し、個別回答を選択しない", () => {
  const review = tournamentReview(fixture());
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ReviewContent, { review })),
  );
  expect(html.match(/<article /g)).toHaveLength(4);
  expect(html).not.toMatch(/display-page|display-content|display-header/);
  expect(html.match(/data-color-scheme="light"/g)).toHaveLength(2);
  expect(html.match(/aria-label="問題文"/g)).toHaveLength(4);
  expect(html.match(/aria-label="正解と解説"/g)).toHaveLength(4);
  expect(html.match(/class="choice-explanation-link"/g)).toHaveLength(16);
  expect(html.match(/正解 A<\/h3>/g)).toHaveLength(4);
  expect(html).toContain("回答 1 / 2人 · 未回答 1人");
  expect(html).toContain("回答数は参考記録です");
  expect(html).toContain("この問題は出題されていません");
  expect(html).toContain("回答受付を行っていません");
  expect(html).toContain(review.rounds[0].question.choices.A.explanationUrl);
  expect(html).not.toMatch(/個人名|aria-pressed|choice-check|selected|<button/);
});
