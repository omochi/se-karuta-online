import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBody } from "../src/client/MarkdownBody";

function render(text: string) {
  return renderToStaticMarkup(createElement(MarkdownBody, { text }));
}

it("Swiftのコードは初回描画から色分けされ、記号・改行・字下げを保つ", () => {
  const code =
    '// 比較\nlet value = "<tag>&"\nif count < 3 {\n  print(value)\n}\n';
  const html = render("```swift\n" + code + "```");
  for (const token of ["keyword", "string", "number", "comment"]) {
    expect(html).toContain(`class="hljs-${token}"`);
  }
  const content = html.match(/<code[^>]*>([\s\S]*?)<\/code>/)![1];
  expect(content.replace(/<[^>]*>/g, "")).toBe(
    code
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;"),
  );
});

it.each(["", "text", "txt", "plaintext", "unknown-language"])(
  "言語が%sならコードを色分けせずそのまま表示する",
  (language) => {
    const html = render("```" + language + '\nlet x = "<tag>"\n```');
    expect(html).not.toContain("<span");
    expect(html).toContain("let x = &quot;&lt;tag&gt;&quot;\n</code>");
  },
);

it("インラインコードは色分けせず、生HTMLは表示しない", () => {
  const html = render('`let x = 1`\n\n<script>alert("x")</script>');
  expect(html).toContain("<code>let x = 1</code>");
  expect(html).not.toContain("hljs");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("alert");
});
