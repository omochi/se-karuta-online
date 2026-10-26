import { choiceLabel } from "../shared/proposal-title";
import { eventUrls } from "../shared/urls";
import {
  CHOICES,
  type Answer,
  type Choice,
  type Command,
  type Game,
  type Player,
  type Presence,
  type Question,
  type RankRow,
  type Results,
  type Role,
  type RoomView,
  type Round,
  type TimingSettings,
} from "../shared/types";
import { DEFAULT_TIMING, validateTiming } from "../shared/timing";
import { roundAnswerDistribution } from "./answer-distribution";
import { generateJoinCode } from "../shared/join-code";
export function newGame(
  id: string,
  name: string,
  questions: Question[],
  now: number,
): Game {
  return {
    id,
    name,
    joinCode: generateJoinCode(),
    createdAt: now,
    revision: 0,
    phase: "waiting",
    currentIndex: -1,
    phaseEndsAt: null,
    difficultyThreshold: 0.3,
    timing: { ...DEFAULT_TIMING },
    players: [],
    rounds: questions.map((question) => ({
      id: crypto.randomUUID(),
      question,
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
}
export const currentRound = (g: Game): Round | undefined =>
  g.rounds[g.currentIndex];
function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
export function addPlayer(g: Game, player: Player) {
  requireCondition(g.phase !== "finished", "この大会は終了しました。");
  requireCondition(g.players.length < 100, "参加人数の上限です。");
  if (!g.players.some((p) => p.id === player.id)) g.players.push(player);
}
export function applyCommand(
  g: Game,
  input: {
    command: Command;
    revision: number;
    playerId?: string;
    reason?: string;
    timing?: TimingSettings;
  },
  now: number,
) {
  requireCondition(
    input.revision === g.revision,
    "進行状態が更新されました。画面を確認してもう一度操作してください。",
  );
  if (input.command === "updateTiming") {
    requireCondition(
      g.phase !== "finished",
      "終了した大会の設定は変更できません。",
    );
    // 進行中の期限は維持し、各段階を開始するときに最新の設定を使う。
    g.timing = validateTiming(input.timing);
    g.revision += 1;
    return;
  }
  const r = currentRound(g);
  switch (input.command) {
    case "start": {
      requireCondition(
        ["waiting", "rankingShown", "questionVoided"].includes(g.phase),
        "今は次の問題を開始できません。",
      );
      requireCondition(
        g.currentIndex + 1 < g.rounds.length,
        "すべての問題が終了しています。",
      );
      requireCondition(
        g.players.length > 0,
        "参加者が入室してから開始してください。",
      );
      g.currentIndex += 1;
      const next = currentRound(g)!;
      next.participants = Object.fromEntries(
        g.players.map((p) => [p.id, "eligible"]),
      );
      g.phase = "choicesPreparing";
      break;
    }
    case "rest":
      requireCondition(
        r &&
          ["choicesPreparing", "choicesReading", "countdown"].includes(g.phase),
        "お休みの指定は出題前だけできます。",
      );
      requireCondition(
        input.playerId && r.participants[input.playerId] === "eligible",
        "この問題の参加対象者ではありません。",
      );
      r.participants[input.playerId] = "resting";
      if (!Object.values(r.participants).includes("eligible")) {
        g.phase = "choicesPreparing";
        g.phaseEndsAt = null;
        r.readingStartedAt = null;
        r.countdownStartedAt = null;
      }
      break;
    case "close":
      requireCondition(
        r && g.phase === "acceptingAnswers",
        "今は締め切れません。",
      );
      r.closedAt = now;
      g.phase = "answersClosed";
      break;
    case "reveal":
      requireCondition(
        g.phase === "answersClosed",
        "締切後に正解を公開してください。",
      );
      g.phase = "answerRevealed";
      break;
    case "ranking":
      requireCondition(
        g.phase === "answerRevealed",
        "正解公開後に順位を公開してください。",
      );
      g.phase = "rankingShown";
      break;
    case "void":
      requireCondition(
        r && !["waiting", "finished", "questionVoided"].includes(g.phase),
        "無効にできる問題がありません。",
      );
      requireCondition(
        typeof input.reason === "string" &&
          input.reason.trim().length > 0 &&
          input.reason.length <= 300,
        "無効にする理由を 300 文字以内で入力してください。",
      );
      r.isVoided = true;
      r.voidReason = input.reason.trim();
      r.closedAt ??= now;
      g.phase = "questionVoided";
      break;
    case "finish":
      requireCondition(
        ["waiting", "rankingShown", "questionVoided"].includes(g.phase),
        "結果を公開するか、現在の問題を無効にしてから終了してください。",
      );
      g.phase = "finished";
      break;
    default:
      throw new Error("不明な操作です。");
  }
  if (!["choicesReading", "countdown"].includes(g.phase)) g.phaseEndsAt = null;
  g.revision += 1;
}
export function beginCountdownIfReady(
  g: Game,
  ready: Set<string>,
  now: number,
): boolean {
  // Displayは任意の閲覧画面なので、参加者の準備だけを開始条件にする。
  if (g.phase !== "choicesPreparing") return false;
  const r = currentRound(g)!;
  const eligible = Object.keys(r.participants).filter(
    (id) => r.participants[id] === "eligible",
  );
  if (eligible.length === 0 || !eligible.every((id) => ready.has(id)))
    return false;
  r.countdownStartedAt = now;
  g.phase = "countdown";
  g.phaseEndsAt = now + g.timing.countdownSeconds * 1000;
  g.revision += 1;
  return true;
}
export function advanceTimer(g: Game, now: number): boolean {
  if (g.phaseEndsAt === null || now < g.phaseEndsAt) return false;
  const r = currentRound(g)!;
  if (g.phase === "countdown") {
    r.readingStartedAt = now;
    g.phase = "choicesReading";
    g.phaseEndsAt = now + g.timing.readingSeconds * 1000;
  } else if (g.phase === "choicesReading") {
    // 遅延・復旧後も実際の出題時刻を起点にし、過去の予定時刻から計測しない。
    r.openedAt = now;
    g.phase = "acceptingAnswers";
    g.phaseEndsAt = now + g.timing.answeringSeconds * 1000;
  } else if (g.phase === "acceptingAnswers") {
    // アラームが遅れても受付期限を延長せず、未回答は回答なしのまま残す。
    r.closedAt = g.phaseEndsAt;
    g.phase = "answersClosed";
    g.phaseEndsAt = null;
  } else return false;
  g.revision += 1;
  return true;
}
export function receiveAnswer(
  g: Game,
  playerId: string,
  roundId: string,
  choice: Choice,
  receivedAt: number,
): Answer {
  requireCondition(
    CHOICES.includes(choice),
    "回答は A〜D から選んでください。",
  );
  const round = g.rounds.find((r) => r.id === roundId);
  requireCondition(round, "問題が見つかりません。");
  // 応答だけが失われた場合は、締切・次問移行後も保存済みの最初の回答を返す。
  if (round.answers[playerId]) return round.answers[playerId];
  requireCondition(
    round === currentRound(g) &&
      g.phase === "acceptingAnswers" &&
      round.openedAt !== null &&
      receivedAt >= round.openedAt &&
      g.phaseEndsAt !== null &&
      receivedAt < g.phaseEndsAt,
    "この問題は回答受付中ではありません。",
  );
  requireCondition(
    round.participants[playerId] === "eligible",
    "この問題は回答対象ではありません。",
  );
  const answer = { choice, receivedAt };
  round.answers[playerId] = answer;
  return answer;
}
export function roundRanking(g: Game, r: Round): RankRow[] {
  if (r.isVoided || r.openedAt === null) return [];
  return rank(
    g.players
      .filter((p) => r.answers[p.id]?.choice === r.question.correctChoice)
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        value: r.answers[p.id].receivedAt - r.openedAt!,
      })),
    true,
  );
}
function rank(rows: Omit<RankRow, "rank">[], ascending: boolean): RankRow[] {
  const sorted = rows.sort(
    (a, b) =>
      (ascending ? a.value - b.value : b.value - a.value) ||
      a.playerId.localeCompare(b.playerId),
  );
  let currentRank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || row.value !== sorted[index - 1].value)
      currentRank = index + 1;
    return { ...row, rank: currentRank };
  });
}
export function isScoredRound(r: Round): boolean {
  return !r.isVoided && r.closedAt !== null && r.openedAt !== null;
}
export function isDifficultRound(
  g: Game,
  r: Round,
  rankings = roundRanking(g, r),
): boolean {
  const count = Object.values(r.participants).filter(
    (s) => s === "eligible",
  ).length;
  return (
    isScoredRound(r) &&
    count > 0 &&
    rankings.length / count <= g.difficultyThreshold
  );
}
export function finalResults(g: Game): Results {
  const valid = g.rounds.filter(isScoredRound);
  const minimumCorrect = Math.max(1, Math.ceil(valid.length / 2));
  const rankings = valid.map((r) => roundRanking(g, r));
  const hard = valid.map((r, i) => isDifficultRound(g, r, rankings[i]));
  const scores = g.players.map((p) => {
    const rows = rankings.map((r) => r.find((x) => x.playerId === p.id));
    const correct = rows.filter(Boolean).length;
    return {
      playerId: p.id,
      name: p.name,
      correct,
      fastest: rows.filter((r) => r?.rank === 1).length,
      difficult: rows.filter((r, i) => r && hard[i]).length,
      stable: correct
        ? rows.reduce((sum, r) => sum + (r?.rank ?? 0), 0) / correct
        : 0,
    };
  });
  const board = (key: "correct" | "fastest" | "difficult" | "stable") =>
    rank(
      scores
        .filter((p) =>
          key === "stable" ? p.correct >= minimumCorrect : p[key] > 0,
        )
        .map((p) => ({ playerId: p.playerId, name: p.name, value: p[key] })),
      key === "stable",
    );
  const allRecords = valid.flatMap((r, i) =>
    rankings[i].map((row) => ({
      playerId: row.playerId,
      name: row.name,
      elapsed: row.value,
      questionNumber: g.rounds.indexOf(r) + 1,
      proposal: choiceLabel(r.question, r.question.correctChoice),
    })),
  );
  const best = Math.min(...allRecords.map((r) => r.elapsed));
  return {
    correct: board("correct"),
    fastest: board("fastest"),
    difficult: board("difficult"),
    stable: board("stable"),
    validQuestions: valid.length,
    difficultQuestions: hard.filter(Boolean).length,
    minimumCorrect,
    record: allRecords.filter((r) => r.elapsed === best),
  };
}
export function viewFor(
  g: Game,
  role: Role,
  playerId: string | undefined,
  presence: Presence,
  epoch: string,
  now: number,
  publicOrigin: string,
): RoomView {
  const r = currentRound(g);
  const reveal =
    ["answerRevealed", "rankingShown", "finished"].includes(g.phase) &&
    !r?.isVoided;
  const showBody =
    [
      "acceptingAnswers",
      "answersClosed",
      "answerRevealed",
      "rankingShown",
      "finished",
    ].includes(g.phase) && !r?.isVoided;
  const rankings = r ? roundRanking(g, r) : [];
  const eligible = r
    ? Object.keys(r.participants).filter(
        (id) => r.participants[id] === "eligible",
      )
    : [];
  const view: RoomView = {
    urls: eventUrls(publicOrigin, g.id),
    type: "state",
    joinCode: g.joinCode,
    id: g.id,
    name: g.name,
    phase: g.phase,
    revision: g.revision,
    epoch,
    serverNow: now,
    phaseEndsAt: g.phaseEndsAt,
    phaseDurationMs:
      g.phaseEndsAt === null
        ? 0
        : g.phaseEndsAt -
          ((g.phase === "countdown"
            ? r?.countdownStartedAt
            : g.phase === "choicesReading"
              ? r?.readingStartedAt
              : r?.openedAt) ?? now),
    timing: g.timing,
    questionNumber: g.currentIndex + 1,
    totalQuestions: g.rounds.length,
    playerCount: g.players.length,
    eligibleCount: eligible.length,
    readyCount: eligible.filter((id) => presence.readyPlayers.has(id)).length,
    answerCount: r ? Object.keys(r.answers).length : 0,
    question: r
      ? {
          id: r.id,
          ...(!["choicesPreparing", "countdown"].includes(g.phase)
            ? {
                choices: r.question.choices,
              }
            : {}),
          ...(role !== "player" && !r.isVoided
            ? { difficulty: r.question.difficulty }
            : {}),
          ...(showBody && role !== "player"
            ? {
                bodyMarkdown: r.question.bodyMarkdown,
              }
            : {}),
          ...(reveal
            ? {
                correctChoice: r.question.correctChoice,
                explanationMarkdown: r.question.explanationMarkdown,
              }
            : {}),
          ...(r.isVoided ? { voidReason: r.voidReason } : {}),
        }
      : null,
  };
  // 締切だけでは公開しない。正解発表以降の会場Displayに人数だけ送る。
  if (
    role === "display" &&
    r &&
    !r.isVoided &&
    ["answerRevealed", "rankingShown"].includes(g.phase)
  )
    view.answerDistribution = roundAnswerDistribution(r);
  if (g.phase === "rankingShown") view.rankings = rankings;
  if (g.phase === "finished") view.results = finalResults(g);
  if (role === "player") {
    const p = g.players.find((p) => p.id === playerId);
    if (p) {
      const answer = r?.answers[p.id] ?? null;
      view.me = {
        id: p.id,
        name: p.name,
        participation: r?.participants[p.id] ?? "waiting",
        answer,
        elapsed:
          answer && r?.openedAt !== null && r?.openedAt !== undefined
            ? answer.receivedAt - r.openedAt
            : null,
      };
      if (reveal && answer)
        Object.assign(view.me, {
          correct: answer.choice === r!.question.correctChoice,
          rank: rankings.find((p) => p.playerId === playerId)?.rank,
          correctCount: rankings.length,
        });
    }
  }
  if (role === "control") {
    view.players = g.players.map((p) => ({
      id: p.id,
      name: p.name,
      online: presence.onlinePlayers.has(p.id),
      ready: presence.readyPlayers.has(p.id),
      participation: r?.participants[p.id] ?? "waiting",
      answered: !!r?.answers[p.id],
    }));
    view.displays = presence.displays;
    view.preview = ["waiting", "rankingShown", "questionVoided"].includes(
      g.phase,
    )
      ? g.rounds[g.currentIndex + 1]?.question
      : r?.question;
    view.hasNext = g.currentIndex + 1 < g.rounds.length;
  }
  return view;
}
