/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeAll, expect, it, vi } from "vitest";
import { env, exports } from "cloudflare:workers";
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import joinCodeMigration from "../migrations/0002_join_code.sql?raw";
import sessionMigration from "../migrations/0004_client_sessions.sql?raw";
import resultMigration from "../migrations/0005_result_sharing.sql?raw";
import debugMigration from "../migrations/0006_debug_player_sessions.sql?raw";
import worker from "../src/worker/index";
import readyWaitMigration from "../migrations/0003_unify_resting_with_unanswered.sql?raw";
import { tournamentReport } from "../src/worker/report";
import { tournamentReview } from "../src/worker/review";
import { personalResult } from "../src/worker/personal-result";
import migration from "../migrations/0001_initial.sql?raw";
import {
  newGame,
  addPlayer,
  applyCommand,
  beginCountdownIfReady,
  advanceTimer,
  receiveAnswer,
} from "../src/worker/game";
import { loadGame, saveGame } from "../src/worker/repository";
import {
  createSession,
  readSession,
  digest,
  cookie as sessionCookie,
  readAuthorizations,
} from "../src/worker/auth";
import type { Env } from "../src/worker/env";
import type { Game, Question, RoomView } from "../src/shared/types";
import type { EventPage } from "../src/shared/events";
const bindings = env as unknown as Env;
let legacyGame: Game;
it("大会一覧は管理者だけが取得でき、件数制限・安定した並び順・状態を返す", async () => {
  const { token } = await sessionFixture({
    role: "admin",
  });
  const request = (query = "", cookie = `se_session=${token}`) =>
    exports.default.fetch(
      new Request(`http://test/api/events${query}`, {
        headers: { Cookie: cookie },
      }),
    );
  expect((await request("?page=1", "")).status).toBe(401);
  const { token: playerToken } = await sessionFixture({
    role: "player",
    eventId: "test",
    playerId: "player",
  });
  expect((await request("?page=1", `se_session=${playerToken}`)).status).toBe(
    401,
  );
  const before = (await (await request()).json()) as EventPage;
  const phases = [
    "waiting",
    "choicesPreparing",
    "countdown",
    "choicesReading",
    "acceptingAnswers",
    "answersClosed",
    "answerRevealed",
    "rankingShown",
    "questionVoided",
    "finished",
  ];
  const prefix = crypto.randomUUID();
  const ids = Array.from(
    { length: 41 },
    (_, i) => `${prefix}-${String(i).padStart(2, "0")}`,
  );
  await bindings.DB.batch(
    ids.map((id, i) =>
      bindings.DB.prepare(
        "INSERT INTO tournaments (id,name,created_at,display_password_hash,state_json) VALUES (?,?,?,?,?)",
      ).bind(
        id,
        `一覧テスト${i}`,
        4102444800000,
        "hidden-password",
        JSON.stringify({
          phase: phases[i % phases.length],
          privateData: "hidden-state",
        }),
      ),
    ),
  );
  try {
    const recent = (await (await request("?pageSize=5")).json()) as EventPage;
    expect(recent.events.map((e) => e.id)).toEqual(ids.slice(-5).reverse());
    expect(recent.total).toBe(before.total + 41);
    const first = (await (await request("?page=1")).json()) as EventPage;
    const second = (await (await request("?page=2")).json()) as EventPage;
    const third = (await (await request("?page=3")).json()) as EventPage;
    expect(first.events.map((e) => e.id)).toEqual(ids.slice(21).reverse());
    expect(second.events.map((e) => e.id)).toEqual(ids.slice(1, 21).reverse());
    expect(third.events[0].id).toBe(ids[0]);
    for (const e of first.events) {
      const phase = phases[ids.indexOf(e.id) % phases.length];
      expect(e.status).toBe(
        phase === "waiting" || phase === "finished" ? phase : "active",
      );
      expect(Object.keys(e).sort()).toEqual([
        "created_at",
        "id",
        "name",
        "status",
        "urls",
      ]);
    }
    const last = (await (await request("?page=999999")).json()) as EventPage;
    expect(last.page).toBe(last.pageCount);
    expect(last.events.length).toBeGreaterThan(0);
    for (const query of [
      "?page=0",
      "?page=-1",
      "?page=1.5",
      "?page=abc",
      "?page=9007199254740992",
      "?pageSize=0",
      "?pageSize=21",
      "?pageSize=abc",
    ]) {
      expect((await request(query)).status, query).toBe(400);
    }
    await bindings.DB.prepare(
      "UPDATE tournaments SET state_json = ? WHERE id = ?",
    )
      .bind(JSON.stringify({ phase: "finished" }), ids[40])
      .run();
    const updated = (await (await request("?pageSize=5")).json()) as EventPage;
    expect(updated.events[0].status).toBe("finished");
  } finally {
    await bindings.DB.batch(
      ids.map((id) =>
        bindings.DB.prepare("DELETE FROM tournaments WHERE id = ?").bind(id),
      ),
    );
  }
});
it("HostやForwardedヘッダーではなく公開URLを使用する", async () => {
  const config = await exports.default.fetch(
    new Request("http://untrusted.example/api/config", {
      headers: {
        "X-Forwarded-Host": "forged.example",
        "X-Forwarded-Proto": "https",
      },
    }),
  );
  expect(await config.json()).toEqual({
    publicOrigin: "http://test",
    debugMode: false,
  });
  const game = fixture();
  await saveGame(bindings.DB, null, game, "hash");
  const response = await exports.default.fetch(
    new Request(`http://untrusted.example/api/e/${game.id}`, {
      headers: { Host: "forged.example" },
    }),
  );
  expect(await response.json()).toMatchObject({
    urls: { play: `http://test/e/${game.id}/play` },
  });
  const wrongOrigin = await exports.default.fetch(
    new Request("http://untrusted.example/api/admin/login", {
      method: "POST",
      headers: { Origin: "http://untrusted.example" },
      body: JSON.stringify({ password: "test-admin" }),
    }),
  );
  expect(wrongOrigin.status).toBe(403);
});
beforeAll(async () => {
  await bindings.DB.batch(
    (migration + joinCodeMigration + readyWaitMigration)
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => bindings.DB.prepare(s)),
  );
  legacyGame = fixture();
  legacyGame.phase = "finished";
  legacyGame.currentIndex = 0;
  const round = legacyGame.rounds[0];
  const player = legacyGame.players[0];
  round.openedAt = 100;
  round.closedAt = 200;
  round.participants[player.id] = "eligible";
  round.answers[player.id] = { choice: "B", receivedAt: 150 };
  const { players: _p, rounds: _r, joinCode: _c, ...head } = legacyGame;
  const { question: _q, participants: _ps, answers: _a, ...roundState } = round;
  await bindings.DB.batch([
    bindings.DB.prepare(
      "INSERT INTO tournaments (id,name,created_at,display_password_hash,state_json,join_code) VALUES (?,?,?,?,?,?)",
    ).bind(
      legacyGame.id,
      legacyGame.name,
      legacyGame.createdAt,
      "legacy-display",
      JSON.stringify(head),
      legacyGame.joinCode,
    ),
    bindings.DB.prepare(
      "INSERT INTO questions (id,content_json) VALUES (?,?)",
    ).bind(round.question.id, JSON.stringify(round.question)),
    bindings.DB.prepare(
      "INSERT INTO rounds (id,tournament_id,position,question_id,question_json,state_json) VALUES (?,?,?,?,?,?)",
    ).bind(
      round.id,
      legacyGame.id,
      0,
      round.question.id,
      JSON.stringify(round.question),
      JSON.stringify(roundState),
    ),
    bindings.DB.prepare(
      "INSERT INTO players (id,tournament_id,name,joined_at,session_hash) VALUES (?,?,?,?,?)",
    ).bind(
      player.id,
      legacyGame.id,
      player.name,
      player.joinedAt,
      "legacy-session",
    ),
    bindings.DB.prepare(
      "INSERT INTO participations (tournament_id,round_id,player_id,status) VALUES (?,?,?,?)",
    ).bind(legacyGame.id, round.id, player.id, "eligible"),
    bindings.DB.prepare(
      "INSERT INTO answers (tournament_id,round_id,player_id,choice,received_at) VALUES (?,?,?,?,?)",
    ).bind(legacyGame.id, round.id, player.id, "B", 150),
  ]);
  await bindings.DB.batch(
    (sessionMigration + resultMigration + debugMigration)
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => bindings.DB.prepare(s)),
  );
});
function fixture(): Game {
  const game = newGame(
    crypto.randomUUID(),
    "Worker test",
    [
      {
        id: crypto.randomUUID(),
        difficulty: 2 as const,
        bodyMarkdown: "body",
        choices: {
          A: {
            number: "SE-0001",
            title: "a",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0001.html",
          },
          B: {
            number: "SE-0002",
            title: "b",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0002.html",
          },
          C: {
            number: "SE-0003",
            title: "c",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0003.html",
          },
          D: {
            number: "SE-0004",
            title: "d",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0004.html",
          },
        },
        correctChoice: "B",
        explanationMarkdown: "explanation",
      },
    ],
    Date.now(),
  );
  addPlayer(game, {
    id: crypto.randomUUID(),
    name: "Alice",
    joinedAt: Date.now(),
  });
  return game;
}
it("D1に問題のスナップショット・参加資格・回答を保存して復元する", async () => {
  const g = fixture();
  g.rounds[0].question.choices.B.titleJa = "邦題";
  g.rounds[0].question.choices.D.titleJa = "別の邦題";
  await saveGame(bindings.DB, null, g, "display-hash");
  const next = structuredClone(g);
  applyCommand(next, { command: "start", revision: 0 }, 100);
  beginCountdownIfReady(next, new Set(next.players.map((p) => p.id)), 100);
  advanceTimer(next, 5100);
  advanceTimer(next, 25100);
  receiveAnswer(next, next.players[0].id, next.rounds[0].id, "B", 25382);
  applyCommand(
    next,
    {
      command: "updateTiming",
      revision: next.revision,
      timing: {
        countdownSeconds: 3,
        readingSeconds: 15,
        answeringSeconds1: 45,
        answeringSeconds2: 45,
        answeringSeconds3: 45,
      },
    },
    25400,
  );
  expect(next.phaseEndsAt).toBe(70100);
  await saveGame(bindings.DB, g, next);
  expect(await loadGame(bindings.DB, g.id)).toEqual(next);
  await bindings.DB.prepare(
    "UPDATE questions SET content_json = ? WHERE id = ?",
  )
    .bind(
      JSON.stringify({ ...g.rounds[0].question, bodyMarkdown: "changed" }),
      g.rounds[0].question.id,
    )
    .run();
  expect(
    (await loadGame(bindings.DB, g.id))?.rounds[0].question.bodyMarkdown,
  ).toBe("body");
});
it("回答保存が失敗したら同じbatchの状態更新もロールバックする", async () => {
  const g = fixture();
  await saveGame(bindings.DB, null, g, "hash");
  const broken = structuredClone(g);
  applyCommand(broken, { command: "start", revision: 0 }, 0);
  broken.rounds[0].answers[g.players[0].id] = {
    choice: "E" as "A",
    receivedAt: 1,
  };
  await expect(saveGame(bindings.DB, g, broken)).rejects.toThrow();
  expect(await loadGame(bindings.DB, g.id)).toEqual(g);
});
it("延長後の締切・通知時刻・回答をD1から復元し、古い大会は通知なしで復元する", async () => {
  const g = fixture();
  applyCommand(g, { command: "start", revision: g.revision }, 100);
  beginCountdownIfReady(g, new Set(g.players.map((p) => p.id)), 100);
  advanceTimer(g, 5100);
  advanceTimer(g, 25100);
  receiveAnswer(g, g.players[0].id, g.rounds[0].id, "B", 26000);
  await saveGame(bindings.DB, null, g, "hash");
  const legacy = (await loadGame(bindings.DB, g.id))!;
  expect(legacy.rounds[0].answerExtendedAt).toBeUndefined();
  const extended = structuredClone(legacy);
  applyCommand(
    extended,
    { command: "extendAnswers", revision: extended.revision },
    70099,
  );
  await saveGame(bindings.DB, legacy, extended);
  expect(await loadGame(bindings.DB, g.id)).toEqual(extended);
  expect(extended.phaseEndsAt).toBe(85100);
  expect(extended.rounds[0].answerExtendedAt).toBe(70099);
  expect(extended.rounds[0].answers).toEqual(legacy.rounds[0].answers);
});
it("Durable Objectを破棄してもD1から進行状態を復元する", async () => {
  const g = fixture();
  addPlayer(g, {
    id: crypto.randomUUID(),
    name: "待ち合わせ対象",
    joinedAt: Date.now(),
  });
  applyCommand(
    g,
    {
      command: "setReadyWait",
      revision: g.revision,
      playerId: g.players[0].id,
      waitForReady: false,
    },
    0,
  );
  applyCommand(g, { command: "start", revision: g.revision }, 0);
  await saveGame(bindings.DB, null, g, "hash");
  const { token } = await sessionFixture({
    role: "admin",
  });
  async function connect() {
    const response = await exports.default.fetch(
      new Request(`http://test/api/e/${g.id}/ws?role=control`, {
        headers: {
          Origin: "http://test",
          Upgrade: "websocket",
          Cookie: `se_session=${token}`,
        },
      }),
    );
    expect(response.status).toBe(101);
    const ws = response.webSocket!;
    const first = new Promise<RoomView>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("state timeout")), 5000);
      ws.addEventListener("message", (e) => {
        const message = JSON.parse(e.data as string);
        if (message.type === "state") {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });
    ws.accept();
    return { ws, view: await first };
  }
  const first = await connect();
  expect(first.view.phase).toBe("choicesPreparing");
  const stub = bindings.ROOMS.get(bindings.ROOMS.idFromName(g.id));
  first.ws.close();
  await evictDurableObject(stub, { webSockets: "close" });
  const second = await connect();
  expect(second.view.phase).toBe("choicesPreparing");
  expect(second.view.readyWaitCount).toBe(1);
  expect(
    second.view.players?.find((p) => p.id === g.players[0].id)?.waitForReady,
  ).toBe(false);
  expect(second.view.question?.id).toBe(first.view.question?.id);
  expect(second.view.epoch).not.toBe(first.view.epoch);
  second.ws.close();
});

