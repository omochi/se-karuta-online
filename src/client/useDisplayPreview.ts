import { useEffect, useRef, useState } from "react";
import type {
  DisplayPreviewMessage,
  DisplayPreviewSnapshot,
} from "./display-preview";

export function useDisplayPreview(snapshot: DisplayPreviewSnapshot | null) {
  // LANのHTTPでも使えるgetRandomValuesで、ビューワごとの通信先を分ける。
  const [id] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join(""),
  );
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef(snapshot);

  useEffect(() => {
    latest.current = snapshot;
    if (snapshot)
      channel.current?.postMessage({
        type: "display-preview-state",
        snapshot,
      } satisfies DisplayPreviewMessage);
  }, [snapshot]);

  useEffect(() => {
    const connection = new BroadcastChannel(`display-preview:${id}`);
    channel.current = connection;
    const send = () => {
      if (latest.current)
        connection.postMessage({
          type: "display-preview-state",
          snapshot: latest.current,
        } satisfies DisplayPreviewMessage);
    };
    // 普通のリンクから開いた画面へ、準備完了後に最新の編集状態を送る。
    connection.onmessage = (event: MessageEvent<DisplayPreviewMessage>) => {
      if (event.data?.type === "display-preview-ready") send();
    };
    const disconnected = () =>
      connection.postMessage({
        type: "display-preview-closed",
      } satisfies DisplayPreviewMessage);
    window.addEventListener("pagehide", disconnected);
    window.addEventListener("pageshow", send);
    return () => {
      window.removeEventListener("pagehide", disconnected);
      window.removeEventListener("pageshow", send);
      disconnected();
      connection.close();
      channel.current = null;
    };
  }, [id]);

  return `/questions/display-preview#${id}`;
}
