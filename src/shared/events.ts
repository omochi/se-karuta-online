import type { EventUrls } from "./urls";

export const RECENT_EVENTS_LIMIT = 5;
export const EVENTS_PAGE_SIZE = 20;

export type EventStatus = "waiting" | "active" | "finished";
export interface EventSummary {
  id: string;
  name: string;
  created_at: number;
  status: EventStatus;
  urls: EventUrls;
}
export interface EventPage {
  events: EventSummary[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}
