import { notFound } from "next/navigation";

/**
 * Opt-in for developer harness routes in a production build.
 * Set `LITT_ENABLE_DEV_HARNESS=1` to serve them; any other value keeps
 * the production 404.
 */
export const DEV_HARNESS_FLAG = "LITT_ENABLE_DEV_HARNESS";

export function isDevHarnessEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env[DEV_HARNESS_FLAG];
  if (flag === "1" || flag === "true") return true;
  return env.NODE_ENV !== "production";
}

/** 404 harness routes in production unless `LITT_ENABLE_DEV_HARNESS=1`. */
export function guardDevHarnessRoute(): void {
  if (!isDevHarnessEnabled()) notFound();
}
