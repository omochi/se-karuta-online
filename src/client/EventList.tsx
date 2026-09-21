import { Link } from "react-router";
import type { EventSummary } from "../shared/events";

const statusLabels = { waiting: "準備中", active: "進行中", finished: "終了" };

export function EventList({ events }: { events: EventSummary[] }) {
  return (
    <div className="event-list">
      {events.map((event) => (
        <Link
          className="event-card"
          key={event.id}
          to={new URL(event.urls.control).pathname}
        >
          <div>
            <div className="event-meta">
              <small>
                {new Date(event.created_at).toLocaleDateString("ja-JP")}
              </small>
              <span className={`event-status event-status-${event.status}`}>
                {statusLabels[event.status]}
              </span>
            </div>
            <h3>{event.name}</h3>
          </div>
          <span>進行画面へ →</span>
        </Link>
      ))}
    </div>
  );
}
