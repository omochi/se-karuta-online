const MAX_RATE_ADJUSTMENT = 0.2;
const SETTLING_TIME_MS = 1000;
const SAMPLE_LIFETIME_MS = 30000;

// performance.now() とサーバー時刻を対応付ける。状態通知では同期し直さない。
export class ServerClock {
  private anchor: { local: number; server: number; offset: number } | null =
    null;
  private samples: Array<{ at: number; roundTrip: number; offset: number }> =
    [];

  constructor(private readonly localNow = () => performance.now()) {}

  initialize(serverNow: number) {
    if (this.anchor) return;
    const local = this.localNow();
    this.anchor = { local, server: serverNow, offset: serverNow - local };
  }

  now = () => {
    if (!this.anchor) throw new Error("サーバー時計が未初期化です。");
    return this.timeAt(this.localNow());
  };

  synchronize(
    sentAt: number,
    receivedAt: number,
    serverReceivedAt: number,
    serverSentAt: number,
  ) {
    if (
      ![sentAt, receivedAt, serverReceivedAt, serverSentAt].every(
        Number.isFinite,
      ) ||
      receivedAt < sentAt ||
      serverSentAt < serverReceivedAt
    )
      return;
    // サーバーで処理を待った時間は、通信の往復時間から除く。
    const roundTrip = Math.max(
      0,
      receivedAt - sentAt - (serverSentAt - serverReceivedAt),
    );
    const offset = (serverReceivedAt - sentAt + serverSentAt - receivedAt) / 2;
    this.samples = this.samples.filter(
      (sample) => receivedAt - sample.at < SAMPLE_LIFETIME_MS,
    );
    this.samples.push({ at: receivedAt, roundTrip, offset });
    const best = this.samples.reduce((a, b) =>
      a.roundTrip < b.roundTrip ? a : b,
    );
    const server = this.anchor
      ? this.timeAt(receivedAt)
      : receivedAt + best.offset;
    // 現在時刻は連続に保ち、追いかける目標だけを更新する。
    this.anchor = { local: receivedAt, server, offset: best.offset };
  }

  private timeAt(local: number) {
    const anchor = this.anchor!;
    const elapsed = Math.max(0, local - anchor.local);
    const error = anchor.local + anchor.offset - anchor.server;
    const distance = Math.abs(error);
    // 大きなずれには最大±20%で追従し、ずれが200ms以下なら指数的に減速する。
    // 経過時間から積分値を求めるので、描画や読み取りの頻度に依存しない。
    const linearTime = Math.min(
      elapsed,
      Math.max(0, distance / MAX_RATE_ADJUSTMENT - SETTLING_TIME_MS),
    );
    const linearCorrection = linearTime * MAX_RATE_ADJUSTMENT;
    const correction =
      linearCorrection +
      (distance - linearCorrection) *
        -Math.expm1(-(elapsed - linearTime) / SETTLING_TIME_MS);
    return anchor.server + elapsed + Math.sign(error) * correction;
  }
}
