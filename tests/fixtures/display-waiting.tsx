// 本番のDisplayScreenを使う、待機画面のブラウザー確認用。
// QR・URL・参加コードはサンプル。大会への接続・登録は行わない。
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { DisplayScreen } from "../../src/client/DisplayScreen";
import { ConnectionBadge } from "../../src/client/components";
import { getGameProgress } from "../../src/client/phase-presentation";
import { eventUrls } from "../../src/shared/urls";
import { DEFAULT_TIMING } from "../../src/shared/timing";
import type { RoomView } from "../../src/shared/types";
import "../../src/client/style.css";

const view: RoomView = {
  type: "state",
  id: "preview",
  name: "Swift Evolution Karuta 大会（表示サンプル）",
  joinCode: new URLSearchParams(location.search).has("qr-only")
    ? null
    : "ABCDEF",
  urls: eventUrls(
    "https://se-karuta-online.omochimetaru.workers.dev",
    "preview",
  ),
  phase: "waiting",
  revision: 0,
  epoch: "preview",
  serverNow: 0,
  phaseEndsAt: null,
  phaseDurationMs: 0,
  timing: { ...DEFAULT_TIMING },
  questionNumber: 0,
  totalQuestions: 10,
  playerCount: 24,
  eligibleCount: 0,
  readyCount: 0,
  answerCount: 0,
  question: null,
};
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <DisplayScreen
      view={view}
      progress={getGameProgress(view, 0)}
      status={<ConnectionBadge connected />}
    />
  </MemoryRouter>,
);
