import type { Difficulty } from "../shared/types";
import { MarkdownBody } from "./MarkdownBody";
import { QuestionDifficulty } from "./QuestionDifficulty";

export function QuestionBody({
  text,
  difficulty = 2,
}: {
  text: string;
  difficulty?: Difficulty;
}) {
  return (
    <>
      <QuestionDifficulty difficulty={difficulty} />
      <MarkdownBody text={text} />
    </>
  );
}
