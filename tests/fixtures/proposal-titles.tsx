// 開発専用。大会には接続せず、本番の配信・画面コンポーネントで全問題を確認する。
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Control, Player } from "../../src/client/App";
import { DisplayScreen } from "../../src/client/DisplayScreen";
import { getGameProgress } from "../../src/client/phase-presentation";
import type { RoomConnection } from "../../src/client/useRoom";
import { validateQuestions } from "../../src/shared/questions";
import {
  CHOICES,
  type Choice,
  type Phase,
  type Role,
} from "../../src/shared/types";
import { newGame, viewFor } from "../../src/worker/game";
import volume from "../../data/questions/vol-01.json";
import "../../src/client/style.css";

const params = new URLSearchParams(location.search);
const mode = (params.get("mode") ?? "display") as Role;
const phase = (params.get("phase") ?? "acceptingAnswers") as Phase;
const index = Math.max(0, Math.min(11, Number(params.get("q") ?? 1) - 1));
const width = Number(params.get("width")) || (mode === "player" ? 390 : 1280);
const height = Number(params.get("height")) || (mode === "player" ? 844 : 720);

function Screen() {
  const initialAnswer = CHOICES.find(
    (choice) => choice === params.get("answer"),
  );
  const answerState = params.get("answerState") ?? "accepted";
  const [selected, setSelected] = useState<Choice | undefined>(
    answerState === "accepted" ? initialAnswer : undefined,
  );
  const [pending, setPending] = useState<Choice | undefined>(
    answerState === "pending" ? initialAnswer : undefined,
  );
  const [game] = useState(() =>
    newGame(
      "title-preview",
      volume.name,
      validateQuestions(volume.questions),
      0,
    ),
  );
  game.currentIndex = index;
  game.phase = phase;
  game.players = [
    {
      id: "preview-player",
      name: "プレビュー参加者",
      joinedAt: 0,
      sessionHash: "fixture",
    },
  ];
  const round = game.rounds[index];
  round.participants = { "preview-player": "eligible" };
  round.openedAt = 20000;
  round.readingStartedAt = 5000;
  game.phaseEndsAt =
    phase === "choicesReading"
      ? 20000
      : phase === "acceptingAnswers"
        ? 50000
        : null;
  if (selected)
    round.answers["preview-player"] = { choice: selected, receivedAt: 21000 };
  const view = viewFor(
    game,
    mode,
    "preview-player",
    {
      onlinePlayers: new Set(["preview-player"]),
      readyPlayers: new Set(),
      displays: [],
    },
    "preview",
    phase === "choicesReading" ? 5000 : 20000,
    location.origin,
  );
  const room: RoomConnection = {
    view,
    connected: answerState !== "offline",
    error:
      answerState === "error"
        ? "回答を送信できませんでした。接続を確認してもう一度お試しください。"
        : "",
    busy: false,
    pending: pending
      ? {
          type: "answer",
          requestId: "preview-answer",
          roundId: round.id,
          choice: pending,
        }
      : null,
    answer: (choice) => {
      setPending(choice);
      // 送信中と受付済みの両方の表示を実操作で確認できるようにする。
      setTimeout(() => {
        setSelected(choice);
        setPending(undefined);
      }, 300);
    },
    command: () => {},
    serverNow: () => view.serverNow,
  };
  return mode === "player" ? (
    <Player room={room} />
  ) : mode === "control" ? (
    <Control room={room} />
  ) : (
    <DisplayScreen
      view={view}
      progress={getGameProgress(view)}
      status="表示確認"
    />
  );
}

const RESOLUTION_PRESETS = [
  { label: "HD · 1280 × 720", width: 1280, height: 720, group: "PC・Display" },
  {
    label: "ノートPC · 1366 × 768",
    width: 1366,
    height: 768,
    group: "PC・Display",
  },
  {
    label: "Full HD · 1920 × 1080",
    width: 1920,
    height: 1080,
    group: "PC・Display",
  },
  {
    label: "WQHD · 2560 × 1440",
    width: 2560,
    height: 1440,
    group: "PC・Display",
  },
  {
    label: "4K · 3840 × 2160",
    width: 3840,
    height: 2160,
    group: "PC・Display",
  },
  {
    label: "スマホ小 · 375 × 667",
    width: 375,
    height: 667,
    group: "スマホ・タブレット",
  },
  {
    label: "スマホ · 360 × 780",
    width: 360,
    height: 780,
    group: "スマホ・タブレット",
  },
  {
    label: "スマホ標準 · 390 × 844",
    width: 390,
    height: 844,
    group: "スマホ・タブレット",
  },
  {
    label: "スマホ大 · 430 × 932",
    width: 430,
    height: 932,
    group: "スマホ・タブレット",
  },
  {
    label: "タブレット縦 · 768 × 1024",
    width: 768,
    height: 1024,
    group: "スマホ・タブレット",
  },
  {
    label: "タブレット横 · 1024 × 768",
    width: 1024,
    height: 768,
    group: "スマホ・タブレット",
  },
];

