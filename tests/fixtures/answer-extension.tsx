// 公開チュートリアルと本番のゲーム処理・画面を使い、選択肢が動かないことを確認する。
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { Control, Display, Player } from "../../src/client/App";
import { validateQuestions } from "../../src/shared/questions";
import type { Game, Role } from "../../src/shared/types";
import type { RoomConnection } from "../../src/client/useRoom";
import {
  addPlayer,
  advanceTimer,
  applyCommand,
  beginCountdownIfReady,
  newGame,
  receiveAnswer,
  viewFor,
} from "../../src/worker/game";
import tutorial from "../../data/questions/tutorial.json";
import "../../src/client/style.css";

const params = new URLSearchParams(location.search);
const mode = (params.get("mode") ?? "player") as Role;
const embedded = params.has("embedded");
const screens = { control: Control, display: Display, player: Player };

function makeGame() {
  const now = Date.now();
  const game = newGame(
    "extension-preview",
    "回答時間の延長確認",
    validateQuestions(tutorial.questions),
    now,
  );
  addPlayer(game, {
    id: "p",
    name: "サンプル参加者",
    joinedAt: now,
    sessionHash: "fixture",
  });
  // 回答開始を25秒前に置き、残り5秒から延長を確認する。
  applyCommand(
    game,
    { command: "start", revision: game.revision },
    now - 50000,
  );
  beginCountdownIfReady(game, new Set(["p"]), now - 50000);
  advanceTimer(game, now - 45000);
  advanceTimer(game, now - 25000);
  return game;
}

function Fixture() {
  const [game, setGame] = useState(makeGame);
  const [error, setError] = useState("");
  const [result, setResult] = useState("未検証");
  const choiceBounds = () =>
    Array.from(document.querySelectorAll(".choices .choice"), (choice) => {
      const { x, y, width, height } = choice.getBoundingClientRect();
      return [x, y, width, height];
    });
  function checkExtension() {
    const before = choiceBounds();
    room.command("extendAnswers");
    requestAnimationFrame(() => {
      const notice = document.querySelector(".countdown-label")?.textContent;
      const unchanged =
        JSON.stringify(before) === JSON.stringify(choiceBounds());
      setResult(
        before.length === 4 && unchanged && notice === "15秒延長！"
          ? "PASS: 選択肢の位置を維持"
          : "FAIL: 延長と表示位置を確認してください",
      );
    });
  }
  function update(work: (next: Game) => void) {
    try {
      const next = structuredClone(game);
      work(next);
      setGame(next);
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const room: RoomConnection = {
    view: viewFor(
      game,
      mode,
      "p",
      {
        onlinePlayers: new Set(["p"]),
        readyPlayers: new Set(["p"]),
        displays: [],
      },
      "fixture",
      Date.now(),
      location.origin,
    ),
    serverNow: Date.now,
    connected: true,
    busy: false,
    pending: null,
    error,
    command: (command, extra) =>
      update((next) =>
        applyCommand(
          next,
          { command, revision: next.revision, ...extra },
          Date.now(),
        ),
      ),
    answer: (choice) =>
      update((next) => {
        receiveAnswer(next, "p", next.rounds[0].id, choice, Date.now());
      }),
  };
  const Screen = screens[mode];
  return (
    <MemoryRouter>
      <div style={{ padding: 8, background: "#fff" }}>
        <button
          onClick={() => {
            setGame(makeGame());
            setError("");
            setResult("未検証");
          }}
        >
          残り5秒から確認
        </button>{" "}
        <button onClick={checkExtension}>延長を試す</button>
        <output style={{ display: "block", height: 24 }}>{result}</output>
        {error && <p role="alert">{error}</p>}
      </div>
      <Screen room={room} />
    </MemoryRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  mode === "player" && !embedded ? (
    <iframe
      title="スマホの延長表示"
      src="?mode=player&embedded=1"
      style={{ width: 390, height: 844, border: "1px solid #888" }}
    />
  ) : (
    <Fixture />
  ),
);
