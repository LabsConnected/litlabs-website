/**
 * Investigate React hydration error #418 — check if it happens on multiple pages.
 */
import { chromium } from "@playwright/test";

const BASE = "https://www.litlabs.net";
const authFile = "tests/playwright/.auth/production-session.json";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: authFile,
  });

  const pages = [
    { path: "/", name: "home" },
    { path: "/pricing", name: "pricing" },
    { path: "/studio", name: "studio" },
  ];

  for (const p of pages) {
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}${p.path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    const hydrationErrors = pageErrors.filter(e => e.includes("418") || e.includes("hydration"));
    const cspErrors = consoleErrors.filter(e => e.includes("Content Security Policy"));

    console.log(`\n=== ${p.name} (${p.path}) ===`);
    console.log(`  Page errors: ${pageErrors.length}`);
    console.log(`  Hydration errors: ${hydrationErrors.length}`);
    if (hydrationErrors.length) {
      for (const e of hydrationErrors) console.log(`    - ${e.slice(0, 200)}`);
    }
    console.log(`  CSP errors: ${cspErrors.length}`);
    console.log(`  Other console errors: ${consoleErrors.length - cspErrors.length}`);
    if (consoleErrors.length - cspErrors.length > 0) {
      for (const e of consoleErrors.filter(e => !e.includes("Content Security Policy")).slice(0, 5)) {
        console.log(`    - ${e.slice(0, 200)}`);
      }
    }

    await page.close();
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
