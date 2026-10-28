// 開発サーバー専用。大会には接続せず、本番の復習資料コンポーネントを表示する。
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { ReviewContent } from "../../src/client/TournamentReview";
import { validateQuestions } from "../../src/shared/questions";
import tutorial from "../../data/questions/tutorial.json";
import "../../src/client/style.css";

const question = validateQuestions(tutorial.questions)[0];
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <ReviewContent
      review={{
        id: "review-light-preview",
        name: "Swift Evolution Karuta 復習資料",
        rounds: [
          {
            number: 1,
            status: "scored",
            question,
            distribution: { counts: { A: 3, B: 2, C: 1, D: 2 }, unanswered: 2 },
          },
        ],
      }}
    />
  </MemoryRouter>,
);
