import { validateQuestions } from "../shared/questions";
import type { Question } from "../shared/types";

export interface QuestionDocument {
  questions: Question[];
  // 大会名などの付随情報と、元の配列 / オブジェクト形式を保存時に維持する。
  metadata: Record<string, unknown> | null;
}

export function readQuestionDocument(text: string): QuestionDocument {
  const input: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (Array.isArray(input))
    return { questions: validateQuestions(input), metadata: null };
  if (!input || typeof input !== "object")
    throw new Error(
      "問題の配列、または questions を含むJSONを選んでください。",
    );
  const { questions, ...metadata } = input as Record<string, unknown>;
  return { questions: validateQuestions(questions), metadata };
}

export function writeQuestionDocument(document: QuestionDocument): string {
  const questions = validateQuestions(document.questions);
  return (
    JSON.stringify(
      document.metadata === null
        ? questions
        : { ...document.metadata, questions },
      null,
      2,
    ) + "\n"
  );
}
