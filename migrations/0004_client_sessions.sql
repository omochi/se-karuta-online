CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1))
);
CREATE TABLE client_sessions (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX client_sessions_client ON client_sessions(client_id);
CREATE TABLE client_players (
  client_id TEXT NOT NULL REFERENCES clients(id),
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  player_id TEXT NOT NULL,
  PRIMARY KEY (client_id, tournament_id),
  UNIQUE (tournament_id, player_id),
  FOREIGN KEY (tournament_id, player_id) REFERENCES players(tournament_id, id)
);
CREATE TABLE client_displays (
  client_id TEXT NOT NULL REFERENCES clients(id),
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  PRIMARY KEY (client_id, tournament_id)
);
-- 過去の参加者・回答は保持する。旧Cookieからクライアントへの引き継ぎは行わない。
ALTER TABLE players DROP COLUMN session_hash;
