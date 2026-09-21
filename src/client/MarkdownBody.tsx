import { memo, type ComponentProps } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import swift from "highlight.js/lib/languages/swift";
import objectivec from "highlight.js/lib/languages/objectivec";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import "./syntax-highlighting.css";

const highlighting: NonNullable<
  ComponentProps<typeof Markdown>["rehypePlugins"]
> = [
  [
    rehypeHighlight,
    {
      languages: {
        swift,
        objectivec,
        c,
        cpp,
        javascript,
        typescript,
        json,
        bash,
      },
      detect: false,
      plainText: ["text", "txt", "plaintext"],
    },
  ],
];

// タイマーの再描画ごとにMarkdown解析・色付けを繰り返さない。
// 同期プラグインなので、本文が出た後に色だけが変わる段階も作らない。
export const MarkdownBody = memo(function MarkdownBody({
  text,
}: {
  text: string;
}) {
  return (
    <div className="markdown">
      <Markdown skipHtml rehypePlugins={highlighting}>
        {text}
      </Markdown>
    </div>
  );
});
