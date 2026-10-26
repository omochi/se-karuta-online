import { useEffect, useState } from "react";
import type { RoomConnection } from "./useRoom";
import { getGameProgress } from "./phase-presentation";

export function useGameProgress(room: RoomConnection) {
  const view = room.view!;
  const [, tick] = useState(0);
  useEffect(() => {
    if (view.phaseEndsAt === null) return;
    const timer = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(timer);
  }, [view.phaseEndsAt]);
  return getGameProgress(view, room.serverNow());
}
