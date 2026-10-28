// 開発サーバー専用。本番Displayのレイアウトを変えず、同率3位の人数だけを増やす。
// 大会やWebSocketには接続しない。
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { DisplayScreen } from "../../src/client/DisplayScreen";
import { getGameProgress } from "../../src/client/phase-presentation";
import type { RankRow, RoomView } from "../../src/shared/types";
import { DEFAULT_TIMING } from "../../src/shared/timing";
import { eventUrls } from "../../src/shared/urls";
import { BOT_NAMES } from "../../src/worker/bot-names";
import "../../src/client/style.css";

const counts = [3, 4, 5, 6, 8, 15, 50, 100];
function Preview() {
  const requested = Number(
    new URLSearchParams(location.search).get("people") ?? 4,
  );
  const [count, setCount] = useState(
    counts.includes(requested) ? requested : 4,
  );
  const rows: RankRow[] = Array.from({ length: count }, (_, i) => ({
    playerId: `p${i}`,
    name: BOT_NAMES[i],
    rank: Math.min(i + 1, 3),
    value: i === 0 ? 7 : i === 1 ? 5 : 3,
  }));
  const points = rows.map((row) => ({ ...row, value: row.value / 2 }));
  const view: RoomView = {
    type: "state",
    id: "awards-ties-preview",
    name: "【表示確認】同率3位を全員表示",
    joinCode: "ABCDEF",
    urls: eventUrls(location.origin, "awards-ties-preview"),
    phase: "finished",
    revision: 0,
    epoch: "fixture",
    serverNow: 0,
    phaseEndsAt: null,
    phaseDurationMs: 0,
    timing: { ...DEFAULT_TIMING },
    questionNumber: 8,
    totalQuestions: 8,
    playerCount: count,
    eligibleCount: count,
    readyCount: count,
    readyWaitCount: count,
    answerCount: count,
    question: null,
    results: {
      correct: rows,
      fastest: points,
      difficult: points,
      friendship: points,
      validQuestions: 8,
    },
  };
  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 8,
          right: 12,
          zIndex: 100,
          background: "#fffefa",
          color: "#202b33",
          padding: "8px 12px",
          borderRadius: 8,
          boxShadow: "0 1px 8px #0003",
        }}
      >
        <label style={{ flexDirection: "row", alignItems: "center" }}>
          各賞の表示人数
          <select
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {counts.map((n) => (
              <option key={n} value={n}>
                {n}人{n > 3 ? `（同率3位 ${n - 2}人）` : "（同率なし）"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <DisplayScreen
        view={view}
        progress={getGameProgress(view)}
        status={
          <span className="display-event">
            各賞{count}人 · 同率3位{Math.max(1, count - 2)}人
          </span>
        }
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <Preview />
  </MemoryRouter>,
);
