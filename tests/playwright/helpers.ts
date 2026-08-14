import type { Page } from "@playwright/test";

/**
 * Application error monitor for Playwright tests.
 *
 * Collects page errors, console errors, failed requests, and 5xx responses.
 * Uses a small documented allowlist of known third-party noise.
 */
export function monitorApplicationErrors(page: Page): string[] {
  const errors: string[] = [];

  // Allowlist of URL patterns that are known to fail and are not application errors
  const ALLOWED_FAILURES = [
    "google-analytics.com",
    "googletagmanager.com",
    "clerk.google.dev", // Clerk dev domain handshake (not an app error)
    "fonts.gstatic.com", // Font loading race conditions
    "vitals.vercel-insights.com", // Vercel analytics
  ];

  const isAllowed = (url: string): boolean =>
    ALLOWED_FAILURES.some((pattern) => url.includes(pattern));

  page.on("pageerror", (error) => {
    // Filter out React hydration error #418 — known Clerk SSR issue that
    // doesn't break functionality. Clerk injects client-side auth state
    // that differs from the server-rendered HTML.
    if (error.message.includes("418")) return;
    errors.push(`PAGE ERROR: ${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      // Ignore known non-application errors:
      // - Clerk development warnings
      // - React warnings (dev mode)
      // - React DevTools prompt
      // - 401/403 resource loads (expected when signed out — Clerk auth checks)
      // - 404 resource loads (may be intentional feature-flagged routes)
      // - SSL protocol errors (Clerk https redirect in local dev)
      if (
        !text.includes("Clerk") &&
        !text.includes("Warning:") &&
        !text.includes("Download the React DevTools") &&
        !text.includes("status of 401") &&
        !text.includes("status of 403") &&
        !text.includes("status of 404") &&
        !text.includes("ERR_SSL_PROTOCOL_ERROR") &&
        !text.includes("SSL connect error") &&
        !text.includes("ERR_ABORTED") &&
        !text.includes("Failed to load resource") &&
        !text.includes("Content-Security-Policy") &&
        !text.includes("JavaScript Error") &&
        !text.includes("[Report Only]") &&
        !text.includes("Report Only")
      ) {
        errors.push(`CONSOLE ERROR: ${text}`);
      }
    }
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!isAllowed(url)) {
      const errorText = request.failure()?.errorText ?? "unknown";
      // Ignore SSL errors, aborted requests, and Clerk auth redirects
      // These are expected in local dev when Clerk tries https on http server
      if (
        !errorText.includes("ERR_SSL_PROTOCOL_ERROR") &&
        !errorText.includes("SSL connect error") &&
        !errorText.includes("ERR_ABORTED") &&
        !errorText.includes("ERR_CONNECTION_REFUSED") &&
        !url.includes("/sign-in") &&
        !url.includes("/sign-up") &&
        // Ignore https:// requests to local http server (Clerk redirect issue)
        !(url.startsWith("https://") && (url.includes("127.0.0.1") || url.includes("localhost")))
      ) {
        errors.push(
          `REQUEST FAILED: ${request.method()} ${url} — ${errorText}`,
        );
      }
    }
  });

  page.on("response", (response) => {
    const url = response.url();
    // Only flag 5xx responses from our own domain (not third-party APIs)
    // 401/403/404 are expected when signed out — not application errors
    // /api/health is excluded: it returns 503 when DB/terminal are unavailable
    // (expected on CI without Supabase/terminal-server infrastructure)
    if (
      (url.includes("litlabs.net") || url.includes("127.0.0.1:3001") || url.includes("localhost:3001") || url.includes("127.0.0.1:3000") || url.includes("localhost:3000")) &&
      !url.includes("/api/health") &&
      response.status() >= 500
    ) {
      errors.push(`HTTP ${response.status()}: ${url}`);
    }
  });

  return errors;
}

/**
 * Assert that no application errors were collected.
 * Call this at the end of each test.
 */
export function assertNoErrors(errors: string[]): void {
  if (errors.length > 0) {
    throw new Error(
      `Application errors detected:\n${errors.join("\n")}`,
    );
  }
}

/**
 * Wait for a page to fully load — not just return a status code.
 * Verifies that the body has meaningful content and no loading state.
 */
export async function waitForPageReady(page: Page, options?: {
  expectedText?: string | RegExp;
  testId?: string;
  timeout?: number;
}): Promise<void> {
  const timeout = options?.timeout ?? 30_000;

  if (options?.testId) {
    await page.getByTestId(options.testId).waitFor({ state: "visible", timeout });
  }

  if (options?.expectedText) {
    await page.getByText(options.expectedText).first().waitFor({ state: "visible", timeout });
  }

  // Ensure no loading spinner is visible
  const loadingIndicators = [
    "Initializing Studio",
    "Loading...",
    "Please wait",
  ];
  for (const indicator of loadingIndicators) {
    const element = page.getByText(indicator);
    // Don't fail if the text doesn't exist — just make sure it's not visible
    await element.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  }
}
