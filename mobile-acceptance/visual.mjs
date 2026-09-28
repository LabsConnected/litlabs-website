/**
 * Visual capture pass for the responsive Studio phone tier.
 *
 * Lighter sibling of run.mjs: renders /studio at three phone viewports,
 * runs the core layout checks, and saves screenshots next to this script.
 *
 * Prerequisites: a dev server on BASE_URL with an authenticated /studio
 * session (Clerk). The script cannot sign in by itself.
 *
 * Usage: BASE_URL=http://127.0.0.1:3001 node mobile-acceptance/visual.mjs
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

const OUT = scriptDir;
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915 },
];

const browser = await chromium.launch({
  executablePath: "/home/hatch/.cache/ms-playwright/chrome-linux64/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

for (const vp of VIEWPORTS) {
  console.log(`\n=== ${vp.name} ===`);
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const checks = [];

  try {
    await page.goto(`${BASE_URL}/studio`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Responsive phone shell renders (same StudioShell, phone column).
    const shell = await page.locator('[data-testid="studio-shell"][data-phone="true"]').count();
    checks.push(["phone shell renders", shell > 0, `found ${shell}`]);

    // WorktabBar is kept on the phone tier.
    const worktab = await page.locator('[data-testid="worktab-bar"]').count();
    checks.push(["worktab bar kept", worktab > 0, `found ${worktab}`]);

    // Bottom nav 5 items.
    const nav = await page.locator('[data-testid^="mobile-nav-"]').count();
    checks.push(["bottom nav 5 items", nav === 5, `found ${nav}`]);

    // No horizontal overflow.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    checks.push(["no horizontal overflow", overflow <= 1, `${overflow}px`]);

    // Chat screenshot (collapsed composer above the bottom nav).
    await page.screenshot({ path: `${OUT}/${vp.name}-chat.png` });
    checks.push(["chat screenshot", true, "saved"]);

    // Preview.
    await page.locator('[data-testid="mobile-nav-preview"]').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/${vp.name}-preview.png` });
    checks.push(["preview screenshot", true, "saved"]);

    // Files.
    await page.locator('[data-testid="mobile-nav-files"]').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/${vp.name}-files.png` });
    checks.push(["files screenshot", true, "saved"]);

    // Activity.
    await page.locator('[data-testid="mobile-nav-activity"]').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/${vp.name}-activity.png` });
    checks.push(["activity screenshot", true, "saved"]);

    // More.
    await page.locator('[data-testid="mobile-nav-more"]').click();
    await page.waitForTimeout(1000);
    const moreSheet = await page.locator('[data-testid="mobile-more-sheet"]').count();
    checks.push(["more sheet opens", moreSheet > 0, `found ${moreSheet}`]);
    await page.screenshot({ path: `${OUT}/${vp.name}-more.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

  } catch (err) {
    checks.push(["viewport run", false, String(err).slice(0, 150)]);
  }

  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? "✓" : "✗"} ${name}: ${detail}`);
  }
  await context.close();
}

await browser.close();
console.log("\nDone");
