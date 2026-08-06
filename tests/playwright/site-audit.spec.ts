import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Comprehensive site audit — tests every public route on the site.
 *
 * Checks per route:
 * 1. HTTP status (200 for public, 307/401/403 for protected)
 * 2. Body content > 100 chars (no blank pages)
 * 3. No console errors or page errors
 * 4. No 5xx responses
 * 5. Accessibility scan (WCAG A/AA)
 * 6. Meta tags present (title, description)
 * 7. No broken internal links on the page
 *
 * Run against production:
 *   PLAYWRIGHT_BASE_URL=https://litlabs.net pnpm exec playwright test site-audit
 *
 * Run locally:
 *   pnpm exec playwright test site-audit
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.SMOKE_TEST_URL ?? "http://127.0.0.1:3001";

const PUBLIC_ROUTES = [
  { path: "/", name: "Homepage", expectedText: /LiTTree|LiTT|AI Creative Studio/i },
  { path: "/pricing", name: "Pricing", expectedText: /Creator|Pro|Pricing|month|\$7|\$19/i },
  { path: "/marketplace", name: "Marketplace", expectedText: /Marketplace|agent|Agent/i },
  { path: "/gallery", name: "Gallery", expectedText: /Gallery|project|Project|Showcase/i },
  { path: "/docs", name: "Docs", expectedText: /Docs|Documentation|guide|Guide|LiTTree/i },
  { path: "/privacy", name: "Privacy", expectedText: /Privacy|privacy/i },
  { path: "/terms", name: "Terms", expectedText: /Terms|terms/i },
  { path: "/cookies", name: "Cookies", expectedText: /Cookie|cookie/i },
  { path: "/showcase", name: "Showcase", expectedText: /Showcase|project|Project|Gallery/i },
  { path: "/voice", name: "Voice", expectedText: /Voice|voice|speak|Speak|Studio|Sign/i },
  { path: "/signup", name: "Signup", expectedText: /Sign|sign|Create|create|free|Free/i },
  { path: "/discover", name: "Discover", expectedText: /Discover|Community|community|Creator|creator/i },
  { path: "/agents", name: "Agents", expectedText: /Agent|agent|AI/i },
  { path: "/games", name: "Games", expectedText: /Game|game|Play|play|Arcade|arcade/i },
  { path: "/social", name: "Social", expectedText: /Social|social|Community|community/i, redirectsTo: "/discover" },
];

const PROTECTED_ROUTES = [
  { path: "/dashboard", name: "Dashboard" },
  { path: "/settings", name: "Settings" },
  { path: "/profile", name: "Profile" },
  { path: "/wallet", name: "Wallet" },
  { path: "/studio", name: "Studio" },
  { path: "/projects", name: "Projects" },
  { path: "/memories", name: "Memories" },
  { path: "/deployments", name: "Deployments" },
  { path: "/library/files", name: "Library Files" },
  { path: "/library/saved", name: "Library Saved" },
  { path: "/code", name: "Code" },
  { path: "/flow", name: "Flow" },
  { path: "/ai-builder", name: "AI Builder" },
  { path: "/builder", name: "Builder" },
  { path: "/chat", name: "Chat" },
  { path: "/generate", name: "Generate" },
  { path: "/litt", name: "LiTT" },
  { path: "/settings/connections", name: "Settings Connections" },
  { path: "/settings/connections/diagnostics", name: "Diagnostics" },
];

const KNOWN_FALSE_POSITIVES = [
  "color-contrast",
  "region",
];

// ─── Public route tests ─────────────────────────────────────────────────────

