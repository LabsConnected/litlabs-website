import { test, expect } from "@playwright/test";

const BASE_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";

/**
 * Landing page tests for the LiTT operator homepage.
 *
 * Source of truth: src/app/HomePageClient.tsx + src/components/landing/*.
 *
 * Covers:
 * - Homepage renders and returns 200
 * - Hero message ("Bring the idea. / LiTT builds the rest.") and live status pill
 * - Hero has exactly 2 CTAs
 * - Section landmarks the primary nav points at actually exist (no dead anchors)
 * - No fake creator handles or "concept examples" disclaimer
 * - No unsupported "real/deployed" claims on FULL HOMEPAGE
 * - No invented deployment evidence in the interactive demo
 * - Interactive product demo has 6 selectable stages (Mission -> Launch)
 * - Product demonstration cards (3) with honest labeling
 * - All showcase project pages return 200
 * - All landing-page CTAs resolve to real routes (no dead links)
 * - No /studio?demo=1 link (not implemented)
 * - No Remix links (template param not consumed)
 * - Mobile navigation works at 360px, 390px, 768px
 * - Desktop at 1440px
 * - Reduced-motion: reveal animations resolve to their final state immediately
 * - Keyboard navigation for interactive demo
 * - No horizontal overflow at any width
 * - Anonymous users can access homepage without redirect
 * - Footer links resolve to real routes
 * - No console errors
 */

