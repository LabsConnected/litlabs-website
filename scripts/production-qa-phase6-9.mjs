/**
 * Production QA — Phase 6: Terminal/WebSocket + Phase 9: Edge states.
 *
 * Phase 6:
 * - Verify terminal WebSocket endpoint configuration
 * - Check for stale localhost URLs
 * - Verify connection state handling
 *
 * Phase 9:
 * - Malformed routes
 * - Signed-out access to protected routes (already tested, expand)
 * - Rapid route changes
 * - Invalid form input
 */
import { chromium } from "@playwright/test";

const BASE = "https://www.litlabs.net";
const artifactDir = "artifacts/production-qa/20260905-232031";
const shotDir = `${artifactDir}/screenshots`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  // ═══ Phase 6: Terminal/WebSocket ═══
  console.log("=== Phase 6: Terminal/WebSocket ===\n");

  // Check for WebSocket URLs in the page source
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check NEXT_PUBLIC_TERMINAL_WS_URL in the page
  const wsUrls = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const matches = html.match(/wss?:\/\/[^"'<>\s\\]+/g) || [];
    return matches.map(u => u.replace(/token=[^&]+/, "token=REDACTED"));
  });
  console.log(`WebSocket URLs in DOM: ${wsUrls.length}`);
  for (const u of wsUrls) console.log(`  - ${u}`);

  // Check for any localhost references in the page
  const localhostRefs = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const matches = html.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)[:\d]*/g) || [];
    return [...new Set(matches)];
  });
  console.log(`Localhost references: ${localhostRefs.length}`);
  for (const r of localhostRefs) console.log(`  - ${r}`);

  // Check the terminal page if it exists
  console.log("\nTerminal page check:");
  try {
    const resp = await page.goto(`${BASE}/terminal`, { waitUntil: "domcontentloaded", timeout: 15000 });
    console.log(`  /terminal: HTTP ${resp?.status()}, URL: ${page.url()}`);
    await page.screenshot({ path: `${shotDir}/06-terminal-page.png`, fullPage: true });
  } catch (err) {
    console.log(`  /terminal: ${err.message.slice(0, 80)}`);
  }

  // Check terminal API endpoint
  const terminalApiResp = await context.request.get(`${BASE}/api/terminal`);
  console.log(`  GET /api/terminal: HTTP ${terminalApiResp.status()}`);

  // Check terminal health via the main health endpoint
  const healthResp = await context.request.get(`${BASE}/api/health`);
  const health = await healthResp.json().catch(() => ({}));
  console.log(`  Health terminal check: ${health.checks?.terminal?.status ?? "n/a"} ${health.checks?.terminal?.detail ?? ""}`);

  // ═══ Phase 9: Edge States ═══
  console.log("\n=== Phase 9: Edge States ===\n");

  // ─── Malformed routes ───
  console.log("Malformed routes:");
  const malformedRoutes = [
    "/api",
    "/api/",
    "/studio/../../etc/passwd",
    "/%2e%2e/",
    "//",
    "/api/billing/checkout/invalid-id",
  ];
  for (const route of malformedRoutes) {
    try {
      const resp = await context.request.get(`${BASE}${route}`, { maxRedirects: 0 });
      console.log(`  GET ${route}: HTTP ${resp.status()}`);
    } catch (err) {
      console.log(`  GET ${route}: ${err.message.slice(0, 60)}`);
    }
  }

  // ─── Protected routes (comprehensive) ───
  console.log("\nProtected routes (signed-out):");
  const protectedRoutes = [
    "/studio",
    "/dashboard",
    "/settings",
    "/wallet",
    "/billing",
    "/api/studio-projects",
    "/api/settings/profile",
    "/api/wallet",
    "/api/billing/portal",
  ];
  for (const route of protectedRoutes) {
    try {
      const resp = await context.request.get(`${BASE}${route}`, { maxRedirects: 0 });
      const status = resp.status();
      const isProtected = status === 401 || status === 307 || status === 302;
      console.log(`  GET ${route}: HTTP ${status} ${isProtected ? "✓ protected" : "✗ NOT protected"}`);
    } catch (err) {
      console.log(`  GET ${route}: ${err.message.slice(0, 60)}`);
    }
  }

  // ─── Rapid route changes ───
  console.log("\nRapid route changes:");
  const rapidRoutes = ["/", "/pricing", "/sign-in", "/pricing", "/", "/sign-up", "/"];
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  for (const route of rapidRoutes) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 10000 });
    } catch (err) {
      errors.push(`nav-error: ${err.message}`);
    }
  }
  await page.waitForTimeout(2000);
  console.log(`  Rapid navigation errors: ${errors.length}`);
  if (errors.length) {
    for (const e of errors) console.log(`    - ${e.slice(0, 100)}`);
  }

  // ─── Invalid form input on sign-up ───
  console.log("\nInvalid form input (sign-up):");
  await page.goto(`${BASE}/sign-up`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Try submitting with invalid email
  try {
    const emailInput = page.locator("input[type='email'], input[name='emailAddress']").first();
    if (await emailInput.count()) {
      await emailInput.fill("not-an-email");
      await page.waitForTimeout(500);
      // Check if Clerk shows validation
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const hasValidation = /invalid|valid email|enter.*email/i.test(bodyText);
      console.log(`  Invalid email input: validation shown = ${hasValidation}`);
    } else {
      console.log("  No email input found (Clerk may use different structure)");
    }
  } catch (err) {
    console.log(`  Form test error: ${err.message.slice(0, 80)}`);
  }

  // ─── Double-click on CTA ───
  console.log("\nDouble-click on CTA:");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  try {
    const cta = page.locator("a:has-text('Start'), a:has-text('Launch'), a:has-text('free')").first();
    if (await cta.count()) {
      await cta.dblclick({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      console.log(`  Double-click handled, URL: ${page.url()}`);
    }
  } catch (err) {
    console.log(`  Double-click test: ${err.message.slice(0, 80)}`);
  }

  // ─── Summary ───
  console.log("\n=== Phase 6+9 Summary ===");
  console.log(`  WebSocket URLs: ${wsUrls.length}`);
  console.log(`  Localhost refs: ${localhostRefs.length}`);
  console.log(`  Terminal health: ${health.checks?.terminal?.status ?? "n/a"}`);
  console.log(`  Rapid nav errors: ${errors.length}`);

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error("[QA] FATAL:", err);
  process.exit(1);
});
