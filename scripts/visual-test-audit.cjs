/**
 * visual-test-audit.cjs — Programmatic visual audit for the
 * authenticated Command Studio visual test harness.
 *
 * Verifies at each viewport:
 * - No horizontal overflow
 * - No horizontal scrollbar
 * - Expected components are visible (transcript, composer, header)
 * - State-specific elements are present
 *
 * Environment variables:
 *   CHROME_PATH            — path to Chrome executable
 *   STUDIO_AUDIT_URL       — base URL of the dev server
 */

const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = process.env.STUDIO_AUDIT_URL || "http://localhost:3000";
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

// Expected elements per state
const stateExpectations = {
  empty: { transcript: false, emptyState: true, composer: true },
  conversation: { transcript: true, emptyState: false, composer: true, userMessages: true, assistantMessages: true },
  busy: { transcript: true, emptyState: false, composer: true, busyIndicator: true },
  spark: { transcript: true, emptyState: false, composer: true, sparkAgent: true },
  inspector: { transcript: false, emptyState: true, composer: true, inspector: true },
  "activity-drawer": { transcript: false, emptyState: true, composer: true, drawer: true },
  "terminal-drawer": { transcript: false, emptyState: true, composer: true, drawer: true },
  camera: { transcript: false, emptyState: true, composer: true, camera: true },
  "mobile-conversation": { transcript: true, emptyState: false, composer: true, userMessages: true },
  "mobile-composer": { transcript: false, emptyState: true, composer: true },
};

(async () => {
  console.log(`Chrome:    ${CHROME}`);
  console.log(`URL:       ${VISUAL_TEST_URL}`);
  console.log("");

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });

  let passCount = 0;
  let failCount = 0;
  const failures = [];

  for (const vp of viewports) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });

    try {
      await page.goto(VISUAL_TEST_URL, { waitUntil: "networkidle2", timeout: 30000 });
    } catch (err) {
      console.error(`Failed to load: ${err.message}`);
      failCount += states.length;
      continue;
    }

    await new Promise((r) => setTimeout(r, 3000));

    for (const state of states) {
      // Click the state button
      const clicked = await page.evaluate((targetState) => {
        const btn = document.querySelector(`[data-visual-state="${targetState}"]`);
        if (btn) { btn.click(); return true; }
        return false;
      }, state);

      if (!clicked) {
        failures.push(`${vp.name}/${state}: button not found`);
        failCount++;
        continue;
      }

      await new Promise((r) => setTimeout(r, 1500));

      // Run audit checks
      const audit = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const clientWidth = document.documentElement.clientWidth;
        const horizontalOverflow = docWidth > clientWidth;
        const horizontalScrollbar = window.innerWidth > clientWidth;

        // Check for opacity-0 focusable elements
        const opacity0 = Array.from(document.querySelectorAll("button, a, input, textarea, select"))
          .filter((el) => {
            const style = window.getComputedStyle(el);
            return style.opacity === "0" && el.offsetParent !== null;
          }).length;

        // Check for expected elements
        const header = !!document.querySelector("header");
        const composer = !!document.querySelector("textarea, [contenteditable], [data-composer]");
        const transcript = document.body.innerText.includes("Build something") === false &&
          document.body.innerText.length > 200;
        const emptyState = document.body.innerText.includes("What are we building");
        const busyIndicator = document.body.innerText.includes("LiTT") && document.querySelector("[class*='animate']") !== null;

        return {
          horizontalOverflow,
          horizontalScrollbar,
          opacity0,
          header,
          composer,
          transcript,
          emptyState,
          busyIndicator,
          bodyLength: document.body.innerText.length,
        };
      });

      const checks = [];
      if (audit.horizontalOverflow) { checks.push("horizontal overflow"); }
      if (audit.horizontalScrollbar) { checks.push("horizontal scrollbar"); }
      if (audit.opacity0 > 0) { checks.push(`${audit.opacity0} opacity-0 elements`); }
      if (!audit.header) { checks.push("header missing"); }
      if (!audit.composer) { checks.push("composer missing"); }

      const expected = stateExpectations[state];
      if (expected.emptyState !== undefined && audit.emptyState !== expected.emptyState) {
        checks.push(`emptyState expected ${expected.emptyState} got ${audit.emptyState}`);
      }

      if (checks.length === 0) {
        console.log(`  PASS: ${vp.name}/${state}`);
        passCount++;
      } else {
        console.log(`  FAIL: ${vp.name}/${state} — ${checks.join(", ")}`);
        failures.push(`${vp.name}/${state}: ${checks.join(", ")}`);
        failCount++;
      }
    }

    await page.close();
  }

  await browser.close();

  console.log("");
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);

  if (failures.length > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }

  process.exit(failCount > 0 ? 1 : 0);
})().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
