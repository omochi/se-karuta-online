-- お休みは回答対象外にせず、回答がなければ通常の未回答として集計する。
UPDATE participations SET status = 'eligible' WHERE status = 'resting';
