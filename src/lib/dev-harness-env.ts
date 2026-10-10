/**
 * Opt-in for developer harness routes in a production build.
 * Set `LITT_ENABLE_DEV_HARNESS=1` and rebuild to serve them.
 * Any other value keeps the production 404.
 */
export const DEV_HARNESS_FLAG = "LITT_ENABLE_DEV_HARNESS";

export const DEV_HARNESS_PATHS = [
  "/games/retro/test",
  "/studio/visual-test",
  "/runtime-test",
] as const;

export function isDevHarnessEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env[DEV_HARNESS_FLAG];
  if (flag === "1" || flag === "true") return true;
  return env.NODE_ENV !== "production";
}

/**
 * Production builds rewrite harness URLs to a path that does not exist, so
 * the router returns the app 404 before the root loading shell can stream a
 * 200. `next dev` does not apply these rewrites.
 *
 * The flag is read when the production build evaluates next.config. Set it
 * and rebuild to keep the routes.
 */
export function devHarnessProductionRewrites(
  env: NodeJS.ProcessEnv = process.env,
): { source: string; destination: string }[] {
  if (env.NODE_ENV !== "production" || isDevHarnessEnabled(env)) return [];
  return DEV_HARNESS_PATHS.flatMap((source) => [
    { source, destination: "/__dev-harness-unavailable" },
    { source: `${source}/:path*`, destination: "/__dev-harness-unavailable" },
  ]);
}
