/**
 * Phase 1 QA: Playwright browser verification for CoderWorkspace.
 *
 * Tests the REAL /studio?demo=1&tool=code route (not an isolated test page).
 * Verifies: tool=code loads CoderWorkspace, ?legacy=code loads CanvasTool,
 * back/forward navigation, refresh preserves tool, no Clerk crash.
 * Also tests layout invariants at 4 viewports × 4 zoom levels.
 *
 * Blocked tests FAIL by default (nonzero exit code).
 * Set ALLOW_BLOCKED_TESTS=true to allow blocked tests for diagnostics.
 *
 * Usage:
 *   node scripts/phase1-qa-playwright.mjs
 *   ALLOW_BLOCKED_TESTS=true node scripts/phase1-qa-playwright.mjs
 *
 * Output:
 *   phase1-qa-evidence/phase1-qa-report.json  — full test report
 *   phase1-qa-evidence/studio-desktop-1440.png — representative screenshot
 *   phase1-qa-evidence/studio-mobile-390.png  — representative screenshot
 *   phase1-qa-evidence/studio-legacy-code.png  — representative screenshot
 *   phase1-qa-evidence/studio-back-forward.png — representative screenshot
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "phase1-qa-evidence");

// Clean previous evidence and recreate directory
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const BASE = "http://localhost:3000";
const ALLOW_BLOCKED = process.env.ALLOW_BLOCKED_TESTS === "true";

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900, expectDesktop: true },
  { name: "1280x720", width: 1280, height: 720, expectDesktop: true },
  { name: "1024x768", width: 1024, height: 768, expectDesktop: true },
  { name: "390x844", width: 390, height: 844, expectDesktop: false },
];

const ZOOM_LEVELS = [
  { name: "80", value: 0.8 },
  { name: "100", value: 1.0 },
  { name: "125", value: 1.25 },
  { name: "150", value: 1.5 },
];

const results = [];
const log = (msg) => console.log(msg);

async function run() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  log("Browser launched (headless system chrome)");

  // ─── Test 1: Layout invariants at 4 viewports × 4 zoom levels ────────
  for (const vp of VIEWPORTS) {
    for (const zoom of ZOOM_LEVELS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await context.newPage();
      await page.goto(`${BASE}/studio?demo=1&tool=code`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForTimeout(5000);

      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setPageScaleFactor", {
        pageScaleFactor: zoom.value,
      });
      await page.waitForTimeout(1000);

      const tag = `${vp.name}@${zoom.name}`;
      const checks = await page.evaluate(() => {
        const html = document.documentElement;
        const winH = window.innerHeight;

        function isVis(el) {
          if (!el) return false;
          const s = getComputedStyle(el);
          if (s.display === "none" || s.visibility === "hidden") return false;
          if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
          const r = el.getBoundingClientRect();
          return r.bottom <= winH && r.top >= 0;
        }

        const pageScrolls = html.scrollHeight > html.clientHeight + 2;
        const hOverflow = html.scrollWidth > html.clientWidth + 2;

        const composer = Array.from(
          document.querySelectorAll("textarea"),
        ).find((t) => (t.placeholder || "").includes("/api/litt/run"));
        const composerVis = isVis(composer);

        const tabBtns = Array.from(
          document.querySelectorAll(
            "button[class*='uppercase'][class*='tracking']",
          ),
        ).filter((b) => b.offsetWidth > 0 && b.offsetHeight > 0);
        const tabsVis =
          tabBtns.length > 0 &&
          tabBtns.some((b) => b.getBoundingClientRect().bottom <= winH);

        const mobileBtn = document.querySelector(
          'button[aria-label="Open work sheet"]',
        );
        const mobileVis = isVis(mobileBtn);

        const rightTabs = Array.from(
          document.querySelectorAll("button"),
        ).filter((b) =>
          ["files", "code", "preview", "review"].includes(
            b.innerText.trim().toLowerCase(),
          ),
        );
        const rightVis =
          rightTabs.length >= 4 && rightTabs.every((b) => isVis(b));

        const drawerTabs = Array.from(
          document.querySelectorAll("button"),
        ).filter((b) =>
          ["canvas", "terminal"].includes(b.innerText.trim().toLowerCase()),
        );
        const drawerVis =
          drawerTabs.length >= 2 && drawerTabs.every((b) => isVis(b));

        return {
          pageScrolls,
          hOverflow,
          composerVis,
          tabsVis,
          mobileVis,
          rightVis,
          drawerVis,
        };
      });

      const desktopOK = vp.expectDesktop
        ? checks.rightVis && checks.drawerVis && !checks.mobileVis
        : true;
      const mobileOK = !vp.expectDesktop
        ? checks.mobileVis && !checks.rightVis && !checks.drawerVis
        : true;

      const passed =
        !checks.pageScrolls &&
        !checks.hOverflow &&
        checks.composerVis &&
        checks.tabsVis &&
        desktopOK &&
        mobileOK;

      results.push({ tag, passed, ...checks, desktopOK, mobileOK });
      log(
        `${passed ? "PASS" : "FAIL"} ${tag} | scroll=${checks.pageScrolls} hOverflow=${checks.hOverflow} composer=${checks.composerVis} tabs=${checks.tabsVis} mobile=${checks.mobileVis} right=${checks.rightVis} drawer=${checks.drawerVis}`,
      );

      // Save 4 representative screenshots only
      if (
        (vp.name === "1440x900" && zoom.name === "100") ||
        (vp.name === "390x844" && zoom.name === "100")
      ) {
        const fname =
          vp.name === "1440x900"
            ? "studio-desktop-1440.png"
            : "studio-mobile-390.png";
        await page.screenshot({ path: join(OUT_DIR, fname) });
      }

      await context.close();
    }
  }

  // ─── Test 2: tool=code loads CoderWorkspace ─────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/studio?demo=1&tool=code`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    const hasComposer = await page.evaluate(() =>
      Array.from(document.querySelectorAll("textarea")).some((t) =>
        (t.placeholder || "").includes("/api/litt/run"),
      ),
    );
    log(`tool=code → CoderWorkspace composer: ${hasComposer} (expect true)`);
    results.push({ tag: "tool-code", passed: hasComposer, hasComposer });
    await context.close();
  }

  // ─── Test 3: ?legacy=code loads CanvasTool (not CoderWorkspace) ─────
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/studio?demo=1&tool=code&legacy=code`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    const hasCoderComposer = await page.evaluate(() =>
      Array.from(document.querySelectorAll("textarea")).some((t) =>
        (t.placeholder || "").includes("/api/litt/run"),
      ),
    );
    log(`?legacy=code → CoderWorkspace composer: ${hasCoderComposer} (expect false)`);
    await page.screenshot({ path: join(OUT_DIR, "studio-legacy-code.png") });
    results.push({ tag: "legacy-code", passed: !hasCoderComposer, hasCoderComposer });
    await context.close();
  }

  // ─── Test 4: Back/Forward preserves tool ────────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/studio?demo=1&tool=chat`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);
    await page.goto(`${BASE}/studio?demo=1&tool=code`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const backUrl = page.url();
    const backIsChat = backUrl.includes("tool=chat");
    await page.goForward({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const fwdUrl = page.url();
    const fwdIsCode = fwdUrl.includes("tool=code");
    log(`Back → tool=chat: ${backIsChat} (${backUrl}), Forward → tool=code: ${fwdIsCode} (${fwdUrl})`);
    await page.screenshot({ path: join(OUT_DIR, "studio-back-forward.png") });
    results.push({
      tag: "back-forward",
      passed: backIsChat && fwdIsCode,
      backUrl,
      fwdUrl,
    });
    await context.close();
  }

  // ─── Test 5: Refresh preserves selected tool ────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/studio?demo=1&tool=code`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const refreshedUrl = page.url();
    const toolPreserved = refreshedUrl.includes("tool=code");
    const hasComposerAfterRefresh = await page.evaluate(() =>
      Array.from(document.querySelectorAll("textarea")).some((t) =>
        (t.placeholder || "").includes("/api/litt/run"),
      ),
    );
    log(`Refresh → tool=code preserved: ${toolPreserved}, composer: ${hasComposerAfterRefresh}`);
    results.push({
      tag: "refresh",
      passed: toolPreserved && hasComposerAfterRefresh,
      refreshedUrl,
      hasComposerAfterRefresh,
    });
    await context.close();
  }

  // ─── Test 6: No Clerk runtime crash ──────────────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });

    await page.goto(`${BASE}/studio?demo=1&tool=code`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    const clerkErrors = pageErrors.filter((e) =>
      e.includes("ClerkProvider") || e.includes("clerk"),
    );
    const hasErrorBoundary = await page.evaluate(() =>
      document.body.innerText.includes("Something went wrong"),
    );

    log(`Clerk errors: ${clerkErrors.length}, error boundary: ${hasErrorBoundary}`);
    results.push({
      tag: "no-clerk-crash",
      passed: clerkErrors.length === 0 && !hasErrorBoundary,
      clerkErrorCount: clerkErrors.length,
      hasErrorBoundary,
    });
    await context.close();
  }

  // ─── Test 7: Mobile bottom sheet opens and closes ──────────────────
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/studio?demo=1&tool=code`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    const openBtn = page.locator('button[aria-label="Open work sheet"]');
    const openVis = await openBtn.isVisible().catch(() => false);
    let opened = false;
    let closed = false;
    if (openVis) {
      await openBtn.click();
      await page.waitForTimeout(500);
      opened = await page
        .locator('button[aria-label="Close work sheet"]')
        .isVisible()
        .catch(() => false);
      if (opened) {
        await page.locator('button[aria-label="Close"]').click();
        await page.waitForTimeout(500);
        closed = !(await page
          .locator('button[aria-label="Close work sheet"]')
          .isVisible()
          .catch(() => false));
      }
    }
    log(`Mobile sheet: btn=${openVis} opened=${opened} closed=${closed}`);
    results.push({
      tag: "mobile-sheet",
      passed: openVis && opened && closed,
      openVis,
      opened,
      closed,
    });
    await context.close();
  }

  // ─── Summary ─────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
  for (const r of results.filter((r) => !r.passed)) {
    log(`  FAIL: ${r.tag} → ${JSON.stringify(r)}`);
  }

  // Write JSON report
  const report = {
    timestamp: new Date().toISOString(),
    base: BASE,
    route: "/studio?demo=1&tool=code",
    summary: { passed, failed, total: results.length },
    results,
  };
  writeFileSync(
    join(OUT_DIR, "phase1-qa-report.json"),
    JSON.stringify(report, null, 2),
  );
  log(`\nJSON report: ${join(OUT_DIR, "phase1-qa-report.json")}`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
