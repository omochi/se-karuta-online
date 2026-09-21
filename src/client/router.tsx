import { useEffect } from "react";
import {
  Outlet,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
  type RouteObject,
} from "react-router";
import { Home, GamePage } from "./App";
import QuestionViewer from "./QuestionViewer";
import { Brand, Header } from "./components";
import { createRouteLoaders } from "./route-loaders";
export function InitialScreen() {
  // 初回アクセスだけの外枠。ページ間の遷移では現在の画面が維持される。
  return (
    <div className="loading" aria-label="SE Karuta">
      <Brand />
    </div>
  );
}
function Layout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
function RouteError({
  loaders,
}: {
  loaders: ReturnType<typeof createRouteLoaders>;
}) {
  const error = useRouteError();
  useEffect(() => {
    loaders.retain();
  }, [loaders]);
  const message =
    isRouteErrorResponse(error) && error.status === 404
      ? "ページが見つかりません。"
      : error instanceof Error
        ? error.message
        : "画面を開けませんでした。";
  return (
    <>
      <Header />
      <main className="gate">
        <h1>画面を開けませんでした</h1>
        <p role="alert">{message}</p>
        <button className="primary" onClick={() => location.reload()}>
          再試行
        </button>
      </main>
    </>
  );
}
export function createAppRoutes(
  loaders: ReturnType<typeof createRouteLoaders>,
): RouteObject[] {
  return [
    {
      id: "root",
      path: "/",
      loader: loaders.configuration,
      shouldRevalidate: () => false,
      Component: Layout,
      HydrateFallback: InitialScreen,
      errorElement: <RouteError loaders={loaders} />,
      children: [
        { index: true, loader: loaders.home, Component: Home },
        {
          path: "questions",
          loader: loaders.viewer,
          Component: QuestionViewer,
        },
        ...(["control", "display", "play"] as const).map((path) => ({
          id: `game-${path}`,
          path: `e/:id/${path}`,
          loader: loaders.game(path === "play" ? "player" : path),
          Component: GamePage,
        })),
        {
          path: "*",
          loader: () => {
            throw new Response(null, { status: 404 });
          },
        },
      ],
    },
  ];
}
