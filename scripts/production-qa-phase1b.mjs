/**
 * Production QA — Phase 1b: Sign-in page, navigation, footer, checkout handoff.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "fs";

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
  const errors = [];
  const networkFails = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("401")) {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on("response", (resp) => {
    if (resp.status() >= 500) networkFails.push(`${resp.status()} ${resp.url()}`);
  });

  // ─── Sign-in page ───
  console.log("\n=== Sign-in page ===");
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${shotDir}/desktop-signin-detail.png`, fullPage: true });

  const clerkSignIn = await page.locator("[data-clerk], .cl-rootBox, .cl-card, [class*='clerk']").count();
  const emailInput = await page.locator("input[type='email'], input[name='email'], input[placeholder*='mail' i]").count();
  const signInButtons = await page.locator("button:visible").allTextContents();
  console.log(`  Clerk components: ${clerkSignIn}`);
  console.log(`  Email inputs: ${emailInput}`);
  console.log(`  Buttons: ${signInButtons.slice(0, 10).map(b => b.trim()).join(", ")}`);

  // Check for social login buttons
  const socialButtons = await page.locator("[class*='social'], button:has-text('Google'), button:has-text('GitHub'), button:has-text('Apple')").count();
  console.log(`  Social login buttons: ${socialButtons}`);

  // ─── Navigation links from homepage ───
  console.log("\n=== Navigation links from homepage ===");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const navLinks = await page.locator("nav a[href], header a[href]").evaluateAll((els) =>
    els.map((e) => ({ href: e.getAttribute("href"), text: e.textContent?.trim().slice(0, 40) }))
      .filter((l) => l.href && !l.href.startsWith("http") && !l.href.startsWith("#"))
  );
  console.log("  Nav links:");
  for (const l of navLinks) console.log(`    ${l.text}: ${l.href}`);

  // ─── Footer links ───
  console.log("\n=== Footer links ===");
  const footerLinks = await page.locator("footer a[href]").evaluateAll((els) =>
    els.map((e) => ({ href: e.getAttribute("href"), text: e.textContent?.trim().slice(0, 40) }))
  );
  console.log("  Footer links:");
  for (const l of footerLinks) console.log(`    ${l.text}: ${l.href}`);

  // ─── Test footer/legal links ───
  console.log("\n=== Testing legal/footer links ===");
  const legalPaths = ["/privacy", "/terms", "/privacy-policy", "/terms-of-service"];
  for (const path of legalPaths) {
    try {
      const resp = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      const status = resp?.status() ?? "?";
      const title = await page.title();
      console.log(`  ${path}: HTTP ${status}, title="${title.slice(0, 60)}"`);
    } catch (err) {
      console.log(`  ${path}: ERROR ${err.message.slice(0, 80)}`);
    }
  }

  // ─── Checkout handoff (unauthenticated) ───
  console.log("\n=== Checkout handoff (unauthenticated) ===");
  // Try the checkout API directly
  const checkoutResp = await context.request.post(`${BASE}/api/billing/checkout`, {
    data: { priceId: "price_1U36qFJ53kgx4fp5avhUOuBH", mode: "recurring" },
    headers: { "Content-Type": "application/json" },
  });
  console.log(`  POST /api/billing/checkout: HTTP ${checkoutResp.status()}`);
  const checkoutBody = await checkoutResp.text().catch(() => "");
  if (checkoutResp.status() === 401) {
    console.log("  → 401 is correct (unauthenticated user cannot create checkout)");
  } else if (checkoutResp.status() === 200) {
    console.log(`  → 200 (unexpected for unauthenticated): ${checkoutBody.slice(0, 200)}`);
  } else {
    console.log(`  → ${checkoutResp.status()}: ${checkoutBody.slice(0, 200)}`);
  }

  // ─── Billing portal (unauthenticated) ───
  console.log("\n=== Billing portal (unauthenticated) ===");
  const portalResp = await context.request.get(`${BASE}/api/billing/portal`);
  console.log(`  GET /api/billing/portal: HTTP ${portalResp.status()}`);
  if (portalResp.status() === 401) {
    console.log("  → 401 is correct (unauthenticated user cannot access billing portal)");
  }

  // ─── API health ───
  console.log("\n=== API health ===");
  const healthResp = await context.request.get(`${BASE}/api/health`);
  const healthBody = await healthResp.text();
  console.log(`  GET /api/health: HTTP ${healthResp.status()}`);
  try {
    const health = JSON.parse(healthBody);
    console.log(`  status=${health.status}, commit=${health.commit}, service=${health.service}`);
    if (health.checks) {
      for (const [k, v] of Object.entries(health.checks)) {
        console.log(`    ${k}: ${v.status}`);
      }
    }
  } catch {}

  // ─── Summary ───
  console.log(`\n=== Phase 1b Summary ===`);
  console.log(`  Console errors (non-401): ${errors.length}`);
  console.log(`  Network 5xx: ${networkFails.length}`);
  if (errors.length) {
    console.log("  Errors:");
    for (const e of errors) console.log(`    - ${e.slice(0, 120)}`);
  }
  if (networkFails.length) {
    console.log("  Network fails:");
    for (const n of networkFails) console.log(`    - ${n}`);
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
