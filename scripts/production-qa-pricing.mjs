/**
 * Production QA — Pricing page text extraction.
 * Verifies exact price strings are visible on the pricing page.
 */
import { chromium } from "@playwright/test";

const BASE = "https://www.litlabs.net";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Get all visible text
  const bodyText = await page.locator("body").innerText();

  // Check for price strings
  const checks = [
    { name: "$15", pattern: /\$15/i },
    { name: "$39", pattern: /\$39/i },
    { name: "$149", pattern: /\$149/i },
    { name: "Creator", pattern: /creator/i },
    { name: "Pro", pattern: /\bpro\b/i },
    { name: "Founder", pattern: /founder/i },
    { name: "/month or /mo", pattern: /\/mo|\/month|per month/i },
    { name: "one-time", pattern: /one.time|one time/i },
  ];

  console.log("=== Pricing page text checks ===");
  for (const c of checks) {
    const found = c.pattern.test(bodyText);
    console.log(`  ${c.name}: ${found ? "FOUND" : "NOT FOUND"}`);
  }

  // Extract all button/link text and hrefs
  const buttons = await page.locator("button:visible, a:visible").allTextContents();
  console.log("\n=== Visible buttons/links (first 30) ===");
  for (const b of buttons.slice(0, 30)) {
    console.log(`  - ${b.trim().slice(0, 80)}`);
  }

  // Check for checkout/billing links
  const links = await page.locator("a[href]").evaluateAll((els) =>
    els.map((e) => ({ href: e.getAttribute("href"), text: e.textContent?.trim().slice(0, 60) }))
      .filter((l) => l.href && (l.href.includes("checkout") || l.href.includes("billing") || l.href.includes("stripe")))
  );
  console.log("\n=== Checkout/billing links ===");
  for (const l of links) {
    console.log(`  - ${l.text}: ${l.href}`);
  }

  // Check for any pricing card structure
  const pricingCards = await page.locator("[class*='pricing'], [class*='card'], [class*='plan'], [class*='tier']").count();
  console.log(`\n=== Pricing-related elements: ${pricingCards} ===`);

  await context.close();
  await browser.close();
}

main().catch(console.error);
