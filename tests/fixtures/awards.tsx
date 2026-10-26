// 開発サーバー専用。公開チュートリアルと本番の集計・画面で表彰を確認する。
// ?screen=display|player|control|report で切り替える。大会・WebSocketには接続しない。
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Control, Display, Player } from "../../src/client/App";
import TournamentReport from "../../src/client/TournamentReport";
import type { RoomConnection } from "../../src/client/useRoom";
import { validateQuestions } from "../../src/shared/questions";
import { CHOICES, type Role } from "../../src/shared/types";
import { newGame, viewFor } from "../../src/worker/game";
import { tournamentReport } from "../../src/worker/report";
import tutorial from "../../data/questions/tutorial.json";
import "../../src/client/style.css";

const [question] = validateQuestions(tutorial.questions);
const game = newGame(
  "awards-preview",
  "【ダミー】Swift Evolution カルタ大会",
  Array.from({ length: 6 }, (_, i) => ({ ...question, id: `preview-${i}` })),
  0,
);
game.phase = "finished";
game.currentIndex = 5;
game.players = ["あおい", "はる", "ゆう", "さくら", "りん", "みなと"].map(
  (name, i) => ({ id: `p${i}`, name, joinedAt: 0, sessionHash: "fixture" }),
);
const correctPlayers = [
  [0, 1, 2],
  [0, 1],
  [0, 1, 2, 3],
  [0, 2],
  [0, 1, 2, 3, 4],
  [0, 1, 2],
];
const firstPlayers = [2, 1, 0, 2, 0, 1];
const wrong = CHOICES.find((choice) => choice !== question.correctChoice)!;
for (const [i, round] of game.rounds.entries()) {
  round.openedAt = 1000 + i * 60000;
  round.closedAt = round.openedAt + 30000;
  for (const [p, player] of game.players.entries()) {
    round.participants[player.id] = "eligible";
    round.answers[player.id] = {
      choice: correctPlayers[i].includes(p) ? question.correctChoice : wrong,
      receivedAt:
        round.openedAt + (p === firstPlayers[i] ? 800 : 1500 + p * 600),
    };
  }
}
const screen = new URLSearchParams(location.search).get("screen") ?? "display";
const role: Role =
  screen === "player" ? "player" : screen === "control" ? "control" : "display";
const view = viewFor(
  game,
  role,
  role === "player" ? "p1" : undefined,
  {
    onlinePlayers: new Set(game.players.map((p) => p.id)),
    readyPlayers: new Set(),
    displays: [],
  },
  "fixture",
  400000,
  location.origin,
);
const room: RoomConnection = {
  view,
  connected: true,
  error: "",
  busy: false,
  pending: null,
  answer: () => {},
  command: () => {},
  serverNow: () => 400000,
};
const report = tournamentReport(game);
const router = createMemoryRouter([
  {
    path: "/",
    loader: () => ({
      id: game.id,
      report,
      loginRequired: false,
      unavailable: false,
    }),
    element:
      screen === "report" ? (
        <TournamentReport />
      ) : screen === "player" ? (
        <Player room={room} />
      ) : screen === "control" ? (
        <Control room={room} />
      ) : (
        <Display room={room} />
      ),
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
