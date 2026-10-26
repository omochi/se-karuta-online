import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type {
  Choice,
  ClientMessage,
  Command,
  RoomView,
  ServerMessage,
} from "../src/shared/types";
const origin = "http://localhost";
class Peer {
  state: RoomView | null = null;
  private listeners = new Set<(message: ServerMessage) => void>();
  private replies = new Map<string, ServerMessage>();
  private heartbeat: ReturnType<typeof setInterval>;
  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === "state") this.state = message;
      else if (message.requestId) this.replies.set(message.requestId, message);
      for (const listener of this.listeners) listener(message);
    });
    ws.accept();
    this.heartbeat = setInterval(() => {
      try {
        this.send({ type: "ping" });
      } catch {}
    }, 10000);
  }
  send(message: ClientMessage) {
    this.ws.send(JSON.stringify(message));
  }
  close() {
    clearInterval(this.heartbeat);
    try {
      this.ws.close();
    } catch {}
  }
  wait(predicate: (v: RoomView) => boolean, timeout = 7000): Promise<RoomView> {
    if (this.state && predicate(this.state)) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const listener = (message: ServerMessage) => {
        if (message.type === "state" && predicate(message)) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(message);
        }
      };
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(
          new Error(
            `state timeout: ${this.state?.phase}, ${this.state?.readyCount}/${this.state?.eligibleCount}`,
          ),
        );
      }, timeout);
      this.listeners.add(listener);
    });
  }
  reply(requestId: string): Promise<ServerMessage> {
    if (this.replies.has(requestId))
      return Promise.resolve(this.replies.get(requestId)!);
    return new Promise((resolve, reject) => {
      const listener = (m: ServerMessage) => {
        if (m.type !== "state" && m.requestId === requestId) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(m);
        }
      };
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error("reply timeout"));
      }, 7000);
      this.listeners.add(listener);
    });
  }
  async command(
    command: Command,
    extra: { playerId?: string; reason?: string; waitForReady?: boolean } = {},
  ) {
    const revision = this.state!.revision;
    const requestId = crypto.randomUUID();
    this.send({ type: "command", requestId, revision, command, ...extra });
    const reply = await this.reply(requestId);
    assert.equal(reply.type, "ack", JSON.stringify(reply));
    return this.wait((v) => v.revision > revision);
  }
}
test(
  "40人と複数DisplayのWebSocket・D1・Durable Objectsで準備確認から表彰まで遊べる",
  { timeout: 100000 },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), "se-karuta-integration-"));
    const bundle = await build({
      entryPoints: ["src/worker/index.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["cloudflare:workers"],
    });
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-09-20",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        d1Persist: join(folder, "d1"),
        durableObjects: {
          ROOMS: { className: "TournamentRoom", useSQLite: true },
        },
        durableObjectsPersist: join(folder, "do"),
        bindings: {
          ADMIN_PASSWORD: "test-admin",
          PUBLIC_ORIGIN: origin,
        },
      }),
    );
    const peers: Peer[] = [];
    t.after(async () => {
      for (const p of peers) p.close();
      await mf.dispose();
      await rm(folder, { recursive: true, force: true });
    });
    const db = await mf.getD1Database("DB");
    const schema = (
      await Promise.all(
        (await readdir("migrations"))
          .filter((f) => f.endsWith(".sql"))
          .sort()
          .map((f) => readFile(`migrations/${f}`, "utf8")),
      )
    ).join("\n");
    await db.batch(
      schema
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
    async function request(path: string, data?: unknown, cookie = "") {
      return mf.dispatchFetch(origin + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    }
    const cookieOf = (r: { headers: { get(name: string): string | null } }) =>
      r.headers.get("set-cookie")!.split(";")[0];
    const anonymous = await request("/api/events");
    assert.equal(anonymous.status, 401);
    const crossOrigin = await mf.dispatchFetch(origin + "/api/admin/login", {
      method: "POST",
      headers: { Origin: "https://other.example" },
      body: JSON.stringify({ password: "test-admin" }),
    });
    assert.equal(crossOrigin.status, 403);
    const login = await request("/api/admin/login", { password: "test-admin" });
    assert.equal(login.status, 200);
    const adminCookie = cookieOf(login);
    const questionSet = JSON.parse(
      await readFile("data/questions/vol-01.json", "utf8"),
    );
    assert.equal(questionSet.questions.length, 8);
    assert.deepEqual(
      questionSet.questions
        .map((q: { difficulty: number }) => q.difficulty)
        .sort(),
      [1, 1, 1, 2, 2, 2, 3, 3],
    );
    const firstCorrectChoice = questionSet.questions[0].correctChoice as Choice;
    const differentChoice: Choice = firstCorrectChoice === "A" ? "B" : "A";
    const create = await request("/api/events", questionSet, adminCookie);
    assert.equal(create.status, 201);
    const { id } = (await create.json()) as { id: string };
    const displayLogin = await request(`/api/e/${id}/display/login`, {
      password: "display-karuta",
    });
    assert.equal(displayLogin.status, 200);
    const displayCookie = cookieOf(displayLogin);
    async function connect(
      role: "control" | "display" | "player",
      cookie: string,
    ) {
      const response = await mf.dispatchFetch(
        `${origin}/api/e/${id}/ws?role=${role}`,
        { headers: { Origin: origin, Upgrade: "websocket", Cookie: cookie } },
      );
      assert.equal(response.status, 101);
      const peer = new Peer(response.webSocket as unknown as WebSocket);
      peers.push(peer);
      await peer.wait(() => true);
      return peer;
    }
    const control = await connect("control", adminCookie);
    let display = await connect("display", displayCookie);
    const syncId = crypto.randomUUID();
    const syncStarted = Date.now();
    const revisionBeforeSync = display.state!.revision;
    display.send({ type: "timeSync", requestId: syncId });
    const synchronized = await display.reply(syncId);
    assert.equal(synchronized.type, "timeSync");
    if (synchronized.type !== "timeSync") throw new Error("missing timeSync");
    assert(synchronized.serverReceivedAt >= syncStarted);
    assert(synchronized.serverSentAt >= synchronized.serverReceivedAt);
    assert(synchronized.serverSentAt <= Date.now());
    assert.equal(display.state!.revision, revisionBeforeSync);
    assert.equal(display.state!.phase, "waiting");
    const joins = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        request(`/api/e/${id}/join`, { name: `Player ${i}` }),
      ),
    );
    const cookies = joins.map(cookieOf);
    const players = await Promise.all(cookies.map((c) => connect("player", c)));
    await control.wait((v) => v.playerCount === 40);
    await control.command("start");
    await display.wait((v) => v.phase === "choicesPreparing");
    await Promise.all(
      players.map((p) => p.wait((v) => v.phase === "choicesPreparing")),
    );
    const roundId = control.state!.question!.id;
    assert.equal(display.state!.question!.bodyMarkdown, undefined);
    assert.equal(display.state!.question!.difficulty, 1);
    assert.equal(players[0].state!.question!.difficulty, undefined);
    assert.equal(display.state!.question!.correctChoice, undefined);
    assert.equal(players[0].state!.preview, undefined);
    // Displayは随時追加・切断でき、準備完了通知は不要。
    const viewer = await connect("display", displayCookie);
    await control.wait((v) => v.displays?.length === 2);
    viewer.close();
    await control.wait((v) => v.displays?.length === 1);
    display.close();
    await control.wait((v) => v.displays?.length === 0);
    display = await connect("display", displayCookie);
    assert.equal(display.state!.question!.difficulty, 1);
    assert.equal(display.state!.question!.bodyMarkdown, undefined);
    await control.wait((v) => v.displays?.length === 1);
    const monitor = await connect("display", displayCookie);
    // 別PCで同じパスワードを使ってログインしたサテライト画面。
    const satelliteLogin = await request(`/api/e/${id}/display/login`, {
      password: "display-karuta",
    });
    assert.equal(satelliteLogin.status, 200);
    const satellite = await connect("display", cookieOf(satelliteLogin));
    await control.wait((v) => v.displays?.length === 3);
    // 古い世代の通知を送っても準備完了にしない。
    players[0].send({ type: "ready", roundId, epoch: "old-connection" });
    players[0].send({ type: "ping" });
    for (const player of players.slice(0, 39))
      player.send({ type: "ready", roundId, epoch: player.state!.epoch });
    await control.wait((v) => v.readyCount === 39);
    assert.equal(control.state!.phase, "choicesPreparing");
    const lateJoin = await request(`/api/e/${id}/join`, {
      name: "Late player",
    });
    const late = await connect("player", cookieOf(lateJoin));
    assert.equal(late.state!.me!.participation, "waiting");
    const restedId = players[39].state!.me!.id;
    assert.equal(players[0].state!.question!.choices, undefined);
    assert.equal(display.state!.question!.choices, undefined);
    // 3画面から準備完了が届かなくても、参加者が揃えば開始する。
    const countdown = await control.command("setReadyWait", {
      playerId: restedId,
      waitForReady: false,
    });
    assert.equal(countdown.phase, "countdown");
    assert.equal(countdown.eligibleCount, 40);
    assert.equal(countdown.readyWaitCount, 39);
    assert.equal(countdown.phaseEndsAt! - countdown.serverNow <= 5000, true);
    await display.wait((v) => v.phase === "countdown");
    assert.equal(display.state!.question!.difficulty, 1);
    assert.equal(display.state!.question!.bodyMarkdown, undefined);
    assert.equal(display.state!.question!.choices, undefined);
    const reading = await control.wait(
      (v) => v.phase === "choicesReading",
      8000,
    );
    assert.equal(reading.phaseDurationMs, 20000);
    await display.wait((v) => v.phase === "choicesReading");
    assert.equal(display.state!.question!.difficulty, 1);
    assert.equal(display.state!.question!.bodyMarkdown, undefined);
    await players[0].wait((v) => v.phase === "choicesReading");
    assert.equal(players[0].state!.question!.difficulty, undefined);
    assert.deepEqual(
      players[0].state!.question!.choices,
      questionSet.questions[0].choices,
    );
    for (const peer of [control, display, players[0]]) {
      assert.deepEqual(
        peer.state!.question!.choices,
        questionSet.questions[0].choices,
      );
      assert.equal(peer.state!.question!.choices!.B.titleJa, null);
    }
    await control.wait((v) => v.phase === "acceptingAnswers", 23000);
    assert.equal(control.state!.phaseDurationMs, 30000);
    await display.wait((v) => v.phase === "acceptingAnswers");
    assert.deepEqual(display.state!.answerDistribution, {
      counts: { A: 0, B: 0, C: 0, D: 0 },
      unanswered: 40,
    });
    await Promise.all(
      players.map((p) => p.wait((v) => v.phase === "acceptingAnswers")),
    );
    assert.equal(
      display.state!.question!.bodyMarkdown,
      questionSet.questions[0].bodyMarkdown,
    );
    assert.equal(players[0].state!.question!.bodyMarkdown, undefined);
    assert.equal(display.state!.question!.difficulty, 1);
    assert.equal(players[0].state!.question!.difficulty, undefined);
    for (const screen of [monitor, satellite]) {
      await screen.wait((v) => v.phase === "acceptingAnswers");
      assert.deepEqual(screen.state!.question, display.state!.question);
      assert.equal(screen.state!.phaseEndsAt, display.state!.phaseEndsAt);
    }
    // 出題中に増えた画面にも同じ問題・期限を送り、進行は巻き戻さない。
    const lateDisplay = await connect("display", displayCookie);
    assert.equal(lateDisplay.state!.phase, "acceptingAnswers");
    assert.deepEqual(lateDisplay.state!.question, display.state!.question);
    assert.equal(lateDisplay.state!.phaseEndsAt, display.state!.phaseEndsAt);
    const invalidId = crypto.randomUUID();
    late.send({
      type: "answer",
      requestId: invalidId,
      roundId,
      choice: firstCorrectChoice,
    });
    assert.equal((await late.reply(invalidId)).type, "error");
    const hostileId = crypto.randomUUID();
    players[0].send({
      type: "command",
      requestId: hostileId,
      revision: control.state!.revision,
      command: "close",
    });
    assert.equal((await players[0].reply(hostileId)).type, "error");
    // DB障害を一度起こし、未保存の回答を成功扱いしないことを実ランタイムで確認する。
    await db.exec(
      "CREATE TRIGGER fail_test_answer BEFORE INSERT ON answers WHEN NEW.choice = 'A' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    );
    const failedId = crypto.randomUUID();
    players[0].send({
      type: "answer",
      requestId: failedId,
      roundId,
      choice: "A",
    });
    assert.equal((await players[0].reply(failedId)).type, "error");
    assert.deepEqual(display.state!.answerDistribution, {
      counts: { A: 0, B: 0, C: 0, D: 0 },
      unanswered: 40,
    });
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM answers WHERE round_id = ?")
          .bind(roundId)
          .first<{ n: number }>()
      )?.n,
      0,
    );
    await db.exec("DROP TRIGGER fail_test_answer;");
    const started = performance.now();
    // readyを待たなかった人も通常どおり回答できる。
    const answeringPlayers = [...players.slice(0, 37), players[39]];
    const ids = answeringPlayers.map(() => crypto.randomUUID());
    answeringPlayers.forEach((p, i) =>
      p.send({
        type: "answer",
        requestId: ids[i],
        roundId,
        choice: firstCorrectChoice,
      }),
    );
    const answers = await Promise.all(
      answeringPlayers.map((p, i) => p.reply(ids[i])),
    );
    assert(answers.every((a) => a.type === "ack"));
    await control.wait((v) => v.answerCount === 38);
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    counts[firstCorrectChoice] = 38;
    const distribution = { counts, unanswered: 2 };
    for (const screen of [display, monitor, satellite, lateDisplay]) {
      await screen.wait((v) => v.answerCount === 38);
      assert.equal(screen.state!.phase, "acceptingAnswers");
      assert.deepEqual(screen.state!.answerDistribution, distribution);
      assert.equal(screen.state!.question!.correctChoice, undefined);
    }
    assert.equal(control.state!.answerDistribution, undefined);
    await players[0].wait((v) => v.answerCount === 38);
    assert.equal(players[0].state!.answerDistribution, undefined);
    // 途中接続したDisplayにも、保存済みの最新集計を即座に送る。
    lateDisplay.close();
    const liveDisplay = await connect("display", displayCookie);
    assert.equal(liveDisplay.state!.phase, "acceptingAnswers");
    assert.deepEqual(liveDisplay.state!.answerDistribution, distribution);
    t.diagnostic(
      `38 simultaneous answers persisted and acknowledged in ${Math.round(performance.now() - started)} ms (local)`,
    );
    const first = answers[0];
    assert.equal(first.type, "ack");
    if (first.type !== "ack") throw new Error("missing ack");
    const originalDeadline = control.state!.phaseEndsAt!;
    // 保存できない延長は成功扱いせず、期限も通知も更新しない。
    await db.exec(
      "CREATE TRIGGER fail_test_extension BEFORE UPDATE ON tournaments BEGIN SELECT RAISE(ABORT, 'injected extension failure'); END;",
    );
    const failedExtension = crypto.randomUUID();
    control.send({
      type: "command",
      requestId: failedExtension,
      revision: control.state!.revision,
      command: "extendAnswers",
    });
    assert.equal((await control.reply(failedExtension)).type, "error");
    await db.exec("DROP TRIGGER fail_test_extension;");
    assert.equal(control.state!.phaseEndsAt, originalDeadline);
    assert.equal(control.state!.answerExtendedAt, undefined);
    const extended = await control.command("extendAnswers");
    assert.equal(extended.phaseEndsAt, originalDeadline + 15000);
    assert.equal(extended.phaseDurationMs, 45000);
    assert.equal(typeof extended.answerExtendedAt, "number");
    for (const peer of [display, monitor, satellite, ...players]) {
      const view = await peer.wait(
        (v) => v.phaseEndsAt === extended.phaseEndsAt,
      );
      assert.equal(view.answerExtendedAt, extended.answerExtendedAt);
    }
    // 再接続しても延長した期限と確定済みの回答を維持する。
    const extensionReconnect = await connect("player", cookies[0]);
    assert.equal(extensionReconnect.state!.phaseEndsAt, extended.phaseEndsAt);
    assert.deepEqual(extensionReconnect.state!.me!.answer, first.answer);
    extensionReconnect.close();
    // 古いアラームの期限では締め切らず、新しい期限で自動締切する。
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, originalDeadline - Date.now() + 100)),
    );
    control.send({ type: "ping" });
    await control.wait((v) => v.serverNow >= originalDeadline);
    assert.equal(control.state!.phase, "acceptingAnswers");
    await control.wait((v) => v.phase === "answersClosed", 18000);
    const expiredExtension = crypto.randomUUID();
    control.send({
      type: "command",
      requestId: expiredExtension,
      revision: control.state!.revision,
      command: "extendAnswers",
    });
    assert.equal((await control.reply(expiredExtension)).type, "error");
    await display.wait((v) => v.phase === "answersClosed");
    const closedQuestion = display.state!.question;
    display.close();
    display = await connect("display", displayCookie);
    assert.equal(display.state!.phase, "answersClosed");
    assert.deepEqual(display.state!.question, closedQuestion);
    assert.equal(
      display.state!.question!.bodyMarkdown,
      questionSet.questions[0].bodyMarkdown,
    );
    assert.equal(display.state!.question!.correctChoice, undefined);
    assert.equal(display.state!.question!.explanationMarkdown, undefined);
    assert.deepEqual(display.state!.answerDistribution, distribution);
    await players[38].wait((v) => v.phase === "answersClosed");
    assert.equal(players[38].state!.me!.answer, null);
    const tooLate = crypto.randomUUID();
    players[38].send({
      type: "answer",
      requestId: tooLate,
      roundId,
      choice: firstCorrectChoice,
    });
    assert.equal((await players[38].reply(tooLate)).type, "error");
    const retryId = crypto.randomUUID();
    players[0].send({
      type: "answer",
      requestId: retryId,
      roundId,
      choice: differentChoice,
    });
    const retry = await players[0].reply(retryId);
    assert.equal(retry.type, "ack");
    if (retry.type === "ack") assert.deepEqual(retry.answer, first.answer);
    // 同じCookieで再接続しても、新しい参加者や新しい回答を作らない。
    players[0].close();
    const reconnected = await connect("player", cookies[0]);
    assert.deepEqual(reconnected.state!.me!.answer, first.answer);
    assert.deepEqual(display.state!.answerDistribution, distribution);
    await control.command("reveal");
    await display.wait((v) => v.phase === "answerRevealed");
    assert.deepEqual(display.state!.answerDistribution, {
      counts,
      unanswered: 2,
    });
    for (const screen of [monitor, satellite, liveDisplay]) {
      await screen.wait((v) => v.phase === "answerRevealed");
      assert.deepEqual(screen.state!.question, display.state!.question);
      assert.deepEqual(screen.state!.answerDistribution, {
        counts,
        unanswered: 2,
      });
    }
    await reconnected.wait((v) => v.phase === "answerRevealed");
    assert.equal(reconnected.state!.me!.correct, true);
    assert.equal(reconnected.state!.rankings, undefined);
    assert.equal(reconnected.state!.answerDistribution, undefined);
    await control.command("ranking");
    await display.wait((v) => v.phase === "rankingShown");
    assert.equal(display.state!.rankings!.length, 38);
    assert.deepEqual(display.state!.answerDistribution, {
      counts,
      unanswered: 2,
    });
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM answers WHERE round_id = ?")
          .bind(roundId)
          .first<{ n: number }>()
      )?.n,
      38,
    );
    await control.command("start");
    await players[39].wait((v) => v.questionNumber === 2);
    assert.equal(players[39].state!.me!.participation, "eligible");
    await late.wait((v) => v.questionNumber === 2);
    assert.equal(late.state!.me!.participation, "eligible");
    // 全Displayを閉じても、参加者の準備だけで次問を開始できる。
    for (const screen of [display, monitor, satellite, liveDisplay])
      screen.close();
    await control.wait((v) => v.displays?.length === 0);
    const nextRoundId = control.state!.question!.id;
    for (const player of [...players.slice(1, 39), reconnected, late]) {
      await player.wait((v) => v.questionNumber === 2);
      player.send({
        type: "ready",
        roundId: nextRoundId,
        epoch: player.state!.epoch,
      });
    }
    await control.wait((v) => v.phase === "countdown");
    assert.equal(control.state!.readyCount, 40);
    assert.equal(control.state!.readyWaitCount, 40);
    assert.equal(control.state!.displays!.length, 0);
    const deadline = control.state!.phaseEndsAt;
    // 開始後に追加・全切断しても進行と期限を変えない。
    const replacement = await connect("display", displayCookie);
    assert.equal(replacement.state!.phase, "countdown");
    assert.equal(replacement.state!.phaseEndsAt, deadline);
    replacement.close();
    await control.wait((v) => v.displays?.length === 0);
    assert.equal(control.state!.phase, "countdown");
    assert.equal(control.state!.phaseEndsAt, deadline);
    await control.command("void", { reason: "試遊のためスキップ" });
    await control.command("finish");
    await reconnected.wait((v) => v.phase === "finished");
    assert.equal(reconnected.state!.results!.validQuestions, 1);
    assert.equal(reconnected.state!.results!.correct.length, 38);
    assert(reconnected.state!.results!.fastest.length > 0);
    assert(reconnected.state!.results!.friendship.length > 0);
    assert(!("record" in reconnected.state!.results!));
  },
);
