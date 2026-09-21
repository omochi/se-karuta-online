/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeAll, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import joinCodeMigration from "../migrations/0002_join_code.sql?raw";
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
import { signSession } from "../src/worker/auth";
import type { Env } from "../src/worker/env";
import type { Game, Question, RoomView } from "../src/shared/types";
import type { EventPage } from "../src/shared/events";
const bindings = env as unknown as Env;
it("大会一覧は管理者だけが取得でき、件数制限・安定した並び順・状態を返す", async () => {
  const { token } = await signSession(bindings.SESSION_SECRET, {
    role: "admin",
  });
  const request = (query = "", cookie = `se_admin=${token}`) =>
    exports.default.fetch(
      new Request(`http://test/api/events${query}`, {
        headers: { Cookie: cookie },
      }),
    );
  expect((await request("?page=1", "")).status).toBe(401);
  const { token: playerToken } = await signSession(bindings.SESSION_SECRET, {
    role: "player",
    eventId: "test",
    playerId: "player",
  });
  expect((await request("?page=1", `se_admin=${playerToken}`)).status).toBe(
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
  expect(await config.json()).toEqual({ publicOrigin: "http://test" });
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
    (migration + joinCodeMigration)
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
        choices: { A: "a", B: "b", C: "c", D: "d" },
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
    sessionHash: "test-hash",
  });
  return game;
}
it("D1に問題のスナップショット・参加資格・回答を保存して復元する", async () => {
  const g = fixture();
  await saveGame(bindings.DB, null, g, "display-hash");
  const next = structuredClone(g);
  applyCommand(next, { command: "start", revision: 0 }, 100);
  beginCountdownIfReady(
    next,
    new Set(next.players.map((p) => p.id)),
    true,
    100,
  );
  advanceTimer(next, 5100);
  advanceTimer(next, 20100);
  receiveAnswer(next, next.players[0].id, next.rounds[0].id, "B", 20382);
  applyCommand(
    next,
    {
      command: "updateTiming",
      revision: next.revision,
      timing: { countdownSeconds: 3, readingSeconds: 15, answeringSeconds: 45 },
    },
    20400,
  );
  expect(next.phaseEndsAt).toBe(50100);
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
it("Durable Objectを破棄してもD1から進行状態を復元する", async () => {
  const g = fixture();
  applyCommand(g, { command: "start", revision: 0 }, 0);
  await saveGame(bindings.DB, null, g, "hash");
  const { token } = await signSession(bindings.SESSION_SECRET, {
    role: "admin",
  });
  async function connect() {
    const response = await exports.default.fetch(
      new Request(`http://test/api/e/${g.id}/ws?role=control`, {
        headers: {
          Origin: "http://test",
          Upgrade: "websocket",
          Cookie: `se_admin=${token}`,
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
        choices: { A: "a", B: "b", C: "c", D: "d" },
        correctChoice: "C",
        explanationMarkdown: "first explanation",
      },
      {
        id: crypto.randomUUID(),
        difficulty: 2 as const,
        bodyMarkdown: "second secret",
        choices: { A: "a", B: "b", C: "c", D: "d" },
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
    const { token } = await signSession(bindings.SESSION_SECRET, {
      role,
      eventId: game.id,
    });
    const denied = await exports.default.fetch(
      new Request(url, {
        headers: {
          Cookie: `se_${role}_${game.id}=${token}; se_admin=${token}`,
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
  const { token } = await signSession(bindings.SESSION_SECRET, {
    role: "admin",
  });
  const response = await exports.default.fetch(
    new Request(url, { headers: { Cookie: `se_admin=${token}` } }),
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
    readingSeconds: 15,
    answeringSeconds: 30,
  });
});

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
  const { token } = await signSession(bindings.SESSION_SECRET, {
    role: "admin",
  });
  const response = await exports.default.fetch(
    new Request(`http://test/api/e/${game.id}/questions`, {
      headers: { Cookie: `se_admin=${token}` },
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
  const { token } = await signSession(bindings.SESSION_SECRET, {
    role: "admin",
  });
  const request = () =>
    exports.default.fetch(
      new Request(url, { headers: { Cookie: `se_admin=${token}` } }),
    );
  expect((await request()).status).toBe(409);
  const finished = structuredClone(game);
  applyCommand(finished, { command: "start", revision: finished.revision }, 0);
  beginCountdownIfReady(
    finished,
    new Set(finished.players.map((p) => p.id)),
    true,
    0,
  );
  advanceTimer(finished, 5000);
  advanceTimer(finished, 20000);
  receiveAnswer(
    finished,
    finished.players[0].id,
    finished.rounds[0].id,
    "B",
    20382,
  );
  for (const command of ["close", "reveal", "ranking", "finish"] as const)
    applyCommand(finished, { command, revision: finished.revision }, 21000);
  await saveGame(bindings.DB, game, finished);
  expect((await exports.default.fetch(new Request(url))).status).toBe(401);
  for (const role of ["display", "player"] as const) {
    const session = await signSession(bindings.SESSION_SECRET, {
      role,
      eventId: game.id,
      playerId: game.players[0].id,
    });
    const response = await exports.default.fetch(
      new Request(url, {
        headers: {
          Cookie: `se_${role}_${game.id}=${session.token}; se_admin=${session.token}`,
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
