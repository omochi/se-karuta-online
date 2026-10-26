import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Display } from "../src/client/App";
import { DisplayScreen } from "../src/client/DisplayScreen";
import { ConnectionBadge } from "../src/client/components";
import {
  createDisplayPreviewView,
  type DisplayPreviewPhase,
} from "../src/client/display-preview";
import { getGameProgress } from "../src/client/phase-presentation";
import type { RoomConnection } from "../src/client/useRoom";
import type { Difficulty, Phase } from "../src/shared/types";

const question = {
  id: "preview-question",
  difficulty: 2 as const,
  bodyMarkdown: "QUESTION BODY\n\n```swift\nlet value = 42\n```",
  choices: {
    A: {
      number: "SE-0001",
      title: "Alpha",
      titleJa: null,
      explanationUrl: "https://swiftdigest.koherent.org/proposals/se-0001.html",
    },
    B: {
      number: "SE-0002",
      title: "Beta",
      titleJa: null,
      explanationUrl: "https://swiftdigest.koherent.org/proposals/se-0002.html",
    },
    C: {
      number: "SE-0003",
      title: "Gamma",
      titleJa: null,
      explanationUrl: "https://swiftdigest.koherent.org/proposals/se-0003.html",
    },
    D: {
      number: "SE-0004",
      title: "Delta",
      titleJa: null,
      explanationUrl: "https://swiftdigest.koherent.org/proposals/se-0004.html",
    },
  },
  correctChoice: "B" as const,
  explanationMarkdown: "ANSWER EXPLANATION",
};
function view(phase: DisplayPreviewPhase) {
  return createDisplayPreviewView(
    { name: "Review", question, questionNumber: 2, totalQuestions: 3, phase },
    "http://localhost",
  );
}
function render(element: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}
function preview(phase: DisplayPreviewPhase) {
  const state = view(phase);
  return render(
    createElement(DisplayScreen, {
      view: state,
      progress: getGameProgress(state, 0),
      status: createElement(ConnectionBadge, { connected: true }),
    }),
  );
}
afterEach(() => vi.restoreAllMocks());

it.each([1, 2, 3] as const)(
  "出題前の各画面に難易度%iだけを予告し、本文や正解は表示しない",
  (difficulty: Difficulty) => {
    for (const phase of [
      "choicesPreparing",
      "countdown",
      "choicesReading",
    ] satisfies Phase[]) {
      const state = view("choicesReading");
      state.phase = phase;
      state.question!.difficulty = difficulty;
      if (phase !== "choicesReading") state.question!.choices = undefined;
      const html = render(
        createElement(DisplayScreen, {
          view: state,
          progress: getGameProgress(state, 0),
          status: null,
        }),
      );
      expect(html).toContain(`data-difficulty="${difficulty}"`);
      expect(html).toContain(`難易度 ${difficulty}`);
      expect(html).toContain("★".repeat(difficulty));
      expect(html.match(/class="question-difficulty"/g)).toHaveLength(1);
      expect(html).not.toContain("QUESTION BODY");
      expect(html).not.toContain("ANSWER EXPLANATION");
      expect(html.includes("Alpha")).toBe(phase === "choicesReading");
      expect(html).not.toMatch(/class="choice [^"]*correct/);
    }
  },
);

it.each<DisplayPreviewPhase>([
  "choicesReading",
  "acceptingAnswers",
  "answerRevealed",
])("%s のプレビューと本番Displayは同じマークアップになる", (phase) => {
  vi.spyOn(performance, "now").mockReturnValue(1000);
  const room: RoomConnection = {
    view: view(phase),
    connected: true,
    error: "",
    busy: false,
    pending: null,
    answer: vi.fn(),
    command: vi.fn(),
    receivedAt: { current: 1000 },
  };
  expect(render(createElement(Display, { room }))).toBe(preview(phase));
});

it("出題中は問題と全選択肢・固定タイマーを表示し、正解を強調しない", () => {
  const html = preview("acceptingAnswers");
  expect(html).toContain("QUESTION BODY");
  for (const choice of Object.values(question.choices))
    expect(html).toContain(choice.title);
  expect(html).toContain("回答受付中");
  expect(html).toContain('data-difficulty="2"');
  expect(html).toContain("残り 30 秒");
  expect(html).toContain("QUESTION 02 / 3");
  expect(html).not.toContain("ANSWER EXPLANATION");
  expect(html).not.toMatch(/class="choice [^"]*correct/);
});

