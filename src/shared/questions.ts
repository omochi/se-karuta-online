import { CHOICES, type Difficulty, type Question } from "./types";

export function readDifficulty(value: unknown): Difficulty {
  // 追加前のJSON・保存済み大会には標準難度を補い、同じ値で編集・表示する。
  if (value === undefined) return 2;
  if (value === 1 || value === 2 || value === 3) return value;
  throw new Error("難易度は 1・2・3 の整数で指定してください。");
}
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
    let difficulty: Difficulty;
    try {
      difficulty = readDifficulty(q.difficulty);
    } catch (error) {
      throw new Error(prefix + (error as Error).message);
    }
    if (
      !q.choices ||
      typeof q.choices !== "object" ||
      Array.isArray(q.choices) ||
      Object.keys(q.choices).length !== 4
    )
      throw new Error(prefix + "選択肢は A〜D の 4 件にしてください。");
    const rawChoices = q.choices as Record<string, unknown>;
    const choices = {} as Question["choices"];
    for (const key of CHOICES) {
      const rawChoice = rawChoices[key];
      const error = prefix + `選択肢 ${key}: `;
      if (
        !rawChoice ||
        typeof rawChoice !== "object" ||
        Array.isArray(rawChoice)
      )
        throw new Error(
          error + "SE番号・原題・邦題を持つオブジェクトで指定してください。",
        );
      const choice = rawChoice as Record<string, unknown>;
      if (
        typeof choice.number !== "string" ||
        !/^SE-\d{4}$/.test(choice.number)
      )
        throw new Error(error + "number は SE-0380 の形式で指定してください。");
      if (
        typeof choice.title !== "string" ||
        !choice.title.trim() ||
        choice.title.length > 300
      )
        throw new Error(error + "title は1〜300文字で指定してください。");
      if (
        choice.titleJa !== null &&
        (typeof choice.titleJa !== "string" ||
          !choice.titleJa.trim() ||
          choice.titleJa.length > 300)
      )
        throw new Error(
          error +
            "titleJa は1〜300文字、または邦題なしの null で指定してください。",
        );
      choices[key] = {
        number: choice.number,
        title: choice.title,
        titleJa: choice.titleJa,
      };
    }
    if (!CHOICES.includes(q.correctChoice as never))
      throw new Error(prefix + "正解は A〜D のいずれかです。");
    return {
      id,
      difficulty,
      bodyMarkdown: q.bodyMarkdown as string,
      choices,
      correctChoice: q.correctChoice as Question["correctChoice"],
      explanationMarkdown: q.explanationMarkdown as string,
    };
  });
}
