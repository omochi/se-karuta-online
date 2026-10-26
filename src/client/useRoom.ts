import { useEffect, useRef, useSyncExternalStore } from "react";
import type { RoomSession } from "./RoomSession";
export function useRoom(session: RoomSession) {
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const { view, connected, error, busy, pending, generation } = snapshot;
  const lastReady = useRef<{ session: RoomSession; key: string } | null>(null);
  useEffect(() => {
    let first = 0;
    let second = 0;
    const cancel = () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
    const prepare = () => {
      cancel();
      if (
        !connected ||
        !view?.question ||
        view.phase !== "choicesPreparing" ||
        session.role !== "player" ||
        document.visibilityState !== "visible"
      )
        return;
      const key = `${generation}:${view.epoch}:${view.question.id}`;
      if (
        lastReady.current?.session === session &&
        lastReady.current.key === key
      )
        return;
      // loaderの先読みではなく、遷移先の描画機会を経てから通知する。
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          if (
            document.visibilityState === "visible" &&
            session.send({
              type: "ready",
              roundId: view.question!.id,
              epoch: view.epoch,
            })
          )
            lastReady.current = { session, key };
        });
      });
    };
    const visible = () => {
      if (document.visibilityState === "visible") {
        lastReady.current = null;
        session.send({ type: "ping" });
        session.synchronizeClock();
      }
      prepare();
    };
    prepare();
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [connected, view, generation, session]);
  return {
    view,
    connected,
    error,
    busy,
    pending: pending?.roundId === view?.question?.id ? pending : null,
    answer: session.answer,
    command: session.command,
    serverNow: session.serverNow,
  };
}
export type RoomConnection = ReturnType<typeof useRoom>;
