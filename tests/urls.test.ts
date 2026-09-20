import { expect, it } from "vitest";
import { eventUrls, normalizePublicOrigin } from "../src/shared/urls";

it("公開URLからポート番号を含む画面URLを組み立てる", () => {
  expect(eventUrls("http://192.168.1.2:5218/", "event-1")).toEqual({
    home: "http://192.168.1.2:5218/",
    control: "http://192.168.1.2:5218/e/event-1/control",
    display: "http://192.168.1.2:5218/e/event-1/display",
    play: "http://192.168.1.2:5218/e/event-1/play",
  });
  expect(normalizePublicOrigin("https://karuta.example/")).toBe(
    "https://karuta.example",
  );
});
it.each([
  "",
  "192.168.1.2:5218",
  "ftp://example.com",
  "https://user:pass@example.com",
  "https://example.com/path",
  "https://example.com/?x=1",
  "https://example.com/#x",
])("不正な公開URLを拒否する: %s", (value) => {
  expect(() => normalizePublicOrigin(value)).toThrow("PUBLIC_ORIGIN");
});
