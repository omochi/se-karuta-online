import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { normalizeJoinCode } from "../shared/join-code";
import { api } from "./api";
import { ErrorBox } from "./components";

export function JoinTournamentForm() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const normalized = normalizeJoinCode(code);
    if (!normalized) {
      setError("参加コードを英字6文字で入力してください。");
      return;
    }
    setBusy(true);
    try {
      const { playUrl } = await api<{ playUrl: string }>(
        `/api/join-code?code=${encodeURIComponent(normalized)}`,
      );
      await navigate(new URL(playUrl).pathname);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="home-join" aria-labelledby="join-heading">
      <p className="eyebrow">JOIN THE GAME</p>
      <h2 id="join-heading">参加コードで大会に入る</h2>
      <p className="muted" id="join-hint">
        会場の画面にある英字6文字を入力してください。
      </p>
      <form className="stack" onSubmit={submit}>
        <label>
          参加コード
          <input
            className="join-code-input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ABCDEF"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={30}
            aria-describedby="join-hint join-code-case-hint"
            required
          />
          <small className="muted" id="join-code-case-hint">
            大文字でも小文字でも、同じコードとして受け付けます。
          </small>
        </label>
        <ErrorBox message={error} />
        <button className="primary" disabled={busy}>
          {busy ? "確認中…" : "名前の入力へ →"}
        </button>
      </form>
    </section>
  );
}
