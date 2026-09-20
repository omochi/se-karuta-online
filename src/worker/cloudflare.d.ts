import type { Env as WorkerEnv } from "./env";
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
    interface GlobalProps {
      mainModule: typeof import("./index");
      durableNamespaces: "TournamentRoom";
    }
  }
}
