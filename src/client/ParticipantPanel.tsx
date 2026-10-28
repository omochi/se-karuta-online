import { useEffect, useState } from "react";
import type { RoomView } from "../shared/types";

const PAGE_SIZE = 10;
export function ParticipantPanel({
  players,
  finished,
  disabled,
  onReadyWait,
}: {
  players: NonNullable<RoomView["players"]>;
  finished: boolean;
  disabled: boolean;
  onReadyWait: (playerId: string, waitForReady: boolean) => void;
}) {
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(players.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount - 1);
  // 件数が減った場合だけ補正し、状態配信や参加者追加で閲覧中のページを戻さない。
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);
  const start = page * PAGE_SIZE;
  const visible = players.slice(start, start + PAGE_SIZE);
  return (
    <section className="panel" aria-label="参加者">
      <div className="section-heading">
        <h2>参加者</h2>
        <span className="pill">{players.length} 人</span>
      </div>
      {pageCount > 1 && (
        <>
          <nav
            className="roster-pagination"
            aria-label="参加者のページ切り替え"
          >
            <button
              className="secondary"
              aria-label="前の10人"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              ← 前へ
            </button>
            <span aria-live="polite">
              {page + 1} / {pageCount} ページ
            </span>
            <button
              className="secondary"
              aria-label="次の10人"
              disabled={page === pageCount - 1}
              onClick={() => setPage(page + 1)}
            >
              次へ →
            </button>
          </nav>
          <p className="muted roster-range">
            {start + 1}〜{start + visible.length}人目を表示
          </p>
        </>
      )}
      <div className="roster">
        {visible.map((p) => (
          <div className="person" key={p.id}>
            <i className={`presence-dot ${p.online ? "online" : ""}`} />
            <div>
              <strong>{p.name}</strong>
              <small>
                {p.id.slice(0, 4)} ·{" "}
                {p.answered
                  ? "回答済み"
                  : p.ready
                    ? "準備完了"
                    : p.online
                      ? "接続中"
                      : "未接続"}
                {" · "}
                {p.waitForReady ? "開始を待つ" : "開始を待たない"}
              </small>
            </div>
            {!finished && (
              <button
                className="ready-wait-toggle"
                role="switch"
                aria-checked={p.waitForReady}
                aria-label={`${p.name}（${p.id.slice(0, 4)}）の準備完了を待つ`}
                disabled={disabled}
                onClick={() => onReadyWait(p.id, !p.waitForReady)}
              >
                {p.waitForReady ? "開始を待つ" : "開始を待たない"}
              </button>
            )}
          </div>
        ))}
      </div>
      {players.length === 0 && (
        <p className="muted empty-small">参加者の入室を待っています。</p>
      )}
    </section>
  );
}
