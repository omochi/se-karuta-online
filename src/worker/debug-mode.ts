import { normalizePublicOrigin } from "../shared/urls";
import type { Env } from "./env";

export function debugModeEnabled(
  env: Pick<Env, "DEBUG_MODE" | "PUBLIC_ORIGIN">,
): boolean {
  if (env.DEBUG_MODE !== "true") return false;
  try {
    const host = new URL(normalizePublicOrigin(env.PUBLIC_ORIGIN)).hostname;
    return (
      host === "localhost" ||
      /^127\.\d+\.\d+\.\d+$/.test(host) ||
      /^192\.168\.\d+\.\d+$/.test(host)
    );
  } catch {
    return false;
  }
}
