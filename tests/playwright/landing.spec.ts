import { test, expect } from "@playwright/test";

const BASE_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";

/**
 * Landing page tests for the remastered LiTTree homepage.
 *
 * Covers:
 * - Homepage renders and returns 200
 * - Hero has exactly 2 CTAs
 * - No fake creator handles or "concept examples" disclaimer
 * - No unsupported "real/deployed" claims
 * - Interactive product demo has 6 selectable stages
 * - Product demonstration cards (3) with honest labeling
 * - All showcase project pages return 200
 * - All landing-page CTAs resolve to real routes (no dead links)
 * - No /studio?demo=1 link (not implemented)
 * - No Remix links (template param not consumed)
 * - No SOC2-ready claim
 * - No "500 starter credits" claim
 * - Mobile navigation works at 360px, 390px, 768px
 * - Desktop at 1440px
 * - Reduced-motion: final static state shown immediately
 * - Keyboard navigation for interactive demo
 * - No horizontal overflow at any width
 * - Anonymous users can access homepage without redirect
 * - Footer links resolve to real routes
 */

test.describe("Landing page — remastered homepage", () => {
  test("homepage returns 200 and renders hero", async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toContainText("Bring the idea");
  });

  test("hero says 'helps you build' not 'builds the rest'", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const h1 = await page.locator("h1").textContent();
    expect(h1).toContain("helps you build the rest");
    expect(h1).not.toContain("LiTT builds the rest");
  });

  test("hero has exactly two CTAs", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const startBuilding = page.getByRole("link", { name: /Start building free/i }).first();
    await expect(startBuilding).toBeVisible();
    const watchProduct = page.getByTestId("cta-watch-product");
    await expect(watchProduct).toBeVisible();
    const heroSection = page.locator("section").first();
    await expect(heroSection.getByText("Try Studio without signing in")).toHaveCount(0);
  });

  test("no fake creator handles or concept disclaimer", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const body = (await page.locator("body").textContent()) || "";
    expect(body).not.toContain("Nova's Dream Lab");
    expect(body).not.toContain("Neon Garden");
    expect(body).not.toContain("Build the Future");
    expect(body).not.toContain("@nova");
    expect(body).not.toContain("@garden");
    expect(body).not.toContain("@futurecrew");
    expect(body).not.toContain("concept examples");
    expect(body).not.toContain("These are concept examples");
  });

  test("no unsupported 'real/deployed' claims on homepage", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const body = (await page.locator("body").textContent()) || "";
    // The creations section must not claim "Real projects. Real results."
    expect(body).not.toContain("Real projects. Real results.");
    // Must not claim SOC2-ready
    expect(body).not.toContain("SOC2-ready");
    expect(body).not.toContain("SOC 2");
    // Must not claim 500 starter credits
    expect(body).not.toContain("500 starter credits");
    // Must not claim one-click deployment
    expect(body).not.toContain("one-click deployment");
    // Must not claim private projects by default
    expect(body).not.toContain("Private projects by default");
    // Must not claim deployment previews before going live
    expect(body).not.toContain("Deployment previews before going live");
  });

  test("no /studio?demo=1 link (not implemented)", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const demoLinks = page.locator('a[href*="/studio?demo"]');
    await expect(demoLinks).toHaveCount(0);
  });

  test("no Remix links (template param not consumed)", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const remixLinks = page.locator('a[href*="template="]');
    await expect(remixLinks).toHaveCount(0);
    const remixText = page.getByText(/Remix/i);
    await expect(remixText).toHaveCount(0);
  });

  test("interactive product demo has 6 selectable stages", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const productSection = page.locator("#product");
    await expect(productSection).toBeVisible();
    const tabs = productSection.getByRole("tab");
    await expect(tabs).toHaveCount(6);
    const labels = await tabs.allTextContents();
    expect(labels).toEqual(
      expect.arrayContaining(["Mission", "Plan", "Build", "Preview", "Approval", "Launch"])
    );
    await tabs.nth(2).click();
    const panel = productSection.getByRole("tabpanel");
    await expect(panel).toContainText("Build");
  });

  test("product demonstration section has 3 cards with honest labeling", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const creationsSection = page.locator("#creations");
    await expect(creationsSection).toBeVisible();
    const cards = creationsSection.locator("article");
    await expect(cards).toHaveCount(3);
    // Each card should have a "View workflow" link (not "View project" or "Remix")
    const viewLinks = creationsSection.getByRole("link", { name: /View workflow/i });
    await expect(viewLinks).toHaveCount(3);
    // Should contain "Product demonstration" label
    const demoLabels = creationsSection.getByText(/Product demonstration/i);
    await expect(demoLabels).toHaveCount(3);
  });

  test("all showcase project pages return 200 with demo disclaimer", async ({ request }) => {
    const slugs = ["artist-launch-site", "small-business-dashboard", "music-campaign"];
    for (const slug of slugs) {
      const response = await request.get(`${BASE_URL}/showcase/${slug}`);
      expect(response.status(), `Showcase /showcase/${slug} should return 200`).toBe(200);
      const body = await response.text();
      expect(body).toContain("Product demonstration");
      // Must NOT contain invented evidence
      expect(body).not.toContain("Deployed live");
      expect(body).not.toContain("edge network");
      expect(body).not.toContain("KB");
      expect(body).not.toContain("MB");
    }
  });

  test("all landing-page CTAs resolve to real routes (no dead links)", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const links = page.locator("a[href]");
    const count = await links.count();
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      expect(href, `Link ${i} should not have empty href`).toBeTruthy();
      expect(href, `Link ${i} should not be "#"`).not.toBe("#");
    }
    const startFree = page.getByRole("link", { name: /Start building free/i }).first();
    await expect(startFree).toHaveAttribute("href", "/sign-up");
    const watchProduct = page.getByTestId("cta-watch-product");
    await expect(watchProduct).toHaveAttribute("href", "#product");
  });

  test("mobile navigation works at 360px width", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "No horizontal overflow at 360px").toBeLessThanOrEqual(clientWidth + 1);
    await expect(page.locator("h1")).toContainText("Bring the idea");
    const startBuilding = page.getByRole("link", { name: /Start building free/i }).first();
    await expect(startBuilding).toBeVisible();
  });

  test("mobile navigation works at 390px width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "No horizontal overflow at 390px").toBeLessThanOrEqual(clientWidth + 1);
  });

  test("tablet navigation works at 768px width", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "No horizontal overflow at 768px").toBeLessThanOrEqual(clientWidth + 1);
  });

  test("no horizontal overflow at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "No horizontal overflow at 1440px").toBeLessThanOrEqual(clientWidth + 1);
  });

  test("reduced-motion shows final static state immediately", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText("Bring the idea");
    // The mission sequence should show the final "Live" stage, not "Prompt"
    const sequence = page.locator("section").first().locator(".rounded-2xl").first();
    await expect(sequence).toBeVisible();
    // Wait a moment and check that the stage label shows "Live" (the final stage)
    await page.waitForTimeout(500);
    const stageText = await sequence.textContent();
    expect(stageText).toContain("Live");
    expect(stageText).not.toContain("Prompt");
  });

  test("anonymous users can access homepage without redirect", async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toMatch(/\/studio/);
    expect(page.url()).not.toMatch(/\/sign-in/);
  });

  test("keyboard navigation works for interactive demo", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const productSection = page.locator("#product");
    const tabs = productSection.getByRole("tab");
    await tabs.first().focus();
    await expect(tabs.first()).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    const panel = productSection.getByRole("tabpanel");
    await expect(panel).toBeVisible();
  });

  test("footer links resolve to real routes", async ({ request }) => {
    const footerRoutes = ["/studio", "/marketplace", "/gallery", "/games", "/discover", "/pricing", "/privacy", "/terms"];
    for (const route of footerRoutes) {
      const response = await request.get(`${BASE_URL}${route}`);
      expect(response.status(), `Footer link ${route} should resolve`).toBeLessThan(400);
    }
  });

  test("no console errors on homepage", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    // Allow no console errors (filter out known third-party noise if needed)
    const realErrors = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("Chrome extension")
    );
    expect(realErrors, `Console errors: ${realErrors.join("; ")}`).toHaveLength(0);
  });
});
