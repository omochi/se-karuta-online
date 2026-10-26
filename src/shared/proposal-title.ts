import type { Choice, Question } from "./types";

export function choiceLabel(
  question: { choices?: Question["choices"] },
  choice: Choice,
) {
  const proposal = question.choices?.[choice];
  if (!proposal) return "";
  const original = `${proposal.number} · ${proposal.title}`;
  return proposal.titleJa ? `${original} / ${proposal.titleJa}` : original;
}
