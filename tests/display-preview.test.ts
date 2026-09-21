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

const question = {
  id: "preview-question",
  bodyMarkdown: "QUESTION BODY\n\n```swift\nlet value = 42\n```",
  choices: { A: "Alpha", B: "Beta", C: "Gamma", D: "Delta" },
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
    expect(html).toContain(choice);
  expect(html).toContain("回答受付中");
  expect(html).toContain("残り 30 秒");
  expect(html).toContain("QUESTION 02 / 3");
  expect(html).not.toContain("ANSWER EXPLANATION");
  expect(html).not.toMatch(/class="choice [^"]*correct/);
});

it("選択肢公開では問題を隠し、正解発表では本文・正解の強調・解説を表示する", () => {
  const reading = preview("choicesReading");
  expect(reading).toContain("Alpha");
  expect(reading).toContain("残り 15 秒");
  expect(reading).not.toContain("QUESTION BODY");
  expect(reading).not.toContain("ANSWER EXPLANATION");
  const revealed = preview("answerRevealed");
  expect(revealed).toContain("QUESTION BODY");
  expect(revealed).toContain("ANSWER EXPLANATION");
  expect(revealed).toMatch(/class="choice choice-b [^"]*correct/);
  expect(revealed).not.toContain("残り 30 秒");
});
