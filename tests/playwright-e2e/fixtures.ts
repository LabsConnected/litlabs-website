import { test as base, expect } from "@playwright/test";

/**
 * Isolated E2E fixtures — network allowlist with fail-closed enforcement.
 *
 * Every browser context created from this `test` gets a context-level route
 * that permits ONLY allowlisted hosts. Anything else is aborted AND recorded;
 * the `e2eViolations` fixture asserts the list is empty after each test, so an
 * unexpected external request fails the test even if the page handled the
 * failure gracefully.
 *
 * Coverage notes:
 * - context.route covers all requests from every page in the context —
 *   navigations, XHR/fetch, media, websockets.
 * - Service workers are blocked at the config level (serviceWorkers:"block")
 *   because public/sw.js would otherwise issue un-routable fetches.
 * - Server-side requests (Next.js SSR / route handlers) are NOT covered by
 *   browser routing — that layer is isolated by the server env allowlist in
 *   playwright.e2e.config.ts (the server can only reach the E2E Supabase stack
 *   and the Clerk dev instance named in e2e/env.e2e).
 * - The Node test process itself (auth.setup via @clerk/backend → api.clerk.com)
 *   is not browser traffic and is expected; it is the official Clerk testing
 *   path, not an application leak.
 */

export interface NetworkViolation {
  url: string;
  resourceType: string;
}

const APP_HOSTS = [
  /^127\.0\.0\.1:3001$/,
  /^localhost:3001$/,
  /^\[::1\]:3001$/,
];

// LiTTreeLabStudio_E2E local stack — kong api 55321, db 55322, studio 55323,
// mailpit 55324, analytics 55327, pooler 55329 (see supabase/config.toml).
const SUPABASE_E2E_HOSTS = [
  /^127\.0\.0\.1:5532\d$/,
  /^localhost:5532\d$/,
  /^\[::1\]:5532\d$/,
];

// Clerk DEVELOPMENT instance only — browser-side FAPI + asset hosts.
// Live/production Clerk hosts are deliberately absent.
const CLERK_DEV_HOSTS = [
  /(^|\.)clerk\.accounts\.dev$/,
  /(^|\.)img\.clerk\.com$/,
  /(^|\.)images\.clerk\.dev$/,
];

// E2E terminal-server (loopback only) — the Studio shell opens a ws/http
// channel to NEXT_PUBLIC_TERMINAL_* for workspace file ops.
const TERMINAL_E2E_HOSTS = [
  /^127\.0\.0\.1:4401$/,
  /^localhost:4401$/,
  /^\[::1\]:4401$/,
];

// Reviewed exceptions — public read-only font CDN, no credentials attached:
// - app layout uses next/font (self-hosted at build, no runtime request)
// - canvas-to-html emits fonts.googleapis <link> inside the sandboxed
//   preview iframe srcdoc, which IS a real runtime request
const STATIC_CDN_HOSTS = [
  /^fonts\.googleapis\.com$/,
  /^fonts\.gstatic\.com$/,
];

// Tolerated-but-blocked hosts: the app emits these requests itself (its own
// marketing tracker — src/components/GhlAffiliateTracker.tsx loads
// link.msgsndr.com/js/am.js on every page). In E2E they are ABORTED before
// any bytes leave the browser — never sent, no live egress — and recorded
// in e2eBlockedTolerated for diagnostics instead of failing the test.
const BLOCKED_TOLERATED_HOSTS = [/^link\.msgsndr\.com$/];

const ALLOWED_HOST_PATTERNS = [
  ...APP_HOSTS,
  ...SUPABASE_E2E_HOSTS,
  ...TERMINAL_E2E_HOSTS,
  ...CLERK_DEV_HOSTS,
  ...STATIC_CDN_HOSTS,
];

function isAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Non-network schemes (data:, blob:, about:, chrome:) issue no egress.
  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:" &&
    parsed.protocol !== "ws:" &&
    parsed.protocol !== "wss:"
  ) {
    return true;
  }
  return ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(parsed.host));
}

export const test = base.extend<{
  e2eViolations: NetworkViolation[];
}>({
  context: async ({ context }, use) => {
    const violations: NetworkViolation[] = [];
    const tolerated: NetworkViolation[] = [];
    (context as unknown as { __e2eViolations: NetworkViolation[] }).__e2eViolations =
      violations;
    (context as unknown as { __e2eBlockedTolerated: NetworkViolation[] }).__e2eBlockedTolerated =
      tolerated;

    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (isAllowed(url)) {
        await route.continue();
        return;
      }
      let host = "";
      try {
        host = new URL(url).host;
      } catch {
        // unparseable → not tolerated
      }
      if (host && BLOCKED_TOLERATED_HOSTS.some((p) => p.test(host))) {
        tolerated.push({ url, resourceType: request.resourceType() });
      } else {
        violations.push({ url, resourceType: request.resourceType() });
      }
      await route.abort();
    });

    await use(context);
  },

  e2eViolations: [
    async ({ context }, use) => {
      const violations =
        (context as unknown as { __e2eViolations?: NetworkViolation[] })
          .__e2eViolations ?? [];
      await use(violations);
      // Fail closed: ANY off-allowlist request fails the test.
      expect(
        violations.map((v) => `${v.resourceType} ${v.url}`),
        "off-allowlist network requests detected",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export const E2E_GATES = {
  stackReady: process.env.E2E_STACK_READY === "true",
  authStatePath: process.env.E2E_AUTH_STATE
    ? process.env.E2E_AUTH_STATE
    : "tests/playwright-e2e/.clerk/user-e2e.json",
};
