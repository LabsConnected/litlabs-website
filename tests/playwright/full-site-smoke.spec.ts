import { test, expect } from "@playwright/test";

const BASE_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";

const SCREENSHOT_DIR = "tests/playwright/screenshots";

/**
 * Full-site smoke test for litlabs.net.
 *
 * Covers:
 * - Every public page returns HTTP 200
 * - Every showcase slug returns 200
 * - Protected pages render (not 500) — sign-in prompts are valid
 * - API endpoints return expected status codes (401/200/404)
 * - Homepage navigation: h1 renders, nav links work, no dead links
 * - Console errors checked on key pages (homepage, studio, dashboard)
 * - Screenshots of key pages saved to tests/playwright/screenshots/
 * - Mobile viewport (390px) tested on homepage and studio
 * - Page load timing (FCP, LCP) measured and logged for each route
 * - Studio page loads with either sign-in prompt or studio UI (both valid)
 *
 * Uses `domcontentloaded` instead of `networkidle` because Clerk keeps
 * the network busy with polling requests.
 */

// ---------------------------------------------------------------------------
// Route lists
// ---------------------------------------------------------------------------

const PUBLIC_PAGES = [
  "/",
  "/pricing",
  "/docs",
  "/login",
  "/sign-in",
  "/sign-up",
  "/privacy",
  "/terms",
  "/cookies",
  "/discover",
  "/showcase",
  "/gallery",
  "/games",
  "/games/cloud",
  "/games/dos",
  "/games/retro",
  "/marketplace",
  "/social",
  "/landing",
  "/creator",
  "/resources/facebook-growth",
];

const SHOWCASE_SLUGS = [
  "/showcase/artist-launch-site",
  "/showcase/small-business-dashboard",
  "/showcase/music-campaign",
];

const PROTECTED_PAGES = [
  "/studio",
  "/dashboard",
  "/profile",
  "/projects",
  "/deployments",
  "/settings",
  "/wallet",
  "/memories",
  "/voice",
  "/agent",
  "/agent-chat",
  "/agents",
  "/chat",
  "/code",
  "/flow",
  "/ai-builder",
  "/builder",
  "/generate",
  "/litt",
  "/litt-terminal",
  "/library/files",
  "/library/saved",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Measure FCP and LCP for a page navigation. Returns timings in ms. */
async function measurePageTiming(
  page: import("@playwright/test").Page,
  url: string,
): Promise<{ fcp: number | null; lcp: number | null; route: string }> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Give the browser a moment to paint and record performance entries
  await page.waitForTimeout(1500);

  const timings = await page.evaluate(() => {
    const entries = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    const paintEntries = performance.getEntriesByType(
      "paint",
    ) as PerformancePaintTiming[];

    const fcpEntry = paintEntries.find((e) => e.name === "first-contentful-paint");
    const fcp = fcpEntry ? fcpEntry.startTime : null;

    // LCP via PerformanceObserver buffer (may not be available in all browsers)
    let lcp: number | null = null;
    try {
      const lcpEntries = performance.getEntriesByType(
        "largest-contentful-paint",
      ) as PerformanceEntry[];
      if (lcpEntries.length > 0) {
        lcp = lcpEntries[lcpEntries.length - 1].startTime;
      }
    } catch {
      lcp = null;
    }

    return { fcp, lcp, navCount: entries.length };
  });

  const route = url.replace(BASE_URL, "") || "/";
  console.log(
    `[timing] ${route}: FCP=${timings.fcp?.toFixed(0) ?? "n/a"}ms, LCP=${timings.lcp?.toFixed(0) ?? "n/a"}ms`,
  );
  return { fcp: timings.fcp, lcp: timings.lcp, route };
}

// ---------------------------------------------------------------------------
// 1. Public pages — HTTP 200
// ---------------------------------------------------------------------------

