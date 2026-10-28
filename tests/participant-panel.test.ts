import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ParticipantPanel } from "../src/client/ParticipantPanel";
import type { RoomView } from "../src/shared/types";

function render(count: number) {
  const players: NonNullable<RoomView["players"]> = Array.from(
    { length: count },
    (_, i) => ({
      id: `p${i + 1}`,
      name: `参加者${i + 1}`,
      online: true,
      ready: false,
      participation: "eligible",
      answered: false,
      waitForReady: true,
    }),
  );
  return renderToStaticMarkup(
    createElement(ParticipantPanel, {
      players,
      finished: false,
      disabled: false,
      onReadyWait: () => {},
    }),
  );
}
it("51人いても10人だけを描画し、総人数と6ページ分のナビゲーションを残す", () => {
  const html = render(51);
  expect(html.match(/class="person"/g)).toHaveLength(10);
  expect(html).toContain("51 人");
  expect(html).toContain("1 / 6 ページ");
  expect(html).toContain("1〜10人目を表示");
  expect(html).not.toContain("参加者11");
});
it("10人以内ではページ切り替えを出さず、0人では入室待ちを表示する", () => {
  expect(render(10)).not.toContain("参加者のページ切り替え");
  expect(render(0)).toContain("参加者の入室を待っています。");
});
