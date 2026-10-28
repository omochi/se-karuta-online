// 開発サーバー専用。公開チュートリアルと本番の集計・画面で表彰を確認する。
// ?screen=display|player|control|report|result で切り替える。大会・WebSocketには接続しない。
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Control, Display, Player } from "../../src/client/App";
import TournamentReport from "../../src/client/TournamentReport";
import { PersonalResultContent } from "../../src/client/PersonalResult";
import { personalResult } from "../../src/worker/personal-result";
import type { RoomConnection } from "../../src/client/useRoom";
import { validateQuestions } from "../../src/shared/questions";
import { CHOICES, type Game, type Role } from "../../src/shared/types";
import { DEFAULT_TIMING } from "../../src/shared/timing";
import { viewFor } from "../../src/worker/game";
import { tournamentReport } from "../../src/worker/report";
import tutorial from "../../data/questions/tutorial.json";
import "../../src/client/style.css";

const [question] = validateQuestions(tutorial.questions);
// LANのHTTPではcrypto.randomUUIDを使えない。表示用データは固定IDで作る。
const game: Game = {
  id: "awards-preview",
  name: "【ダミー】Swift Evolution カルタ大会",
  joinCode: "ABCDEF",
  createdAt: 0,
  revision: 0,
  phase: "finished",
  currentIndex: 5,
  phaseEndsAt: null,
  timing: { ...DEFAULT_TIMING },
  players: [],
  readyExemptPlayerIds: [],
  rounds: Array.from({ length: 6 }, (_, i) => ({
    id: `preview-round-${i}`,
    question: { ...question, id: `preview-${i}` },
    participants: {},
    answers: {},
    readingStartedAt: null,
    countdownStartedAt: null,
    openedAt: null,
    closedAt: null,
    isVoided: false,
    voidReason: null,
  })),
};
game.players = ["あおい", "はる", "ゆう", "さくら", "りん", "みなと"].map(
  (name, i) => ({ id: `p${i}`, name, joinedAt: 0 }),
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
const previewParams = new URLSearchParams(location.search);
if (previewParams.has("late")) {
  // 最後の1問だけ参加した場合も、有効6問を分母にする表示確認。
  for (const round of game.rounds.slice(0, -1)) {
    delete round.participants.p0;
    delete round.answers.p0;
  }
}
if (previewParams.has("long")) {
  game.name = "長い大会名の折り返しを確認するための大会です。"
    .repeat(4)
    .slice(0, 80);
  game.players[0].name = "長い名前の参加者表示の検証用ダミーです".slice(0, 20);
}
const result = personalResult(game, previewParams.get("player") ?? "p0");
if (previewParams.has("allTitles"))
  result.player.titles = [
    { key: "correct", title: "正答王", rank: 1 },
    { key: "fastest", title: "早押し王", rank: 1 },
    { key: "difficult", title: "難問王", rank: 1 },
    { key: "friendship", title: "友情王", rank: 1 },
  ];
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
      screen === "result" ? (
        <PersonalResultContent data={{ result, owner: true, shareUrl: null }} />
      ) : screen === "report" ? (
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
