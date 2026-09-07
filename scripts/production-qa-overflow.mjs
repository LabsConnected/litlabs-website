/**
 * Production QA — Investigate text overflow on mobile home page.
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

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Find all elements that overflow the viewport
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
          class: el.className?.toString().slice(0, 60),
          text: (el.textContent || "").trim().slice(0, 80),
          rect: {
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          viewportWidth: window.innerWidth,
        });
      }
    }
    return results;
  });

  console.log(`Text overflow elements on mobile home (${overflowEls.length}):`);
  for (const el of overflowEls) {
    console.log(`  ${el.tag} "${el.text}" class="${el.class}"`);
    console.log(`    rect: left=${el.rect.left} right=${el.rect.right} width=${el.rect.width} (viewport=${el.viewportWidth})`);
  }

  // Also check the animated background canvas
  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
      parentClass: canvas.parentElement?.className?.slice(0, 60),
    };
  });
  console.log(`\nCanvas info:`, canvasInfo);

  await context.close();
  await browser.close();
}

main().catch(console.error);
