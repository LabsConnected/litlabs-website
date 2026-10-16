/**
 * Opt in to serving dev harness pages from a production build.
 * `next build` reads this while it computes rewrites (that is what makes
 * the HTTP status a real 404). The page gate reads it again per request.
 * Value must be the string "1".
 */
export const PUBLIC_TEST_PAGES_OPT_IN_ENV = "ENABLE_PUBLIC_TEST_PAGES";

/** Routes that exist for local development and must not be public in production. */
export const HIDDEN_PUBLIC_TEST_PATHS = [
  "/games/retro/test",
  "/studio/visual-test",
  "/runtime-test",
] as const;

const HIDDEN_DESTINATION = "/__hidden-public-test-page";

/**
 * Development and test keep harness routes reachable. Production hides
 * them unless ENABLE_PUBLIC_TEST_PAGES=1.
 */
export function isPublicTestPageBlocked(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV !== "production") return false;
  return env[PUBLIC_TEST_PAGES_OPT_IN_ENV] !== "1";
}

/** Always-on rewrite so /agents/[slug] is handled outside the app loading shell. */
export function agentSlugGateRewrites(): { source: string; destination: string }[] {
  return [{ source: "/agents/:slug", destination: "/agent-slug/:slug" }];
}

/**
 * Production rewrites that run before the page is matched, so the harness
 * URL serves the app's real 404 (the unmatched-route response) instead of
 * a streamed 200. Omitted in development and when the opt-in flag is "1".
 */
export function hiddenPublicTestRewrites(
  env: NodeJS.ProcessEnv = process.env,
): { source: string; destination: string }[] {
  if (!isPublicTestPageBlocked(env)) return [];
  return HIDDEN_PUBLIC_TEST_PATHS.flatMap((path) => [
    { source: path, destination: HIDDEN_DESTINATION },
    { source: `${path}/:path*`, destination: HIDDEN_DESTINATION },
  ]);
}
