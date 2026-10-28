import { choiceLabel } from "../shared/proposal-title";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { CHOICES } from "../shared/types";
import type {
  ReportPlayer,
  TournamentReport as Report,
} from "../shared/report";
import type { ReportData } from "./route-loaders";
import { api } from "./api";
import { AnswerStatus } from "./AnswerStatus";
import {
  FinalResults,
  Header,
  MarkdownBody,
  PasswordForm,
  PlayerTitles,
} from "./components";
import "./report.css";

const percent = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const seconds = (value: number | null) =>
  value === null ? "—" : `${(value / 1000).toFixed(3)} 秒`;
const roundLabels = { scored: "集計対象", voided: "無効", unasked: "未出題" };
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="report-metric">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}
function Table({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="report-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="report-table">{children}</table>
    </div>
  );
}
function Person({ player }: { player: Pick<ReportPlayer, "id" | "name"> }) {
  return (
    <>
      <strong>{player.name}</strong>
      <small className="report-person-id">{player.id.slice(0, 4)}</small>
    </>
  );
}

export default function TournamentReport() {
  const data = useLoaderData<ReportData>();
  const revalidator = useRevalidator();
  const [error, setError] = useState("");
  return (
    <>
      <Header>
        {data.report && (
          <Link to={`/e/${data.id}/review`}>復習資料を見る →</Link>
        )}
        <Link to={`/e/${data.id}/control`}>Controlへ戻る →</Link>
      </Header>
      {data.loginRequired ? (
        <main className="gate">
          <h1>詳細結果</h1>
          <PasswordForm
            label="管理用パスワード"
            error={error}
            onSubmit={async (password) => {
              try {
                await api("/api/admin/login", { password });
                setError("");
                await revalidator.revalidate();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </main>
      ) : data.unavailable ? (
        <main className="gate">
          <h1>大会終了後に確認できます</h1>
          <p>
            大会を終了すると、問題ごとの回答内訳や参加者の成績を確認できます。
          </p>
          <Link className="button secondary" to={`/e/${data.id}/control`}>
            Controlへ戻る
          </Link>
        </main>
      ) : data.report ? (
        <ReportContent key={data.report.id} report={data.report} />
      ) : null}
    </>
  );
}
function ReportContent({ report }: { report: Report }) {
  const detailRef = useRef<HTMLElement>(null);
  const [detailFocus, setDetailFocus] = useState(0);
  useEffect(() => {
    if (detailFocus > 0) detailRef.current?.focus();
  }, [detailFocus]);
  const [tab, setTab] = useState<"overview" | "questions" | "players">(
    "overview",
  );
  const [roundId, setRoundId] = useState(report.rounds[0]?.id ?? "");
  const [playerId, setPlayerId] = useState(report.players[0]?.id ?? "");
  const round = report.rounds.find((r) => r.id === roundId);
  const player = report.players.find((p) => p.id === playerId);
  function showPlayer(id: string) {
    setPlayerId(id);
    setTab("players");
    setDetailFocus((n) => n + 1);
  }
  function showRound(id: string) {
    setRoundId(id);
    setTab("questions");
    setDetailFocus((n) => n + 1);
  }
  return (
    <main className="report-page">
      <div className="page-title">
        <div>
          <p className="eyebrow">TOURNAMENT REPORT</p>
          <h1>{report.name}</h1>
          <p className="muted">
            詳細結果 · {new Date(report.createdAt).toLocaleDateString("ja-JP")}{" "}
            作成 · {report.players.length} 人
          </p>
        </div>
        <Link className="button secondary" to="/">
          大会一覧へ
        </Link>
      </div>
      <nav className="report-tabs" aria-label="詳細結果の表示切替">
        {(
          [
            ["overview", "全体の集計"],
            ["questions", "問題ごとの内訳"],
            ["players", "参加者ごとの成績"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "primary" : "secondary"}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <p className="report-note">
        集計は有効な出題のみ。個人の正答率は正解数 ÷
        大会全体の有効問題数で、途中参加前も未回答に含みます。問題ごとの正答率も大会の全参加者を分母にします。無効・未出題の問題は全体と個人成績に含めません。
      </p>
      {tab === "overview" ? (
        <>
          <h2>全体の集計</h2>
          <div className="report-metrics">
            <Metric label="有効問題">
              {report.summary.scored} / {report.rounds.length} 問
            </Metric>
            <Metric label="全体正答率">
              {percent(report.summary.correctRate)}
            </Metric>
            <Metric label="回答数 / 延べ集計人数">
              {report.summary.answered} / {report.summary.eligible}
            </Metric>
            <Metric label="平均回答時間（全回答）">
              {seconds(report.summary.averageElapsed)}
            </Metric>
          </div>
          <p className="muted">
            正解 {report.summary.correct} 件 · 未回答{" "}
            {report.summary.eligible - report.summary.answered} 件 · 無効{" "}
            {report.summary.voided} 問 · 未出題 {report.summary.unasked} 問
          </p>
          {!report.summary.scored && (
            <p className="report-notice">
              集計対象の問題はありません。問題ごとの内訳では、無効にした問題の記録も確認できます。
            </p>
          )}
          <section className="report-section">
            <h2>最終表彰</h2>
            <p className="muted">
              同点は同順位。友情王は正誤に関係なく、最多得票の選択肢を選んだ回数です。同率最多も対象です。
            </p>
            <FinalResults results={report.results} />
          </section>
        </>
      ) : tab === "questions" ? (
        <>
          <h2>問題ごとの内訳</h2>
          <QuestionList
            report={report}
            selected={roundId}
            onSelect={showRound}
          />
          {round && (
            <section
              className="panel report-section"
              aria-label="選択した問題の詳細"
              ref={detailRef}
              tabIndex={-1}
            >
              <label>
                確認する問題
                <select
                  value={roundId}
                  onChange={(e) => setRoundId(e.target.value)}
                >
                  {report.rounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      Q{r.number} ·{" "}
                      {choiceLabel(r.question, r.question.correctChoice)} ·{" "}
                      {roundLabels[r.status]}
                    </option>
                  ))}
                </select>
              </label>
              <h2>
                Q{round.number} ·{" "}
                {choiceLabel(round.question, round.question.correctChoice)}
              </h2>
              <p className="muted">
                難易度 {round.question.difficulty} · {roundLabels[round.status]}
              </p>
              {round.status !== "scored" && (
                <p className="report-notice">
                  {round.status === "voided"
                    ? `無効の理由：${round.voidReason}。以下は集計対象外の記録です。回答時間は受付が始まっていた場合のみ表示します。`
                    : "この問題は出題されていません。"}
                </p>
              )}
              <details className="report-question">
                <summary>問題文・選択肢・解説を見る</summary>
                <MarkdownBody text={round.question.bodyMarkdown} />
                <ul>
                  {CHOICES.map((c) => (
                    <li key={c}>
                      <strong>
                        {c}
                        {c === round.question.correctChoice ? "（正解）" : ""}
                      </strong>{" "}
                      · {choiceLabel(round.question, c)}
                    </li>
                  ))}
                </ul>
                <MarkdownBody text={round.question.explanationMarkdown} />
              </details>
              <div className="report-metrics">
                <Metric label="正答率">{percent(round.correctRate)}</Metric>
                <Metric label="回答数 / 集計人数">
                  {round.answered} / {round.eligible}
                </Metric>
                <Metric label="平均回答時間（全回答）">
                  {seconds(round.averageElapsed)}
                </Metric>
                <Metric label="中央値（全回答）">
                  {seconds(round.medianElapsed)}
                </Metric>
              </div>
              <p className="muted">
                正解 {round.correct} 人 · 未回答 {round.unanswered} 人 · 対象外{" "}
                {round.ineligible} 人 · 最速正解 {seconds(round.fastestCorrect)}
              </p>
              <h3>選択肢ごとの回答人数</h3>
              <p className="muted">
                棒の長さは集計人数に対する割合。途中参加前も未回答に含めるため、A〜Dの合計は100%にならない場合があります。
              </p>
              <div className="report-distribution">
                {CHOICES.map((c) => (
                  <div
                    key={c}
                    className={
                      c === round.question.correctChoice
                        ? "report-choice-correct"
                        : ""
                    }
                  >
                    <div className="report-choice-label">
                      <span>
                        <strong>{c}</strong> · {choiceLabel(round.question, c)}
                        {c === round.question.correctChoice ? "（正解）" : ""}
                      </span>
                      <strong>{round.distribution[c]} 人</strong>
                    </div>
                    <div className="report-bar" aria-hidden="true">
                      <span
                        style={{
                          width: `${round.eligible ? (round.distribution[c] / round.eligible) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <h3>全参加者の回答</h3>
              <Table label="問題ごとの全回答">
                <thead>
                  <tr>
                    <th>参加者</th>
                    <th>結果</th>
                    <th>回答</th>
                    <th>回答時間</th>
                    <th>正解者内順位</th>
                  </tr>
                </thead>
                <tbody>
                  {round.answers.map((a) => {
                    const p = report.players.find((p) => p.id === a.playerId)!;
                    return (
                      <tr key={p.id}>
                        <th scope="row">
                          <button
                            className="report-link"
                            onClick={() => showPlayer(p.id)}
                          >
                            <Person player={p} />
                          </button>
                        </th>
                        <td>
                          <AnswerStatus status={a.status} />
                        </td>
                        <td>{a.choice ?? "—"}</td>
                        <td>{seconds(a.elapsed)}</td>
                        <td>{a.rank === null ? "—" : `${a.rank} 位`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              {!report.players.length && (
                <p className="muted">参加者はいません。</p>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          <h2>参加者ごとの成績</h2>
          <PlayerList
            report={report}
            selected={playerId}
            onSelect={showPlayer}
          />
          {player && (
            <section
              className="panel report-section"
              aria-label="選択した参加者の詳細"
              ref={detailRef}
              tabIndex={-1}
            >
              <label>
                確認する参加者
                <select
                  value={playerId}
                  onChange={(e) => setPlayerId(e.target.value)}
                >
                  {report.players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.id.slice(0, 4)}
                    </option>
                  ))}
                </select>
              </label>
              <h2>
                <Person player={player} />
              </h2>
              <PlayerTitles titles={player.titles} />
              <div className="report-metrics">
                <Metric label="正解数 / 有効問題数">
                  {player.correct} / {player.eligible}
                </Metric>
                <Metric label="正答率">{percent(player.correctRate)}</Metric>
                <Metric label="平均回答時間（全回答）">
                  {seconds(player.averageElapsed)}
                </Metric>
                <Metric label="平均回答時間（正解のみ）">
                  {seconds(player.averageCorrectElapsed)}
                </Metric>
              </div>
              <p>
                正解者内1位 {player.firstPlaces} 回 · 早押し王{" "}
                {player.fastestScore.toFixed(3)} 点（小数第3位まで表示） ·
                平均順位{" "}
                {player.averageRank === null
                  ? "—"
                  : `${player.averageRank.toFixed(2)} 位`}{" "}
                · 難問王 {player.difficultScore.toFixed(3)}{" "}
                点（小数第3位まで表示） · みんなと同じ答え{" "}
                {player.friendshipMatches} 回 · 最速正解{" "}
                {seconds(player.fastestCorrect)}
              </p>
              <p className="muted">
                不正解 {player.incorrect} 問 · 未回答 {player.unanswered} 問
              </p>
              <h3>全問の回答履歴</h3>
              <Table label="参加者の全問履歴">
                <thead>
                  <tr>
                    <th>問題</th>
                    <th>集計</th>
                    <th>結果</th>
                    <th>回答 / 正解</th>
                    <th>回答時間</th>
                    <th>正解者内順位</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rounds.map((r) => {
                    const a = r.answers.find((a) => a.playerId === playerId)!;
                    return (
                      <tr key={r.id}>
                        <th scope="row">
                          <button
                            className="report-link"
                            onClick={() => showRound(r.id)}
                          >
                            Q{r.number} ·{" "}
                            {choiceLabel(r.question, r.question.correctChoice)}
                          </button>
                        </th>
                        <td>{roundLabels[r.status]}</td>
                        <td>
                          <AnswerStatus status={a.status} />
                        </td>
                        <td>
                          {a.choice ?? "—"} / {r.question.correctChoice}
                        </td>
                        <td>{seconds(a.elapsed)}</td>
                        <td>{a.rank === null ? "—" : `${a.rank} 位`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </section>
          )}
        </>
      )}
      <p className="report-note">
        「—」は対象データなし。時間は問題の受付開始からサーバーが回答を受信するまでの経過時間です。平均・中央値は回答済みのデータだけで計算し、未回答を0秒として扱いません。
      </p>
    </main>
  );
}

function QuestionList({
  report,
  selected,
  onSelect,
}: {
  report: Report;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [sort, setSort] = useState("order");
  const rounds = [...report.rounds].sort((a, b) =>
    sort === "rate"
      ? (a.correctRate ?? Infinity) - (b.correctRate ?? Infinity) ||
        a.number - b.number
      : a.number - b.number,
  );
  return (
    <>
      <div className="report-toolbar">
        <label>
          問題の並び順
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="order">出題順</option>
            <option value="rate">正答率が低い順</option>
          </select>
        </label>
      </div>
      <Table label="問題一覧">
        <thead>
          <tr>
            <th>問題</th>
            <th>難易度</th>
            <th>集計</th>
            <th>正解 / 対象</th>
            <th>正答率</th>
            <th>未回答</th>
            <th>平均時間</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((r) => (
            <tr
              key={r.id}
              className={r.id === selected ? "report-selected" : ""}
            >
              <th scope="row">
                <button
                  className="report-link"
                  aria-pressed={r.id === selected}
                  onClick={() => onSelect(r.id)}
                >
                  Q{r.number} ·{" "}
                  {choiceLabel(r.question, r.question.correctChoice)}
                </button>
              </th>
              <td>{r.question.difficulty}</td>
              <td>{roundLabels[r.status]}</td>
              <td>
                {r.correct} / {r.eligible}
              </td>
              <td>{percent(r.correctRate)}</td>
              <td>{r.unanswered}</td>
              <td>{seconds(r.averageElapsed)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
function PlayerList({
  report,
  selected,
  onSelect,
}: {
  report: Report;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("correct");
  const players = report.players
    .filter((p) =>
      `${p.name} ${p.id}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => {
      const order =
        sort === "name"
          ? a.name.localeCompare(b.name, "ja")
          : sort === "rate"
            ? (b.correctRate ?? -1) - (a.correctRate ?? -1)
            : sort === "time"
              ? (a.averageCorrectElapsed ?? Infinity) -
                (b.averageCorrectElapsed ?? Infinity)
              : b.correct - a.correct;
      return order || a.id.localeCompare(b.id);
    });
  return (
    <>
      <div className="report-toolbar">
        <label>
          参加者を検索
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前・識別子"
          />
        </label>
        <label>
          参加者の並び順
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="correct">正解数が多い順</option>
            <option value="rate">正答率が高い順</option>
            <option value="time">正解時の平均時間が短い順</option>
            <option value="name">名前順</option>
          </select>
        </label>
      </div>
      <Table label="参加者一覧">
        <thead>
          <tr>
            <th>参加者</th>
            <th>正解 / 対象</th>
            <th>正答率</th>
            <th>不正解</th>
            <th>未回答</th>
            <th>正解時の平均時間</th>
            <th>1位回数</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr
              key={p.id}
              className={p.id === selected ? "report-selected" : ""}
            >
              <th scope="row">
                <button
                  className="report-link"
                  aria-pressed={p.id === selected}
                  onClick={() => onSelect(p.id)}
                >
                  <Person player={p} />
                </button>
              </th>
              <td>
                {p.correct} / {p.eligible}
              </td>
              <td>{percent(p.correctRate)}</td>
              <td>{p.incorrect}</td>
              <td>{p.unanswered}</td>
              <td>{seconds(p.averageCorrectElapsed)}</td>
              <td>{p.firstPlaces}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {!players.length && (
        <p className="muted">
          {report.players.length
            ? "一致する参加者はいません。"
            : "参加者はいません。"}
        </p>
      )}
    </>
  );
}
