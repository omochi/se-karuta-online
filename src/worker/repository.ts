import type { Game, Player, Round } from "../shared/types";
import { DEFAULT_TIMING } from "../shared/timing";
import { readDifficulty } from "../shared/questions";
const head = ({ players: _p, rounds: _r, ...state }: Game) => state;
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
    db.prepare("SELECT state_json FROM tournaments WHERE id = ?").bind(id),
    db
      .prepare(
        "SELECT question_json, state_json FROM rounds WHERE tournament_id = ? ORDER BY position",
      )
      .bind(id),
    db
      .prepare(
        "SELECT id, name, joined_at, session_hash FROM players WHERE tournament_id = ? ORDER BY joined_at, id",
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
    players: [],
    rounds: [],
  };
  game.timing ??= { ...DEFAULT_TIMING };
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
        sessionHash: row.session_hash,
      }) as Player,
  );
  const rounds = new Map(game.rounds.map((r) => [r.id, r]));
  for (const row of data[3].results)
    rounds.get(row.round_id as string)!.participants[row.player_id as string] =
      row.status as "eligible" | "resting";
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
    game.phaseEndsAt = current.openedAt + game.timing.answeringSeconds * 1000;
  return game;
}
export async function saveGame(
  db: D1Database,
  before: Game | null,
  after: Game,
  displayPasswordHash?: string,
) {
  const statements: D1PreparedStatement[] = [];
  if (!before) {
    statements.push(
      db
        .prepare(
          "INSERT INTO tournaments (id,name,created_at,display_password_hash,state_json) VALUES (?,?,?,?,?)",
        )
        .bind(
          after.id,
          after.name,
          after.createdAt,
          displayPasswordHash!,
          JSON.stringify(head(after)),
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
            "INSERT INTO players (id,tournament_id,name,joined_at,session_hash) VALUES (?,?,?,?,?)",
          )
          .bind(
            player.id,
            after.id,
            player.name,
            player.joinedAt,
            player.sessionHash,
          ),
      );
  }
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
