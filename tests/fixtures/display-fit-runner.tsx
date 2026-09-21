// Vite開発サーバー上だけで開く、実ブラウザーの組版・初回描画の検証用ページ。
// テスト用の問題を使い、本番の問題集・大会・WebSocketには接続しない。
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router";
import { DisplayScreen } from "../../src/client/DisplayScreen";
import { createDisplayPreviewView } from "../../src/client/display-preview";
import { getGameProgress } from "../../src/client/phase-presentation";
import "../../src/client/style.css";

const root = createRoot(document.getElementById("screen")!);
const output = document.getElementById("results")!;
const button = document.getElementById("run") as HTMLButtonElement;
let measurements = 0;
const reportFit = () => measurements++;
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
function draw(
  bodyMarkdown: string,
  elapsed = 0,
  id = "fixture",
  phase: "acceptingAnswers" | "answerRevealed" = "acceptingAnswers",
) {
  const view = createDisplayPreviewView(
    {
      name: "表示テスト",
      questionNumber: 1,
      totalQuestions: 1,
      phase,
      question: {
        id,
        difficulty: 2 as const,
        bodyMarkdown,
        choices: {
          A: "Proposal A",
          B: "Proposal B",
          C: "Proposal C",
          D: "Proposal D",
        },
        correctChoice: "A",
        explanationMarkdown: "Test explanation",
      },
    },
    location.origin,
  );
  flushSync(() =>
    root.render(
      <MemoryRouter>
        <DisplayScreen
          view={view}
          progress={getGameProgress(view, elapsed)}
          status={null}
          onQuestionFit={reportFit}
        />
      </MemoryRouter>,
    ),
  );
}
function readFrame() {
  const box = document.querySelector<HTMLElement>(".fitted-question")!;
  const content = document.querySelector<HTMLElement>(".question-fit-content")!;
  assert(
    box.dataset.fitReady === "true",
    "未計測の本文が描画フレームに到達した",
  );
  assert(
    getComputedStyle(content).visibility === "visible",
    "本文が非表示のまま",
  );
  assert(content.scrollHeight <= box.clientHeight, "本文が縦にはみ出した");
  assert(content.scrollWidth <= box.clientWidth, "本文が横にはみ出した");
  assert(
    document.documentElement.scrollHeight <= innerHeight,
    "画面全体が縦にはみ出した",
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    "画面全体が横にはみ出した",
  );
  return Number.parseFloat(getComputedStyle(content).fontSize);
}

button.onclick = async () => {
  button.disabled = true;
  const results: string[] = [];
  let sampledFrames = 0;
  try {
    const cases = [
      ["短い問題", "短い問題です。\n\n```swift\nlet value = 42\n```"],
      [
        "日本語の折り返しと長いコード",
        "日本語の折り返しも含めて全文を表示します。".repeat(6) +
          "\n\n```swift\n" +
          Array.from({ length: 35 }, (_, i) => `let value${i} = ${i}`).join(
            "\n",
          ) +
          "\n```",
      ],
      [
        "長い一行",
        '長い行を折り返さずに表示します。\n\n```swift\nlet value = "' +
          "x".repeat(170) +
          '"\n```',
      ],
      ["再び短い問題", "短い問題に戻します。\n\n```swift\nprint(42)\n```"],
    ];
    for (const [label, text] of cases) {
      // 同じ問題IDの編集でも、新サイズの確定は最初の描画フレームより前に完了する。
      draw(text);
      let size: number | null = null;
      for (let i = 0; i < 3; i++) {
        await frame();
        const current = readFrame();
        if (size !== null)
          assert(current === size, "計測途中のサイズが描画された");
        size = current;
        sampledFrames++;
      }
      results.push(`PASS ${label}: ${size}px`);
    }
    const text = cases.at(-1)![1];
    const previousMeasurements = measurements;
    for (const elapsed of [100, 1100, 2100, 5100]) {
      draw(text, elapsed);
      await frame();
      readFrame();
      sampledFrames++;
    }
    assert(measurements === previousMeasurements, "タイマーの更新で再計測した");
    results.push("PASS タイマー更新では再計測しない");
    draw(cases[1][1], 0, "another-question");
    await frame();
    readFrame();
    sampledFrames++;
    results.push("PASS 問題切替の最初のフレームで収まる");
    draw(
      "どの Proposal がこの機能を導入したでしょう？\n\n```swift\nlet value = 42\n```",
      0,
      "distribution",
      "answerRevealed",
    );
    await frame();
    readFrame();
    const chart = document.querySelector<HTMLElement>(".answer-distribution")!;
    assert(
      chart.scrollHeight <= chart.clientHeight,
      "回答分布が縦にはみ出した",
    );
    assert(chart.scrollWidth <= chart.clientWidth, "回答分布が横にはみ出した");
    assert(
      chart.textContent!.includes("未回答 2人"),
      "未回答人数が表示されない",
    );
    results.push("PASS 正解発表の本文・回答分布・選択肢・解説が収まる");
    sampledFrames++;
    output.dataset.status = "passed";
    results.push(`${innerWidth} × ${innerHeight}, ${sampledFrames} frames`);
  } catch (error) {
    output.dataset.status = "failed";
    results.push(`FAIL ${(error as Error).message}`);
  } finally {
    output.textContent = results.join("\n");
    button.disabled = false;
  }
};
