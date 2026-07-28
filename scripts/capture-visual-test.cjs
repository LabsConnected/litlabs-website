/**
 * capture-visual-test.cjs — Configurable screenshot capture for the
 * authenticated Command Studio visual test harness.
 *
 * Environment variables:
 *   CHROME_PATH            — path to Chrome executable
 *   STUDIO_AUDIT_URL       — base URL of the dev server
 *   SCREENSHOT_OUTPUT_DIR  — directory for screenshot output
 *
 * Captures 10 visual states at 3 viewports (1920x1080, 1366x768, 390x844).
 */

const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = process.env.STUDIO_AUDIT_URL || "http://localhost:3001";
const OUT_DIR = process.env.SCREENSHOT_OUTPUT_DIR || path.join(__dirname, "..", "screenshots", "visual-test");

const VISUAL_TEST_URL = `${BASE_URL}/studio/visual-test`;

const viewports = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "390x844", width: 390, height: 844 },
];

const states = [
  "empty",
  "conversation",
  "busy",
  "spark",
  "inspector",
  "activity-drawer",
  "terminal-drawer",
  "camera",
  "mobile-conversation",
  "mobile-composer",
];

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Chrome:    ${CHROME}`);
  console.log(`URL:       ${VISUAL_TEST_URL}`);
  console.log(`Output:    ${OUT_DIR}`);
  console.log("");

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });

  let captured = 0;
  let failed = 0;

  for (const vp of viewports) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });

    // Navigate to the visual test page
    try {
      await page.goto(VISUAL_TEST_URL, { waitUntil: "networkidle2", timeout: 30000 });
    } catch (err) {
      console.error(`Failed to load ${VISUAL_TEST_URL}: ${err.message}`);
      failed++;
      continue;
    }

    // Wait for the state selector to appear
    await new Promise((r) => setTimeout(r, 3000));

    const selectorExists = await page.evaluate(() => {
      return !!document.querySelector("[data-testid='visual-test-state-selector']");
    });

    if (!selectorExists) {
      console.error(`State selector not found at ${vp.name} — visual test page may not be enabled`);
      console.error("Set NEXT_PUBLIC_VISUAL_TEST=1 in your .env.local");
      failed += states.length;
      continue;
    }

    for (const state of states) {
      // Click the state button by data-visual-state attribute
      const clicked = await page.evaluate((targetState) => {
        const btn = document.querySelector(`[data-visual-state="${targetState}"]`);
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      }, state);

      if (!clicked) {
        console.error(`  FAIL: ${vp.name}/${state} — button not found`);
        failed++;
        continue;
      }

      // Wait for UI to settle
      await new Promise((r) => setTimeout(r, 1500));

      const file = path.join(OUT_DIR, `${state}-${vp.name}.png`);
      try {
        await page.screenshot({ path: file, fullPage: false });
        const sizeKB = Math.round(fs.statSync(file).size / 1024);
        console.log(`  OK:   ${vp.name}/${state} → ${path.basename(file)} (${sizeKB} KB)`);
        captured++;
      } catch (err) {
        console.error(`  FAIL: ${vp.name}/${state} — ${err.message}`);
        failed++;
      }
    }

    await page.close();
  }

  await browser.close();

  console.log("");
  console.log(`Captured: ${captured}`);
  console.log(`Failed:   ${failed}`);
  console.log(`Output:   ${OUT_DIR}`);

  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