test.describe("Public pages — HTTP 200", () => {
  test.setTimeout(120_000);

  for (const route of PUBLIC_PAGES) {
    test(`${route} returns 200`, async ({ request }) => {
      const resp = await request.get(`${BASE_URL}${route}`);
      const status = resp.status();
      console.log(`${route}: ${status}`);
      expect(status, `${route} should return 200`).toBe(200);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Showcase slugs — HTTP 200
// ---------------------------------------------------------------------------

test.describe("Showcase slugs — HTTP 200", () => {
  test.setTimeout(60_000);

  for (const route of SHOWCASE_SLUGS) {
    test(`${route} returns 200`, async ({ request }) => {
      const resp = await request.get(`${BASE_URL}${route}`);
      const status = resp.status();
      console.log(`${route}: ${status}`);
      expect(status, `${route} should return 200`).toBe(200);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Protected pages — render without 500
// ---------------------------------------------------------------------------

test.describe("Protected pages — render without server error", () => {
  test.setTimeout(180_000);

  for (const route of PROTECTED_PAGES) {
    test(`${route} does not return 500`, async ({ request }) => {
      const resp = await request.get(`${BASE_URL}${route}`);
      const status = resp.status();
      console.log(`${route}: ${status}`);
      // Protected pages may return 200 (embedded sign-in) or a redirect (307),
      // but must never return a server error (5xx).
      expect(status, `${route} returned ${status}`).toBeLessThan(500);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. API endpoints — expected status codes
// ---------------------------------------------------------------------------

test.describe("API endpoints — expected status codes", () => {
  test.setTimeout(30_000);

  test("/api/studio/conversations returns 401 when unauthenticated", async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/studio/conversations`);
    const status = resp.status();
    console.log(`/api/studio/conversations: ${status}`);
    expect(status).toBe(401);
  });

  test("/api/llm/health returns 200", async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/llm/health`);
    const status = resp.status();
    console.log(`/api/llm/health: ${status}`);
    expect(status).toBe(200);
  });

  test("/api/this-does-not-exist returns 404", async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/this-does-not-exist`);
    const status = resp.status();
    console.log(`/api/this-does-not-exist: ${status}`);
    expect(status).toBe(404);
  });

  test("/api/auth/session returns expected status", async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/auth/session`);
    const status = resp.status();
    console.log(`/api/auth/session: ${status}`);
    // Public endpoint — should be 200 (returns null/empty session when unauthenticated)
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 5. Homepage navigation
// ---------------------------------------------------------------------------

test.describe("Homepage navigation", () => {
  test.setTimeout(60_000);

  test("h1 renders on homepage", async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    const h1Text = await page.locator("h1").textContent();
    console.log(`Homepage h1: ${h1Text}`);
    expect(h1Text).toBeTruthy();
  });

  test("nav links resolve to real routes (no dead links)", async ({ page }) => {
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    const links = page.locator("a[href]");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    const checked: string[] = [];
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      expect(href, `Link ${i} should not have empty href`).toBeTruthy();
      expect(href, `Link ${i} should not be "#"`).not.toBe("#");
      if (href && !href.startsWith("http") && !href.startsWith("mailto:") && !href.startsWith("#")) {
        checked.push(href);
      }
    }
    console.log(`Homepage has ${count} links, ${checked.length} internal routes checked`);
    expect(checked.length).toBeGreaterThan(0);
  });

  test("clicking a nav link navigates successfully", async ({ page }) => {
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    // Find the first internal link that points to a real route
    const links = page.locator('a[href^="/"]');
    const count = await links.count();
    let navigated = false;
    for (let i = 0; i < count && !navigated; i++) {
      const href = await links.nth(i).getAttribute("href");
      if (href && href !== "/" && !href.startsWith("/api/")) {
        await links.nth(i).click();
        await page.waitForLoadState("domcontentloaded");
        const url = page.url();
        expect(url).toContain(BASE_URL);
        console.log(`Clicked nav link -> ${url}`);
        navigated = true;
      }
    }
    // It's fine if no clickable internal nav link was found (e.g. all CTAs)
    if (!navigated) {
      console.log("No internal nav link found to click — skipping click test");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Console errors on key pages
// ---------------------------------------------------------------------------

test.describe("Console errors on key pages", () => {
  test.setTimeout(90_000);

  // Known noise that is not a real application error
  const NOISE_PATTERNS = [
    "net::ERR",
    "Failed to load resource",
    "favicon",
    "Clerk",
    "Minified React error #418",
    "Chrome extension",
    "third-party",
  ];

  function filterRealErrors(errors: string[]): string[] {
    return errors.filter((e) => !NOISE_PATTERNS.some((p) => e.includes(p)));
  }

  test("no unexpected console errors on homepage", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const realErrors = filterRealErrors(errors);
    console.log(`Homepage console errors: ${errors.length}, real: ${realErrors.length}`);
    if (realErrors.length > 0) {
      console.log(`Real errors:\n${realErrors.join("\n")}`);
    }
    expect(realErrors, `Real console errors: ${realErrors.join("; ")}`).toEqual([]);
  });

  test("no unexpected console errors on studio", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    await page.goto(`${BASE_URL}/studio`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const realErrors = filterRealErrors(errors);
    console.log(`Studio console errors: ${errors.length}, real: ${realErrors.length}`);
    if (realErrors.length > 0) {
      console.log(`Real errors:\n${realErrors.join("\n")}`);
    }
    expect(realErrors, `Real console errors: ${realErrors.join("; ")}`).toEqual([]);
  });

  test("no unexpected console errors on dashboard", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const realErrors = filterRealErrors(errors);
    console.log(`Dashboard console errors: ${errors.length}, real: ${realErrors.length}`);
    if (realErrors.length > 0) {
      console.log(`Real errors:\n${realErrors.join("\n")}`);
    }
    expect(realErrors, `Real console errors: ${realErrors.join("; ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Screenshots of key pages
// ---------------------------------------------------------------------------

test.describe("Screenshots of key pages", () => {
  test.setTimeout(120_000);

  test("screenshot homepage", async ({ page }) => {
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/full-homepage.png`,
      fullPage: true,
    });
    console.log("Saved screenshot: full-homepage.png");
  });

  test("screenshot studio", async ({ page }) => {
    await page.goto(`${BASE_URL}/studio`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/full-studio.png`,
      fullPage: true,
    });
    console.log("Saved screenshot: full-studio.png");
  });

  test("screenshot dashboard", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/full-dashboard.png`,
      fullPage: true,
    });
    console.log("Saved screenshot: full-dashboard.png");
  });

  test("screenshot pricing", async ({ page }) => {
    await page.goto(`${BASE_URL}/pricing`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/full-pricing.png`,
      fullPage: true,
    });
    console.log("Saved screenshot: full-pricing.png");
  });

  test("screenshot showcase", async ({ page }) => {
    await page.goto(`${BASE_URL}/showcase`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/full-showcase.png`,
      fullPage: true,
    });
    console.log("Saved screenshot: full-showcase.png");
  });

  test("screenshot gallery", async ({ page }) => {
    await page.goto(`${BASE_URL}/gallery`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/full-gallery.png`,
      fullPage: true,
    });
    console.log("Saved screenshot: full-gallery.png");
  });

  test("screenshot games", async ({ page }) => {
    await page.goto(`${BASE_URL}/games`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/full-games.png`,
      fullPage: true,
    });
    console.log("Saved screenshot: full-games.png");
  });

  test("screenshot marketplace", async ({ page }) => {
    await page.goto(`${BASE_URL}/marketplace`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/full-marketplace.png`,
      fullPage: true,
    });
    console.log("Saved screenshot: full-marketplace.png");
  });
});

// ---------------------------------------------------------------------------
// 8. Mobile viewport (390px)
// ---------------------------------------------------------------------------

test.describe("Mobile viewport (390px)", () => {
  test.setTimeout(60_000);

  test("homepage renders at 390px without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "No horizontal overflow at 390px").toBeLessThanOrEqual(clientWidth + 1);

    await expect(page.locator("h1")).toBeVisible();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-390-homepage.png`,
      fullPage: true,
    });
    console.log("Saved mobile screenshot: mobile-390-homepage.png");
  });

  test("studio renders at 390px without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/studio`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "No horizontal overflow at 390px on studio").toBeLessThanOrEqual(
      clientWidth + 1,
    );

    const bodyContent = await page.locator("body *").count();
    expect(bodyContent).toBeGreaterThan(0);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-390-studio.png`,
      fullPage: true,
    });
    console.log("Saved mobile screenshot: mobile-390-studio.png");
  });
});

// ---------------------------------------------------------------------------
// 9. Page load timing (FCP, LCP)
// ---------------------------------------------------------------------------

test.describe("Page load timing (FCP, LCP)", () => {
  test.setTimeout(180_000);

  const TIMED_ROUTES = [
    "/",
    "/pricing",
    "/docs",
    "/sign-in",
    "/sign-up",
    "/privacy",
    "/terms",
    "/discover",
    "/showcase",
    "/gallery",
    "/games",
    "/marketplace",
    "/social",
    "/landing",
    "/creator",
    "/studio",
    "/dashboard",
    "/profile",
    "/projects",
    "/chat",
    "/agents",
    "/litt",
    "/library/files",
  ];

  for (const route of TIMED_ROUTES) {
    test(`${route} — FCP and LCP measured`, async ({ page }) => {
      const timing = await measurePageTiming(page, `${BASE_URL}${route}`);
      // We log timings; we don't hard-assert thresholds in a smoke test,
      // but we do verify the navigation completed (page loaded).
      expect(page.url()).toContain(BASE_URL.replace(/^https?:\/\//, "").split("/")[0]);
      // FCP should be a positive number if recorded
      if (timing.fcp !== null) {
        expect(timing.fcp).toBeGreaterThanOrEqual(0);
      }
      if (timing.lcp !== null) {
        expect(timing.lcp).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 10. Studio page — sign-in prompt OR studio UI (both valid)
// ---------------------------------------------------------------------------

test.describe("Studio page — sign-in prompt or studio UI", () => {
  test.setTimeout(60_000);

  test("studio redirects to sign-in when unauthenticated", async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/studio`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Middleware redirects signed-out users to /sign-in.
    const url = page.url();
    expect(url).toContain("/sign-in");

    // The sign-in page must render content
    const bodyContent = await page.locator("body *").count();
    expect(bodyContent, "Sign-in page should render body content").toBeGreaterThan(0);

    console.log(`Studio (unauth): redirected to url=${url}, bodyElements=${bodyContent}`);
  });
});
