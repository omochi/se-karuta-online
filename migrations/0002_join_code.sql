ALTER TABLE tournaments ADD COLUMN join_code TEXT
  CHECK (join_code IS NULL OR (length(join_code) = 6 AND join_code NOT GLOB '*[^A-HJKMNP-Z]*'));
CREATE UNIQUE INDEX tournaments_join_code ON tournaments(join_code);
