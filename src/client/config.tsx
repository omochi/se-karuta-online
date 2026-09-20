import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const PublicOrigin = createContext("");
export const usePublicOrigin = () => useContext(PublicOrigin);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/config", { cache: "no-store" })
      .then(async (response) => {
        const config = (await response.json()) as {
          publicOrigin: string;
          error?: string;
        };
        if (!response.ok)
          throw new Error(config.error ?? "設定を取得できませんでした。");
        if (cancelled) return;
        // Cookie と Origin の検証を統一するため、別名で開いた画面も公開URLに揃える。
        if (location.origin !== config.publicOrigin) {
          location.replace(
            config.publicOrigin +
              location.pathname +
              location.search +
              location.hash,
          );
          return;
        }
        setOrigin(config.publicOrigin);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (error)
    return (
      <main className="auth-page">
        <p role="alert">{error}</p>
        <button onClick={() => location.reload()}>再読み込み</button>
      </main>
    );
  if (!origin)
    return (
      <main className="auth-page">
        <p>接続しています…</p>
      </main>
    );
  return (
    <PublicOrigin.Provider value={origin}>{children}</PublicOrigin.Provider>
  );
}
