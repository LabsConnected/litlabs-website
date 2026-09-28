/**
 * Mobile Studio acceptance — responsive phone-tier composition.
 *
 * Drives the dev server with full Chrome at three phone viewports,
 * verifies the P0 invariants of the single StudioShell's phone tier,
 * and captures screenshots.
 *
 * Prerequisites: a dev server on BASE_URL with an authenticated /studio
 * session (Clerk). The script cannot sign in by itself.
 *
 * Usage: BASE_URL=http://127.0.0.1:3001 node mobile-acceptance/run.mjs
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// playwright-core is not top-level linked in this repo's pnpm layout —
// resolve it from node_modules/.pnpm relative to the repo root.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
const entries = await readdir(pnpmDir);
const pwEntry = entries
  .filter((e) => e.startsWith("playwright-core@"))
  .sort()
  .at(-1);
if (!pwEntry) {
  throw new Error(`playwright-core not found under ${pnpmDir}`);
}
const { chromium } = await import(
  pathToFileURL(path.join(pnpmDir, pwEntry, "node_modules", "playwright-core", "index.js")).href
);

const CHROME_PATH = "/home/hatch/.cache/ms-playwright/chrome-linux64/chrome";
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const OUT_DIR = scriptDir;

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915 },
];

const results = [];

async function checkViewport(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const checks = [];
  const shot = (name) => `${OUT_DIR}/${vp.name}-${name}.png`;

  try {
    await page.goto(`${BASE_URL}/studio`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    // 1. Responsive phone shell renders (same StudioShell, phone column).
    const phoneShell = await page.locator('[data-testid="studio-shell"][data-phone="true"]').count();
    checks.push({
      name: "phone shell renders",
      pass: phoneShell > 0,
      detail: `found ${phoneShell}`,
    });

    if (phoneShell === 0) {
      await page.screenshot({ path: shot("no-shell") });
      checks.push({ name: "debug screenshot", pass: true, detail: shot("no-shell") });
      return checks;
    }

    // 2. WorktabBar is KEPT on the phone tier (task identity).
    const worktabBar = await page.locator('[data-testid="worktab-bar"]').count();
    checks.push({
      name: "worktab bar kept",
      pass: worktabBar > 0,
      detail: `found ${worktabBar}`,
    });

    // 3. No desktop rail and no desktop inspector aside on the phone tier.
    const rail = await page.locator('[data-testid="studio-workspace-rail"]').count();
    const inspectorAside = await page.locator('[data-testid="studio-context-inspector"]').count();
    checks.push({
      name: "no desktop rail or inspector aside",
      pass: rail === 0 && inspectorAside === 0,
      detail: `rail=${rail}, aside=${inspectorAside}`,
    });

    // 4. Bottom nav has exactly 5 items.
    const navItems = await page.locator('[data-testid^="mobile-nav-"]').count();
    checks.push({
      name: "bottom nav has 5 items",
      pass: navItems === 5,
      detail: `found ${navItems}`,
    });

    // 5. No horizontal overflow.
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        overflow: doc.scrollWidth - doc.clientWidth,
      };
    });
    checks.push({
      name: "no horizontal overflow",
      pass: overflow.overflow <= 1,
      detail: `overflow=${overflow.overflow}px`,
    });

    // 6. Inspector sheet starts closed (hidden by default on the phone tier).
    const inspectorSheet = await page.locator('[data-testid="mobile-inspector-sheet"]').count();
    checks.push({
      name: "inspector sheet starts closed",
      pass: inspectorSheet === 0,
      detail: `found ${inspectorSheet}`,
    });

    // 7. Chat: collapsed composer visible above the bottom nav; tapping
    //    Chat expands the LiTT command layer.
    const composer = await page.locator('[data-testid="litt-command-layer"]').count();
    await page.locator('[data-testid="mobile-nav-chat"]').click();
    await page.waitForTimeout(1000);
    const chatActive = await page.locator('[data-testid="mobile-nav-chat"][aria-current="page"]').count();
    checks.push({
      name: "chat composer present and activates",
      pass: composer > 0 && chatActive > 0,
      detail: `composer=${composer}, active=${chatActive}`,
    });
    await page.screenshot({ path: shot("chat") });

    // 8. Preview surface — compact toolbar.
    await page.locator('[data-testid="mobile-nav-preview"]').click();
    await page.waitForTimeout(2000);
    const previewToolbar = await page.locator('[data-testid="preview-toolbar"]').count();
    const toolbarDensity = await page.locator('[data-testid="preview-toolbar"]').getAttribute("data-toolbar-density");
    const moreMenu = await page.locator('[data-testid="preview-more-menu"]').count();
    checks.push({
      name: "preview toolbar compact",
      pass: previewToolbar > 0 && toolbarDensity === "compact" && moreMenu > 0,
      detail: `toolbar=${previewToolbar}, density=${toolbarDensity}, more=${moreMenu}`,
    });
    await page.screenshot({ path: shot("preview") });

    // 9. Files surface.
    await page.locator('[data-testid="mobile-nav-files"]').click();
    await page.waitForTimeout(2000);
    const filesActive = await page.locator('[data-testid="stage-surface-files"][data-active="true"]').count();
    checks.push({
      name: "files surface activates",
      pass: filesActive > 0,
      detail: `found ${filesActive}`,
    });
    await page.screenshot({ path: shot("files") });

    // 10. Activity surface.
    await page.locator('[data-testid="mobile-nav-activity"]').click();
    await page.waitForTimeout(2000);
    const activityActive = await page.locator('[data-testid="stage-surface-activity"][data-active="true"]').count();
    checks.push({
      name: "activity surface activates",
      pass: activityActive > 0,
      detail: `found ${activityActive}`,
    });
    await page.screenshot({ path: shot("activity") });

    // 11. More sheet — 8 secondary surfaces from STAGE_SURFACE_META.
    await page.locator('[data-testid="mobile-nav-more"]').click();
    await page.waitForTimeout(1000);
    const moreSheet = await page.locator('[data-testid="mobile-more-sheet"]').count();
    const moreRows = await page.locator('[data-testid^="phone-more-"]').count();
    checks.push({
      name: "more sheet opens with 8 surfaces",
      pass: moreSheet > 0 && moreRows === 8,
      detail: `sheet=${moreSheet}, rows=${moreRows}`,
    });
    await page.screenshot({ path: shot("more") });

    // 12. More sheet drives the same stage: Terminal opens the terminal surface.
    await page.locator('[data-testid="phone-more-terminal"]').click();
    await page.waitForTimeout(1500);
    const terminalActive = await page.locator('[data-testid="stage-surface-terminal"][data-active="true"]').count();
    const moreClosed = await page.locator('[data-testid="mobile-more-sheet"]').count();
    checks.push({
      name: "more sheet opens terminal surface",
      pass: terminalActive > 0 && moreClosed === 0,
      detail: `terminal=${terminalActive}, sheetClosed=${moreClosed === 0}`,
    });
    await page.screenshot({ path: shot("terminal") });

  } catch (err) {
    checks.push({ name: "viewport run", pass: false, detail: String(err).slice(0, 200) });
    try {
      await page.screenshot({ path: shot("error") });
    } catch {}
  } finally {
    await context.close();
  }

  return checks;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.name} ===`);
    const checks = await checkViewport(browser, vp);
    for (const c of checks) {
      const icon = c.pass ? "✓" : "✗";
      console.log(`${icon} ${c.name}: ${c.detail}`);
    }
    results.push({ viewport: vp.name, checks });
  }

  await browser.close();

  // Summary
  console.log("\n=== SUMMARY ===");
  let totalPass = 0, totalFail = 0;
  for (const r of results) {
    const pass = r.checks.filter((c) => c.pass).length;
    const fail = r.checks.filter((c) => !c.pass).length;
    totalPass += pass; totalFail += fail;
    console.log(`${r.viewport}: ${pass} pass, ${fail} fail`);
  }
  console.log(`Total: ${totalPass} pass, ${totalFail} fail`);
  if (totalFail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