it.each(["期限到達直後", "サーバーの締切確定後"])(
  "%sも問題文と選択肢を画面内に表示し、正解と解説は公開しない",
  (timing) => {
    const state = view("acceptingAnswers");
    if (timing === "サーバーの締切確定後") {
      state.phase = "answersClosed";
      state.phaseEndsAt = null;
    }
    const html = render(
      createElement(DisplayScreen, {
        view: state,
        progress: getGameProgress(state, 30000),
        status: null,
      }),
    );
    expect(html).toContain("回答を締め切りました");
    expect(html).toContain("QUESTION BODY");
    expect(html).toContain('data-difficulty="2"');
    expect(html).toContain("display-page-question");
    expect(html).toContain("fitted-question");
    for (const choice of Object.values(question.choices))
      expect(html).toContain(choice.title);
    expect(html).not.toContain("ANSWER EXPLANATION");
    expect(html).not.toContain("みんなの回答");
    expect(html).not.toMatch(/class="choice [^"]*correct/);
    expect(html).not.toContain('role="progressbar"');
  },
);

it("選択肢公開では問題を隠し、正解発表では本文と正解の強調を表示し、解説は表示しない", () => {
  const reading = preview("choicesReading");
  expect(reading).toContain("Alpha");
  expect(reading).toContain("残り 15 秒");
  expect(reading).not.toContain("QUESTION BODY");
  expect(reading).toContain('data-difficulty="2"');
  expect(reading).not.toContain("ANSWER EXPLANATION");
  const revealed = preview("answerRevealed");
  expect(revealed).toContain("QUESTION BODY");
  expect(revealed).toContain('data-difficulty="2"');
  expect(revealed).not.toContain("ANSWER EXPLANATION");
  expect(revealed).not.toContain("display-explanation");
  expect(revealed).toMatch(/class="choice choice-b [^"]*correct/);
  expect(revealed).not.toContain("残り 30 秒");
});

it("正解発表のプレビューにはサンプルの回答分布があり、公開前にはない", () => {
  expect(preview("choicesReading")).not.toContain("みんなの回答");
  expect(preview("acceptingAnswers")).not.toContain("みんなの回答");
  const revealed = preview("answerRevealed");
  expect(revealed).toContain("みんなの回答");
  expect(revealed).toContain("サンプル");
  expect(revealed).toContain('aria-label="B：9人、正解"');
  expect(revealed).toContain("回答 18人 · 未回答 2人");
});

it("正解発表の全4択に、JSONで明示したURLを開くアイコンだけの独立リンクを表示する", () => {
  const state = view("answerRevealed");
  state.question!.choices = {
    ...question.choices,
    A: {
      ...question.choices.A,
      explanationUrl: "https://swiftdigest.koherent.org/custom-article.html",
    },
  };
  const html = render(
    createElement(DisplayScreen, {
      view: state,
      progress: getGameProgress(state, 0),
      status: null,
    }),
  );
  for (const c of ["A", "B", "C", "D"] as const) {
    expect(html).toContain(
      `href="${state.question!.choices![c].explanationUrl}"`,
    );
    expect(html).toContain(
      `aria-label="選択肢 ${c}（${question.choices[c].number}）の解説を Swift Digest で開く（別タブ）"`,
    );
  }
  expect(html.match(/class="choice-explanation-link"/g)).toHaveLength(4);
  expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(
    4,
  );
  expect(html.match(/<div class="choice choice-/g)).toHaveLength(4);
  expect(html).not.toContain('<button class="choice');
  expect(html).toMatch(/class="choice choice-b [^"]*correct/);
  expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(4);
});

it.each([
  "choicesPreparing",
  "countdown",
  "choicesReading",
  "acceptingAnswers",
  "answersClosed",
  "rankingShown",
  "questionVoided",
] satisfies Phase[])("%s では解説リンクを表示しない", (phase) => {
  const state = view("answerRevealed");
  state.phase = phase;
  const html = render(
    createElement(DisplayScreen, {
      view: state,
      progress: getGameProgress(state, 0),
      status: null,
    }),
  );
  expect(html).not.toContain("choice-explanation-link");
});
