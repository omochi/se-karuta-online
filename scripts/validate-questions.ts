import { readFileSync } from "node:fs";
import { validateQuestions } from "../src/shared/questions";
const file = process.argv[2] ?? "data/questions/demo.json";
const input = JSON.parse(readFileSync(file, "utf8"));
console.log(
  `${validateQuestions(input.questions ?? input).length} 問を検証しました。`,
);
