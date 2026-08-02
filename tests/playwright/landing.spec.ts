import { test, expect } from "@playwright/test";

const BASE_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";

test.describe("Landing page — remastered homepage", () => {
  test("homepage returns 200 and renders hero", async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toContainText("Bring the idea");
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

  test("interactive product demo has 6 selectable stages", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const productSection = page.locator("#product");
    await expect(productSection).toBeVisible();
    const tabs = productSection.getByRole("tab");
    await expect(tabs).toHaveCount(6);
    const labels = await tabs.allTextContents();
    expect(labels).toEqual(expect.arrayContaining(["Mission", "Plan", "Build", "Preview", "Approval", "Launch"]));
    await tabs.nth(2).click();
    const panel = productSection.getByRole("tabpanel");
    await expect(panel).toContainText("Build");
  });

  test("real creations section has 3 project cards", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const creationsSection = page.locator("#creations");
    await expect(creationsSection).toBeVisible();
    const cards = creationsSection.locator("article");
    await expect(cards).toHaveCount(3);
    const viewLinks = creationsSection.getByRole("link", { name: /View project/i });
    const remixLinks = creationsSection.getByRole("link", { name: /Remix/i });
    await expect(viewLinks).toHaveCount(3);
    await expect(remixLinks).toHaveCount(3);
  });

  test("all showcase project pages return 200", async ({ request }) => {
    const slugs = ["artist-launch-site", "small-business-dashboard", "music-campaign"];
    for (const slug of slugs) {
      const response = await request.get(`${BASE_URL}/showcase/${slug}`);
      expect(response.status(), `Showcase /showcase/${slug} should return 200`).toBe(200);
      const body = await response.text();
      expect(body).toContain("<body");
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

  test("no horizontal overflow at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "No horizontal overflow at 1440px").toBeLessThanOrEqual(clientWidth + 1);
  });

  test("reduced-motion is respected", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText("Bring the idea");
    const sequence = page.locator("section").first().locator(".rounded-2xl").first();
    await expect(sequence).toBeVisible();
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
});