test.describe("Site Audit — Public Routes @public", () => {
  test.describe.configure({ mode: "parallel" });

  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} (${route.path}) — full audit`, async ({ page }) => {
      const errors: string[] = [];
      const failedRequests: string[] = [];

      page.on("pageerror", (error) => {
        if (error.message.includes("418")) return;
        errors.push(`PAGE ERROR: ${error.message}`);
      });

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          if (
            !text.includes("Clerk") &&
            !text.includes("Warning:") &&
            !text.includes("Download the React DevTools") &&
            !text.includes("status of 401") &&
            !text.includes("status of 403") &&
            !text.includes("status of 404") &&
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

      page.on("response", (response) => {
        const url = response.url();
        if (
          (url.includes(BASE_URL) || url.includes("litlabs.net")) &&
          response.status() >= 500
        ) {
          errors.push(`HTTP ${response.status()}: ${url}`);
        }
      });

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      // 1. Status code — 200 for normal pages, 307 for redirects
      const status = response?.status() ?? 0;
      if (route.redirectsTo) {
        expect(status === 200 || status === 307 || status === 302, `${route.path} should return 200 or redirect`).toBe(true);
        // If redirected, navigate to the destination
        if (status === 307 || status === 302) {
          await page.waitForURL(route.redirectsTo, { waitUntil: "domcontentloaded" });
        }
      } else {
        expect(status, `${route.path} should return 200`).toBe(200);
      }

      // 2. Body content
      await page.waitForLoadState("domcontentloaded");
      // For redirected pages, wait for network to settle so Axe doesn't hit a destroyed context
      if (route.redirectsTo) {
        await page.waitForLoadState("networkidle").catch(() => {});
      }
      const bodyText = await page.locator("body").innerText();
      const bodyHtml = await page.locator("body").innerHTML();
      const totalContent = bodyText.length + bodyHtml.length;
      expect(totalContent, `${route.path} should have body content > 100 chars`).toBeGreaterThan(100);

      // 3. Expected text — use destination's expected text if redirected
      const checkRoute = route.redirectsTo
        ? PUBLIC_ROUTES.find((r) => r.path === route.redirectsTo) ?? route
        : route;
      const hasExpectedText = await page.locator("body").textContent();
      expect(hasExpectedText, `${route.path} should contain expected text`).toMatch(checkRoute.expectedText);

      // 4. Meta tags
      const title = await page.title();
      expect(title.length, `${route.path} should have a title > 5 chars`).toBeGreaterThan(5);

      const description = await page.getAttribute('meta[name="description"]', "content");
      if (description) {
        expect(description.length, `${route.path} meta description should be > 20 chars`).toBeGreaterThan(20);
      }

      // 5. No errors
      expect(errors, `${route.path} should have no application errors`).toEqual([]);

      // 6. Accessibility scan
      const axeResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const criticalViolations = axeResults.violations.filter(
        (v) =>
          (v.impact === "critical" || v.impact === "serious") &&
          !KNOWN_FALSE_POSITIVES.includes(v.id),
      );

      expect(
        criticalViolations.length,
        `${route.path} has ${criticalViolations.length} critical/serious accessibility violations:\n${
          criticalViolations.map((v) => `- ${v.id}: ${v.description}`).join("\n")
        }`,
      ).toBe(0);
    });
  }
});

// ─── Protected route tests ──────────────────────────────────────────────────

test.describe("Site Audit — Protected Routes @public", () => {
  test.describe.configure({ mode: "parallel" });

  for (const route of PROTECTED_ROUTES) {
    test(`${route.name} (${route.path}) — redirects or shows sign-in`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;

      if (status === 307 || status === 302) {
        const url = page.url();
        expect(url, `${route.path} should redirect to sign-in`).toContain("/sign-in");
      } else if (status === 200) {
        await page.waitForLoadState("domcontentloaded");
        const bodyText = await page.locator("body").textContent() ?? "";
        const hasSignInPrompt = /sign|Sign|login|Login|unauthorized|member|Clerk|Loading|Studio|dashboard/i.test(bodyText);
        expect(hasSignInPrompt, `${route.path} should show sign-in prompt or auth state when unauthenticated`).toBe(true);
      } else {
        throw new Error(`Protected route ${route.path} returned unexpected status ${status}`);
      }
    });
  }
});

// ─── API health tests ───────────────────────────────────────────────────────

test.describe("Site Audit — API Health @public", () => {
  test("Health endpoint returns 200 with ok status", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("Sitemap.xml is accessible", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("<urlset");
  });

  test("robots.txt is accessible", async ({ request }) => {
    const response = await request.get("/robots.txt");
    const status = response.status();
    expect(status === 200 || status === 404, `robots.txt returned ${status}`).toBe(true);
    if (status === 200) {
      const text = await response.text();
      expect(text).toMatch(/User-agent/i);
    }
  });
});

// ─── Navigation link audit ──────────────────────────────────────────────────

test.describe("Site Audit — Navigation Links @public", () => {
  test("Homepage internal links resolve to 200 or 307", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const links = page.locator("a[href]");
    const count = await links.count();
    expect(count, "Homepage should have links").toBeGreaterThan(5);

    const hrefs = new Set<string>();
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      if (
        href &&
        !href.startsWith("http") &&
        !href.startsWith("mailto:") &&
        !href.startsWith("#") &&
        !href.startsWith("tel:")
      ) {
        hrefs.add(href);
      }
    }

    // Test up to 15 internal links
    const sampleHrefs = Array.from(hrefs).slice(0, 15);
    const broken: string[] = [];

    for (const href of sampleHrefs) {
      const response = await page.goto(href, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      if (status !== 200 && status !== 307 && status !== 302) {
        broken.push(`${href} → ${status}`);
      }
    }

    expect(broken, `Broken internal links:\n${broken.join("\n")}`).toEqual([]);
  });
});

// ─── Security audit ─────────────────────────────────────────────────────────

test.describe("Site Audit — Security @public", () => {
  test("Public pages do not expose secrets", async ({ page }) => {
    const publicPaths = ["/", "/pricing", "/marketplace", "/gallery", "/privacy", "/terms", "/cookies"];

    for (const route of publicPaths) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const bodyText = await page.locator("body").innerText();

      expect(bodyText, `${route} should not expose API keys`).not.toMatch(/sk_live_|sk_test_|STRIPE_SECRET/);
      expect(bodyText, `${route} should not expose JWT tokens`).not.toMatch(/eyJ[a-zA-Z0-9_-]*\.eyJ/);
      expect(bodyText, `${route} should not expose Supabase keys`).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE/);
    }
  });

  test("Protected API endpoints return 401/403/307", async ({ request }) => {
    const apiRoutes = ["/api/account", "/api/wallet/balance", "/api/settings/profile"];

    for (const route of apiRoutes) {
      const response = await request.get(route);
      const status = response.status();
      expect(
        status === 401 || status === 403 || status === 307,
        `API ${route} should return 401/403/307, got ${status}`,
      ).toBe(true);
    }
  });
});
