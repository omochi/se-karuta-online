// 開発サーバー専用。大会やWebSocketには接続せず、本番の参加者ペインを操作する。
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ParticipantPanel } from "../../src/client/ParticipantPanel";
import { BOT_NAMES } from "../../src/worker/bot-names";
import type { RoomView } from "../../src/shared/types";
import "../../src/client/style.css";

const initial: NonNullable<RoomView["players"]> = Array.from(
  { length: 51 },
  (_, i) => ({
    id: `p${String(i + 1).padStart(3, "0")}`,
    name: `${String(i + 1).padStart(2, "0")} ${BOT_NAMES[i]}`,
    online: true,
    ready: i % 3 === 0,
    participation: "eligible",
    answered: false,
    waitForReady: true,
  }),
);
function Preview() {
  const [players, setPlayers] = useState(initial);
  const [last, setLast] = useState("");
  return (
    <main style={{ maxWidth: 420, margin: "32px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 20 }}>参加者ペインの表示確認</h1>
      <div className="links" style={{ marginBottom: 16 }}>
        <button
          className="secondary"
          onClick={() =>
            setPlayers((current) =>
              current.map((p) => ({ ...p, answered: true })),
            )
          }
        >
          回答状況を更新
        </button>
        <button
          className="secondary"
          onClick={() => setPlayers(initial.slice(0, 10))}
        >
          10人に変更
        </button>
        <button
          className="secondary"
          onClick={() =>
            setPlayers((current) => [
              ...current,
              ...initial.slice(current.length),
            ])
          }
        >
          51人に変更
        </button>
      </div>
      <ParticipantPanel
        players={players}
        finished={false}
        disabled={false}
        onReadyWait={(id, waitForReady) => {
          setLast(`${id}: ${waitForReady ? "待つ" : "待たない"}`);
          setPlayers((current) =>
            current.map((p) => (p.id === id ? { ...p, waitForReady } : p)),
          );
        }}
      />
      <p role="status">{last}</p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
