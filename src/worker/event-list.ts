import {
  EVENTS_PAGE_SIZE,
  type EventPage,
  type EventSummary,
} from "../shared/events";
import { eventUrls } from "../shared/urls";

export async function listEvents(
  db: D1Database,
  search: URLSearchParams,
  publicOrigin: string,
): Promise<EventPage | null> {
  const readPositiveInteger = (key: string, fallback: number) => {
    const value = search.get(key);
    if (value === null) return fallback;
    return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
      ? Number(value)
      : NaN;
  };
  const requestedPage = readPositiveInteger("page", 1);
  const pageSize = readPositiveInteger("pageSize", EVENTS_PAGE_SIZE);
  if (
    !Number.isFinite(requestedPage) ||
    !Number.isFinite(pageSize) ||
    pageSize > EVENTS_PAGE_SIZE
  )
    return null;

  const count = await db
    .prepare("SELECT COUNT(*) AS total FROM tournaments")
    .first<{ total: number }>();
  const total = count!.total;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const { results } = await db
    .prepare(
      `
    SELECT id, name, created_at,
      CASE json_extract(state_json, '$.phase')
        WHEN 'waiting' THEN 'waiting'
        WHEN 'finished' THEN 'finished'
        ELSE 'active'
      END AS status
    FROM tournaments
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `,
    )
    .bind(pageSize, (page - 1) * pageSize)
    .all<Omit<EventSummary, "urls">>();
  return {
    events: results.map((row) => ({
      ...row,
      urls: eventUrls(publicOrigin, row.id),
    })),
    page,
    pageSize,
    total,
    pageCount,
  };
}
