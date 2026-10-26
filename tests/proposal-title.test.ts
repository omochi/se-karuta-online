import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Choices } from "../src/client/components";
import {
  readQuestionDocument,
  writeQuestionDocument,
} from "../src/client/question-document";
import { createDisplayPreviewView } from "../src/client/display-preview";
import { validateQuestions } from "../src/shared/questions";
import { choiceLabel } from "../src/shared/proposal-title";
import type { Phase, Role } from "../src/shared/types";
import { newGame, viewFor, finalResults } from "../src/worker/game";
import { tournamentReport } from "../src/worker/report";
import volume from "../data/questions/vol-01.json";
import tutorial from "../data/questions/tutorial.json";

const question = validateQuestions(volume.questions)[0];
it("全収録問題の選択肢にSE番号・原題・邦題をまとめ、編集・保存・再読み込みで保持する", () => {
  for (const source of [volume, tutorial]) {
    const doc = readQuestionDocument(JSON.stringify(source));
    expect(doc.questions).toEqual(source.questions);
    for (const q of doc.questions)
      for (const choice of Object.values(q.choices))
        expect(Object.keys(choice)).toEqual(["number", "title", "titleJa"]);
    doc.questions[0].choices.A = {
      number: "SE-1234",
      title: "Edited title",
      titleJa: "調整した邦題",
    };
    expect(readQuestionDocument(writeQuestionDocument(doc))).toEqual(doc);
  }
});
it.each([
  "SE-0380 · if and switch expressions",
  null,
  [],
  {},
  { ...question.choices.A, number: "0380" },
  { ...question.choices.A, number: "SE-380" },
  { ...question.choices.A, title: " " },
  { ...question.choices.A, title: "a".repeat(301) },
  { ...question.choices.A, titleJa: undefined },
  { ...question.choices.A, titleJa: " " },
  { ...question.choices.A, titleJa: 123 },
  { ...question.choices.A, titleJa: "あ".repeat(301) },
])("旧文字列形式や不正な選択肢 %j を拒否する", (choice) => {
  expect(() =>
    validateQuestions([
      { ...question, choices: { ...question.choices, A: choice } },
    ]),
  ).toThrow("問題 1: 選択肢 A:");
});
it("titleJa の null を保存し、邦題のない選択肢では原題だけを表示する", () => {
  const doc = readQuestionDocument(JSON.stringify(tutorial));
  expect(readQuestionDocument(writeQuestionDocument(doc))).toEqual(doc);
  expect(doc.questions[0].choices.A.titleJa).toBeNull();
  expect(choiceLabel(doc.questions[0], "A")).toBe("SE-0296 · Async/await");
  const choices = Object.fromEntries(
    Object.entries(question.choices).map(([key, value]) => [
      key,
      { ...value, titleJa: null },
    ]),
  ) as typeof question.choices;
  const html = renderToStaticMarkup(
    createElement(Choices, { question: { ...question, choices } }),
  );
  expect(html).toContain("Implicit returns from single-expression functions");
  expect(html).not.toContain("proposal-japanese");
});
it("原題と同じ邦題は英字の大小違いも含め、収録データで null にする", () => {
  for (const source of [volume, tutorial])
    for (const q of source.questions)
      for (const choice of Object.values(q.choices)) {
        if (choice.titleJa !== null)
          expect(choice.titleJa.toLowerCase()).not.toBe(
            choice.title.toLowerCase(),
          );
      }
  expect(tutorial.questions[0].choices.A.titleJa).toBeNull();
});
it.each(["control", "display", "player"] satisfies Role[])(
  "%s に邦題を選択肢と同じタイミングで配信し、正解は発表まで隠す",
  (role) => {
    const game = newGame("test", "表示確認", [question], 0);
    game.currentIndex = 0;
    for (const phase of [
      "choicesPreparing",
      "countdown",
      "choicesReading",
      "acceptingAnswers",
      "answersClosed",
      "answerRevealed",
    ] satisfies Phase[]) {
      game.phase = phase;
      const view = viewFor(
        game,
        role,
        undefined,
        { onlinePlayers: new Set(), readyPlayers: new Set(), displays: [] },
        "test",
        0,
        "http://localhost",
      );
      expect(view.question?.choices).toEqual(
        ["choicesPreparing", "countdown"].includes(phase)
          ? undefined
          : question.choices,
      );
      expect(view.question?.correctChoice).toBe(
        phase === "answerRevealed" ? question.correctChoice : undefined,
      );
    }
  },
);
it("表示プレビュー・レポート・最速回答にも邦題を残す", () => {
  const view = createDisplayPreviewView(
    {
      name: "確認",
      question,
      questionNumber: 1,
      totalQuestions: 1,
      phase: "choicesReading",
    },
    "http://localhost",
  );
  expect(view.question!.choices).toEqual(question.choices);
  const game = newGame("test", "確認", [question], 0);
  game.players = [
    { id: "p", name: "参加者", sessionHash: "test", joinedAt: 0 },
  ];
  game.phase = "finished";
  const round = game.rounds[0];
  round.openedAt = 1000;
  round.closedAt = 2000;
  round.participants = { p: "eligible" };
  round.answers = { p: { choice: question.correctChoice, receivedAt: 1500 } };
  expect(tournamentReport(game).rounds[0].question.choices).toEqual(
    question.choices,
  );
  expect(finalResults(game).record[0].proposal).toBe(
    choiceLabel(question, question.correctChoice),
  );
});
it("SE番号・原題・邦題を別々に表示し、読み上げにも邦題を含める", () => {
  const html = renderToStaticMarkup(
    createElement(Choices, { question, selected: "A", disabled: false }),
  );
  expect(html).toContain('class="proposal-number">SE-0255</span>');
  expect(html).toContain(
    'lang="en">Implicit returns from single-expression functions',
  );
  expect(html).toContain('lang="ja">単一式関数からの暗黙的return');
  expect(html).toContain(`aria-label="A. ${choiceLabel(question, "A")}"`);
  expect(html).toContain('aria-pressed="true"');
});
