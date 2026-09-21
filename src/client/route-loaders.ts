import {
  redirectDocument,
  type LoaderFunctionArgs,
  type DataRouter,
} from "react-router";
import {
  RECENT_EVENTS_LIMIT,
  type EventPage,
  type EventSummary,
} from "../shared/events";
import type { Role, Question } from "../shared/types";
import type { TournamentReport } from "../shared/report";
import { api } from "./api";
import { RoomSession } from "./RoomSession";
export interface HomeData {
  events: EventSummary[] | null;
}
export interface EventsData {
  listing: EventPage | null;
}
export interface ViewerData extends HomeData {
  eventId: string;
  document: { name: string; questions: Question[] } | null;
}
export interface GameData {
  id: string;
  role: Role;
  name: string;
  session: RoomSession | null;
  finished: boolean;
}
export interface ReportData {
  id: string;
  report: TournamentReport | null;
  loginRequired: boolean;
  unavailable: boolean;
}
export function createRouteLoaders() {
  let config: { publicOrigin: string } | undefined;
  const sessions = new Set<RoomSession>();
  async function configuration({ request }: LoaderFunctionArgs) {
    const loaded =
      config ??
      (await api<{ publicOrigin: string }>(
        "/api/config",
        undefined,
        request.signal,
      ));
    request.signal.throwIfAborted();
    config = loaded;
    const url = new URL(request.url);
    if (url.origin !== loaded.publicOrigin) {
      // CookieとOriginの検証を統一するため、別名のアクセスだけは文書ごと移動する。
      throw redirectDocument(
        loaded.publicOrigin + url.pathname + url.search + url.hash,
      );
    }
    return loaded;
  }
  async function eventPage(
    args: LoaderFunctionArgs,
    query: string,
  ): Promise<EventPage | null> {
    await configuration(args);
    try {
      return await api<EventPage>(
        `/api/events?${query}`,
        undefined,
        args.request.signal,
      );
    } catch (error) {
      if ((error as { status?: number }).status === 401) return null;
      throw error;
    }
  }
  async function home(args: LoaderFunctionArgs): Promise<HomeData> {
    const data = await eventPage(args, `pageSize=${RECENT_EVENTS_LIMIT}`);
    return { events: data?.events ?? null };
  }
  async function events(args: LoaderFunctionArgs): Promise<EventsData> {
    const page = new URL(args.request.url).searchParams.get("page") ?? "1";
    return {
      listing: await eventPage(args, new URLSearchParams({ page }).toString()),
    };
  }
  async function viewer(args: LoaderFunctionArgs): Promise<ViewerData> {
    let data = await eventPage(args, "page=1");
    const events = data ? [...data.events] : null;
    // ビューワの大会選択では古い大会も引き続き選べるよう、全ページを取得する。
    while (data && data.page < data.pageCount) {
      const next = await eventPage(args, `page=${data.page + 1}`);
      if (!next) return { events: null, eventId: "", document: null };
      if (next.page <= data.page) break;
      events!.push(...next.events);
      data = next;
    }
    const requested = new URL(args.request.url).searchParams.get("event") ?? "";
    const document =
      events && requested
        ? await api<{ name: string; questions: Question[] }>(
            `/api/e/${encodeURIComponent(requested)}/questions`,
            undefined,
            args.request.signal,
          )
        : null;
    return {
      events,
      eventId: requested || events?.[0]?.id || "",
      document,
    };
  }
  const game =
    (role: Role) =>
    async (args: LoaderFunctionArgs): Promise<GameData> => {
      const { publicOrigin } = await configuration(args);
      const id = args.params.id!;
      const { name, finished } = await api<{ name: string; finished: boolean }>(
        `/api/e/${id}`,
        undefined,
        args.request.signal,
      );
      try {
        await api(
          `/api/e/${id}/session?role=${role}`,
          undefined,
          args.request.signal,
        );
      } catch (error) {
        if ((error as { status?: number }).status === 401)
          return { id, role, name, finished, session: null };
        throw error;
      }
      args.request.signal.throwIfAborted();
      const session = new RoomSession(id, role, publicOrigin);
      sessions.add(session);
      const abort = () => session.dispose(args.request.signal.reason);
      args.request.signal.addEventListener("abort", abort, { once: true });
      try {
        await session.ready;
        args.request.signal.throwIfAborted();
        return { id, role, name, finished, session };
      } catch (error) {
        session.dispose();
        sessions.delete(session);
        if ((error as { status?: number }).status === 401)
          return { id, role, name, finished, session: null };
        throw error;
      } finally {
        args.request.signal.removeEventListener("abort", abort);
      }
    };
  async function report(args: LoaderFunctionArgs): Promise<ReportData> {
    await configuration(args);
    const id = args.params.id!;
    try {
      const report = await api<TournamentReport>(
        `/api/e/${encodeURIComponent(id)}/report`,
        undefined,
        args.request.signal,
      );
      return { id, report, loginRequired: false, unavailable: false };
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 409)
        return {
          id,
          report: null,
          loginRequired: status === 401,
          unavailable: status === 409,
        };
      throw error;
    }
  }
  function retain(active?: RoomSession) {
    for (const session of sessions)
      if (session !== active) {
        session.dispose();
        sessions.delete(session);
      }
  }
  return { configuration, home, events, viewer, game, report, retain };
}

export function bindRoomSessions(
  router: DataRouter,
  loaders: ReturnType<typeof createRouteLoaders>,
) {
  // 次のloaderが完了するまでは現在の接続を維持する。
  // 中断された先読みはrequest.signal、遷移完了後の旧接続はここで閉じる。
  return router.subscribe((state) => {
    if (state.navigation.state !== "idle" || state.revalidation !== "idle")
      return;
    const game = state.matches
      .map((match) => state.loaderData[match.route.id])
      .find((data) => data && typeof data === "object" && "session" in data) as
      GameData | undefined;
    loaders.retain(state.errors ? undefined : (game?.session ?? undefined));
  });
}
