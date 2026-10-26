// 開発サーバー専用。30人全員が正解した問題の結果を本番のDisplayScreenで表示する。
// ランキングの表示上限やCSSは変更せず、大会・WebSocketには接続しない。
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { DisplayScreen } from "../../src/client/DisplayScreen";
import { getGameProgress } from "../../src/client/phase-presentation";
import { eventUrls } from "../../src/shared/urls";
import { DEFAULT_TIMING } from "../../src/shared/timing";
import type { RoomView } from "../../src/shared/types";
import "../../src/client/style.css";

const names = [
  "田中 太郎",
  "佐藤 花子",
  "Suzuki",
  "高橋 健太",
  "伊藤 美咲",
  "Swiftが大好きな参加者",
  "Yamamoto",
  "中村 さくら",
  "小林 大輔",
  "加藤 葵",
  "吉田 翔",
  "山田 結衣",
  "Sasaki",
  "山口 悠真",
  "松本 凛",
  "井上 陽菜",
  "木村 蓮",
  "林 ひなた",
  "清水 湊",
  "斎藤 杏",
  "池田 樹",
  "橋本 芽依",
  "阿部 大和",
  "石川 紬",
  "山崎 颯太",
  "Mori",
  "藤田 琴音",
  "岡田 蒼",
  "後藤 莉子",
  "長谷川 晴",
];
const view: RoomView = {
  type: "state",
  id: "ranking-preview",
  name: "【ダミー】30人の問題別ランキング",
  joinCode: null,
  urls: eventUrls(location.origin, "ranking-preview"),
  phase: "rankingShown",
  revision: 0,
  epoch: "preview",
  serverNow: 0,
  phaseEndsAt: null,
  phaseDurationMs: 0,
  timing: { ...DEFAULT_TIMING },
  questionNumber: 1,
  totalQuestions: 12,
  playerCount: names.length,
  eligibleCount: names.length,
  readyCount: names.length,
  answerCount: names.length,
  question: {
    id: "ranking-fixture",
    correctChoice: "A",
    choices: {
      A: {
        number: "SE-0296",
        title: "Async/await",
        titleJa: null,
        explanationUrl:
          "https://swiftdigest.koherent.org/proposals/se-0296.html",
      },
      B: {
        number: "SE-0235",
        title: "Add Result to the Standard Library",
        titleJa: null,
        explanationUrl:
          "https://swiftdigest.koherent.org/proposals/se-0235.html",
      },
      C: {
        number: "SE-0258",
        title: "Property Wrappers",
        titleJa: null,
        explanationUrl:
          "https://swiftdigest.koherent.org/proposals/se-0258.html",
      },
      D: {
        number: "SE-0195",
        title: 'Introduce User-defined "Dynamic Member Lookup" Types',
        titleJa: null,
        explanationUrl:
          "https://swiftdigest.koherent.org/proposals/se-0195.html",
      },
    },
  },
  answerDistribution: {
    counts: { A: names.length, B: 0, C: 0, D: 0 },
    unanswered: 0,
    sample: true,
  },
  rankings: names.map((name, i) => ({
    playerId: `dummy-${i + 1}`,
    name,
    rank: i + 1,
    value: 1200 + i * 780,
  })),
};

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <DisplayScreen
      view={view}
      progress={getGameProgress(view, 0)}
      status={<span className="display-event">ダミー表示 · 正解者30人</span>}
    />
  </MemoryRouter>,
);
