export const MAX_QUESTION_FONT_SIZE = 32;
export const READABLE_QUESTION_FONT_SIZE = 18;

export interface QuestionFit {
  fontSize: number;
  fits: boolean;
  readable: boolean;
  availableWidth: number;
  availableHeight: number;
}

// 文字の折り返しはブラウザーに任せ、実際に描画するDOMで収まりを判定する。
// 0.25px単位で最大値を探す。最後にもそのサイズを適用し、計測と表示を一致させる。
export function findQuestionFontSize(measure: (fontSize: number) => boolean) {
  let low = 4;
  let high = MAX_QUESTION_FONT_SIZE * 4;
  if (measure(high / 4)) return { fontSize: high / 4, fits: true };
  if (!measure(low / 4)) return { fontSize: low / 4, fits: false };
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (measure(middle / 4)) low = middle;
    else high = middle;
  }
  return { fontSize: low / 4, fits: measure(low / 4) };
}

export function fitQuestion(
  viewport: HTMLElement,
  content: HTMLElement,
): QuestionFit {
  const availableWidth = viewport.clientWidth;
  const availableHeight = viewport.clientHeight;
  const result = findQuestionFontSize((fontSize) => {
    content.style.fontSize = `${fontSize}px`;
    return (
      availableWidth > 0 &&
      availableHeight > 0 &&
      content.scrollWidth <= availableWidth &&
      content.scrollHeight <= availableHeight
    );
  });
  return {
    ...result,
    availableWidth,
    availableHeight,
    readable: result.fits && result.fontSize >= READABLE_QUESTION_FONT_SIZE,
  };
}
