import { useLayoutEffect, useRef } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { fitQuestion, type QuestionFit } from "./fit-question";

export function FittedQuestion({
  text,
  layoutKey,
  onFit,
}: {
  text: string;
  layoutKey: string;
  onFit?: (fit: QuestionFit) => void;
}) {
  const viewportRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    const content = contentRef.current!;
    let width = -1;
    let height = -1;
    const fit = () => {
      // 前の問題が収まらなかった場合も、スクロールバーを除いた同じ領域で計測を始める。
      viewport.dataset.fitOverflow = "false";
      const result = fitQuestion(viewport, content);
      const bounds = viewport.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      viewport.dataset.fitReady = "true";
      viewport.dataset.fitOverflow = String(!result.fits);
      viewport.dataset.fitFontSize = String(result.fontSize);
      onFit?.(result);
    };

    // 初回・問題変更は描画前に全候補を同期計測する。探索をフレームに分けないので、
    // サイズ変更の途中や未調整の大きい本文が画面に出ることはない。
    fit();
    const observer = new ResizeObserver(() => {
      // 小数pxの幅変更でも折り返しが変わるため、整数のclientWidthだけでは比較しない。
      const bounds = viewport.getBoundingClientRect();
      if (bounds.width !== width || bounds.height !== height) fit();
    });
    // 内容から独立して高さが決まる外枠だけを監視し、計測による再計測ループを防ぐ。
    observer.observe(viewport);
    document.fonts.addEventListener("loadingdone", fit);
    content.addEventListener("load", fit, true);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", fit);
      content.removeEventListener("load", fit, true);
    };
  }, [text, layoutKey, onFit]);

  return (
    <section className="question-body fitted-question" ref={viewportRef}>
      <div className="question-fit-content" ref={contentRef}>
        <MarkdownBody text={text} />
      </div>
    </section>
  );
}
