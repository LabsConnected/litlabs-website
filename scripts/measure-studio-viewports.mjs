import { chromium } from "@playwright/test";

const BASE = process.env.TEST_URL || "http://127.0.0.1:3001";

const DESKTOP_VIEWPORTS = [
  { width: 1024, height: 768, tier: "compact" },
  { width: 1100, height: 800, tier: "compact" },
  { width: 1280, height: 800, tier: "desktop-split" },
  { width: 1440, height: 900, tier: "desktop-split" },
  { width: 1680, height: 1050, tier: "desktop-split" },
  { width: 1920, height: 1080, tier: "desktop-split" },
];

async function measure() {
  console.log("Measuring Studio Pane Geometry across 6 Viewports...\n");
  const browser = await chromium.launch({ headless: true });

  const results = [];

  for (const { width, height, tier } of DESKTOP_VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width, height },
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    // Navigate to studio (or local dev server)
    try {
      await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2000);

      const measurements = await page.evaluate(() => {
        const shell = document.querySelector(".studio-shell");
        const main = document.querySelector("#main-content");
        const center = document.querySelector('[data-testid="studio-center-workspace"]');
        const littPanel = document.querySelector('[data-testid="litt-panel"]');
        const previewCol = document.querySelector('[data-testid="permanent-preview-column"]');
        const docEl = document.documentElement;

        const shellRect = shell?.getBoundingClientRect();
        const mainRect = main?.getBoundingClientRect();
        const centerRect = center?.getBoundingClientRect();
        const littRect = littPanel?.getBoundingClientRect();
        const previewRect = previewCol?.getBoundingClientRect();

        return {
          windowInnerWidth: window.innerWidth,
          docClientWidth: docEl.clientWidth,
          docScrollWidth: docEl.scrollWidth,
          shellRight: shellRect ? Math.round(shellRect.right) : 0,
          shellWidth: shellRect ? Math.round(shellRect.width) : 0,
          mainRight: mainRect ? Math.round(mainRect.right) : 0,
          centerWidth: centerRect ? Math.round(centerRect.width) : 0,
          littWidth: littRect ? Math.round(littRect.width) : 0,
          previewWidth: previewRect ? Math.round(previewRect.width) : 0,
        };
      });

      const rightEdgeDelta = Math.abs(measurements.shellRight - width);
      const noOverflow = measurements.docScrollWidth <= width + 1;
      let centerPass = false;

      if (tier === "compact") {
        centerPass = measurements.centerWidth >= 320 && measurements.littWidth >= 280;
      } else if (width === 1280) {
        centerPass = measurements.centerWidth >= 320 && measurements.littWidth >= 280 && measurements.previewWidth >= 260;
      } else {
        centerPass = measurements.centerWidth >= 420 && measurements.littWidth >= 300 && measurements.previewWidth >= 280;
      }

      const pass = rightEdgeDelta <= 2 && noOverflow && centerPass;

      results.push({
        viewport: `${width}x${height}`,
        tier,
        shellRight: `${measurements.shellRight}px`,
        shellWidth: `${measurements.shellWidth}px`,
        centerWidth: `${measurements.centerWidth}px`,
        littWidth: `${measurements.littWidth}px`,
        previewWidth: `${measurements.previewWidth}px`,
        scrollWidth: `${measurements.docScrollWidth}px`,
        status: pass ? "PASS" : "FAIL",
      });
    } catch (err) {
      results.push({
        viewport: `${width}x${height}`,
        tier,
        error: err.message,
        status: "ERROR",
      });
    } finally {
      await context.close();
    }
  }

  await browser.close();
  console.table(results);
}

measure().catch(console.error);
