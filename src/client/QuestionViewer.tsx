import { useEffect, useState } from "react";
import { CHOICES, type Question } from "../shared/types";
import { validateQuestions } from "../shared/questions";
import {
  Choices,
  ErrorBox,
  Header,
  MarkdownBody,
  PasswordForm,
} from "./components";
import { Link, useBlocker, useLoaderData, useRevalidator } from "react-router";
import type { ViewerData } from "./route-loaders";
import { api } from "./api";
import { useDisplayPreview } from "./useDisplayPreview";
import type { DisplayPreviewPhase } from "./display-preview";
import {
  readQuestionDocument,
  writeQuestionDocument,
  type QuestionDocument,
} from "./question-document";
import "./question-viewer.css";

export default function QuestionViewer() {
  const initial = useLoaderData<ViewerData>();
  return (
    <ViewerEditor
      key={`${initial.eventId}:${!!initial.events}:${!!initial.document}`}
      initial={initial}
    />
  );
}
function ViewerEditor({ initial }: { initial: ViewerData }) {
  const { events } = initial;
  const revalidator = useRevalidator();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [eventId, setEventId] = useState(initial.eventId);
  const [document, setDocument] = useState<QuestionDocument | null>(() =>
    initial.document
      ? readQuestionDocument(JSON.stringify(initial.document))
      : null,
  );
  const [source, setSource] = useState(
    initial.document ? `大会：${initial.document.name}` : "",
  );
  const [filename, setFilename] = useState("questions.json");
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState(0);
  const [search, setSearch] = useState("");
  const [showAnswer, setShowAnswer] = useState(true);
  const [dark, setDark] = useState(false);
  const [paste, setPaste] = useState("");
  const [sourcesOpen, setSourcesOpen] = useState(!initial.document);
  const [notice, setNotice] = useState("");
  const [displayPhase, setDisplayPhase] =
    useState<DisplayPreviewPhase>("acceptingAnswers");
  const q = document?.questions[selected];
  const displayPreviewUrl = useDisplayPreview(
    document && q
      ? {
          name:
            typeof document.metadata?.name === "string"
              ? document.metadata.name
              : source,
          question: q,
          questionNumber: selected + 1,
          totalQuestions: document.questions.length,
          phase: displayPhase,
        }
      : null,
  );
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const canReplace = () =>
    !dirty ||
    window.confirm(
      "ダウンロードしていない変更があります。破棄して別の問題集を開きますか？",
    );
  function accept(text: string, label: string, file: string) {
    const next = readQuestionDocument(text);
    setDocument(next);
    setSourcesOpen(false);
    setSource(label);
    setFilename(file);
    setSelected(0);
    setSearch("");
    setDirty(false);
    setError("");
    setNotice("");
  }
  async function loadEvent() {
    if (!canReplace()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ name: string; questions: Question[] }>(
        `/api/e/${eventId}/questions`,
      );
      accept(JSON.stringify(result), `大会：${result.name}`, "questions.json");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadFile(file: File) {
    if (!canReplace()) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 1_500_000)
        throw new Error("1.5 MB 以下のJSONを選んでください。");
      accept(await file.text(), file.name, file.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function patchQuestion(patch: Partial<Question>) {
    setDocument(
      (current) =>
        current && {
          ...current,
          questions: current.questions.map((q, i) =>
            i === selected ? { ...q, ...patch } : q,
          ),
        },
    );
    setDirty(true);
    setNotice("");
  }
  function download() {
    if (!document) return;
    try {
      const url = URL.createObjectURL(
        new Blob([writeQuestionDocument(document)], {
          type: "application/json",
        }),
      );
      const link = window.document.createElement("a");
      link.href = url;
      link.download = filename.replace(/\.json$/i, "") + "-reviewed.json";
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        "JSONのダウンロードを開始しました。次の大会を作るときに取り込んでください。",
      );
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  let validation = "";
  if (document) {
    try {
      validateQuestions(document.questions);
    } catch (e) {
      validation = (e as Error).message;
    }
  }
  const filtered =
    document?.questions
      .map((question, index) => ({ question, index }))
      .filter(({ question }) =>
        [
          question.id,
          question.bodyMarkdown,
          question.explanationMarkdown,
          ...Object.values(question.choices),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) ?? [];
  return (
    <>
      <Header>
        <Link className="viewer-home-link" to="/">
          大会一覧へ →
        </Link>
      </Header>
      <main className="question-viewer">
        {blocker.state === "blocked" && (
          <div
            className="confirmation"
            role="dialog"
            aria-labelledby="leave-viewer-title"
          >
            <h2 id="leave-viewer-title">編集内容を破棄して移動しますか？</h2>
            <p>ダウンロードしていない変更があります。</p>
            <div className="host-actions">
              <button className="secondary" onClick={() => blocker.reset()}>
                編集を続ける
              </button>
              <button className="danger" onClick={() => blocker.proceed()}>
                破棄して移動
              </button>
            </div>
          </div>
        )}
        <div className="viewer-title">
          <div>
            <p className="eyebrow">QUESTION WORKSHOP</p>
            <h1>問題ビューワ</h1>
            <p className="muted">一問ずつ読みながら、問題集を磨こう。</p>
          </div>
          {document && (
            <button
              className="primary"
              disabled={busy || !!validation}
              onClick={download}
            >
              JSONをダウンロード ↓
            </button>
          )}
        </div>
        {events === null ? (
          <section className="panel viewer-login">
            <h2>管理用パスワードで開く</h2>
            <PasswordForm
              label="管理用パスワード"
              error={error}
              onSubmit={async (password) => {
                try {
                  await api("/api/admin/login", { password });
                  await revalidator.revalidate();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          </section>
        ) : (
          <>
            <details
              className="panel viewer-source"
              open={sourcesOpen}
              onToggle={(e) => setSourcesOpen(e.currentTarget.open)}
            >
              <summary>問題集を開く・切り替える</summary>
              <div className="viewer-source-row">
                <label>
                  大会の問題集
                  <select
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">大会を選択</option>
                    {events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name} ·{" "}
                        {new Date(event.created_at).toLocaleString("ja-JP")} ·{" "}
                        {event.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary"
                  onClick={loadEvent}
                  disabled={!eventId || busy}
                >
                  大会から読み込む
                </button>
                <label className="viewer-file">
                  JSONファイルを開く
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void loadFile(file);
                    }}
                  />
                </label>
              </div>
              <details className="viewer-paste">
                <summary>JSONを貼り付けて開く</summary>
                <label>
                  問題集のJSON
                  <textarea
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    rows={5}
                    spellCheck={false}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={busy || !paste.trim()}
                  onClick={() => {
                    if (!canReplace()) return;
                    try {
                      accept(paste, "貼り付けたJSON", "questions.json");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  貼り付けたJSONを読み込む
                </button>
              </details>
              <ErrorBox message={error} />
            </details>
            {document && q ? (
              <>
                <div className="viewer-summary">
                  <div>
                    <strong>{source}</strong>
                    <span>
                      {document.questions.length} 問
                      {dirty ? " · 変更あり（未ダウンロード）" : ""}
                    </span>
                  </div>
                  <div className="answer-balance" aria-label="正解の分布">
                    {CHOICES.map((c) => (
                      <span key={c}>
                        {c}
                        <strong>
                          {
                            document.questions.filter(
                              (q) => q.correctChoice === c,
                            ).length
                          }
                        </strong>
                      </span>
                    ))}
                  </div>
                </div>
                <p className="viewer-note">
                  編集内容はJSONとしてダウンロードしてください。元ファイルや大会の問題は変更されません。
                </p>
                {notice && (
                  <p className="viewer-notice" role="status">
                    {notice}
                  </p>
                )}
                <ErrorBox message={validation} />
                <div className="viewer-layout">
                  <aside className="panel viewer-index">
                    <label>
                      問題を検索
                      <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="ID・本文・選択肢"
                      />
                    </label>
                    <p className="muted">
                      {filtered.length} / {document.questions.length} 問
                    </p>
                    <nav aria-label="問題一覧">
                      {filtered.map(({ question, index }) => (
                        <button
                          key={index}
                          aria-current={selected === index ? "true" : undefined}
                          onClick={() => setSelected(index)}
                        >
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <strong>{question.id || "ID未入力"}</strong>
                            <small>
                              {question.bodyMarkdown
                                .split("\n")
                                .find((line) => line.trim())}
                            </small>
                          </div>
                        </button>
                      ))}
                    </nav>
                    {!filtered.length && <p>一致する問題がありません。</p>}
                  </aside>
                  <div className="viewer-detail">
                    <div className="viewer-display-toolbar">
                      <a
                        className="secondary"
                        href={displayPreviewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Displayプレビューを開く ↗
                      </a>
                      <label>
                        Displayの表示状態
                        <select
                          value={displayPhase}
                          onChange={(e) =>
                            setDisplayPhase(
                              e.target.value as DisplayPreviewPhase,
                            )
                          }
                        >
                          <option value="choicesReading">選択肢公開</option>
                          <option value="acceptingAnswers">出題中</option>
                          <option value="answerRevealed">正解発表</option>
                        </select>
                      </label>
                      <p className="muted">
                        選択・編集を自動で反映。タブを別ウィンドウに移して、大きさを変えて確認できます。
                      </p>
                    </div>
                    <div className="viewer-toolbar">
                      <div>
                        <button
                          className="secondary"
                          onClick={() => setSelected((i) => i - 1)}
                          disabled={selected === 0}
                        >
                          ← 前の問題
                        </button>
                        <strong>
                          {selected + 1} / {document.questions.length}
                        </strong>
                        <button
                          className="secondary"
                          onClick={() => setSelected((i) => i + 1)}
                          disabled={selected === document.questions.length - 1}
                        >
                          次の問題 →
                        </button>
                      </div>
                      <div>
                        <label>
                          <input
                            type="checkbox"
                            checked={showAnswer}
                            onChange={(e) => setShowAnswer(e.target.checked)}
                          />
                          正解・解説を表示
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={dark}
                            onChange={(e) => setDark(e.target.checked)}
                          />
                          暗い背景
                        </label>
                      </div>
                    </div>
                    <article
                      className={`panel viewer-preview ${dark ? "viewer-preview-dark" : ""}`}
                      aria-label="問題プレビュー"
                    >
                      <p className="eyebrow">
                        QUESTION {String(selected + 1).padStart(2, "0")}{" "}
                        <span> / {q.id}</span>
                      </p>
                      <MarkdownBody text={q.bodyMarkdown} />
                      <Choices question={q} showCorrect={showAnswer} />
                      {showAnswer && (
                        <section className="explanation">
                          <h2>正解 {q.correctChoice}</h2>
                          <MarkdownBody text={q.explanationMarkdown} />
                        </section>
                      )}
                    </article>
                    <details className="panel viewer-editor" key={selected}>
                      <summary>この問題を調整する</summary>
                      <p className="muted">
                        入力すると上のプレビューに反映されます。問題文と解説にはMarkdownを使えます。
                      </p>
                      <fieldset className="stack viewer-fields" disabled={busy}>
                        <label>
                          問題ID
                          <input
                            value={q.id}
                            onChange={(e) =>
                              patchQuestion({ id: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          問題文（Markdown）
                          <textarea
                            rows={8}
                            value={q.bodyMarkdown}
                            spellCheck={false}
                            onChange={(e) =>
                              patchQuestion({ bodyMarkdown: e.target.value })
                            }
                          />
                        </label>
                        <div className="viewer-edit-choices">
                          {CHOICES.map((c) => (
                            <label key={c}>
                              選択肢 {c}
                              <textarea
                                rows={2}
                                value={q.choices[c]}
                                onChange={(e) =>
                                  patchQuestion({
                                    choices: {
                                      ...q.choices,
                                      [c]: e.target.value,
                                    },
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <label>
                          正解
                          <select
                            value={q.correctChoice}
                            onChange={(e) =>
                              patchQuestion({
                                correctChoice: e.target
                                  .value as Question["correctChoice"],
                              })
                            }
                          >
                            {CHOICES.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          解説（Markdown）
                          <textarea
                            rows={6}
                            value={q.explanationMarkdown}
                            spellCheck={false}
                            onChange={(e) =>
                              patchQuestion({
                                explanationMarkdown: e.target.value,
                              })
                            }
                          />
                        </label>
                      </fieldset>
                    </details>
                  </div>
                </div>
              </>
            ) : (
              <section className="viewer-empty">
                <span>≋</span>
                <h2>確認したい問題集を開こう</h2>
                <p>
                  大会から読み込むか、手元のJSONファイルを選んでください。
                  <br />
                  問題文・選択肢・正解・解説をまとめて確認できます。
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
