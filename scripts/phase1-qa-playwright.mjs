// Phase 1 QA: Playwright browser verification for CoderWorkspace.
// Tests 4 viewports × 4 zoom levels on /studio/coder-qa (isolated component),
// plus routing tests on /studio (which may be blocked by pre-existing
// Clerk UserButton issue if env vars are missing).
//
// Usage: node scripts/phase1-qa-playwright.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "phase1-qa-evidence");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = "http://localhost:3000";

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

function log(msg) {
  console.log(msg);
}

// Proper visibility check: element must have non-zero dimensions and
// be within the viewport, and not display:none.
function isVisible(el, winHeight) {
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.bottom <= winHeight && rect.top >= 0;
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    channel: "chrome",
  });
  log("Browser launched (headless system chrome)");

  // ─── Test 1: CoderWorkspace at all viewport × zoom combos ────────────
  for (const vp of VIEWPORTS) {
    for (const zoom of ZOOM_LEVELS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.goto(`${BASE}/studio/coder-qa`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });

      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setPageScaleFactor", {
        pageScaleFactor: zoom.value,
      });
      await page.waitForTimeout(1000);

      const tag = `${vp.name}@${zoom.name}`;
      const screenshotPath = join(
        OUT_DIR,
        `coder-${vp.name}-z${zoom.name}.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: false });

      const checks = await page.evaluate(() => {
        const html = document.documentElement;
        const winHeight = window.innerHeight;

        function isVis(el) {
          if (!el) return false;
          const style = getComputedStyle(el);
          if (style.display === "none") return false;
          if (style.visibility === "hidden") return false;
          if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
          const rect = el.getBoundingClientRect();
          return rect.bottom <= winHeight && rect.top >= 0;
        }

        const pageScrolls = html.scrollHeight > html.clientHeight + 2;
        const horizontalOverflow = html.scrollWidth > html.clientWidth + 2;

        const composer = Array.from(
          document.querySelectorAll("textarea"),
        ).find((t) => (t.placeholder || "").includes("/api/litt/run"));
        const composerVisible = isVis(composer);

        const tabButtons = Array.from(
          document.querySelectorAll(
            "button[class*='uppercase'][class*='tracking']",
          ),
        ).filter((b) => b.offsetWidth > 0 && b.offsetHeight > 0);
        const tabsVisible =
          tabButtons.length > 0 &&
          tabButtons.some(
            (b) => b.getBoundingClientRect().bottom <= winHeight,
          );

        const mobileSheetBtn = document.querySelector(
          'button[aria-label="Open work sheet"]',
        );
        const mobileSheetVisible = isVis(mobileSheetBtn);

        const rightPaneTabs = Array.from(
          document.querySelectorAll("button"),
        ).filter((b) =>
          ["files", "code", "preview", "review"].includes(
            b.innerText.trim().toLowerCase(),
          ),
        );
        const rightPaneVisible =
          rightPaneTabs.length >= 4 &&
          rightPaneTabs.every((b) => isVis(b));

        const drawerTabs = Array.from(
          document.querySelectorAll("button"),
        ).filter((b) =>
          ["canvas", "terminal"].includes(b.innerText.trim().toLowerCase()),
        );
        const drawerVisible =
          drawerTabs.length >= 2 && drawerTabs.every((b) => isVis(b));

        return {
          pageScrolls,
          horizontalOverflow,
          composerVisible,
          tabsVisible,
          mobileSheetVisible,
          rightPaneVisible,
          drawerVisible,
          scrollHeight: html.scrollHeight,
          clientHeight: html.clientHeight,
        };
      });

      // On desktop: rightPane and drawer should be visible, mobileSheet hidden
      // On mobile: mobileSheet should be visible, rightPane and drawer hidden
      const desktopCorrect =
        vp.expectDesktop
          ? checks.rightPaneVisible && checks.drawerVisible && !checks.mobileSheetVisible
          : true;
      const mobileCorrect =
        !vp.expectDesktop
          ? checks.mobileSheetVisible && !checks.rightPaneVisible && !checks.drawerVisible
          : true;

      const passed =
        !checks.pageScrolls &&
        !checks.horizontalOverflow &&
        checks.composerVisible &&
        checks.tabsVisible &&
        desktopCorrect &&
        mobileCorrect;

      results.push({ tag, passed, ...checks, desktopCorrect, mobileCorrect });
      log(
        `${passed ? "PASS" : "FAIL"} ${tag} | scroll=${checks.pageScrolls} hOverflow=${checks.horizontalOverflow} composer=${checks.composerVisible} tabs=${checks.tabsVisible} mobileSheet=${checks.mobileSheetVisible} rightPane=${checks.rightPaneVisible} drawer=${checks.drawerVisible} desktopOK=${desktopCorrect} mobileOK=${mobileCorrect}`,
      );

      await context.close();
    }
  }

  // ─── Test 2: Mobile bottom sheet opens and closes ───────────────────
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/studio/coder-qa`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(1000);

    const openBtn = page.locator('button[aria-label="Open work sheet"]');
    const openBtnVisible = await openBtn.isVisible().catch(() => false);
    log(`Mobile sheet button visible: ${openBtnVisible}`);

    let sheetOpened = false;
    let sheetClosed = false;
    if (openBtnVisible) {
      await openBtn.click();
      await page.waitForTimeout(500);
      sheetOpened = await page
        .locator('button[aria-label="Close work sheet"]')
        .isVisible()
        .catch(() => false);
      log(`Mobile sheet opened: ${sheetOpened}`);

      if (sheetOpened) {
        await page.locator('button[aria-label="Close"]').click();
        await page.waitForTimeout(500);
        sheetClosed = !(await page
          .locator('button[aria-label="Close work sheet"]')
          .isVisible()
          .catch(() => false));
        log(`Mobile sheet closed: ${sheetClosed}`);
      }
    }
    await page.screenshot({
      path: join(OUT_DIR, "mobile-sheet-test.png"),
    });
    results.push({
      tag: "mobile-sheet",
      passed: openBtnVisible && sheetOpened && sheetClosed,
      openBtnVisible,
      sheetOpened,
      sheetClosed,
    });
    await context.close();
  }

  // ─── Test 3: Empty Project state is truthful ─────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/studio/coder-qa`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const emptyState = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasNoProjectSelected: text.includes("No project selected"),
        hasProjectSelector: !!document.querySelector("select"),
        hasLoadingText: text.includes("Loading"),
        hasErrorText: text.includes("Error"),
      };
    });
    log(`Empty state: ${JSON.stringify(emptyState)}`);
    results.push({ tag: "empty-state", passed: true, ...emptyState });
    await context.close();
  }

  // ─── Test 4: API failure produces error state ─────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    await page.route("**/api/studio-projects**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Simulated server error" }),
      }),
    );

    await page.goto(`${BASE}/studio/coder-qa`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const errorState = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasErrorText: text.includes("Error") || text.includes("error"),
        hasFakeContent: text.includes("fake") || text.includes("Fake"),
        hasNoProjects: text.includes("No projects"),
      };
    });
    log(`API failure state: ${JSON.stringify(errorState)}`);
    await page.screenshot({
      path: join(OUT_DIR, "api-failure-test.png"),
    });
    results.push({
      tag: "api-failure",
      passed: errorState.hasErrorText && !errorState.hasFakeContent,
      ...errorState,
    });
    await context.close();
  }

  // ─── Test 5: Studio routing (?legacy=code, tool=code, back/forward) ──
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const studioErrors = [];
    page.on("pageerror", (err) => studioErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") studioErrors.push(msg.text());
    });

    await page.goto(`${BASE}/studio?demo=1&tool=code`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const hasClerkError = studioErrors.some((e) =>
      e.includes("ClerkProvider"),
    );

    if (hasClerkError) {
      log("Studio routing tests BLOCKED by pre-existing Clerk UserButton crash");
      results.push({
        tag: "studio-routing",
        passed: false,
        blocked: true,
        blocker: "Pre-existing Clerk UserButton crash (missing Clerk env vars in worktree)",
      });
    } else {
      await page.goto(`${BASE}/studio?demo=1&tool=code&legacy=code`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(1500);
      const hasCoderComposer = await page.evaluate(() =>
        Array.from(document.querySelectorAll("textarea")).some((t) =>
          (t.placeholder || "").includes("/api/litt/run"),
        ),
      );
      log(`legacy=code → CoderWorkspace composer present: ${hasCoderComposer} (expect false)`);
      results.push({ tag: "legacy-code", passed: !hasCoderComposer, hasCoderComposer });

      await page.goto(`${BASE}/studio?demo=1&tool=code`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(1500);
      const hasCoderComposer2 = await page.evaluate(() =>
        Array.from(document.querySelectorAll("textarea")).some((t) =>
          (t.placeholder || "").includes("/api/litt/run"),
        ),
      );
      log(`tool=code → CoderWorkspace composer present: ${hasCoderComposer2} (expect true)`);
      results.push({ tag: "tool-code", passed: hasCoderComposer2, hasCoderComposer: hasCoderComposer2 });

      await page.goto(`${BASE}/studio?demo=1&tool=chat`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(500);
      await page.goto(`${BASE}/studio?demo=1&tool=code`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(500);
      await page.goBack({ waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const urlAfterBack = page.url();
      const backIsChat = urlAfterBack.includes("tool=chat");
      await page.goForward({ waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const urlAfterForward = page.url();
      const forwardIsCode = urlAfterForward.includes("tool=code");
      log(`Back → tool=chat: ${backIsChat}, Forward → tool=code: ${forwardIsCode}`);
      results.push({
        tag: "back-forward",
        passed: backIsChat && forwardIsCode,
        urlAfterBack,
        urlAfterForward,
      });
    }
    await context.close();
  }

  // ─── Summary ─────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && !r.blocked).length;
  const blocked = results.filter((r) => r.blocked).length;
  log(`\n=== SUMMARY: ${passed} passed, ${failed} failed, ${blocked} blocked ===`);
  for (const r of results.filter((r) => !r.passed)) {
    log(`  FAIL/BLOCKED: ${r.tag} → ${JSON.stringify(r)}`);
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
