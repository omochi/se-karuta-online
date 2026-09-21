/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeAll, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
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
const bindings = env as unknown as Env;
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
    migration
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
