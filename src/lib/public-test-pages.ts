import { notFound } from "next/navigation";

/**
 * Opt in to serving dev harness pages on a production server.
 * Read per request (the gated routes are force-dynamic), so set this on
 * the server process and restart. Value must be the string "1".
 */
export const PUBLIC_TEST_PAGES_OPT_IN_ENV = "ENABLE_PUBLIC_TEST_PAGES";

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

/** Real 404 (app not-found UI, noindex) when a public test page is hidden. */
export function gatePublicTestPage(): void {
  if (isPublicTestPageBlocked()) notFound();
}
