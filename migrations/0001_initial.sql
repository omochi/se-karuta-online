CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  display_password_hash TEXT NOT NULL,
  state_json TEXT NOT NULL
);
CREATE TABLE questions (id TEXT PRIMARY KEY, content_json TEXT NOT NULL);
CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  position INTEGER NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id),
  question_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  UNIQUE (tournament_id, position), UNIQUE (tournament_id, id)
);
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  name TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  session_hash TEXT NOT NULL,
  UNIQUE (tournament_id, id)
);
CREATE TABLE participations (
  tournament_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('eligible', 'resting')),
  PRIMARY KEY (round_id, player_id),
  FOREIGN KEY (tournament_id, round_id) REFERENCES rounds(tournament_id, id),
  FOREIGN KEY (tournament_id, player_id) REFERENCES players(tournament_id, id)
);
CREATE TABLE answers (
  tournament_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('A','B','C','D')),
  received_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, player_id),
  FOREIGN KEY (round_id, player_id) REFERENCES participations(round_id, player_id),
  FOREIGN KEY (tournament_id, round_id) REFERENCES rounds(tournament_id, id)
);
CREATE INDEX players_tournament ON players(tournament_id);
CREATE INDEX participations_tournament ON participations(tournament_id);
CREATE INDEX answers_tournament ON answers(tournament_id);
