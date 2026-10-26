export interface Env {
  DB: D1Database;
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  PUBLIC_ORIGIN: string;
}
