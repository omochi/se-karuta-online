import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { DisplayScreen } from "./DisplayScreen";
import { getGameProgress } from "./phase-presentation";
import {
  createDisplayPreviewView,
  type DisplayPreviewMessage,
  type DisplayPreviewSnapshot,
} from "./display-preview";
import type { QuestionFit } from "./fit-question";

export default function QuestionDisplayPreview() {
  const [snapshot, setSnapshot] = useState<DisplayPreviewSnapshot | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const { hash } = useLocation();
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Displayプレビュー · SE Karuta";
    return () => {
      document.title = previousTitle;
    };
  }, []);
  useEffect(() => {
    setSnapshot(null);
    const id = hash.slice(1);
    if (!/^[a-f0-9]{32}$/.test(id)) return;
    const connection = new BroadcastChannel(`display-preview:${id}`);
    channel.current = connection;
    connection.onmessage = (event: MessageEvent<DisplayPreviewMessage>) => {
      if (event.data?.type === "display-preview-state")
        setSnapshot(event.data.snapshot);
      else if (event.data?.type === "display-preview-closed") setSnapshot(null);
    };
    connection.postMessage({
      type: "display-preview-ready",
    } satisfies DisplayPreviewMessage);
    return () => {
      connection.close();
      channel.current = null;
    };
  }, [hash]);

  const reportFit = useCallback(
    (fit: QuestionFit) => {
      if (!snapshot) return;
      channel.current?.postMessage({
        type: "display-preview-fit",
        fit: {
          ...fit,
          questionId: snapshot.question.id,
          phase: snapshot.phase,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
      } satisfies DisplayPreviewMessage);
    },
    [snapshot],
  );

  if (!snapshot)
    return (
      <main className="gate">
        <h1>Displayプレビュー</h1>
        <p>
          問題ビューワで問題集を読み込み、「Displayプレビューを開く」を押してください。
        </p>
      </main>
    );

  const view = createDisplayPreviewView(snapshot, window.location.origin);
  return (
    <DisplayScreen
      view={view}
      // レイアウト確認中は時間を進めず、本番と同じタイマーを15秒で固定する。
      progress={getGameProgress(view, 0)}
      status={<span className="connection">プレビュー</span>}
      onQuestionFit={reportFit}
    />
  );
}
