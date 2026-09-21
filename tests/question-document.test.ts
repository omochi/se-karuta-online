import { expect, it } from "vitest";
import {
  readQuestionDocument,
  writeQuestionDocument,
} from "../src/client/question-document";
const question = {
  id: "q1",
  difficulty: 2 as const,
  bodyMarkdown: "問題\n```swift\nlet x = 1\n```",
  choices: { A: "a", B: "b", C: "c", D: "d" },
  correctChoice: "B",
  explanationMarkdown: "[解説](https://example.com)",
};
it("配列形式を維持して編集結果を再取り込みできる", () => {
  const doc = readQuestionDocument(JSON.stringify([question]));
  doc.questions[0].bodyMarkdown = "調整した問題";
  expect(JSON.parse(writeQuestionDocument(doc))).toEqual([
    { ...question, bodyMarkdown: "調整した問題" },
  ]);
  expect(readQuestionDocument(writeQuestionDocument(doc))).toEqual(doc);
});
it("オブジェクト形式の大会名や付随情報を保持し、BOM付きJSONを読み込める", () => {
  const input = {
    name: "大会",
    displayPassword: "password",
    notes: { author: "editor" },
    questions: [question],
  };
  const doc = readQuestionDocument("\uFEFF" + JSON.stringify(input));
  doc.questions[0].choices.A = "新しい選択肢";
  expect(JSON.parse(writeQuestionDocument(doc))).toEqual({
    ...input,
    questions: [
      { ...question, choices: { ...question.choices, A: "新しい選択肢" } },
    ],
  });
});
it("不正な入力と、編集で生じたID重複・正解不正を拒否する", () => {
  for (const text of ["{", "null", "{}", "[]"])
    expect(() => readQuestionDocument(text)).toThrow();
  const doc = readQuestionDocument(JSON.stringify([question]));
  doc.questions.push({ ...doc.questions[0] });
  expect(() => writeQuestionDocument(doc)).toThrow("重複");
  doc.questions.pop();
  doc.questions[0].correctChoice = "X" as "A";
  expect(() => writeQuestionDocument(doc)).toThrow("正解");
});

it.each([1, 2, 3] as const)(
  "難易度 %i を読み込み、変更して保存・再読み込みできる",
  (difficulty) => {
    const doc = readQuestionDocument(
      JSON.stringify([{ ...question, difficulty }]),
    );
    expect(doc.questions[0].difficulty).toBe(difficulty);
    doc.questions[0].difficulty = difficulty === 3 ? 1 : 3;
    expect(readQuestionDocument(writeQuestionDocument(doc))).toEqual(doc);
  },
);

it("難易度のない旧JSONは標準の2として読み込み、保存時に明記する", () => {
  const { difficulty: _, ...legacy } = question;
  const doc = readQuestionDocument(JSON.stringify([legacy]));
  expect(doc.questions[0].difficulty).toBe(2);
  expect(JSON.parse(writeQuestionDocument(doc))[0].difficulty).toBe(2);
});

it.each([0, 4, -1, 1.5, "2", null, true])(
  "不正な難易度 %j を拒否する",
  (difficulty) => {
    expect(() =>
      readQuestionDocument(JSON.stringify([{ ...question, difficulty }])),
    ).toThrow("問題 1: 難易度");
  },
);
