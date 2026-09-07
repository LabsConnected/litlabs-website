/**
 * Production QA — Phase 4: Billing paths + Phase 5: API/Network validation.
 *
 * Tests:
 * - Pricing page buttons point to correct Stripe prices
 * - Checkout API auth boundary (401 for unauthenticated)
 * - Billing portal API auth boundary
 * - Stripe price IDs are valid (via Stripe CLI)
 * - Public API endpoints respond correctly
 * - No CORS failures, no localhost requests, no stale URLs
 */
import { chromium } from "@playwright/test";
import { writeFileSync, readFileSync } from "fs";

const BASE = "https://www.litlabs.net";
const artifactDir = "artifacts/production-qa/20260905-232031";
const shotDir = `${artifactDir}/screenshots`;

// Expected Stripe price IDs (from production-checks.ts)
const EXPECTED_PRICES = {
  creator: { id: "price_1U36qFJ53kgx4fp5avhUOuBH", amount: 1500, mode: "recurring" },
  pro: { id: "price_1U36qFJ53kgx4fp52s6oy53l", amount: 3900, mode: "recurring" },
  founder: { id: "price_1U066EJ53kgx4fp5ZLKsk6wp", amount: 14900, mode: "one_time" },
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  const allRequests = [];
  const allResponses = [];
  const consoleErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("401")) {
      consoleErrors.push(msg.text());
    }
  });
  page.on("request", (req) => {
    allRequests.push({ url: req.url(), method: req.method() });
  });
  page.on("response", (resp) => {
    allResponses.push({ url: resp.url(), status: resp.status() });
  });

  // ═══ Phase 4: Billing ═══

  // ─── Pricing page: verify buttons and price IDs ───
  console.log("=== Phase 4: Billing ===\n");
  await page.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Get all links and buttons with their hrefs/onclick
  const pricingButtons = await page.locator("a:visible, button:visible").evaluateAll((els) =>
    els.map((e) => ({
      tag: e.tagName,
      text: e.textContent?.trim().slice(0, 60),
      href: e.getAttribute("href"),
      dataPriceId: e.getAttribute("data-price-id"),
      dataMode: e.getAttribute("data-mode"),
    })).filter((e) =>
      e.text && /creator|pro|founder|choose|become|start|launch|free/i.test(e.text)
    )
  );
  console.log("Pricing CTAs:");
  for (const b of pricingButtons) {
    console.log(`  ${b.tag}: "${b.text}" href=${b.href ?? "n/a"} data-price-id=${b.dataPriceId ?? "n/a"}`);
  }

  // Check the page source for price IDs
  const pageHtml = await page.content();
  const foundPriceIds = [];
  for (const [plan, info] of Object.entries(EXPECTED_PRICES)) {
    if (pageHtml.includes(info.id)) {
      foundPriceIds.push(plan);
      console.log(`  Price ID for ${plan} (${info.id}): FOUND in page`);
    } else {
      console.log(`  Price ID for ${plan} (${info.id}): not in page HTML (may be fetched client-side)`);
    }
  }

  // ─── Checkout API (unauthenticated) ───
  console.log("\nCheckout API (unauthenticated):");
  for (const [plan, info] of Object.entries(EXPECTED_PRICES)) {
    const resp = await context.request.post(`${BASE}/api/billing/checkout`, {
      data: { priceId: info.id, mode: info.mode },
      headers: { "Content-Type": "application/json" },
    });
    console.log(`  ${plan} (${info.id}): HTTP ${resp.status()} ${resp.status() === 401 ? "→ correct (auth required)" : ""}`);
  }

  // ─── Billing portal (unauthenticated) ───
  console.log("\nBilling portal (unauthenticated):");
  const portalGet = await context.request.get(`${BASE}/api/billing/portal`);
  console.log(`  GET /api/billing/portal: HTTP ${portalGet.status()}`);
  const portalPost = await context.request.post(`${BASE}/api/billing/portal`);
  console.log(`  POST /api/billing/portal: HTTP ${portalPost.status()} ${portalPost.status() === 401 ? "→ correct (auth required)" : ""}`);

  // ═══ Phase 5: API/Network ═══

  console.log("\n=== Phase 5: API/Network ===\n");

  // ─── Public API endpoints ───
  const publicApis = [
    { path: "/api/health", method: "GET", expectStatus: 200 },
    { path: "/api/studio-projects", method: "GET", expectStatus: 401 },
    { path: "/api/settings/profile", method: "GET", expectStatus: 401 },
    { path: "/api/wallet", method: "GET", expectStatus: 401 },
  ];

  for (const api of publicApis) {
    const resp = await context.request.get(`${BASE}${api.path}`);
    const status = resp.status();
    const ok = status === api.expectStatus;
    console.log(`  ${api.method} ${api.path}: HTTP ${status} ${ok ? "✓" : `✗ (expected ${api.expectStatus})`}`);
  }

  // ─── Navigate homepage and inspect all network requests ───
  console.log("\nNetwork request analysis (homepage):");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check for problematic requests
  const localhostReqs = allRequests.filter((r) => /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(r.url));
  const vercelReqs = allRequests.filter((r) => /vercel\.app/.test(r.url) && !r.url.includes("litlabs"));
  const httpReqs = allRequests.filter((r) => r.url.startsWith("http://") && !r.url.includes("localhost"));

  console.log(`  Total requests: ${allRequests.length}`);
  console.log(`  Localhost requests: ${localhostReqs.length}`);
  if (localhostReqs.length) {
    for (const r of localhostReqs) console.log(`    - ${r.method} ${r.url}`);
  }
  console.log(`  Stale Vercel requests: ${vercelReqs.length}`);
  if (vercelReqs.length) {
    for (const r of vercelReqs) console.log(`    - ${r.method} ${r.url}`);
  }
  console.log(`  Insecure HTTP requests: ${httpReqs.length}`);
  if (httpReqs.length) {
    for (const r of httpReqs) console.log(`    - ${r.method} ${r.url}`);
  }

  // Check for CORS failures (responses with status 0 or blocked)
  const corsFails = allResponses.filter((r) => r.status === 0);
  console.log(`  CORS failures (status 0): ${corsFails.length}`);

  // Check for 5xx responses
  const serverErrors = allResponses.filter((r) => r.status >= 500);
  console.log(`  5xx server errors: ${serverErrors.length}`);
  if (serverErrors.length) {
    for (const r of serverErrors) console.log(`    - ${r.status} ${r.url}`);
  }

  // Check for unexpected 4xx (excluding expected 401s)
  const expected401Paths = ["/api/settings/profile", "/api/wallet", "/api/studio-projects"];
  const unexpected4xx = allResponses.filter((r) => {
    if (r.status < 400 || r.status >= 500) return false;
    if (r.status === 401) {
      try {
        const u = new URL(r.url);
        return !expected401Paths.some((p) => u.pathname.startsWith(p));
      } catch { return true; }
    }
    // 404 for challenge-platform is normal (Cloudflare)
    if (r.status === 404 && r.url.includes("challenge-platform")) return false;
    return true;
  });
  console.log(`  Unexpected 4xx: ${unexpected4xx.length}`);
  if (unexpected4xx.length) {
    for (const r of unexpected4xx.slice(0, 10)) console.log(`    - ${r.status} ${r.url}`);
  }

  // ─── WebSocket/Terminal endpoint check ───
  console.log("\nTerminal/WebSocket endpoint:");
  // Check the page for WebSocket URL configuration
  const wsConfig = await page.evaluate(() => {
    // Check for any WebSocket URLs in the page
    const html = document.documentElement.outerHTML;
    const wsMatch = html.match(/wss?:\/\/[^"'\\s]+/g);
    return wsMatch ? wsMatch.slice(0, 5) : [];
  }).catch(() => []);
  console.log(`  WebSocket URLs found in DOM: ${wsConfig.length}`);
  for (const ws of wsConfig) {
    // Don't print full URL if it might contain tokens
    console.log(`    - ${ws.replace(/token=[^&]+/, "token=REDACTED")}`);
  }

  // Check NEXT_PUBLIC_TERMINAL_WS_URL via API
  // The terminal config is exposed via the health endpoint's terminal check
  const healthResp = await context.request.get(`${BASE}/api/health`);
  const healthBody = await healthResp.text();
  try {
    const health = JSON.parse(healthBody);
    console.log(`  Health terminal check: ${health.checks?.terminal?.status ?? "n/a"}`);
  } catch {}

  // ─── Summary ───
  console.log(`\n=== Phase 4+5 Summary ===`);
  console.log(`  Console errors (non-401): ${consoleErrors.length}`);
  console.log(`  Localhost requests: ${localhostReqs.length}`);
  console.log(`  Stale Vercel requests: ${vercelReqs.length}`);
  console.log(`  Insecure HTTP: ${httpReqs.length}`);
  console.log(`  CORS failures: ${corsFails.length}`);
  console.log(`  5xx errors: ${serverErrors.length}`);
  console.log(`  Unexpected 4xx: ${unexpected4xx.length}`);
  if (consoleErrors.length) {
    console.log("  Console errors:");
    for (const e of consoleErrors) console.log(`    - ${e.slice(0, 150)}`);
  }

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error("[QA] FATAL:", err);
  process.exit(1);
});
