import { useLoaderData, useRevalidator } from "react-router";
import type { TournamentReview as Review } from "../shared/review";
import type { ReviewData } from "./route-loaders";
import { Brand, Choices, Header, MarkdownBody } from "./components";
import { QuestionBody } from "./QuestionBody";
import { AnswerDistribution } from "./AnswerDistribution";
import "./review.css";

export default function TournamentReview() {
  const { review } = useLoaderData<ReviewData>();
  const revalidator = useRevalidator();
  if (!review)
    return (
      <>
        <Header />
        <main className="gate">
          <h1>大会終了後に復習できます</h1>
          <p>大会が終了すると、全問の問題文・正解・解説を公開します。</p>
          <button
            className="primary"
            disabled={revalidator.state !== "idle"}
            onClick={() => revalidator.revalidate()}
          >
            公開状況を確認する
          </button>
        </main>
      </>
    );
  return <ReviewContent review={review} />;
}

export function ReviewContent({ review }: { review: Review }) {
  return (
    <div className="display-page review-page">
      <header className="display-header">
        <Brand small />
        <span className="display-event">復習資料</span>
      </header>
      <main className="review-content">
        <div className="review-title">
          <p className="eyebrow">REVIEW</p>
          <h1>{review.name}</h1>
          <p>
            全{review.rounds.length}問の問題文・正解・解説をまとめました。
            選択肢のリンクボタンから Swift Digest の解説も読めます。
          </p>
        </div>
        {review.rounds.map((round) => (
          <article
            className="display-content review-question"
            key={round.number}
            aria-labelledby={`review-q${round.number}`}
          >
            <h2 id={`review-q${round.number}`}>第{round.number}問</h2>
            {round.status !== "scored" && (
              <p className="review-note">
                {round.status === "voided"
                  ? "無効になった問題です。回答数は参考記録です。"
                  : "この問題は出題されていません。"}
              </p>
            )}
            <div className="review-question-summary">
              <section className="question-body" aria-label="問題文">
                <QuestionBody
                  text={round.question.bodyMarkdown}
                  difficulty={round.question.difficulty}
                />
              </section>
              {round.distribution ? (
                <AnswerDistribution
                  distribution={round.distribution}
                  correctChoice={round.question.correctChoice}
                />
              ) : (
                <p className="review-note">回答受付を行っていません。</p>
              )}
            </div>
            <Choices
              question={round.question}
              showCorrect
              showExplanationLinks
            />
            <section className="review-explanation" aria-label="正解と解説">
              <h3>正解 {round.question.correctChoice}</h3>
              <MarkdownBody text={round.question.explanationMarkdown} />
            </section>
          </article>
        ))}
      </main>
    </div>
  );
}
