import type { Game, Player, Round } from "../shared/types";
import { answeringSeconds, restoreTiming } from "../shared/timing";
import { readDifficulty } from "../shared/questions";
import { generateJoinCode } from "../shared/join-code";
const head = ({ players: _p, rounds: _r, joinCode: _c, ...state }: Game) =>
  state;
// 既存大会にも初回参照時に発行する。同時に開かれてもDBに保存された値を採用する。
export async function ensureJoinCode(
  db: D1Database,
  id: string,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await db
      .prepare("SELECT join_code FROM tournaments WHERE id = ?")
      .bind(id)
      .first<{ join_code: string | null }>();
    if (!row) throw new Error("大会が見つかりません。");
    if (row.join_code) return row.join_code;
    await db
      .prepare(
        "UPDATE OR IGNORE tournaments SET join_code = ? WHERE id = ? AND join_code IS NULL",
      )
      .bind(generateJoinCode(), id)
      .run();
  }
  throw new Error("参加コードの発行に失敗しました。再度お試しください。");
}
const roundState = ({
  question: _q,
  participants: _p,
  answers: _a,
  ...state
}: Round) => state;
export async function loadGame(
  db: D1Database,
  id: string,
): Promise<Game | null> {
  const data = await db.batch<Record<string, unknown>>([
    db
      .prepare("SELECT state_json, join_code FROM tournaments WHERE id = ?")
      .bind(id),
    db
      .prepare(
        "SELECT question_json, state_json FROM rounds WHERE tournament_id = ? ORDER BY position",
      )
      .bind(id),
    db
      .prepare(
        "SELECT id, name, joined_at FROM players WHERE tournament_id = ? ORDER BY joined_at, id",
      )
      .bind(id),
    db
      .prepare(
        "SELECT round_id, player_id, status FROM participations WHERE tournament_id = ?",
      )
      .bind(id),
    db
      .prepare(
        "SELECT round_id, player_id, choice, received_at FROM answers WHERE tournament_id = ?",
      )
      .bind(id),
  ]);
  if (!data[0].results.length) return null;
  const game: Game = {
    ...JSON.parse(data[0].results[0].state_json as string),
    joinCode:
      (data[0].results[0].join_code as string | null) ??
      (await ensureJoinCode(db, id)),
    players: [],
    rounds: [],
  };
  game.timing = restoreTiming(game.timing);
  game.readyExemptPlayerIds ??= [];
  game.rounds = data[1].results.map((row) => ({
    ...JSON.parse(row.state_json as string),
    question: JSON.parse(row.question_json as string),
    participants: {},
    answers: {},
  }));
  for (const round of game.rounds)
    round.question.difficulty = readDifficulty(round.question.difficulty);
  game.players = data[2].results.map(
    (row) =>
      ({
        id: row.id,
        name: row.name,
        joinedAt: row.joined_at,
      }) as Player,
  );
  const rounds = new Map(game.rounds.map((r) => [r.id, r]));
  for (const row of data[3].results)
    rounds.get(row.round_id as string)!.participants[row.player_id as string] =
      row.status as "eligible";
  for (const row of data[4].results)
    rounds.get(row.round_id as string)!.answers[row.player_id as string] = {
      choice: row.choice as "A" | "B" | "C" | "D",
      receivedAt: row.received_at as number,
    };
  // 時間制限がなかった既存大会も、復元時に現在の問題へ期限を補う。
  const current = game.rounds[game.currentIndex];
  if (
    game.phase === "acceptingAnswers" &&
    game.phaseEndsAt === null &&
    current?.openedAt != null
  )
    game.phaseEndsAt =
      current.openedAt +
      answeringSeconds(game.timing, current.question.difficulty) * 1000;
  return game;
}
async function persistGame(
  db: D1Database,
  before: Game | null,
  after: Game,
  displayPasswordHash?: string,
  registration?: { clientId: string; playerId: string },
) {
  const statements: D1PreparedStatement[] = [];
  if (!before) {
    statements.push(
      db
        .prepare(
          "INSERT INTO tournaments (id,name,created_at,display_password_hash,state_json,join_code) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          after.id,
          after.name,
          after.createdAt,
          displayPasswordHash!,
          JSON.stringify(head(after)),
          after.joinCode,
        ),
    );
  } else if (JSON.stringify(head(before)) !== JSON.stringify(head(after))) {
    statements.push(
      db
        .prepare("UPDATE tournaments SET state_json = ? WHERE id = ?")
        .bind(JSON.stringify(head(after)), after.id),
    );
  }
  for (const player of after.players) {
    if (!before?.players.some((p) => p.id === player.id))
      statements.push(
        db
          .prepare(
            "INSERT INTO players (id,tournament_id,name,joined_at) VALUES (?,?,?,?)",
          )
          .bind(player.id, after.id, player.name, player.joinedAt),
      );
  }
  if (registration)
    statements.push(
      db
        .prepare(
          "INSERT INTO client_players (client_id,tournament_id,player_id) VALUES (?,?,?)",
        )
        .bind(registration.clientId, after.id, registration.playerId),
    );
  for (const [index, r] of after.rounds.entries()) {
    const old = before?.rounds[index];
    if (!old) {
      statements.push(
        db
          .prepare(
            "INSERT INTO questions (id,content_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET content_json=excluded.content_json",
          )
          .bind(r.question.id, JSON.stringify(r.question)),
      );
      statements.push(
        db
          .prepare(
            "INSERT INTO rounds (id,tournament_id,position,question_id,question_json,state_json) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            r.id,
            after.id,
            index,
            r.question.id,
            JSON.stringify(r.question),
            JSON.stringify(roundState(r)),
          ),
      );
    } else if (
      JSON.stringify(roundState(old)) !== JSON.stringify(roundState(r))
    ) {
      statements.push(
        db
          .prepare("UPDATE rounds SET state_json = ? WHERE id = ?")
          .bind(JSON.stringify(roundState(r)), r.id),
      );
    }
    for (const [playerId, status] of Object.entries(r.participants)) {
      if (old?.participants[playerId] !== status)
        statements.push(
          db
            .prepare(
              "INSERT INTO participations (tournament_id,round_id,player_id,status) VALUES (?,?,?,?) ON CONFLICT(round_id,player_id) DO UPDATE SET status=excluded.status",
            )
            .bind(after.id, r.id, playerId, status),
        );
    }
    for (const [playerId, answer] of Object.entries(r.answers)) {
      if (!old?.answers[playerId])
        statements.push(
          db
            .prepare(
              "INSERT INTO answers (tournament_id,round_id,player_id,choice,received_at) VALUES (?,?,?,?,?)",
            )
            .bind(after.id, r.id, playerId, answer.choice, answer.receivedAt),
        );
    }
  }
  // 保存成功後だけメモリ状態と画面を進める。回答は更新せず、一意制約でも最初の回答を守る。
  if (statements.length) await db.batch(statements);
}

export async function saveGame(
  db: D1Database,
  before: Game | null,
  after: Game,
  displayPasswordHash?: string,
  registration?: { clientId: string; playerId: string },
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await persistGame(db, before, after, displayPasswordHash, registration);
      return;
    } catch (error) {
      // 作成batchは衝突時に全体がロールバックされる。コードの衝突だけを再試行する。
      if (
        before ||
        attempt >= 9 ||
        !(error instanceof Error) ||
        !error.message.includes(
          "UNIQUE constraint failed: tournaments.join_code",
        )
      )
        throw error;
      after.joinCode = generateJoinCode();
    }
  }
}
