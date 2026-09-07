/**
 * Verify mobile hero overflow fix — test against local server.
 */
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:3001";

async function main() {
  const browser = await chromium.launch({ headless: true });

  for (const vp of [
    { name: "mobile", width: 390, height: 844 },
    { name: "narrow-mobile", width: 360, height: 800 },
  ]) {
    console.log(`\n=== ${vp.name} (${vp.width}x${vp.height}) ===`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      storageState: { cookies: [], origins: [] },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check overflow
    const overflowEls = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("h1, h2, h3, h4, p, span, a, div, button"));
      const results = [];
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        // Skip decorative elements (orbs, glows, backgrounds)
        const cls = el.className?.toString() || "";
        if (cls.includes("orb") || cls.includes("glow") || cls.includes("scanline") || cls.includes("pointer-events-none")) continue;
        if (rect.right > window.innerWidth + 2 || rect.left < -2) {
          results.push({
            tag: el.tagName,
            class: cls.slice(0, 60),
            text: (el.textContent || "").trim().slice(0, 60),
            width: Math.round(rect.width),
            right: Math.round(rect.right),
            viewportWidth: window.innerWidth,
          });
        }
      }
      return results;
    });

    // Check command deck dimensions
    const deckInfo = await page.evaluate(() => {
      const deck = document.querySelector(".litt-command-deck");
      if (!deck) return null;
      const rect = deck.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right) };
    });

    // Check horizontal scroll
    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

    console.log(`  Horizontal scroll: ${hScroll}`);
    console.log(`  Command deck: ${deckInfo ? `${deckInfo.width}x${deckInfo.height}, right=${deckInfo.right}` : "not found"}`);
    console.log(`  Content overflow elements (excluding decorative): ${overflowEls.length}`);
    if (overflowEls.length > 0) {
      for (const el of overflowEls.slice(0, 5)) {
        console.log(`    - ${el.tag} "${el.text}" width=${el.width} right=${el.right} (viewport=${el.viewportWidth})`);
      }
    }

    await page.screenshot({ path: `artifacts/production-qa/20260905-232031/screenshots/${vp.name}-home-after-fix.png`, fullPage: true });

    await context.close();
  }

  await browser.close();
}

main().catch(console.error);