it("問題ビューワは管理者だけが大会作成時の問題を出題順で取得できる", async () => {
  const game = newGame(
    crypto.randomUUID(),
    "Viewer test",
    [
      {
        id: crypto.randomUUID(),
        difficulty: 2 as const,
        bodyMarkdown: "first secret",
        choices: {
          A: {
            number: "SE-0001",
            title: "a",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0001.html",
          },
          B: {
            number: "SE-0002",
            title: "b",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0002.html",
          },
          C: {
            number: "SE-0003",
            title: "c",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0003.html",
          },
          D: {
            number: "SE-0004",
            title: "d",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0004.html",
          },
        },
        correctChoice: "C",
        explanationMarkdown: "first explanation",
      },
      {
        id: crypto.randomUUID(),
        difficulty: 2 as const,
        bodyMarkdown: "second secret",
        choices: {
          A: {
            number: "SE-0001",
            title: "a",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0001.html",
          },
          B: {
            number: "SE-0002",
            title: "b",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0002.html",
          },
          C: {
            number: "SE-0003",
            title: "c",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0003.html",
          },
          D: {
            number: "SE-0004",
            title: "d",
            titleJa: null,
            explanationUrl:
              "https://swiftdigest.koherent.org/proposals/se-0004.html",
          },
        },
        correctChoice: "A",
        explanationMarkdown: "second explanation",
      },
    ],
    Date.now(),
  );
  await saveGame(bindings.DB, null, game, "hash");
  const url = `http://test/api/e/${game.id}/questions`;
  const anonymous = await exports.default.fetch(new Request(url));
  expect(anonymous.status).toBe(401);
  expect(await anonymous.text()).not.toContain("secret");
  for (const role of ["display", "player"] as const) {
    const { token } = await sessionFixture({
      role,
      eventId: game.id,
    });
    const denied = await exports.default.fetch(
      new Request(url, {
        headers: {
          Cookie: `se_session=${token}`,
        },
      }),
    );
    expect(denied.status).toBe(401);
  }
  await bindings.DB.prepare(
    "UPDATE questions SET content_json = ? WHERE id = ?",
  )
    .bind(
      JSON.stringify({
        ...game.rounds[0].question,
        bodyMarkdown: "changed master",
      }),
      game.rounds[0].question.id,
    )
    .run();
  const { token } = await sessionFixture({
    role: "admin",
  });
  const response = await exports.default.fetch(
    new Request(url, { headers: { Cookie: `se_session=${token}` } }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    name: game.name,
    questions: game.rounds.map((r) => r.question),
  });
});

