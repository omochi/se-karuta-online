-- 参加者本人が発行したときだけ共有を有効にする。
ALTER TABLE players ADD COLUMN result_share_token TEXT;
CREATE UNIQUE INDEX players_result_share_token ON players(result_share_token)
WHERE result_share_token IS NOT NULL;
