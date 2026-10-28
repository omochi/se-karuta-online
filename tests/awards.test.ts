import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { playerTitles } from "../src/shared/awards";
import type { Results } from "../src/shared/types";
import { FinalResults, PlayerTitles } from "../src/client/components";

const results: Results = {
  correct: [{ playerId: "p", name: "参加者", rank: 2, value: 5 }],
  fastest: [{ playerId: "p", name: "参加者", rank: 4, value: 1 }],
  difficult: [],
  friendship: [
    { playerId: "first", name: "1位の人", rank: 1, value: 4 },
    { playerId: "second", name: "2位の人", rank: 2, value: 3 },
    { playerId: "other", name: "同順位の人", rank: 3, value: 2 },
    { playerId: "p", name: "参加者", rank: 3, value: 2 },
  ],
  validQuestions: 10,
};

it("本人の3位以内の称号だけを表彰順に取得し、4番目に並ぶ同率3位も含める", () => {
  expect(playerTitles(results, "p")).toEqual([
    { key: "correct", title: "正答王", rank: 2 },
    { key: "friendship", title: "友情王", rank: 3 },
  ]);
  expect(playerTitles(results, "absent")).toEqual([]);
  expect(
    renderToStaticMarkup(
      createElement(PlayerTitles, { titles: playerTitles(results, "p") }),
    ).replace(/<[^>]*>/g, ""),
  ).toContain("正答王（2位）、友情王（3位）");
  expect(
    renderToStaticMarkup(createElement(PlayerTitles, { titles: [] })),
  ).toContain("該当なし");
});

it.each([false, true])(
  "表彰は指定の4王だけを順番に表示し、大会最速回答を表示しない（compact=%s）",
  (compact) => {
    const html = renderToStaticMarkup(
      createElement(FinalResults, { results, compact }),
    );
    expect([...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1])).toEqual([
      "正答王",
      "早押し王",
      "難問王",
      "友情王",
    ]);
    expect(html).not.toContain("大会最速回答");
    expect(html).not.toContain("安定王");
  },
);

it.each([
  { ranks: [1, 2, 3, 3, 5], expected: 4 },
  { ranks: [1, 1, 1, 1, 5], expected: 4 },
  { ranks: [1, 2, 2, 4], expected: 3 },
])(
  "Displayの表彰は$ranksを人数で切らず、同率を含めた3位以内の$expected人を表示する",
  ({ ranks, expected }) => {
    const friendship = ranks.map((rank, i) => ({
      playerId: `tied-${i}`,
      name: `同率テスト${i}`,
      rank,
      value: 10 - rank,
    }));
    const html = renderToStaticMarkup(
      createElement(FinalResults, {
        results: {
          correct: [],
          fastest: [],
          difficult: [],
          friendship,
          validQuestions: 1,
        },
        compact: true,
      }),
    );
    expect(html.match(/<li>/g)).toHaveLength(expected);
    for (const row of friendship) {
      if (row.rank <= 3) expect(html).toContain(row.name);
      else expect(html).not.toContain(row.name);
    }
  },
);