it("時間設定のない既存大会をデフォルト値で復元する", async () => {
  const game = fixture();
  await saveGame(bindings.DB, null, game, "hash");
  await bindings.DB.prepare(
    "UPDATE tournaments SET state_json = json_remove(state_json, '$.timing') WHERE id = ?",
  )
    .bind(game.id)
    .run();
  expect((await loadGame(bindings.DB, game.id))?.timing).toEqual({
    countdownSeconds: 5,
    readingSeconds: 20,
    answeringSeconds1: 30,
    answeringSeconds2: 45,
    answeringSeconds3: 60,
  });
});

it("旧形式の共通回答時間を全難易度へ引き継ぎ、進行中の期限を維持する", async () => {
  const game = fixture();
  applyCommand(game, { command: "start", revision: game.revision }, 100);
  beginCountdownIfReady(game, new Set(game.players.map((p) => p.id)), 100);
  advanceTimer(game, 5100);
  advanceTimer(game, 25100);
  await saveGame(bindings.DB, null, game, "hash");
  const legacy = {
    ...game,
    timing: { countdownSeconds: 7, readingSeconds: 18, answeringSeconds: 42 },
  };
  await bindings.DB.prepare(
    "UPDATE tournaments SET state_json = ? WHERE id = ?",
  )
    .bind(JSON.stringify(legacy), game.id)
    .run();
  const restored = (await loadGame(bindings.DB, game.id))!;
  expect(restored.timing).toEqual({
    countdownSeconds: 7,
    readingSeconds: 18,
    answeringSeconds1: 42,
    answeringSeconds2: 42,
    answeringSeconds3: 42,
  });
  expect(restored.phaseEndsAt).toBe(game.phaseEndsAt);
  // 期限を持たない旧大会は、復元した設定と問題の難易度から補う。
  await bindings.DB.prepare(
    "UPDATE tournaments SET state_json = json_set(state_json, '$.phaseEndsAt', NULL) WHERE id = ?",
  )
    .bind(game.id)
    .run();
  expect((await loadGame(bindings.DB, game.id))!.phaseEndsAt).toBe(
    25100 + 42000,
  );
});

it.each([1, 2, 3] as const)(
  "難易度%iの設定を保存し、期限のない出題中の大会を復元する",
  async (difficulty) => {
    const game = fixture();
    game.rounds[0].question.difficulty = difficulty;
    game.timing = {
      ...game.timing,
      answeringSeconds1: 17,
      answeringSeconds2: 28,
      answeringSeconds3: 39,
    };
    applyCommand(game, { command: "start", revision: game.revision }, 100);
    beginCountdownIfReady(game, new Set(game.players.map((p) => p.id)), 100);
    advanceTimer(game, 5100);
    advanceTimer(game, 25100);
    game.phaseEndsAt = null;
    await saveGame(bindings.DB, null, game, "hash");
    const restored = (await loadGame(bindings.DB, game.id))!;
    expect(restored.timing).toEqual(game.timing);
    expect(restored.phaseEndsAt).toBe(
      25100 + [17, 28, 39][difficulty - 1] * 1000,
    );
  },
);

it("難易度のない保存済み問題を標準の2として復元する", async () => {
  const game = fixture();
  game.rounds[0].question.difficulty = 3;
  await saveGame(bindings.DB, null, game, "hash");
  expect(
    (await loadGame(bindings.DB, game.id))?.rounds[0].question.difficulty,
  ).toBe(3);
  await bindings.DB.prepare(
    "UPDATE rounds SET question_json = json_remove(question_json, '$.difficulty') WHERE tournament_id = ?",
  )
    .bind(game.id)
    .run();
  expect(
    (await loadGame(bindings.DB, game.id))?.rounds[0].question.difficulty,
  ).toBe(2);
  const { token } = await sessionFixture({
    role: "admin",
  });
  const response = await exports.default.fetch(
    new Request(`http://test/api/e/${game.id}/questions`, {
      headers: { Cookie: `se_session=${token}` },
    }),
  );
  expect(response.status).toBe(200);
  const document = (await response.json()) as { questions: Question[] };
  expect(document.questions[0].difficulty).toBe(2);
});

