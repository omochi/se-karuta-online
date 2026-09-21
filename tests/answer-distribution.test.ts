import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerDistribution } from "../src/client/AnswerDistribution";

it("A〜D順を保ち、正解0人でも正解を明示し、対象人数を共通の目盛りにする", () => {
  const html = renderToStaticMarkup(
    createElement(AnswerDistribution, {
      distribution: { counts: { A: 2, B: 0, C: 1, D: 0 }, unanswered: 1 },
      correctChoice: "B",
    }),
  );
  expect(html).toContain('aria-label="B：0人、正解"');
  expect(html).toContain('style="width:50%"');
  expect(html).toContain('style="width:25%"');
  expect(html).toContain('style="width:0%"');
  expect(html).toContain("回答 3人 · 未回答 1人");
  expect(html).not.toContain("サンプル");
});
it("対象者0人でもNaNにならず、サンプルにはその旨を表示する", () => {
  const html = renderToStaticMarkup(
    createElement(AnswerDistribution, {
      distribution: {
        counts: { A: 0, B: 0, C: 0, D: 0 },
        unanswered: 0,
        sample: true,
      },
      correctChoice: "D",
    }),
  );
  expect(html).not.toMatch(/NaN|Infinity/);
  expect(html).toContain("この問題の回答対象者はいません");
  expect(html).toContain("サンプル");
});
