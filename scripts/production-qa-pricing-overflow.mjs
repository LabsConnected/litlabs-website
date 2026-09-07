/**
 * Production QA — Investigate pricing page text overflow on mobile.
 */
import { chromium } from "@playwright/test";

const BASE = "https://www.litlabs.net";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const overflowEls = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("h1, h2, h3, h4, p, span, a, div, button"));
    const results = [];
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (rect.right > window.innerWidth + 2 || rect.left < -2) {
        results.push({
          tag: el.tagName,
          class: el.className?.toString().slice(0, 80),
          text: (el.textContent || "").trim().slice(0, 80),
          rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) },
          viewportWidth: window.innerWidth,
        });
      }
    }
    return results;
  });

  console.log(`Pricing page overflow elements (${overflowEls.length}):`);
  for (const el of overflowEls) {
    console.log(`  ${el.tag} "${el.text}" class="${el.class}"`);
    console.log(`    rect: left=${el.rect.left} right=${el.rect.right} width=${el.rect.width} (viewport=${el.viewportWidth})`);
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
