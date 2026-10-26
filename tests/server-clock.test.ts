import { describe, expect, it } from "vitest";
import { ServerClock } from "../src/client/ServerClock";

function fixture(server = 100000) {
  let local = 0;
  const clock = new ServerClock(() => local);
  clock.initialize(server);
  return {
    clock,
    at: (time: number) => {
      local = time;
      return clock.now();
    },
    sync: (offset: number, roundTrip = 20, processing = 0) => {
      const sent = local;
      local += roundTrip + processing;
      clock.synchronize(
        sent,
        local,
        sent + roundTrip / 2 + offset,
        sent + roundTrip / 2 + offset + processing,
      );
      return local;
    },
  };
}

describe("サーバー時計の速度補正", () => {
  it("初回だけ状態のサーバー時刻を使い、その後の通知では基準を動かさない", () => {
    const { clock, at } = fixture();
    expect(at(100)).toBe(100100);
    clock.initialize(999000);
    expect(at(100)).toBe(100100);
    expect(at(1000)).toBe(101000);
  });

  it.each([-1000, 1000])(
    "%smsのずれを瞬間移動させず、最大±20%%で修正して1倍速へ戻す",
    (error) => {
      const { clock, at, sync } = fixture();
      const start = sync(100000 + error);
      expect(at(start)).toBe(100000 + start);
      const direction = Math.sign(error);
      expect(at(start + 1000) - at(start)).toBeCloseTo(1000 + direction * 200);
      const before = at(start + 3900);
      const after = at(start + 4000);
      expect(after - before).toBeCloseTo(100 + direction * 20);
      const late = at(start + 14000);
      expect(late).toBeCloseTo(100000 + error + start + 14000, 1);
      expect(at(start + 14100) - late).toBeCloseTo(100, 2);
      expect(clock.now()).toBe(at(start + 14100));
    },
  );

  it("サーバー内の待ち時間を通信遅延に含めない", () => {
    const { at, sync } = fixture();
    const start = sync(100000, 100, 5000);
    expect(at(start)).toBe(100000 + start);
    expect(at(start + 10000)).toBeCloseTo(100000 + start + 10000);
  });

  it("遅い応答で短い往復時間の測定を上書きせず、古い測定は更新する", () => {
    const { at, sync } = fixture();
    sync(100000, 10);
    const slow = sync(105000, 1000);
    expect(at(slow + 20000)).toBe(100000 + slow + 20000);
    at(31000);
    const fresh = sync(101000, 1000);
    expect(at(fresh + 15000)).toBeCloseTo(101000 + fresh + 15000, 1);
  });

  it("補正方向が何度変わっても時計は0.8〜1.2倍で進み、残り時間は逆行しない", () => {
    const { clock, at, sync } = fixture();
    let time = 0;
    let previous = at(time);
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) {
        time = sync(100000 + (i % 20 === 0 ? 500 : -500), 10);
        const current = clock.now();
        expect(current - previous).toBeGreaterThanOrEqual(8 - 1e-8);
        expect(current - previous).toBeLessThanOrEqual(12 + 1e-8);
        previous = current;
      }
      time += 100;
      const current = at(time);
      expect(current - previous).toBeGreaterThanOrEqual(80 - 1e-8);
      expect(current - previous).toBeLessThanOrEqual(120 + 1e-8);
      expect(130000 - current).toBeLessThan(130000 - previous);
      previous = current;
    }
  });

  it("読み取り頻度や長時間の描画停止で時計の進み方を変えない", () => {
    const frequent = fixture();
    const sparse = fixture();
    const start = frequent.sync(101000);
    sparse.sync(101000);
    for (let time = start; time <= start + 30000; time += 10) frequent.at(time);
    expect(frequent.at(start + 30000)).toBe(sparse.at(start + 30000));
  });

  it("不正な同期応答を時計に反映しない", () => {
    const { clock, at } = fixture();
    clock.synchronize(100, 0, 100000, 100000);
    clock.synchronize(0, 100, 100001, 100000);
    clock.synchronize(0, 100, NaN, 100000);
    expect(at(1000)).toBe(101000);
  });
});
