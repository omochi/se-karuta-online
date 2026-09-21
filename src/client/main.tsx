import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { createAppRoutes } from "./router";
import { createRouteLoaders, bindRoomSessions } from "./route-loaders";
import "./style.css";
const loaders = createRouteLoaders();
const router = createBrowserRouter(createAppRoutes(loaders));
const unsubscribe = bindRoomSessions(router, loaders);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    unsubscribe();
    router.dispose();
    loaders.retain();
  });
