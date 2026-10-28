import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { ResultSummary } from "../src/client/PersonalResult";
import type { PersonalResult } from "../src/shared/personal-result";

const result: PersonalResult = {
  eventId: "event",
  eventName: "大会",
  player: {
    id: "player",
    name: "参加者",
    titles: [{ key: "fastest", title: "早押し王", rank: 2 }],
    eligible: 8,
    correct: 6,
    answered: 7,
    incorrect: 1,
    unanswered: 1,
    correctRate: 0.75,
    averageElapsed: 3000,
    averageCorrectElapsed: 2000,
    firstPlaces: 2,
    fastestScore: 4.5,
    averageRank: 2,
    difficultScore: 2,
    friendshipScore: 5,
  },
  rounds: [],
};

function summary(data: PersonalResult) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ResultSummary, { result: data }),
    ),
  );
}

it("各表彰の得点を有効問題数に対するバーと称号にまとめる", () => {
  const html = summary(result);
  expect(html.match(/role="progressbar"/g)).toHaveLength(4);
  expect(html).toContain(
    'aria-label="正答王" aria-valuemin="0" aria-valuemax="100" aria-valuenow="75"',
  );
  expect(html).toContain(
    'aria-label="早押し王" aria-valuemin="0" aria-valuemax="100" aria-valuenow="56"',
  );
  expect(html).toContain('class="medal medal-2"');
  expect(html).toContain("4.500");
  expect(html).not.toContain("正解数 / 有効問題数");
});

it("有効問題がないときに0除算せず対象なしと表示する", () => {
  const empty = {
    ...result,
    player: {
      ...result.player,
      eligible: 0,
      correct: 0,
      fastestScore: 0,
      difficultScore: 0,
      friendshipScore: 0,
      titles: [],
    },
  };
  const html = summary(empty);
  expect(html.match(/aria-valuetext="対象問題なし"/g)).toHaveLength(4);
  expect(html).not.toMatch(/NaN|Infinity/);
});