function Preview() {
  const [preview, setPreview] = useState({
    mode,
    phase,
    q: index + 1,
    width,
    height,
  });
  const resolution = `${preview.width}x${preview.height}`;
  useEffect(() => {
    const query = new URLSearchParams({
      mode: preview.mode,
      phase: preview.phase,
      q: String(preview.q),
      width: String(preview.width),
      height: String(preview.height),
      ...(params.get("answer") && { answer: params.get("answer")! }),
      ...(params.get("answerState") && {
        answerState: params.get("answerState")!,
      }),
    });
    history.replaceState(null, "", `?${query}`);
  }, [preview]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<string>("");
  async function checkLayouts() {
    setChecking(true);
    const rows: Array<{
      role: string;
      width: number;
      height: number;
      phase: string;
      q: number;
      passed: boolean;
      fontSize?: string;
      selectionStable?: boolean;
    }> = [];
    const target = frame.current!;
    const original = {
      src: target.src,
      width: target.width,
      height: target.height,
    };
    try {
      for (const [role, w, h] of [
        ["display", 1280, 720],
        ["display", 1366, 768],
        ["display", 1920, 1080],
        ["player", 360, 780],
        ["player", 390, 844],
      ] as const) {
        for (const stage of role === "display"
          ? ["choicesReading", "acceptingAnswers", "answerRevealed"]
          : ["choicesReading", "acceptingAnswers"]) {
          for (let q = 1; q <= volume.questions.length; q++) {
            target.width = String(w);
            target.height = String(h);
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error("画面の読み込みがタイムアウトしました")),
                10000,
              );
              target.onload = () => {
                clearTimeout(timeout);
                resolve();
              };
              target.src = `?${new URLSearchParams({ mode: role, phase: stage, q: String(q), embed: "1" })}`;
            });
            const win = target.contentWindow!;
            await win.document.fonts.ready;
            await new Promise<void>((resolve) =>
              win.requestAnimationFrame(() =>
                win.requestAnimationFrame(() => resolve()),
              ),
            );
            const doc = win.document;
            const choices = [...doc.querySelectorAll<HTMLElement>(".choice")];
            const fitted = doc.querySelector<HTMLElement>(".fitted-question");
            let selectionStable: boolean | undefined;
            if (role === "player" && stage === "acceptingAnswers") {
              const measure = () =>
                JSON.stringify({
                  choices: [...doc.querySelectorAll(".choice")].map(
                    (c) => c.getBoundingClientRect().top,
                  ),
                  progress: doc
                    .querySelector(".game-progress")!
                    .getBoundingClientRect().height,
                  event: doc
                    .querySelector(".player-event-slot")!
                    .getBoundingClientRect().height,
                  footer: doc
                    .querySelector(".player-footer")!
                    .getBoundingClientRect().top,
                  scroll: win.scrollY,
                });
              const before = measure();
              choices[0].click();
              await new Promise<void>((resolve) =>
                win.requestAnimationFrame(() =>
                  win.requestAnimationFrame(() => resolve()),
                ),
              );
              const during = measure();
              const sending = doc
                .querySelector(".player-event-slot")!
                .textContent!.includes("回答を送信中");
              await new Promise<void>((resolve, reject) => {
                const started = performance.now();
                const check = () => {
                  if (
                    doc
                      .querySelector(".player-event-slot")!
                      .textContent!.includes("回答しました！")
                  )
                    resolve();
                  else if (performance.now() - started > 3000)
                    reject(new Error("回答の受付確認がタイムアウトしました"));
                  else win.setTimeout(check, 30);
                };
                check();
              });
              selectionStable =
                sending && before === during && before === measure();
            }
            const passed =
              selectionStable !== false &&
              choices.length === 4 &&
              doc.querySelectorAll(".proposal-japanese").length ===
                Object.values(volume.questions[q - 1].choices).filter(
                  (choice) => choice.titleJa !== null,
                ).length &&
              doc.documentElement.scrollWidth <= win.innerWidth &&
              choices.every(
                (c) =>
                  c.scrollWidth <= c.clientWidth + 1 &&
                  c.getBoundingClientRect().bottom <= win.innerHeight,
              ) &&
              (!fitted || fitted.dataset.fitOverflow === "false");
            rows.push({
              role,
              width: w,
              height: h,
              phase: stage,
              q,
              passed,
              fontSize: fitted?.dataset.fitFontSize,
              selectionStable,
            });
            setResults(
              JSON.stringify(
                {
                  checked: rows.length,
                  stableSelections: rows.filter((r) => r.selectionStable)
                    .length,
                  failed: rows.filter((r) => !r.passed),
                  smallestBodyCases: rows
                    .filter((r) => r.fontSize)
                    .sort((a, b) => Number(a.fontSize) - Number(b.fontSize))
                    .slice(0, 3),
                },
                null,
                2,
              ),
            );
          }
        }
      }
    } catch (error) {
      setResults(String(error));
    } finally {
      target.width = original.width;
      target.height = original.height;
      target.src = original.src;
      setChecking(false);
    }
  }
  return (
    <main style={{ padding: 16, width: preview.width + 32 }}>
      <fieldset
        disabled={checking}
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 16,
          alignItems: "end",
          flexWrap: "wrap",
          border: 0,
          padding: 0,
          margin: "0 0 16px",
        }}
      >
        <label>
          モード
          <select
            name="mode"
            value={preview.mode}
            onChange={(e) => {
              const nextMode = e.target.value as Role;
              setPreview((previous) => ({
                ...previous,
                mode: nextMode,
                ...(nextMode === "player"
                  ? { width: 390, height: 844 }
                  : previous.mode === "player"
                    ? { width: 1280, height: 720 }
                    : {}),
              }));
            }}
          >
            <option value="display">Display</option>
            <option value="player">回答</option>
            <option value="control">運営</option>
          </select>
        </label>
        <label>
          問題
          <select
            name="q"
            value={preview.q}
            onChange={(e) =>
              setPreview((previous) => ({
                ...previous,
                q: Number(e.target.value),
              }))
            }
          >
            {volume.questions.map((q, i) => (
              <option key={q.id} value={i + 1}>
                Q{i + 1} · {q.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          進行
          <select
            name="phase"
            value={preview.phase}
            onChange={(e) =>
              setPreview((previous) => ({
                ...previous,
                phase: e.target.value as Phase,
              }))
            }
          >
            {[
              "choicesReading",
              "acceptingAnswers",
              "answersClosed",
              "answerRevealed",
              "rankingShown",
            ].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          解像度
          <select
            name="resolution"
            value={resolution}
            onChange={(e) => {
              const preset = RESOLUTION_PRESETS.find(
                (p) => `${p.width}x${p.height}` === e.target.value,
              );
              if (preset)
                setPreview((previous) => ({
                  ...previous,
                  width: preset.width,
                  height: preset.height,
                }));
            }}
          >
            {!RESOLUTION_PRESETS.some(
              (p) => `${p.width}x${p.height}` === resolution,
            ) && (
              <option value={resolution}>
                カスタム · {preview.width} × {preview.height}
              </option>
            )}
            {["PC・Display", "スマホ・タブレット"].map((group) => (
              <optgroup key={group} label={group}>
                {RESOLUTION_PRESETS.filter((p) => p.group === group).map(
                  (p) => (
                    <option key={p.label} value={`${p.width}x${p.height}`}>
                      {p.label}
                    </option>
                  ),
                )}
              </optgroup>
            ))}
          </select>
        </label>
      </fieldset>
      <iframe
        ref={frame}
        title="画面プレビュー"
        src={`?${new URLSearchParams({ mode: preview.mode, phase: preview.phase, q: String(preview.q), embed: "1", ...(params.get("answer") && { answer: params.get("answer")! }), ...(params.get("answerState") && { answerState: params.get("answerState")! }) })}`}
        width={preview.width}
        height={preview.height}
        style={{ border: "1px solid #bbb", display: "block" }}
      />
      <button
        type="button"
        onClick={checkLayouts}
        disabled={checking}
        style={{ marginTop: 16 }}
      >
        全問の収まりを検証
      </button>
      <pre role="status" data-layout-results style={{ whiteSpace: "pre-wrap" }}>
        {checking ? "検証中…\n" : ""}
        {results}
      </pre>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>{params.has("embed") ? <Screen /> : <Preview />}</MemoryRouter>,
);
