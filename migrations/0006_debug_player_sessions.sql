-- 既存のクライアント権限には参加者確認の権限を追加しない。
-- 発行元セッションの削除による失効を妨げないよう、issuer_session_hashは外部キーにしない。
CREATE TABLE debug_session_tickets (
  token_hash TEXT PRIMARY KEY,
  issuer_session_hash TEXT NOT NULL,
  tournament_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_session_hash TEXT,
  FOREIGN KEY (tournament_id, player_id) REFERENCES players(tournament_id, id)
);
CREATE TABLE debug_player_sessions (
  token_hash TEXT PRIMARY KEY REFERENCES client_sessions(token_hash) ON DELETE CASCADE,
  issuer_session_hash TEXT NOT NULL,
  tournament_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  FOREIGN KEY (tournament_id, player_id) REFERENCES players(tournament_id, id)
);
CREATE UNIQUE INDEX debug_ticket_redemption ON debug_session_tickets(redeemed_session_hash);
