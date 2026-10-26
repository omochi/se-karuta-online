// 公開チュートリアルと本番の集計・画面で、バーの補間と正解発表への連続性を確認する。
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router";
import { DisplayScreen } from "../../src/client/DisplayScreen";
import { getGameProgress } from "../../src/client/phase-presentation";
import { validateQuestions } from "../../src/shared/questions";
import { CHOICES, type Choice } from "../../src/shared/types";
import {
  addPlayer,
  advanceTimer,
  applyCommand,
  beginCountdownIfReady,
  currentRound,
  newGame,
  receiveAnswer,
  viewFor,
} from "../../src/worker/game";
import tutorial from "../../data/questions/tutorial.json";
import "../../src/client/style.css";

const root = createRoot(document.getElementById("screen")!);
const output = document.getElementById("results")!;
const button = document.getElementById("run") as HTMLButtonElement;
function makeGame() {
  const game = newGame(
    "live-votes",
    "回答速報の表示確認",
    validateQuestions(tutorial.questions),
    0,
  );
  for (let i = 0; i < 20; i++)
    addPlayer(game, {
      id: `p${i}`,
      name: `参加者${i}`,
      joinedAt: 0,
      sessionHash: "fixture",
    });
  applyCommand(game, { command: "start", revision: game.revision }, 0);
  beginCountdownIfReady(game, new Set(game.players.map((p) => p.id)), 0);
  advanceTimer(game, 5000);
  advanceTimer(game, 25000);
  return game;
}
let game = makeGame();
function draw() {
  const view = viewFor(
    game,
    "display",
    undefined,
    { onlinePlayers: new Set(), readyPlayers: new Set(), displays: [] },
    "fixture",
    26000,
    location.origin,
  );
  flushSync(() =>
    root.render(
      <MemoryRouter>
        <DisplayScreen
          view={view}
          progress={getGameProgress(view)}
          status={null}
        />
      </MemoryRouter>,
    ),
  );
}
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 180));
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
function bounds() {
  return [...document.querySelectorAll(".distribution-track")].map((node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return [x, y, width, height];
  });
}
function assertFits() {
  const chart = document.querySelector<HTMLElement>(".answer-distribution")!;
  assert(
    chart.scrollHeight <= chart.clientHeight &&
      chart.scrollWidth <= chart.clientWidth,
    "集計が枠からはみ出した",
  );
  const question = document.querySelector<HTMLElement>(".fitted-question")!;
  assert(question.dataset.fitOverflow === "false", "問題文が枠に収まらない");
  assert(
    document.documentElement.scrollWidth <= innerWidth &&
      document.documentElement.scrollHeight <= innerHeight,
    "ページ全体がはみ出した",
  );
}
button.onclick = async () => {
  button.disabled = true;
  const results: string[] = [];
  try {
    game = makeGame();
    draw();
    await frame();
    const chart = document.querySelector(".answer-distribution");
    const fills = [
      ...document.querySelectorAll<HTMLElement>(".distribution-fill"),
    ];
    const before = bounds();
    const round = currentRound(game)!;
    const correct = round.question.correctChoice;
    const other = CHOICES.find((choice) => choice !== correct)!;
    let player = 0;
    const answer = (choice: Choice) =>
      receiveAnswer(game, `p${player++}`, round.id, choice, 25100 + player);
    answer(other);
    draw();
    const style = getComputedStyle(fills[CHOICES.indexOf(other)]);
    assert(
      style.transitionProperty === "width" ||
        matchMedia("(prefers-reduced-motion: reduce)").matches,
      "幅の補間が使われていない",
    );
    await settle();
    assert(
      fills[CHOICES.indexOf(other)].style.width === "5%",
      "1票が対象20人の5%にならない",
    );
    results.push("PASS 1票=5%、タイムバーと同じ幅の補間");
    for (let i = 0; i < 7; i++) answer(other);
    for (let i = 0; i < 7; i++) answer(correct);
    draw();
    await settle();
    assertFits();
    assert(
      !document.querySelector(".distribution-correct"),
      "正解が先に表示された",
    );
    assert(
      JSON.stringify(bounds()) === JSON.stringify(before),
      "回答追加でゲージの位置・目盛りが変わった",
    );
    results.push("PASS 回答追加でも位置と目盛りを維持");
    const widths = fills.map((node) => node.getBoundingClientRect().width);
    for (const command of ["close", "reveal"] as const) {
      applyCommand(game, { command, revision: game.revision }, 27000);
      draw();
      await frame();
      assertFits();
      assert(
        document.querySelector(".answer-distribution") === chart,
        "集計欄が作り直された",
      );
      assert(
        fills.every(
          (node, i) =>
            node === document.querySelectorAll(".distribution-fill")[i] &&
            node.getBoundingClientRect().width === widths[i],
        ),
        "バーが作り直されたか長さが変わった",
      );
      assert(
        JSON.stringify(bounds()) === JSON.stringify(before),
        `締切・正解発表でゲージが移動した: ${JSON.stringify(before)} → ${JSON.stringify(bounds())}`,
      );
      results.push(`PASS ${command}: 同じ位置・長さのバーを維持`);
    }
    assert(
      document.querySelector(".distribution-correct .distribution-label")
        ?.textContent === `${correct}正解`,
      "少数側の正解が強調されない",
    );
    results.push("PASS 8票の不正解と7票の正解を維持し、正解だけ強調");
  } catch (error) {
    results.push(`FAIL ${(error as Error).message}`);
  } finally {
    output.textContent = results.join("\n");
    button.disabled = false;
  }
};
const params = new URLSearchParams(location.search);
const snapshot = params.get("snapshot");
if (params.has("embedded")) {
  if (snapshot === "acceptingAnswers" || snapshot === "answerRevealed") {
    const round = currentRound(game)!;
    const correct = round.question.correctChoice;
    const other = CHOICES.find((choice) => choice !== correct)!;
    for (let i = 0; i < 15; i++)
      receiveAnswer(
        game,
        `p${i}`,
        round.id,
        i < 8 ? other : correct,
        25100 + i,
      );
    if (snapshot === "answerRevealed") {
      for (const command of ["close", "reveal"] as const)
        applyCommand(game, { command, revision: game.revision }, 27000);
    }
    output.parentElement!.hidden = true;
  }
  draw();
} else {
  // 親ブラウザーのパネル幅に依存せず、実際のメディアクエリーと組版を確認する。
  const width = Number(params.get("width")) || 1280;
  const height = Number(params.get("height")) || 720;
  const scale =
    params.get("scale") === "1" ? 1 : Math.min(1, innerWidth / width);
  const childParams = new URLSearchParams({ embedded: "1" });
  if (snapshot) childParams.set("snapshot", snapshot);
  output.parentElement!.hidden = true;
  document.getElementById("screen")!.style.cssText =
    `width:${width * scale}px;height:${height * scale}px`;
  root.render(
    <iframe
      title="Displayの回答速報"
      src={`?${childParams}`}
      style={{
        width,
        height,
        border: 0,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
    />,
  );
}
