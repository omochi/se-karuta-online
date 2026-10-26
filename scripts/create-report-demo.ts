import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { newGame } from "../src/worker/game";
import { hashPassword } from "../src/worker/auth";
import { validateQuestions } from "../src/shared/questions";
import { CHOICES } from "../src/shared/types";
import { eventUrls, normalizePublicOrigin } from "../src/shared/urls";
import { tournamentReport } from "../src/worker/report";

// ローカルDBだけに追加する。実行ごとに新しいIDを使い、既存大会・問題原本は変更しない。
const vars = parseEnv(await readFile(".dev.vars", "utf8"));
const origin = normalizePublicOrigin(
  vars.PUBLIC_ORIGIN ?? "http://localhost:5218",
);
// 本編8問とボーナス4問を使い、有効・無効・未出題を含む12問のサンプルを維持する。
const inputs = await Promise.all(
  ["data/questions/vol-01.json", "data/questions/vol-01-bonus.json"].map(
    async (file) => JSON.parse(await readFile(file, "utf8")),
  ),
);
const id = crypto.randomUUID();
const questions = validateQuestions(
  inputs.flatMap((input) => input.questions ?? input),
).map((q) => ({
  ...q,
  id: `report-${id.slice(0, 8)}-${q.id}`,
}));
if (questions.length < 12)
  throw new Error("ダミー大会には12問以上の問題集が必要です。");
const now = Date.now();
const game = newGame(
  id,
  "【ダミー】詳細結果サンプル大会",
  questions.slice(0, 12),
  now - 20 * 60_000,
);
game.phase = "finished";
game.currentIndex = 9;
const names = [
  "あおい",
  "ゆう",
  "ゆう",
  "はる",
  "さくら",
  "りん",
  "みなと",
  "かえで",
  "Swift好きの長い名前の参加者",
  "つばさ",
  "ひなた",
  "そら",
  "なぎ",
  "まこと",
  "途中参加のひかり",
  "終了前に参加したれん",
];
game.players = names.map((name, i) => ({
  id: crypto.randomUUID(),
  name,
  joinedAt:
    i >= 14
      ? game.createdAt + (i === 14 ? 180_000 : 700_000)
      : game.createdAt + 1000,
  sessionHash: crypto.randomUUID(),
}));
for (let n = 0; n < 10; n++) {
  const r = game.rounds[n];
  const start = game.createdAt + 60_000 + n * 70_000;
  r.countdownStartedAt = start;
  r.readingStartedAt = start + 5000;
  r.openedAt = start + 20000;
  r.closedAt = start + 50000;
  const wrongChoices = CHOICES.filter((c) => c !== r.question.correctChoice);
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i];
    if (i === 15 || (i === 14 && n < 2)) continue;
    r.participants[p.id] = "eligible";
    if (
      (i === 12 && n % 3 === 0) ||
      i === 13 ||
      (i === 11 && n % 2 === 0) ||
      (i + n) % 11 === 10
    )
      continue;
    const correct = n === 2 || n === 6 ? i < 2 : i < 3 || (i + n) % 3 !== 0;
    const elapsed =
      n === 0 && i < 2 ? 382 : 800 + ((i * 977 + n * 431) % 19000);
    r.answers[p.id] = {
      choice: correct ? r.question.correctChoice : wrongChoices[(i + n) % 3],
      receivedAt: r.openedAt + elapsed,
    };
  }
}
// 受付後の無効化は回答を残す。受付前の無効化では「未回答」にしない。
game.rounds[8].isVoided = true;
game.rounds[8].voidReason = "ダミー例：出題内容の誤りに気づいたため";
const beforeOpening = game.rounds[9];
beforeOpening.isVoided = true;
beforeOpening.voidReason = "ダミー例：会場Displayの接続トラブル";
beforeOpening.readingStartedAt = null;
beforeOpening.openedAt = null;
beforeOpening.closedAt = beforeOpening.countdownStartedAt! + 2000;
beforeOpening.answers = {};

const sql: string[] = [];
const literal = (value: string | number | null) =>
  value === null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${value.replaceAll("'", "''")}'`;
function insert(
  table: string,
  columns: string[],
  values: (string | number | null)[],
) {
  sql.push(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES (${values.map(literal).join(",")});`,
  );
}
const { players, rounds, joinCode, ...state } = game;
insert(
  "tournaments",
  [
    "id",
    "name",
    "created_at",
    "display_password_hash",
    "state_json",
    "join_code",
  ],
  [
    id,
    game.name,
    game.createdAt,
    await hashPassword("display-karuta"),
    JSON.stringify(state),
    joinCode,
  ],
);
for (const p of players)
  insert(
    "players",
    ["id", "tournament_id", "name", "joined_at", "session_hash"],
    [p.id, id, p.name, p.joinedAt, p.sessionHash],
  );
for (const [position, r] of rounds.entries()) {
  const { question, participants, answers, ...roundState } = r;
  insert(
    "questions",
    ["id", "content_json"],
    [question.id, JSON.stringify(question)],
  );
  insert(
    "rounds",
    [
      "id",
      "tournament_id",
      "position",
      "question_id",
      "question_json",
      "state_json",
    ],
    [
      r.id,
      id,
      position,
      question.id,
      JSON.stringify(question),
      JSON.stringify(roundState),
    ],
  );
  for (const [playerId, status] of Object.entries(participants))
    insert(
      "participations",
      ["tournament_id", "round_id", "player_id", "status"],
      [id, r.id, playerId, status],
    );
  for (const [playerId, answer] of Object.entries(answers))
    insert(
      "answers",
      ["tournament_id", "round_id", "player_id", "choice", "received_at"],
      [id, r.id, playerId, answer.choice, answer.receivedAt],
    );
}
const folder = await mkdtemp(join(tmpdir(), "se-karuta-report-demo-"));
try {
  const file = join(folder, "seed.sql");
  await writeFile(file, sql.join("\n"));
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--file",
      file,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(
      "ローカルDBへのダミー大会追加に失敗しました。npm run setupでDBを準備してください。",
    );
  }
} finally {
  await rm(folder, { recursive: true, force: true });
}
const report = tournamentReport(game);
const urls = eventUrls(origin, id);
console.log(
  `ダミー大会を追加しました: ${game.name}\n${players.length}人・${rounds.length}問（有効${report.summary.scored}・無効${report.summary.voided}・未出題${report.summary.unasked}）\nControl: ${urls.control}\n詳細結果: ${urls.control}/report`,
);
