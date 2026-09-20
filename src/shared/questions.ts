import { CHOICES, type Question } from "./types";
export function validateQuestions(input: unknown): Question[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100)
    throw new Error("問題は 1〜100 件で指定してください。");
  const ids = new Set<string>();
  return input.map((raw, index) => {
    const prefix = `問題 ${index + 1}: `;
    if (!raw || typeof raw !== "object")
      throw new Error(prefix + "形式が不正です。");
    const q = raw as Record<string, unknown>;
    for (const key of ["id", "bodyMarkdown", "explanationMarkdown"]) {
      if (
        typeof q[key] !== "string" ||
        !(q[key] as string).trim() ||
        (q[key] as string).length > 12000
      )
        throw new Error(prefix + key + " を確認してください。");
    }
    const id = q.id as string;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id))
      throw new Error(prefix + "問題 ID が不正、または重複しています。");
    ids.add(id);
    if (
      !q.choices ||
      typeof q.choices !== "object" ||
      Array.isArray(q.choices) ||
      Object.keys(q.choices).length !== 4
    )
      throw new Error(prefix + "選択肢は A〜D の 4 件にしてください。");
    const choices = q.choices as Record<string, unknown>;
    for (const key of CHOICES)
      if (
        typeof choices[key] !== "string" ||
        !(choices[key] as string).trim() ||
        (choices[key] as string).length > 300
      )
        throw new Error(prefix + `選択肢 ${key} を確認してください。`);
    if (!CHOICES.includes(q.correctChoice as never))
      throw new Error(prefix + "正解は A〜D のいずれかです。");
    return {
      id,
      bodyMarkdown: q.bodyMarkdown as string,
      choices: Object.fromEntries(
        CHOICES.map((c) => [c, choices[c]]),
      ) as Question["choices"],
      correctChoice: q.correctChoice as Question["correctChoice"],
      explanationMarkdown: q.explanationMarkdown as string,
    };
  });
}