it("詳細結果は終了後に管理者だけが取得でき、認証情報を返さない", async () => {
  const game = fixture();
  await saveGame(bindings.DB, null, game, "PRIVATE_DISPLAY_HASH");
  const url = `http://test/api/e/${game.id}/report`;
  const { token } = await sessionFixture({
    role: "admin",
  });
  const request = () =>
    exports.default.fetch(
      new Request(url, { headers: { Cookie: `se_session=${token}` } }),
    );
  expect((await request()).status).toBe(409);
  const finished = structuredClone(game);
  applyCommand(finished, { command: "start", revision: finished.revision }, 0);
  beginCountdownIfReady(
    finished,
    new Set(finished.players.map((p) => p.id)),
    0,
  );
  advanceTimer(finished, 5000);
  advanceTimer(finished, 25000);
  receiveAnswer(
    finished,
    finished.players[0].id,
    finished.rounds[0].id,
    "B",
    25382,
  );
  for (const command of ["close", "reveal", "ranking", "finish"] as const)
    applyCommand(finished, { command, revision: finished.revision }, 26000);
  await saveGame(bindings.DB, game, finished);
  expect((await exports.default.fetch(new Request(url))).status).toBe(401);
  for (const role of ["display", "player"] as const) {
    const session = await sessionFixture({
      role,
      eventId: game.id,
      playerId: game.players[0].id,
    });
    const response = await exports.default.fetch(
      new Request(url, {
        headers: {
          Cookie: `se_session=${session.token}`,
        },
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("body");
  }
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const report = await response.text();
  expect(report).not.toContain("test-hash");
  expect(report).not.toContain("PRIVATE_DISPLAY_HASH");
  expect(JSON.parse(report)).toMatchObject({
    id: game.id,
    name: game.name,
    summary: { scored: 1, unasked: 0, correct: 1, averageElapsed: 382 },
    rounds: [
      { answers: [{ choice: "B", status: "correct", elapsed: 382, rank: 1 }] },
    ],
  });
  expect((await loadGame(bindings.DB, game.id))?.phase).toBe("finished");
});

it("復習資料は全ての終了前フェーズで拒否し、終了後は誰でも同じ匿名集計を取得できる", async () => {
  let game = fixture();
  const first = game.rounds[0].question;
  game = newGame(
    game.id,
    game.name,
    [first, { ...first, id: crypto.randomUUID() }],
    0,
  );
  const player = {
    id: crypto.randomUUID(),
    name: "非公開の参加者名",
    joinedAt: 0,
  };
  addPlayer(game, player);
  const round = game.rounds[0];
  round.openedAt = 1000;
  round.closedAt = 5000;
  round.participants = { [player.id]: "eligible" };
  round.answers = { [player.id]: { choice: "B", receivedAt: 2000 } };
  await saveGame(bindings.DB, null, game, "PRIVATE_REVIEW_HASH");
  const url = `http://test/api/e/${game.id}/review`;
  const { token: adminToken } = await sessionFixture({ role: "admin" });
  const { token: playerToken } = await sessionFixture({
    role: "player",
    eventId: game.id,
    playerId: player.id,
  });
  for (const phase of [
    "waiting",
    "choicesPreparing",
    "countdown",
    "choicesReading",
    "acceptingAnswers",
    "answersClosed",
    "answerRevealed",
    "rankingShown",
    "questionVoided",
  ] as const) {
    const before = structuredClone(game);
    game.phase = phase;
    await saveGame(bindings.DB, before, game);
    for (const token of [null, adminToken, playerToken]) {
      const response = await exports.default.fetch(
        new Request(url, {
          headers: token ? { Cookie: `se_session=${token}` } : {},
        }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "大会終了後に復習資料を確認できます。",
      });
    }
  }
  const before = structuredClone(game);
  game.phase = "finished";
  await saveGame(bindings.DB, before, game);
  for (const token of [null, adminToken, playerToken]) {
    const response = await exports.default.fetch(
      new Request(url, {
        headers: token ? { Cookie: `se_session=${token}` } : {},
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const review = await response.text();
    expect(JSON.parse(review)).toEqual(tournamentReview(game));
    expect(review).not.toContain(player.id);
    expect(review).not.toContain(player.name);
    expect(review).not.toContain("PRIVATE_REVIEW_HASH");
    expect(review).not.toContain("receivedAt");
  }
  expect(
    (
      await exports.default.fetch(
        new Request("http://test/api/e/missing-review/review"),
      )
    ).status,
  ).toBe(404);
});

it("参加コードの衝突を再発行し、保存・再起動後も同じコードを保持する", async () => {
  const first = fixture();
  await saveGame(bindings.DB, null, first, "hash");
  const second = fixture();
  second.joinCode = first.joinCode;
  await saveGame(bindings.DB, null, second, "hash");
  expect(second.joinCode).not.toBe(first.joinCode);
  expect(await loadGame(bindings.DB, first.id)).toEqual(first);
  expect(await loadGame(bindings.DB, second.id)).toEqual(second);
  const head = await bindings.DB.prepare(
    "SELECT state_json FROM tournaments WHERE id = ?",
  )
    .bind(second.id)
    .first<{ state_json: string }>();
  expect(JSON.parse(head!.state_json)).not.toHaveProperty("joinCode");
});

it("コードのない既存大会を同時に開いても一つの固定コードを発行する", async () => {
  const game = fixture();
  await saveGame(bindings.DB, null, game, "hash");
  await bindings.DB.prepare(
    "UPDATE tournaments SET join_code = NULL WHERE id = ?",
  )
    .bind(game.id)
    .run();
  const games = await Promise.all([
    loadGame(bindings.DB, game.id),
    loadGame(bindings.DB, game.id),
  ]);
  expect(games[0]!.joinCode).toMatch(/^[A-HJKMNP-Z]{6}$/);
  expect(games[1]).toEqual(games[0]);
  expect(await loadGame(bindings.DB, game.id)).toEqual(games[0]);
  expect(games[0]).toEqual({ ...game, joinCode: games[0]!.joinCode });
});

it("旧お休み記録の移行で回答を維持し、回答なしを通常の未回答と分母に含める", async () => {
  const game = fixture();
  const player = game.players[0];
  const answered = {
    id: crypto.randomUUID(),
    name: "回答済み",
    joinedAt: player.joinedAt + 1,
  };
  addPlayer(game, answered);
  game.phase = "finished";
  game.currentIndex = 0;
  const round = game.rounds[0];
  round.openedAt = 100;
  round.closedAt = 200;
  round.participants[player.id] = "eligible";
  round.participants[answered.id] = "eligible";
  round.answers[answered.id] = { choice: "B", receivedAt: 150 };
  await saveGame(bindings.DB, null, game, "hash");
  await bindings.DB.prepare(
    "UPDATE participations SET status = 'resting' WHERE tournament_id = ? AND player_id = ?",
  )
    .bind(game.id, player.id)
    .run();
  await bindings.DB.prepare(readyWaitMigration).run();
  await bindings.DB.prepare(readyWaitMigration).run();
  const restored = (await loadGame(bindings.DB, game.id))!;
  expect(restored.rounds[0].participants[player.id]).toBe("eligible");
  expect(restored.players).toEqual(game.players);
  expect(restored.rounds[0].answers).toEqual(round.answers);
  expect(tournamentReport(restored).players[0]).toMatchObject({
    eligible: 1,
    unanswered: 1,
    correctRate: 0,
  });
  expect(tournamentReport(restored).rounds[0]).not.toHaveProperty("resting");
});
it("待ち合わせ免除をD1から復元し、次問でも維持する", async () => {
  const game = fixture();
  const playerId = game.players[0].id;
  applyCommand(
    game,
    {
      command: "setReadyWait",
      revision: game.revision,
      playerId,
      waitForReady: false,
    },
    0,
  );
  await saveGame(bindings.DB, null, game, "hash");
  const restored = (await loadGame(bindings.DB, game.id))!;
  expect(restored.readyExemptPlayerIds).toEqual([playerId]);
  applyCommand(restored, { command: "start", revision: restored.revision }, 1);
  expect(beginCountdownIfReady(restored, new Set(), 2)).toBe(true);
  expect(restored.rounds[0].participants[playerId]).toBe("eligible");
  await saveGame(bindings.DB, game, restored);
  const loaded = (await loadGame(bindings.DB, game.id))!;
  expect(loaded.rounds[0].readyWaitPlayerIds).toEqual([]);
  expect(loaded.readyExemptPlayerIds).toEqual([playerId]);
});

it("参加コードから認証なしで参加URLだけを取得でき、終了・不明・不正コードを区別する", async () => {
  const game = fixture();
  await saveGame(bindings.DB, null, game, "secret");
  const lookup = (code: string) =>
    exports.default.fetch(
      new Request(`http://test/api/join-code?code=${encodeURIComponent(code)}`),
    );
  const response = await lookup(
    `${game.joinCode.slice(0, 3)} ${game.joinCode.slice(3)}`.toLowerCase(),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    id: game.id,
    name: game.name,
    playUrl: `http://test/e/${game.id}/play`,
  });
  expect((await lookup("123456")).status).toBe(400);
  // 有効な形式だが存在しないコードを確実に使う。
  let unknown = "AAAAAA";
  while (
    await bindings.DB.prepare("SELECT id FROM tournaments WHERE join_code = ?")
      .bind(unknown)
      .first()
  )
    unknown = fixture().joinCode;
  expect((await lookup(unknown)).status).toBe(404);
  const finished = structuredClone(game);
  finished.phase = "finished";
  await saveGame(bindings.DB, game, finished);
  expect((await lookup(game.joinCode)).status).toBe(410);
  const metadata = await exports.default.fetch(
    new Request(`http://test/api/e/${game.id}`),
  );
  expect(await metadata.json()).toMatchObject({
    finished: true,
    joinCode: game.joinCode,
  });
  expect(
    (
      await exports.default.fetch(
        new Request(`http://test/api/e/${game.id}/session?role=control`),
      )
    ).status,
  ).toBe(401);
});

async function sessionFixture(values: {
  role: "admin" | "display" | "player";
  eventId?: string;
  playerId?: string;
}) {
  const issued = await createSession(bindings.DB);
  if (values.role === "admin")
    await bindings.DB.prepare("UPDATE clients SET is_admin = 1 WHERE id = ?")
      .bind(issued.session.clientId)
      .run();
  if (values.role === "display")
    await bindings.DB.prepare(
      "INSERT INTO client_displays (client_id,tournament_id) VALUES (?,?)",
    )
      .bind(issued.session.clientId, values.eventId)
      .run();
  if (
    values.role === "player" &&
    values.playerId &&
    (await bindings.DB.prepare("SELECT id FROM players WHERE id = ?")
      .bind(values.playerId)
      .first())
  ) {
    await bindings.DB.prepare(
      "INSERT INTO client_players (client_id,tournament_id,player_id) VALUES (?,?,?)",
    )
      .bind(issued.session.clientId, values.eventId, values.playerId)
      .run();
  }
  return issued;
}
async function participantFixture() {
  const game = fixture();
  await saveGame(bindings.DB, null, game, "hash");
  const issued = await sessionFixture({
    role: "player",
    eventId: game.id,
    playerId: game.players[0].id,
  });
  return { game, ...issued, cookie: `se_session=${issued.token}` };
}

it("個人成績は本人だけが開け、明示的に発行したURLはその人の結果だけを公開する", async () => {
  const game = fixture();
  const other = {
    id: crypto.randomUUID(),
    name: "非公開の参加者",
    joinedAt: Date.now(),
  };
  addPlayer(game, other);
  game.phase = "finished";
  await saveGame(bindings.DB, null, game, "hash");
  const owner = await sessionFixture({
    role: "player",
    eventId: game.id,
    playerId: game.players[0].id,
  });
  const outsider = await sessionFixture({
    role: "player",
    eventId: game.id,
    playerId: other.id,
  });
  const admin = await sessionFixture({ role: "admin" });
  const path = `/api/e/${game.id}/result/${game.players[0].id}`;
  const request = (
    suffix = "",
    token = "",
    method = "GET",
    origin = "http://test",
  ) =>
    exports.default.fetch(
      new Request(`http://test${path}${suffix}`, {
        method,
        headers: { Cookie: `se_session=${token}`, Origin: origin },
      }),
    );
  for (const token of ["", outsider.token, admin.token]) {
    expect((await request("", token)).status).toBe(401);
    expect((await request("/share", token, "POST")).status).toBe(401);
    expect((await request("/share/stop", token, "POST")).status).toBe(401);
  }
  const initial = await request("", owner.token);
  expect(initial.status).toBe(200);
  expect(await initial.json()).toEqual({
    result: personalResult(game, game.players[0].id),
    owner: true,
    shareUrl: null,
  });
  expect((await request("?share=" + "0".repeat(64))).status).toBe(404);
  expect(
    (await request("/share", owner.token, "POST", "https://evil.example"))
      .status,
  ).toBe(403);
  const issued = await Promise.all([
    request("/share", owner.token, "POST"),
    request("/share", owner.token, "POST"),
  ]);
  const [one, two] = await Promise.all(
    issued.map((r) => r.json() as Promise<{ shareUrl: string }>),
  );
  expect(one.shareUrl).toBe(two.shareUrl);
  const url = new URL(one.shareUrl);
  expect(url.origin).toBe("http://test");
  expect(url.searchParams.get("share")).toMatch(/^[0-9a-f]{64}$/);
  const publicResponse = await request(url.search);
  expect(publicResponse.status).toBe(200);
  expect(publicResponse.headers.get("Cache-Control")).toBe("no-store");
  const shared = await publicResponse.json();
  expect(shared).toEqual({
    result: personalResult(game, game.players[0].id),
    owner: false,
    shareUrl: null,
  });
  expect(JSON.stringify(shared)).not.toContain(other.name);
  expect(JSON.stringify(shared)).not.toContain(other.id);
  expect(JSON.stringify(shared)).not.toContain(url.searchParams.get("share")!);
  expect(await (await request(url.search, owner.token)).json()).toEqual(shared);
  expect((await request(`/share${url.search}`, "", "POST")).status).toBe(403);
  expect(
    (await request(`/share/stop${url.search}`, outsider.token, "POST")).status,
  ).toBe(403);
  expect((await request(`${url.search}&share=another`)).status).toBe(404);
  const otherPage = await exports.default.fetch(
    new Request(`http://test/api/e/${game.id}/result/${other.id}${url.search}`),
  );
  expect(otherPage.status).toBe(404);
  const secondGame = fixture();
  secondGame.phase = "finished";
  await saveGame(bindings.DB, null, secondGame, "hash");
  expect(
    (
      await exports.default.fetch(
        new Request(
          `http://test/api/e/${secondGame.id}/result/${game.players[0].id}${url.search}`,
        ),
      )
    ).status,
  ).toBe(404);
  const restored = await request("", owner.token);
  expect(await restored.json()).toMatchObject({ shareUrl: one.shareUrl });
  await request("/share/stop", owner.token, "POST");
  expect((await request(url.search)).status).toBe(404);
  expect((await request(url.search, owner.token)).status).toBe(404);
  expect((await request("", owner.token)).status).toBe(200);
  const reissued = (await (
    await request("/share", owner.token, "POST")
  ).json()) as { shareUrl: string };
  expect(reissued.shareUrl).not.toBe(one.shareUrl);
  expect((await request(url.search)).status).toBe(404);
  await bindings.DB.prepare(
    "UPDATE client_sessions SET expires_at = 0 WHERE client_id = ?",
  )
    .bind(owner.session.clientId)
    .run();
  expect((await request("", owner.token)).status).toBe(401);
  expect((await request("/share", owner.token, "POST")).status).toBe(401);
  expect((await request(new URL(reissued.shareUrl).search)).status).toBe(200);
});

it("大会終了前は本人も成績を取得・共有できず、既存参加者の共有は初期状態で無効", async () => {
  const game = fixture();
  await saveGame(bindings.DB, null, game, "hash");
  const owner = await sessionFixture({
    role: "player",
    eventId: game.id,
    playerId: game.players[0].id,
  });
  const url = `http://test/api/e/${game.id}/result/${game.players[0].id}`;
  for (const [suffix, method] of [
    ["", "GET"],
    ["/share", "POST"],
    ["/share/stop", "POST"],
  ]) {
    expect(
      (
        await exports.default.fetch(
          new Request(url + suffix, {
            method,
            headers: {
              Cookie: `se_session=${owner.token}`,
              Origin: "http://test",
            },
          }),
        )
      ).status,
    ).toBe(409);
  }
  const row = await bindings.DB.prepare(
    "SELECT result_share_token FROM players WHERE tournament_id = ? AND id = ?",
  )
    .bind(legacyGame.id, legacyGame.players[0].id)
    .first();
  expect(row).toEqual({ result_share_token: null });
});
function request(path: string, cookie = "", data?: unknown) {
  return exports.default.fetch(
    new Request(`http://test${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: "http://test",
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }),
  );
}
function joinRequest(id: string, cookie: string, name = "再参加") {
  return request(`/api/e/${id}/join`, cookie, { name });
}
it("共通Cookie一つで大会ごとに別名で参加し、元の名前・参加者IDへ復帰する", async () => {
  const a = await participantFixture();
  const b = fixture();
  await saveGame(bindings.DB, null, b, "hash");
  expect(
    (await request(`/api/e/${b.id}/session?role=player`, a.cookie)).status,
  ).toBe(401);
  const joined = await joinRequest(b.id, a.cookie, "大会Bの名前");
  expect(joined.status).toBe(201);
  expect(joined.headers.get("Set-Cookie")).toBeNull();
  const { playerId } = (await joined.json()) as { playerId: string };
  expect(playerId).not.toBe(a.game.players[0].id);
  for (const [id, expected] of [
    [a.game.id, a.game.players[0].id],
    [b.id, playerId],
  ]) {
    const response = await joinRequest(id, a.cookie, "上書きしない");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ playerId: expected });
  }
  expect((await loadGame(bindings.DB, a.game.id))!.players).toEqual(
    a.game.players,
  );
  expect((await loadGame(bindings.DB, b.id))!.players[1].name).toBe(
    "大会Bの名前",
  );
});
it("同一クライアントから同時参加しても参加者は一人で、DO再生成後も同じ参加者を使う", async () => {
  const game = fixture();
  await saveGame(bindings.DB, null, game, "hash");
  const issued = await createSession(bindings.DB);
  const cookie = `se_session=${issued.token}`;
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      joinRequest(game.id, cookie, `名前${i}`),
    ),
  );
  const ids = await Promise.all(
    responses.map(async (r) => {
      expect([200, 201]).toContain(r.status);
      return ((await r.json()) as { playerId: string }).playerId;
    }),
  );
  expect(new Set(ids).size).toBe(1);
  expect((await loadGame(bindings.DB, game.id))!.players).toHaveLength(2);
  await expect(
    bindings.DB.prepare(
      "INSERT INTO client_players (client_id,tournament_id,player_id) VALUES (?,?,?)",
    )
      .bind(issued.session.clientId, game.id, game.players[0].id)
      .run(),
  ).rejects.toThrow();
  await evictDurableObject(
    bindings.ROOMS.get(bindings.ROOMS.idFromName(game.id)),
  );
  expect(await (await joinRequest(game.id, cookie)).json()).toMatchObject({
    playerId: ids[0],
  });
});
it("管理者・DisplayログインでCookieと参加者の紐づけを維持し、大会別権限を分離する", async () => {
  const a = await participantFixture();
  const b = fixture();
  await saveGame(bindings.DB, null, b, "hash");
  const { hashPassword } = await import("../src/worker/auth");
  await bindings.DB.prepare(
    "UPDATE tournaments SET display_password_hash = ? WHERE id = ?",
  )
    .bind(await hashPassword("display-test"), a.game.id)
    .run();
  const display = await request(`/api/e/${a.game.id}/display/login`, a.cookie, {
    password: "display-test",
  });
  expect(display.status).toBe(200);
  expect(display.headers.get("Set-Cookie")).toBeNull();
  expect(
    (await request(`/api/e/${a.game.id}/session?role=display`, a.cookie))
      .status,
  ).toBe(200);
  expect(
    (await request(`/api/e/${b.id}/session?role=display`, a.cookie)).status,
  ).toBe(401);
  expect((await request("/api/events", a.cookie)).status).toBe(401);
  const admin = await request("/api/admin/login", a.cookie, {
    password: "test-admin",
  });
  expect(admin.status).toBe(200);
  expect(admin.headers.get("Set-Cookie")).toBeNull();
  expect((await request("/api/events", a.cookie)).status).toBe(200);
  expect(
    (await request(`/api/e/${b.id}/session?role=control`, a.cookie)).status,
  ).toBe(200);
  expect(
    (await request(`/api/e/${b.id}/session?role=display`, a.cookie)).status,
  ).toBe(401);
  expect(await (await joinRequest(a.game.id, a.cookie)).json()).toMatchObject({
    playerId: a.game.players[0].id,
  });
  expect((await loadGame(bindings.DB, a.game.id))!.players).toEqual(
    a.game.players,
  );
});
it("Cookieはランダムなトークンだけを持ち、DBのハッシュ・期限・失効を検証する", async () => {
  const a = await participantFixture();
  expect(a.token).toMatch(/^[0-9a-f]{64}$/);
  const row = await bindings.DB.prepare(
    "SELECT * FROM client_sessions WHERE client_id = ?",
  )
    .bind(a.session.clientId)
    .first();
  expect(row!.token_hash).toBe(await digest(a.token));
  expect(JSON.stringify(row)).not.toContain(a.token);
  const read = (cookie: string) =>
    readSession(
      new Request("http://test", { headers: { Cookie: cookie } }),
      bindings.DB,
    );
  expect(await read(a.cookie)).toMatchObject({ clientId: a.session.clientId });
  expect(
    await read(
      `se_session=${a.token.slice(0, -1)}${a.token.endsWith("0") ? "1" : "0"}`,
    ),
  ).toBeNull();
  expect(await read("se_session=invalid")).toBeNull();
  await bindings.DB.prepare(
    "UPDATE client_sessions SET expires_at = ? WHERE client_id = ?",
  )
    .bind(Date.now() - 1, a.session.clientId)
    .run();
  expect(await read(a.cookie)).toBeNull();
  expect(
    (await request(`/api/e/${a.game.id}/session?role=player`, a.cookie)).status,
  ).toBe(401);
  await bindings.DB.prepare(
    "UPDATE client_sessions SET expires_at = ? WHERE client_id = ?",
  )
    .bind(Date.now() + 10000, a.session.clientId)
    .run();
  await bindings.DB.prepare("DELETE FROM client_sessions WHERE client_id = ?")
    .bind(a.session.clientId)
    .run();
  expect(await read(a.cookie)).toBeNull();
});
it("旧CookieやDBに存在しないトークンは引き継がず再登録し、過去参加者を残す", async () => {
  const a = await participantFixture();
  for (const cookie of [
    `se_player_${a.game.id}=old; se_admin=old; se_display_${a.game.id}=old`,
    `se_session=${"0".repeat(64)}`,
  ]) {
    expect(
      (await request(`/api/e/${a.game.id}/session?role=player`, cookie)).status,
    ).toBe(401);
    const response = await joinRequest(a.game.id, cookie);
    expect(response.status).toBe(201);
    expect(response.headers.get("Set-Cookie")).toContain("se_session=");
    const { playerId } = (await response.json()) as { playerId: string };
    expect(playerId).not.toBe(a.game.players[0].id);
    const newCookie = response.headers.get("Set-Cookie")!.split(";")[0];
    expect(
      (await request(`/api/e/${a.game.id}/session?role=player`, newCookie))
        .status,
    ).toBe(200);
  }
  expect((await loadGame(bindings.DB, a.game.id))!.players).toHaveLength(3);
});
it("終了した大会のコードは共通セッションにその大会の参加情報がある場合だけ利用できる", async () => {
  const a = await participantFixture();
  const b = await participantFixture();
  const finished = structuredClone(a.game);
  finished.phase = "finished";
  await saveGame(bindings.DB, a.game, finished);
  const path = `/api/join-code?code=${a.game.joinCode}`;
  expect((await request(path)).status).toBe(410);
  expect((await request(path, b.cookie)).status).toBe(410);
  expect((await request(path, a.cookie)).status).toBe(200);
  expect((await joinRequest(a.game.id, a.cookie)).status).toBe(200);
  expect((await joinRequest(a.game.id, b.cookie)).ok).toBe(false);
  expect((await loadGame(bindings.DB, a.game.id))!.players).toHaveLength(1);
});

it("旧スキーマの大会・参加者・参加資格・回答は認証移行後も保持し、新クライアントへ自動で紐づけない", async () => {
  const restored = (await loadGame(bindings.DB, legacyGame.id))!;
  expect(restored).toEqual(legacyGame);
  expect(tournamentReport(restored)).toEqual(tournamentReport(legacyGame));
  expect(
    await bindings.DB.prepare(
      "SELECT * FROM client_players WHERE tournament_id = ?",
    )
      .bind(legacyGame.id)
      .all(),
  ).toMatchObject({ results: [] });
  const { results } = await bindings.DB.prepare(
    "PRAGMA table_info(players)",
  ).all<{ name: string }>();
  expect(results.map((row) => row.name)).not.toContain("session_hash");
});
it("参加者への紐づけの保存失敗では参加者を作らず、再試行できる", async () => {
  const game = fixture();
  await saveGame(bindings.DB, null, game, "hash");
  const issued = await createSession(bindings.DB);
  const cookie = `se_session=${issued.token}`;
  await bindings.DB.exec(
    "CREATE TRIGGER fail_registration BEFORE INSERT ON client_players BEGIN SELECT RAISE(ABORT, 'injected registration failure'); END;",
  );
  try {
    const response = await joinRequest(game.id, cookie);
    expect(response.status).toBe(503);
    expect(await loadGame(bindings.DB, game.id)).toEqual(game);
    expect(
      await bindings.DB.prepare(
        "SELECT * FROM client_players WHERE client_id = ?",
      )
        .bind(issued.session.clientId)
        .first(),
    ).toBeNull();
  } finally {
    await bindings.DB.exec("DROP TRIGGER fail_registration;");
  }
  const response = await joinRequest(game.id, cookie);
  expect(response.status).toBe(201);
  expect((await loadGame(bindings.DB, game.id))!.players).toHaveLength(2);
  expect(
    (await request(`/api/e/${game.id}/session?role=player`, cookie)).status,
  ).toBe(200);
});
it("セッション発行の保存失敗でクライアントだけ残さない", async () => {
  const before = await bindings.DB.prepare(
    "SELECT COUNT(*) AS n FROM clients",
  ).first();
  await bindings.DB.exec(
    "CREATE TRIGGER fail_session BEFORE INSERT ON client_sessions BEGIN SELECT RAISE(ABORT, 'injected session failure'); END;",
  );
  try {
    await expect(createSession(bindings.DB)).rejects.toThrow();
    expect(
      await bindings.DB.prepare("SELECT COUNT(*) AS n FROM clients").first(),
    ).toEqual(before);
  } finally {
    await bindings.DB.exec("DROP TRIGGER fail_session;");
  }
});
async function connectTestSocket(
  eventId: string,
  cookie: string,
  role: string,
) {
  const response = await exports.default.fetch(
    new Request(`http://test/api/e/${eventId}/ws?role=${role}`, {
      headers: { Origin: "http://test", Cookie: cookie, Upgrade: "websocket" },
    }),
  );
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  const state = new Promise<void>((resolve) =>
    ws.addEventListener("message", () => resolve(), { once: true }),
  );
  ws.accept();
  await state;
  return ws;
}
it.each(["session", "admin", "display", "player", "expiry"] as const)(
  "接続中の%s失効をalarmで検出し、対象WebSocketを閉じて再接続を拒否する",
  async (kind) => {
    const a = await participantFixture();
    const role =
      kind === "admin" ? "control" : kind === "display" ? "display" : "player";
    if (kind === "admin")
      await bindings.DB.prepare("UPDATE clients SET is_admin = 1 WHERE id = ?")
        .bind(a.session.clientId)
        .run();
    if (kind === "display")
      await bindings.DB.prepare(
        "INSERT INTO client_displays (client_id,tournament_id) VALUES (?,?)",
      )
        .bind(a.session.clientId, a.game.id)
        .run();
    const ws = await connectTestSocket(a.game.id, a.cookie, role);
    const closed = new Promise<number>((resolve) =>
      ws.addEventListener("close", (event) => resolve(event.code), {
        once: true,
      }),
    );
    const stub = bindings.ROOMS.get(bindings.ROOMS.idFromName(a.game.id));
    if (kind === "session")
      await bindings.DB.prepare(
        "DELETE FROM client_sessions WHERE client_id = ?",
      )
        .bind(a.session.clientId)
        .run();
    if (kind === "expiry")
      await bindings.DB.prepare(
        "UPDATE client_sessions SET expires_at = ? WHERE client_id = ?",
      )
        .bind(Date.now() - 1, a.session.clientId)
        .run();
    if (kind === "admin")
      await bindings.DB.prepare("UPDATE clients SET is_admin = 0 WHERE id = ?")
        .bind(a.session.clientId)
        .run();
    if (kind === "display")
      await bindings.DB.prepare(
        "DELETE FROM client_displays WHERE client_id = ?",
      )
        .bind(a.session.clientId)
        .run();
    if (kind === "player")
      await bindings.DB.prepare(
        "DELETE FROM client_players WHERE client_id = ?",
      )
        .bind(a.session.clientId)
        .run();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await closed).toBe(4001);
    expect(
      (await request(`/api/e/${a.game.id}/session?role=${role}`, a.cookie))
        .status,
    ).toBe(401);
    const reconnect = await exports.default.fetch(
      new Request(`http://test/api/e/${a.game.id}/ws?role=${role}`, {
        headers: {
          Origin: "http://test",
          Cookie: a.cookie,
          Upgrade: "websocket",
        },
      }),
    );
    expect(reconnect.status).toBe(401);
    // 管理者・Display権限だけを削除しても参加情報は失わない。
    if (kind === "admin" || kind === "display")
      expect(
        (await request(`/api/e/${a.game.id}/session?role=player`, a.cookie))
          .status,
      ).toBe(200);
  },
);
it("pingで失効確認を先送りせず、接続中の期限切れではメッセージを処理しない", async () => {
  const a = await participantFixture();
  const expires = a.session.expires;
  const ws = await connectTestSocket(a.game.id, a.cookie, "player");
  const stub = bindings.ROOMS.get(bindings.ROOMS.idFromName(a.game.id));
  const initialAlarm = await runInDurableObject(stub, (_, state) =>
    state.storage.getAlarm(),
  );
  expect(initialAlarm).toBeLessThanOrEqual(Date.now() + 15000);
  const now = Date.now();
  const time = vi.spyOn(Date, "now").mockReturnValue(now + 1000);
  try {
    const reply = new Promise<void>((resolve) =>
      ws.addEventListener("message", () => resolve(), { once: true }),
    );
    ws.send(JSON.stringify({ type: "ping" }));
    await reply;
    expect(
      await runInDurableObject(stub, (_, state) => state.storage.getAlarm()),
    ).toBe(initialAlarm);
    time.mockReturnValue(expires + 1);
    const closed = new Promise<number>((resolve) =>
      ws.addEventListener("close", (event) => resolve(event.code), {
        once: true,
      }),
    );
    ws.send(JSON.stringify({ type: "ping" }));
    expect(await closed).toBe(4001);
  } finally {
    time.mockRestore();
    ws.close();
  }
});

const debugOrigin = "http://192.168.1.2:5218";
function debugRequest(
  path: string,
  cookie = "",
  data?: unknown,
  overrides: Partial<Env> = {},
) {
  return worker.fetch(
    new Request(`${debugOrigin}${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, Origin: debugOrigin },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }),
    {
      ...bindings,
      PUBLIC_ORIGIN: debugOrigin,
      DEBUG_MODE: "true",
      ...overrides,
    },
  );
}
async function debugFixture() {
  const game = fixture();
  game.phase = "finished";
  await saveGame(bindings.DB, null, game, "hash");
  const owner = await sessionFixture({
    role: "player",
    eventId: game.id,
    playerId: game.players[0].id,
  });
  // 実端末が管理者・共有画面・他大会の権限も持つ状況でも転送しない。
  await bindings.DB.prepare("UPDATE clients SET is_admin = 1 WHERE id = ?")
    .bind(owner.session.clientId)
    .run();
  await bindings.DB.prepare(
    "INSERT INTO client_displays (client_id,tournament_id) VALUES (?,?)",
  )
    .bind(owner.session.clientId, game.id)
    .run();
  const other = fixture();
  other.phase = "finished";
  await saveGame(bindings.DB, null, other, "hash");
  await bindings.DB.prepare(
    "INSERT INTO client_players (client_id,tournament_id,player_id) VALUES (?,?,?)",
  )
    .bind(owner.session.clientId, other.id, other.players[0].id)
    .run();
  const admin = await sessionFixture({ role: "admin" });
  const adminCookie = `se_session=${admin.token}`;
  const issue = () =>
    debugRequest("/api/debug/session/tickets", adminCookie, {
      eventId: game.id,
      playerId: game.players[0].id,
    });
  return { game, other, owner, admin, adminCookie, issue };
}
async function ticketOf(response: Response) {
  expect(response.status).toBe(201);
  const data = await response.json<{ handoffUrl: string; expiresAt: number }>();
  const url = new URL(data.handoffUrl);
  expect(url.origin).toBe(debugOrigin);
  expect(url.search).toBe("");
  expect(data.expiresAt - Date.now()).toBeGreaterThan(290000);
  return url.hash.slice(1);
}
const debugCookie = (response: Response, name = "se_session") => {
  const value = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`));
  expect(value).toBeDefined();
  return value!.split(";")[0];
};

it("参加者確認の一覧・発行・消費は設定と公開ホストで拒否し、一覧・発行には管理者認証も必要", async () => {
  const f = await debugFixture();
  const paths = [
    "/api/debug/session/players?event=" + f.game.id,
    "/api/debug/session/tickets",
    "/api/debug/session/redeem",
  ];
  for (const overrides of [
    { DEBUG_MODE: undefined },
    { DEBUG_MODE: "false" },
    { PUBLIC_ORIGIN: "https://public.example" },
  ]) {
    for (const path of paths) {
      const response = await worker.fetch(
        new Request(`http://localhost${path}`, {
          method: path.includes("players?") ? "GET" : "POST",
          headers: {
            Origin: overrides.PUBLIC_ORIGIN ?? debugOrigin,
            Cookie: f.adminCookie,
            Host: "localhost",
            "X-Forwarded-Host": "127.0.0.1",
          },
          ...(path.includes("players?") ? {} : { body: "{}" }),
        }),
        {
          ...bindings,
          PUBLIC_ORIGIN: debugOrigin,
          DEBUG_MODE: "true",
          ...overrides,
        },
      );
      expect(response.status).toBe(404);
    }
  }
  for (const cookie of [
    "",
    `se_session=${(await createSession(bindings.DB)).token}`,
  ]) {
    expect((await debugRequest(paths[0], cookie)).status).toBe(401);
    expect(
      (
        await debugRequest(paths[1], cookie, {
          eventId: f.game.id,
          playerId: f.game.players[0].id,
        })
      ).status,
    ).toBe(401);
  }
  const list = await debugRequest(paths[0], f.adminCookie);
  expect(await list.json()).toMatchObject({
    players: [{ id: f.game.players[0].id, name: f.game.players[0].name }],
  });
  expect(
    (
      await debugRequest(paths[1], f.adminCookie, {
        eventId: f.other.id,
        playerId: f.game.players[0].id,
      })
    ).status,
  ).toBe(404);
  const crossOrigin = await worker.fetch(
    new Request(debugOrigin + paths[1], {
      method: "POST",
      headers: { Origin: "http://evil.example", Cookie: f.adminCookie },
      body: "{}",
    }),
    { ...bindings, PUBLIC_ORIGIN: debugOrigin, DEBUG_MODE: "true" },
  );
  expect(crossOrigin.status).toBe(403);
});

it("確認セッションは参加者本人の権限だけを持ち、元クライアントの権限や紐づけは変更しない", async () => {
  const f = await debugFixture();
  const ticket = await ticketOf(await f.issue());
  // GETは消費しない。
  expect((await debugRequest("/api/debug/session/redeem")).status).toBe(401);
  const response = await debugRequest("/api/debug/session/redeem", "", {
    ticket,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const cookie = debugCookie(response);
  expect(response.headers.getSetCookie()[0]).toContain("Max-Age=3600");
  expect(response.headers.getSetCookie()[0]).toContain(
    "HttpOnly; SameSite=Strict",
  );
  const session = await readSession(
    new Request(debugOrigin, { headers: { Cookie: cookie } }),
    bindings.DB,
    true,
  );
  expect(session).toMatchObject({
    isAdmin: false,
    debugPlayer: { eventId: f.game.id, playerId: f.game.players[0].id },
  });
  expect(session!.clientId).not.toBe(f.owner.session.clientId);
  const auth = (
    await readAuthorizations(bindings.DB, f.game.id, [session!.tokenHash], true)
  ).get(session!.tokenHash);
  expect(auth).toMatchObject({
    playerId: f.game.players[0].id,
    isAdmin: false,
    canDisplay: false,
  });
  expect(
    (
      await readAuthorizations(
        bindings.DB,
        f.other.id,
        [session!.tokenHash],
        true,
      )
    ).get(session!.tokenHash)?.playerId,
  ).toBeNull();
  expect(
    (await debugRequest(`/api/e/${f.other.id}/session?role=player`, cookie))
      .status,
  ).toBe(401);
  for (const role of ["control", "display"])
    expect(
      (await debugRequest(`/api/e/${f.game.id}/session?role=${role}`, cookie))
        .status,
    ).toBe(401);
  expect((await debugRequest("/api/events", cookie)).status).toBe(401);
  expect(
    (await debugRequest("/api/admin/login", cookie, { password: "test-admin" }))
      .status,
  ).toBe(403);
  expect(
    (
      await debugRequest(`/api/e/${f.game.id}/display/login`, cookie, {
        password: "test",
      })
    ).status,
  ).toBe(403);
  expect(
    (await debugRequest(`/api/e/${f.other.id}/join`, cookie, { name: "追加" }))
      .status,
  ).toBe(403);
  const resultPath = `/api/e/${f.game.id}/result/${f.game.players[0].id}`;
  expect(await (await debugRequest(resultPath, cookie)).json()).toMatchObject({
    owner: true,
  });
  const share = await debugRequest(resultPath + "/share", cookie, {});
  expect(share.status).toBe(200);
  expect(await share.json()).toMatchObject({
    shareUrl: expect.stringContaining("?share="),
  });
  expect(
    (await debugRequest(resultPath + "/share/stop", cookie, {})).status,
  ).toBe(200);
  expect(
    (
      await debugRequest(
        `/api/e/${f.other.id}/result/${f.other.players[0].id}`,
        cookie,
      )
    ).status,
  ).toBe(401);
  const original = (
    await readAuthorizations(bindings.DB, f.game.id, [
      f.owner.session.tokenHash,
    ])
  ).get(f.owner.session.tokenHash);
  expect(original).toMatchObject({
    isAdmin: true,
    canDisplay: true,
    playerId: f.game.players[0].id,
  });
  expect(
    (
      await debugRequest("/api/debug/session/redeem", cookie, {
        ticket: await ticketOf(await f.issue()),
      })
    ).status,
  ).toBe(409);
  // WebSocketと既存セッションAPIでも同じスコープを適用する。
  const stub = bindings.ROOMS.get(bindings.ROOMS.idFromName(f.game.id));
  await runInDurableObject(stub, (instance) => {
    Object.assign(instance, {
      env: { ...bindings, PUBLIC_ORIGIN: debugOrigin, DEBUG_MODE: "true" },
    });
  });
  expect(
    (await debugRequest(`/api/e/${f.game.id}/session?role=player`, cookie))
      .status,
  ).toBe(200);
  const ws = await worker.fetch(
    new Request(`${debugOrigin}/api/e/${f.game.id}/ws?role=player`, {
      headers: { Cookie: cookie, Origin: debugOrigin, Upgrade: "websocket" },
    }),
    { ...bindings, PUBLIC_ORIGIN: debugOrigin, DEBUG_MODE: "true" },
  );
  expect(ws.status).toBe(101);
  ws.webSocket!.accept();
  // 発行元の管理者権限剥奪は接続中の認証検査にも反映される。
  await bindings.DB.prepare("UPDATE clients SET is_admin = 0 WHERE id = ?")
    .bind(f.admin.session.clientId)
    .run();
  const closed = new Promise<number>((resolve) =>
    ws.webSocket!.addEventListener("close", (event) => resolve(event.code)),
  );
  await runDurableObjectAlarm(stub);
  expect(await closed).toBe(4001);
  expect((await debugRequest(resultPath, cookie)).status).toBe(401);
});

it("短期URLは一度だけ原子的に消費し、失効・発行元の失効・無効化を拒否する", async () => {
  const f = await debugFixture();
  const ticket = await ticketOf(await f.issue());
  const replies = await Promise.all([
    debugRequest("/api/debug/session/redeem", "", { ticket }),
    debugRequest("/api/debug/session/redeem", "", { ticket }),
  ]);
  expect(replies.map((r) => r.status).sort()).toEqual([200, 410]);
  const cookie = debugCookie(replies.find((r) => r.status === 200)!);
  const hash = await digest(cookie.split("=")[1]);
  expect(
    (await readAuthorizations(bindings.DB, f.game.id, [hash], false)).size,
  ).toBe(0);
  expect(
    (
      await debugRequest(
        `/api/e/${f.game.id}/result/${f.game.players[0].id}`,
        cookie,
        undefined,
        { DEBUG_MODE: "false" },
      )
    ).status,
  ).toBe(401);
  await bindings.DB.prepare(
    "UPDATE client_sessions SET expires_at = 0 WHERE token_hash = ?",
  )
    .bind(hash)
    .run();
  expect(
    await readSession(
      new Request(debugOrigin, { headers: { Cookie: cookie } }),
      bindings.DB,
      true,
    ),
  ).toBeNull();
  const expired = await ticketOf(await f.issue());
  await bindings.DB.prepare(
    "UPDATE debug_session_tickets SET expires_at = 0 WHERE token_hash = ?",
  )
    .bind(await digest(expired))
    .run();
  expect(
    (await debugRequest("/api/debug/session/redeem", "", { ticket: expired }))
      .status,
  ).toBe(410);
  for (const operation of ["expire", "delete"] as const) {
    const source = await debugFixture();
    const value = await ticketOf(await source.issue());
    if (operation === "expire")
      await bindings.DB.prepare(
        "UPDATE client_sessions SET expires_at = 0 WHERE token_hash = ?",
      )
        .bind(source.admin.session.tokenHash)
        .run();
    else
      await bindings.DB.prepare(
        "DELETE FROM client_sessions WHERE token_hash = ?",
      )
        .bind(source.admin.session.tokenHash)
        .run();
    expect(
      (await debugRequest("/api/debug/session/redeem", "", { ticket: value }))
        .status,
    ).toBe(410);
  }
});

it("同じブラウザのセッションをHttpOnly Cookieに退避し、機能無効化後も期限を延ばさず復帰できる", async () => {
  const f = await debugFixture();
  const response = await debugRequest(
    "/api/debug/session/redeem",
    f.adminCookie,
    { ticket: await ticketOf(await f.issue()) },
  );
  const current = debugCookie(response);
  const saved = debugCookie(response, "se_debug_return");
  expect(saved.split("=")[1]).toBe(f.admin.token);
  expect(
    response.headers
      .getSetCookie()
      .find((v) => v.startsWith("se_debug_return=")),
  ).toContain("HttpOnly");
  expect(
    await (
      await debugRequest("/api/debug/session/status", `${current}; ${saved}`)
    ).json(),
  ).toMatchObject({ active: true, canReturn: true });
  const restored = await debugRequest(
    "/api/debug/session/restore",
    `${current}; ${saved}`,
    {},
    { DEBUG_MODE: "false" },
  );
  expect(debugCookie(restored)).toBe(f.adminCookie);
  expect(
    restored.headers
      .getSetCookie()
      .find((v) => v.startsWith("se_debug_return=")),
  ).toContain("Max-Age=0");
  expect(
    await bindings.DB.prepare(
      "SELECT token_hash FROM client_sessions WHERE token_hash = ?",
    )
      .bind(await digest(current.split("=")[1]))
      .first(),
  ).toBeNull();
  expect((await debugRequest("/api/events", f.adminCookie)).status).toBe(200);
  expect(
    (await debugRequest("/api/debug/session/restore", f.adminCookie, {}))
      .status,
  ).toBe(409);
  // 復帰先セッション自体が失効した場合には、期限切れの権限を復活させない。
  const next = await debugRequest("/api/debug/session/redeem", f.adminCookie, {
    ticket: await ticketOf(await f.issue()),
  });
  await bindings.DB.prepare(
    "UPDATE client_sessions SET expires_at = 0 WHERE token_hash = ?",
  )
    .bind(f.admin.session.tokenHash)
    .run();
  const ended = await debugRequest(
    "/api/debug/session/restore",
    `${debugCookie(next)}; ${debugCookie(next, "se_debug_return")}`,
    {},
  );
  expect(debugCookie(ended)).toBe("se_session=");
  expect(await ended.json()).toMatchObject({ restored: false });
});

it("確認セッション保存に失敗したら短期URLの消費もロールバックする", async () => {
  const f = await debugFixture();
  const ticket = await ticketOf(await f.issue());
  const before = await bindings.DB.prepare(
    "SELECT COUNT(*) AS count FROM clients",
  ).first<{ count: number }>();
  await bindings.DB.exec(
    "CREATE TRIGGER fail_debug_registration BEFORE INSERT ON debug_player_sessions BEGIN SELECT RAISE(ABORT, 'injected debug registration failure'); END;",
  );
  try {
    const response = await debugRequest("/api/debug/session/redeem", "", {
      ticket,
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(
      await bindings.DB.prepare(
        "SELECT redeemed_session_hash FROM debug_session_tickets WHERE token_hash = ?",
      )
        .bind(await digest(ticket))
        .first(),
    ).toMatchObject({ redeemed_session_hash: null });
    expect(
      await bindings.DB.prepare(
        "SELECT COUNT(*) AS count FROM clients",
      ).first(),
    ).toEqual(before);
  } finally {
    await bindings.DB.exec("DROP TRIGGER fail_debug_registration;");
  }
  expect(
    (await debugRequest("/api/debug/session/redeem", "", { ticket })).status,
  ).toBe(200);
});
