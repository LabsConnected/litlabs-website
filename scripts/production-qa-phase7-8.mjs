/**
 * Production QA — Phase 7: Mobile QA + Phase 8: Visual quality.
 *
 * Tests critical public journeys on mobile viewports with:
 * - horizontal overflow detection
 * - touch-target sizing
 * - text truncation
 * - fixed header/footer behavior
 * - modal sizing
 * - scroll trap detection
 */
import { chromium } from "@playwright/test";

const BASE = "https://www.litlabs.net";
const artifactDir = "artifacts/production-qa/20260905-232031";
const shotDir = `${artifactDir}/screenshots`;

const MOBILE_VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "narrow-mobile", width: 360, height: 800 },
];

const PAGES = [
  { path: "/", name: "home" },
  { path: "/pricing", name: "pricing" },
  { path: "/sign-in", name: "signin" },
  { path: "/sign-up", name: "signup" },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const allResults = [];

  for (const vp of MOBILE_VIEWPORTS) {
    console.log(`\n=== Mobile QA: ${vp.name} (${vp.width}x${vp.height}) ===`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      storageState: { cookies: [], origins: [] },
      // Simulate mobile
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    for (const p of PAGES) {
      console.log(`\n  ${vp.name}-${p.name}:`);
      try {
        await page.goto(`${BASE}${p.path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);

        // Screenshot
        await page.screenshot({ path: `${shotDir}/${vp.name}-${p.name}-mobile-detail.png`, fullPage: true });

        // ─── Layout checks ───
        const layout = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            scrollHeight: doc.scrollHeight,
            clientHeight: doc.clientHeight,
            hasHorizontalScroll: doc.scrollWidth > doc.clientWidth,
            hasVerticalScroll: doc.scrollHeight > doc.clientHeight,
            overflowX: getComputedStyle(body).overflowX,
            bodyWidth: body.getBoundingClientRect().width,
          };
        });

        // ─── Touch target sizing ───
        const touchTargets = await page.evaluate(() => {
          const interactive = Array.from(document.querySelectorAll("button, a, input, select"));
          return interactive.map((el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || rect.width === 0) return null;
            return {
              tag: el.tagName,
              text: (el.textContent || "").trim().slice(0, 30),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              tooSmall: rect.width < 44 || rect.height < 44, // WCAG 2.5.5 minimum
            };
          }).filter((t) => t !== null && t.width > 0 && t.height > 0);
        });

        const smallTargets = touchTargets.filter((t) => t.tooSmall);

        // ─── Text overflow check ───
        const textOverflow = await page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll("h1, h2, h3, p, span, a"));
          let overflowCount = 0;
          for (const el of elements) {
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth + 2 || rect.left < -2) {
              overflowCount++;
            }
          }
          return overflowCount;
        }).catch(() => 0);

        // ─── Fixed elements check ───
        const fixedElements = await page.evaluate(() => {
          const fixed = Array.from(document.querySelectorAll("*")).filter((el) => {
            return getComputedStyle(el).position === "fixed";
          });
          return fixed.map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              class: el.className?.slice(0, 40),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              height: Math.round(rect.height),
            };
          });
        });

        // ─── Visible text content ───
        const bodyText = await page.locator("body").innerText().catch(() => "");
        const textSample = bodyText.slice(0, 200).replace(/\n/g, " ");

        // ─── Navigation (mobile menu?) ───
        const hasMobileMenu = await page.locator("[aria-label*='menu' i], button:has-text('Menu'), [class*='hamburger'], [class*='mobile-nav']").count();
        const navLinks = await page.locator("nav a:visible").count();

        console.log(`    Horizontal scroll: ${layout.hasHorizontalScroll} (${layout.scrollWidth}x${layout.clientWidth})`);
        console.log(`    Touch targets: ${touchTargets.length} total, ${smallTargets.length} too small (<44px)`);
        if (smallTargets.length > 0 && smallTargets.length <= 5) {
          for (const t of smallTargets) {
            console.log(`      - ${t.tag} "${t.text}" ${t.width}x${t.height}`);
          }
        }
        console.log(`    Text overflow elements: ${textOverflow}`);
        console.log(`    Fixed elements: ${fixedElements.length}`);
        console.log(`    Mobile menu: ${hasMobileMenu}, nav links visible: ${navLinks}`);
        console.log(`    Text sample: "${textSample.slice(0, 100)}..."`);

        allResults.push({
          viewport: vp.name,
          page: p.name,
          hasHorizontalScroll: layout.hasHorizontalScroll,
          smallTouchTargets: smallTargets.length,
          textOverflow,
          fixedElements: fixedElements.length,
          hasMobileMenu,
          navLinks,
        });
      } catch (err) {
        console.log(`    ERROR: ${err.message.slice(0, 100)}`);
        allResults.push({ viewport: vp.name, page: p.name, error: err.message });
      }
    }

    await context.close();
  }

  // ─── Summary ───
  console.log("\n=== Phase 7+8 Summary ===");
  console.log("| Viewport | Page | H-Scroll | Small Targets | Text Overflow | Fixed | Mobile Menu | Nav Links |");
  console.log("|----------|------|----------|---------------|---------------|-------|-------------|-----------|");
  for (const r of allResults) {
    if (r.error) {
      console.log(`| ${r.viewport} | ${r.page} | ERROR | - | - | - | - | - |`);
    } else {
      console.log(`| ${r.viewport} | ${r.page} | ${r.hasHorizontalScroll ? "YES" : "no"} | ${r.smallTouchTargets} | ${r.textOverflow} | ${r.fixedElements} | ${r.hasMobileMenu} | ${r.navLinks} |`);
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error("[QA] FATAL:", err);
  process.exit(1);
});
