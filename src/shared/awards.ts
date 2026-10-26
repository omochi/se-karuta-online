import type { Results } from "./types";

export const AWARDS = [
  { key: "correct", title: "正答王" },
  { key: "fastest", title: "早押し王" },
  { key: "difficult", title: "難問王" },
  { key: "friendship", title: "友情王" },
] as const;

export interface PlayerTitle {
  key: (typeof AWARDS)[number]["key"];
  title: string;
  rank: number;
}

export function playerTitles(
  results: Results,
  playerId: string,
): PlayerTitle[] {
  return AWARDS.flatMap(({ key, title }) => {
    const row = results[key].find((r) => r.playerId === playerId);
    return row && row.rank <= 3 ? [{ key, title, rank: row.rank }] : [];
  });
}
