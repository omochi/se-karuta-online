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
import {
  answeringSeconds,
  ANSWER_EXTENSION_SECONDS,
  DEFAULT_TIMING,
  validateTiming,
} from "../shared/timing";
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
    timing: { ...DEFAULT_TIMING },
    players: [],
    readyExemptPlayerIds: [],
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
    waitForReady?: boolean;
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
  if (input.command === "extendAnswers") {
    requireCondition(
      r &&
        g.phase === "acceptingAnswers" &&
        g.phaseEndsAt !== null &&
        now < g.phaseEndsAt,
      "回答受付中の締切前だけ延長できます。",
    );
    g.phaseEndsAt += ANSWER_EXTENSION_SECONDS * 1000;
    r.answerExtendedAt = now;
    g.revision += 1;
    return;
  }
  if (input.command === "setReadyWait") {
    requireCondition(
      g.phase !== "finished",
      "終了した大会の設定は変更できません。",
    );
    requireCondition(
      input.playerId && g.players.some((p) => p.id === input.playerId),
      "参加者が見つかりません。",
    );
    requireCondition(
      typeof input.waitForReady === "boolean",
      "待ち合わせ設定が不正です。",
    );
    const exempt = new Set(g.readyExemptPlayerIds);
    if (input.waitForReady) exempt.delete(input.playerId);
    else exempt.add(input.playerId);
    g.readyExemptPlayerIds = [...exempt];
    // 待ち合わせ中の免除だけは直ちに反映。待つ設定への復帰は次問から。
    if (!input.waitForReady && r && g.phase === "choicesPreparing")
      r.readyWaitPlayerIds = readyWaitPlayers(r).filter(
        (id) => id !== input.playerId,
      );
    g.revision += 1;
    return;
  }
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
      next.readyWaitPlayerIds = Object.keys(next.participants).filter(
        (id) => !g.readyExemptPlayerIds.includes(id),
      );
      g.phase = "choicesPreparing";
      break;
    }
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
// 回答資格とは独立した、その問題の待ち合わせ対象。
function readyWaitPlayers(r: Round): string[] {
  return (r.readyWaitPlayerIds ?? Object.keys(r.participants)).filter(
    (id) => r.participants[id] === "eligible",
  );
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
  if (
    eligible.length === 0 ||
    !readyWaitPlayers(r).every((id) => ready.has(id))
  )
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
    g.phaseEndsAt =
      now + answeringSeconds(g.timing, r.question.difficulty) * 1000;
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
// 分数で集計し、足し順による誤差で同点が崩れるのを防ぐ。
type Fraction = { numerator: bigint; denominator: bigint };
function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
function addFraction(a: Fraction, b: Fraction): Fraction {
  const numerator = a.numerator * b.denominator + b.numerator * a.denominator;
  const denominator = a.denominator * b.denominator;
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
export function difficultRoundScore(r: Round): Fraction {
  if (!isScoredRound(r)) return { numerator: 0n, denominator: 1n };
  const { counts, unanswered } = roundAnswerDistribution(r);
  const eligible = Object.values(counts).reduce(
    (sum, count) => sum + count,
    unanswered,
  );
  return eligible === 0
    ? { numerator: 0n, denominator: 1n }
    : {
        numerator: BigInt(eligible - counts[r.question.correctChoice]),
        denominator: BigInt(eligible),
      };
}
export function finalResults(g: Game): Results {
  const valid = g.rounds.filter(isScoredRound);
  const rankings = valid.map((r) => roundRanking(g, r));
  const weights = valid.map(difficultRoundScore);
  const distributions = valid.map((r) => {
    const { counts } = roundAnswerDistribution(r);
    const answered = Object.values(counts).reduce(
      (sum, count) => sum + count,
      0,
    );
    return { counts, answered };
  });
  const scores = g.players.map((p) => {
    const rows = rankings.map((r) => r.find((x) => x.playerId === p.id));
    const correct = rows.filter(Boolean).length;
    return {
      playerId: p.id,
      name: p.name,
      correct,
      fastest: rows.reduce<Fraction>(
        (sum, row) =>
          row
            ? addFraction(sum, { numerator: 1n, denominator: BigInt(row.rank) })
            : sum,
        { numerator: 0n, denominator: 1n },
      ),
      difficult: rows.reduce<Fraction>(
        (sum, row, i) =>
          row && valid[i].participants[p.id] === "eligible"
            ? addFraction(sum, weights[i])
            : sum,
        { numerator: 0n, denominator: 1n },
      ),
      friendship: valid.reduce<Fraction>(
        (sum, r, i) => {
          const answer = r.answers[p.id];
          const { counts, answered } = distributions[i];
          return r.participants[p.id] === "eligible" && answer && answered > 0
            ? addFraction(sum, {
                numerator: BigInt(counts[answer.choice]),
                denominator: BigInt(answered),
              })
            : sum;
        },
        { numerator: 0n, denominator: 1n },
      ),
    };
  });
  const board = (key: "correct") =>
    rank(
      scores
        .filter((p) => p[key] > 0)
        .map((p) => ({ playerId: p.playerId, name: p.name, value: p[key] })),
      false,
    );
  const fractionBoard = (
    key: "fastest" | "difficult" | "friendship",
  ): RankRow[] => {
    const sorted = scores
      .filter((p) => p[key].numerator > 0n)
      .sort((a, b) => {
        const difference =
          a[key].numerator * b[key].denominator -
          b[key].numerator * a[key].denominator;
        return difference > 0n
          ? -1
          : difference < 0n
            ? 1
            : a.playerId.localeCompare(b.playerId);
      });
    let currentRank = 0;
    return sorted.map((p, i) => {
      const previous = sorted[i - 1]?.[key];
      if (
        !previous ||
        p[key].numerator * previous.denominator !==
          previous.numerator * p[key].denominator
      )
        currentRank = i + 1;
      return {
        playerId: p.playerId,
        name: p.name,
        rank: currentRank,
        value: Number(p[key].numerator) / Number(p[key].denominator),
      };
    });
  };
  return {
    correct: board("correct"),
    fastest: fractionBoard("fastest"),
    difficult: fractionBoard("difficult"),
    friendship: fractionBoard("friendship"),
    validQuestions: valid.length,
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
    ...(g.phase === "acceptingAnswers" && r?.answerExtendedAt !== undefined
      ? { answerExtendedAt: r.answerExtendedAt }
      : {}),
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
    readyCount: r
      ? readyWaitPlayers(r).filter((id) => presence.readyPlayers.has(id)).length
      : 0,
    readyWaitCount: r ? readyWaitPlayers(r).length : 0,
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
  // 回答受付から会場Displayに人数だけ送る。正解や個別の回答は公開しない。
  if (
    role === "display" &&
    r &&
    !r.isVoided &&
    [
      "acceptingAnswers",
      "answersClosed",
      "answerRevealed",
      "rankingShown",
    ].includes(g.phase)
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
      waitForReady: !g.readyExemptPlayerIds.includes(p.id),
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
