// 開発サーバー専用。公開チュートリアルで補充と時計補正を実描画する。
// 同期応答・状態通知の時刻だけを模擬し、本番の時計と描画処理を使う。
import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { MemoryRouter } from "react-router";
import { Control, Player } from "../../src/client/App";
import { DisplayScreen } from "../../src/client/DisplayScreen";
import { ServerClock } from "../../src/client/ServerClock";
import { createDisplayPreviewView } from "../../src/client/display-preview";
import { useGameProgress } from "../../src/client/useGameProgress";
import type { RoomConnection } from "../../src/client/useRoom";
import { validateQuestions } from "../../src/shared/questions";
import tutorial from "../../data/questions/tutorial.json";
import "../../src/client/style.css";

const mode = new URLSearchParams(location.search).get("mode") ?? "display";

const initial = createDisplayPreviewView(
  {
    name: "時計補正の表示確認",
    question: validateQuestions(tutorial.questions)[0],
    phase: "choicesReading",
    questionNumber: 1,
    totalQuestions: 1,
  },
  location.origin,
);
initial.phaseEndsAt = 0;

function Screen() {
  const [clock] = useState(() => {
    const clock = new ServerClock();
    clock.initialize(0);
    return clock;
  });
  const [view, setView] = useState(initial);
  const [result, setResult] = useState("未実行");
  const running = useRef(false);
  const room: RoomConnection = {
    view,
    serverNow: clock.now,
    connected: true,
    error: "",
    busy: false,
    pending: null,
    answer: () => {},
    command: () => {},
  };

  function run() {
    if (running.current) return;
    running.current = true;
    const start = performance.now();
    const beforeFill = document.querySelector<HTMLElement>(
      ".countdown-bar-fill",
    )!;
    const beforeFraction =
      beforeFill.getBoundingClientRect().width /
      beforeFill.parentElement!.getBoundingClientRect().width;
    const serverStart = clock.now();
    const next = {
      ...createDisplayPreviewView(
        {
          name: "時計補正の表示確認",
          question: validateQuestions(tutorial.questions)[0],
          phase: "acceptingAnswers",
          questionNumber: 1,
          totalQuestions: 1,
        },
        location.origin,
      ),
      serverNow: serverStart,
      phaseEndsAt: serverStart + 30000,
      playerCount: 4,
      eligibleCount: 4,
    };
    setView(next);
    setResult("測定中");
    const localOffset = serverStart - start;
    [180, 390, 600, 810].forEach((delay, i) =>
      setTimeout(() => {
        const received = performance.now();
        const roundTrip = 100 - i * 20;
        const serverSample =
          received - roundTrip / 2 + localOffset + (i % 2 ? -600 : 600);
        clock.synchronize(
          received - roundTrip,
          received,
          serverSample,
          serverSample,
        );
        // state の serverNow は描画時計を同期し直すために使わない。
        setView({ ...next, serverNow: serverSample, answerCount: i });
      }, delay),
    );
    const frames: Array<{
      at: number;
      fraction: number;
      right: number;
      target: number;
      serverNow: number;
      trackWidth: number;
    }> = [];
    function sample() {
      const fill = document.querySelector<HTMLElement>(".countdown-bar-fill")!;
      const bounds = fill.getBoundingClientRect();
      const trackWidth = fill.parentElement!.getBoundingClientRect().width;
      frames.push({
        at: performance.now() - start,
        fraction: bounds.width / trackWidth,
        right: bounds.right,
        target: fill.style.width
          ? Number.parseFloat(fill.style.width) / 100
          : Number(fill.style.transform.match(/scaleX\((.*)\)/)?.[1]),
        serverNow: clock.now(),
        trackWidth,
      });
      if (performance.now() - start < 2000) requestAnimationFrame(sample);
      else {
        let decreasing = false;
        let reversals = 0;
        let targetReversals = 0;
        let clockReversals = 0;
        for (let i = 1; i < frames.length; i++) {
          const change = frames[i].right - frames[i - 1].right;
          if (change < -0.001) decreasing = true;
          if (decreasing && change > 0.001) reversals++;
          if (frames[i].at > 150 && frames[i].target > frames[i - 1].target)
            targetReversals++;
          if (frames[i].serverNow < frames[i - 1].serverNow) clockReversals++;
        }
        const refill =
          beforeFraction < 0.1 &&
          frames.some((f) => f.fraction > 0 && f.fraction < 0.95) &&
          frames.some((f) => f.fraction > 0.95);
        setResult(
          `${refill && decreasing && reversals === 0 && targetReversals === 0 && clockReversals === 0 ? "PASS" : "FAIL"}: ` +
            `画面 ${mode} / ` +
            `補充アニメーション ${refill ? "あり" : "なし"} / ` +
            `補充の最小幅 ${(Math.min(...frames.map((f) => f.fraction)) * 100).toFixed(1)}% / ` +
            `補充後の右戻り ${reversals} フレーム / ` +
            `目標値の戻り ${targetReversals} / 時計の逆行 ${clockReversals} / ` +
            `バー枠の幅 ${[...new Set(frames.map((f) => f.trackWidth))].join(",")}px / ` +
            `同期のずれ ±600ms / 計測 ${frames.length} フレーム`,
        );
        running.current = false;
      }
    }
    requestAnimationFrame(sample);
  }

  return (
    <>
      {mode === "control" ? (
        <Control room={room} />
      ) : mode === "player" ? (
        <Player room={room} />
      ) : (
        <DisplayPreview room={room} />
      )}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          background: "white",
          zIndex: 10,
        }}
      >
        <button onClick={run} disabled={result !== "未実行"}>
          補充と時刻補正を検証
        </button>
        <p id="result" role="status">
          {result}
        </p>
      </div>
    </>
  );
}

function DisplayPreview({ room }: { room: RoomConnection }) {
  const progress = useGameProgress(room);
  return (
    <DisplayScreen view={room.view!} progress={progress} status="表示検証" />
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <Screen />
  </MemoryRouter>,
);
