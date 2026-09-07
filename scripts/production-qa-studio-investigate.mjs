/**
 * Investigate Studio "error text on page" and React hydration error #418.
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
  const page = await context.newPage();

  const allConsoleErrors = [];
  const allPageErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      allConsoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    allPageErrors.push(err.message);
  });

  // Navigate to Studio
  await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  // Get the full page text and search for "error" context
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const errorMatches = bodyText.match(/.{0,40}error.{0,40}/gi) || [];
  console.log("=== 'error' text occurrences in Studio ===");
  for (const m of errorMatches.slice(0, 10)) {
    console.log(`  "...${m.trim()}..."`);
  }

  // Check for visible error elements
  const errorElements = await page.locator("[class*='error'], [class*='Error'], [role='alert'], .alert").allTextContents();
  console.log(`\n=== Error elements: ${errorElements.length} ===`);
  for (const e of errorElements.slice(0, 5)) {
    console.log(`  - ${e.trim().slice(0, 100)}`);
  }

  // Check for React hydration errors specifically
  console.log(`\n=== Page errors (${allPageErrors.length}) ===`);
  for (const e of allPageErrors) {
    console.log(`  - ${e.slice(0, 200)}`);
  }

  // Check console errors
  console.log(`\n=== Console errors (${allConsoleErrors.length}) ===`);
  for (const e of allConsoleErrors.slice(0, 15)) {
    console.log(`  - ${e.slice(0, 200)}`);
  }

  // Check if the "error" text is just part of normal UI (like "error" in a label or button)
  console.log(`\n=== Checking if 'error' is part of normal UI ===`);
  const errorButtons = await page.locator("button:has-text('error' i), a:has-text('error' i)").count();
  console.log(`  Buttons/links with 'error': ${errorButtons}`);

  // Check for terminal connection status
  const terminalStatus = await page.evaluate(() => {
    const text = document.body.innerText;
    if (/terminal.*connect|connect.*terminal|disconnected|offline/i.test(text)) {
      return text.match(/.{0,30}(terminal.*connect|connect.*terminal|disconnected|offline).{0,30}/i)?.[0];
    }
    return null;
  });
  console.log(`  Terminal status text: ${terminalStatus ?? "not found"}`);

  await context.close();
  await browser.close();
}

main().catch(console.error);