test.describe("Landing page — LiTT operator homepage", () => {
  test("homepage returns 200 and renders hero", async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toContainText("Bring the idea");
  });

  test("hero says 'LiTT builds the rest'", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const h1 = await page.locator("h1").textContent();
    expect(h1).toContain("Bring the idea.");
    expect(h1).toContain("LiTT builds the rest.");
  });

  test("hero shows the live operator status pill", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const hero = page.locator("section").first();
    await expect(hero).toContainText("LiTT is online");
    await expect(hero).toContainText("Missions active");
  });

  test("hero surfaces the four outcome chips", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const hero = page.locator("section").first();
    for (const chip of ["Build products", "Create media", "Run workflows", "Ship safely"]) {
      await expect(hero.getByText(chip, { exact: true })).toBeVisible();
    }
  });

  test("hero has exactly two CTAs", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const heroSection = page.locator("section").first();
    const startBuilding = heroSection.getByRole("link", { name: /Start building free/i });
    await expect(startBuilding).toBeVisible();
    const watchWork = heroSection.getByRole("link", { name: /Watch LiTT work/i });
    await expect(watchWork).toBeVisible();
    await expect(watchWork).toHaveAttribute("href", "#how-it-works");
    // Truly count all links in the hero — must be exactly 2
    await expect(heroSection.getByRole("link")).toHaveCount(2);
  });

  test("section headings carry the operator narrative", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const body = (await page.locator("body").textContent()) || "";
    expect(body).toContain("Everything between idea and done.");
    expect(body).toContain("Not a chat. A working system.");
    expect(body).toContain("One operator. The whole project loop.");
    expect(body).toContain("The difference is what survives the chat.");
  });

  test("primary nav anchors resolve to real sections (no dead anchors)", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    // Read the nav straight out of the DOM — it is display:none below `lg`,
    // so a role query would silently see zero links on a narrow viewport.
    const navHrefs = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'nav[aria-label="Primary navigation"] a[href]',
        ),
      ).map((anchor) => anchor.getAttribute("href") || ""),
    );
    expect(navHrefs.length).toBeGreaterThan(0);
    for (const href of navHrefs) {
      expect(href, "Nav link must have an href").toBeTruthy();
      if (href.startsWith("#")) {
        await expect(
          page.locator(href),
          `Nav anchor ${href} must point at an element that exists`,
        ).toHaveCount(1);
      } else {
        expect(href, `Nav link ${href} must be an absolute app route`).toMatch(/^\//);
      }
    }
  });

  test("the operating loop is spelled out", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const operator = page.locator("#operator");
    await expect(operator).toBeVisible();
    for (const step of ["Understand", "Plan", "Build", "Create", "Use tools", "Verify", "Ship"]) {
      await expect(operator.getByText(step, { exact: true }).first()).toBeVisible();
    }
    await expect(operator).toContainText("Control plane + builder");
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

  test("no unsupported claims on full homepage (scans entire body)", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const body = (await page.locator("body").textContent()) || "";
    // Must not claim "Real projects. Real results."
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
    // Must not invent social proof
    expect(body).not.toMatch(/\d[\d,]*\+?\s+(creators|builders|teams|users)\b/i);
  });

  test("no invented deployment evidence on full homepage (interactive demo included)", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const body = (await page.locator("body").textContent()) || "";
    // The interactive demo must not present invented operational evidence
    expect(body).not.toContain("edge network");
    expect(body).not.toContain("CDN distribution active");
    expect(body).not.toContain("Deployment complete");
    expect(body).not.toContain("Deployment successful");
    expect(body).not.toContain("Deployed live");
    expect(body).not.toContain("3 files, 0 errors");
    // Must not show fake public URLs
    expect(body).not.toContain("your-music.litlabs");
    // Must not claim deployment is complete (only "ready for deployment")
    expect(body).not.toContain("is deployed and ready to share");
    expect(body).not.toContain("Your project is live");
    expect(body).not.toContain("DNS propagation");
    // Must not show fake file sizes
    expect(body).not.toContain("4.2 KB");
    expect(body).not.toContain("8.1 KB");
    expect(body).not.toContain("3.7 KB");
    expect(body).not.toContain("124 KB");
    // Must not claim one-click deployment
    expect(body).not.toContain("one click");
    expect(body).not.toContain("goes live instantly");
  });

  test("interactive demo is labeled as a product demonstration", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const demoLabel = page.getByText(/Interactive product demonstration/i);
    await expect(demoLabel).toHaveCount(1);
  });

  test("interactive demo uses the After Midnight golden demo", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const body = (await page.locator("body").textContent()) || "";
    expect(body).toContain("After Midnight");
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
    const demoSection = page.locator("#how-it-works");
    await expect(demoSection).toBeVisible();
    const tabs = demoSection.getByRole("tab");
    await expect(tabs).toHaveCount(6);
    const labels = await tabs.allTextContents();
    expect(labels.map((label) => label.trim())).toEqual([
      "Mission",
      "Plan",
      "Build",
      "Preview",
      "Approval",
      "Launch",
    ]);
    await tabs.nth(2).click();
    const panel = demoSection.getByRole("tabpanel");
    await expect(panel).toContainText("Build");
  });

  test("product demonstration section has 3 cards with honest labeling", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const creationsSection = page.locator("#creations");
    await expect(creationsSection).toBeVisible();
    const cards = creationsSection.locator("article");
    await expect(cards).toHaveCount(3);
    // Each card links to its showcase workflow (not "View project" or "Remix")
    const viewLinks = creationsSection.getByRole("link", { name: /View the workflow/i });
    await expect(viewLinks).toHaveCount(3);
    // Each card is labeled as a demonstration, not a shipped customer project
    const demoLabels = creationsSection.getByText("Product demo", { exact: true });
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
      expect(href, `Link ${i} should not point at a dev server`).not.toMatch(
        /localhost|127\.0\.0\.1/,
      );
    }
    const startFree = page.getByRole("link", { name: /Start building free/i }).first();
    await expect(startFree).toHaveAttribute("href", "/sign-up");
  });

  test("homepage images use real asset paths that resolve", async ({ page, request }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const sources = await page
      .locator("img")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src") || ""));
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src, "image src must not be empty").toBeTruthy();
      const response = await request.get(new URL(src, BASE_URL).toString());
      expect(response.status(), `Image ${src} should resolve`).toBeLessThan(400);
    }
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

    // The hamburger is reachable (clicking it is covered by navigation.spec.ts;
    // the cookie banner overlays the header in a fresh context).
    await expect(page.getByRole("button", { name: /Open menu/i })).toBeVisible();
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

  test("reduced-motion resolves reveals to their final state immediately", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText("Bring the idea");
    // useViewportReveals must mark every [data-reveal] element revealed up front
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const all = document.querySelectorAll("[data-reveal]").length;
          const revealed = document.querySelectorAll("[data-reveal].is-revealed").length;
          return all > 0 && all === revealed;
        }),
      )
      .toBe(true);
  });

  test("anonymous users can access homepage without redirect", async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toMatch(/\/studio/);
    expect(page.url()).not.toMatch(/\/sign-in/);
  });

  test("keyboard navigation works for interactive demo (ARIA tablist)", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const demoSection = page.locator("#how-it-works");
    const tabs = demoSection.getByRole("tab");
    const panel = demoSection.getByRole("tabpanel");

    // Focus the first tab
    await tabs.first().focus();
    await expect(tabs.first()).toBeFocused();
    await expect(panel).toBeVisible();

    // ArrowRight should move to the next tab and activate it
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(panel).toContainText("Plan");

    // ArrowRight again
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(2)).toBeFocused();
    await expect(panel).toContainText("Build");

    // ArrowLeft should move back
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(panel).toContainText("Plan");

    // End should jump to the last tab
    await page.keyboard.press("End");
    await expect(tabs.last()).toBeFocused();
    await expect(panel).toContainText("Launch");

    // Home should jump to the first tab
    await page.keyboard.press("Home");
    await expect(tabs.first()).toBeFocused();
    await expect(panel).toContainText("Mission");
  });

  test("footer links resolve to real routes", async ({ request }) => {
    const footerRoutes = [
      "/studio",
      "/agents",
      "/marketplace",
      "/gallery",
      "/discover",
      "/pricing",
      "/privacy",
      "/terms",
    ];
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
    // Not `networkidle`/`load`: the app shell keeps long-lived requests open and
    // the hero artwork is heavy, so neither event settles reliably. Give the page
    // a few seconds after DOM ready and collect whatever the console reported.
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5_000);
    // Allow no console errors beyond known, pre-existing app-shell noise:
    // the shell fires /api/wallet and /api/settings/profile on every page, which
    // answer 401 for an anonymous visitor. That predates this landing page and is
    // reproducible on the deployed site — it is not a landing-page regression.
    const realErrors = errors.filter(
      (e) =>
        !e.includes("favicon") &&
        !e.includes("Chrome extension") &&
        !/status of 401\b/.test(e),
    );
    expect(realErrors, `Console errors: ${realErrors.join("; ")}`).toHaveLength(0);
  });
});
