// 開発サーバー専用。公開チュートリアルを使い、出題前の配信データと表示を確認する。
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { DisplayScreen } from "../../src/client/DisplayScreen";
import { getGameProgress } from "../../src/client/phase-presentation";
import { validateQuestions } from "../../src/shared/questions";
import {
  addPlayer,
  advanceTimer,
  applyCommand,
  beginCountdownIfReady,
  newGame,
  viewFor,
} from "../../src/worker/game";
import tutorial from "../../data/questions/tutorial.json";
import "../../src/client/style.css";

const params = new URLSearchParams(location.search);
const question = validateQuestions(tutorial.questions)[0];
const difficulty = Number(params.get("difficulty"));
if (difficulty === 1 || difficulty === 2 || difficulty === 3)
  question.difficulty = difficulty;
const game = newGame("difficulty-preview", "出題前の難易度表示", [question], 0);
addPlayer(game, {
  id: "dummy-player",
  name: "練習用の参加者",
  joinedAt: 0,
  sessionHash: "dummy",
});
applyCommand(game, { command: "start", revision: game.revision }, 0);
const phase = params.get("phase");
if (phase !== "choicesPreparing")
  beginCountdownIfReady(game, new Set(["dummy-player"]), 0);
if (phase === "choicesReading") advanceTimer(game, 5000);
if (phase === "acceptingAnswers") {
  advanceTimer(game, 5000);
  advanceTimer(game, 20000);
}
const view = viewFor(
  game,
  "display",
  undefined,
  { onlinePlayers: new Set(), readyPlayers: new Set(), displays: [] },
  "preview",
  phase === "choicesReading" ? 5000 : phase === "acceptingAnswers" ? 20000 : 0,
  location.origin,
);
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <DisplayScreen
      view={view}
      progress={getGameProgress(view)}
      status={<span className="display-event">チュートリアル表示</span>}
    />
  </MemoryRouter>,
);
