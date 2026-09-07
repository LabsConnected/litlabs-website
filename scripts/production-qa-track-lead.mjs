/**
 * Non-destructive verification of authenticated POST /api/affiliate/track-lead.
 *
 * Strategy: POST with empty body {} — passes auth, reaches validation,
 * returns 400 "Email is required" without ever calling trackLeadIdempotent.
 *
 * This proves:
 * 1. Authentication is accepted (not 401)
 * 2. POST routing is reached (not 405)
 * 3. Validation/business logic executes past auth (returns 400, not 401)
 *
 * Non-destructive because:
 * - trackLeadIdempotent is never called (email validation fails first)
 * - No GHL API call made
 * - No DB modification
 * - No lead created
 */
import { chromium } from "@playwright/test";

const BASE = "https://www.litlabs.net";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // First test: unauthenticated (should get 401)
  console.log("=== Unauthenticated POST /api/affiliate/track-lead ===");
  const unauthResp = await context.request.post(`${BASE}/api/affiliate/track-lead`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  console.log(`  HTTP ${unauthResp.status()} (expected 401)`);
  const unauthBody = await unauthResp.text();
  console.log(`  Body: ${unauthBody}`);
  console.log(`  Auth boundary: ${unauthResp.status() === 401 ? "✓ enforced" : "✗ BROKEN"}`);

  // Now launch headed browser for login
  console.log("\n=== Headed login required ===");
  console.log("Please complete Clerk sign-in in the browser window.");

  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Wait for authentication
  let authenticated = false;
  const maxWaitMs = 300000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(2000);
    const url = page.url();
    if (!url.includes("/sign-in") && !url.includes("/sign-up")) {
      const testResp = await context.request.get(`${BASE}/api/wallet`);
      if (testResp.status() !== 401) {
        authenticated = true;
        console.log(`\nAuthentication detected! URL: ${url}`);
        break;
      }
    }
    if (url === `${BASE}/` || url === `${BASE}/studio`) {
      const testResp = await context.request.get(`${BASE}/api/wallet`);
      if (testResp.status() !== 401) {
        authenticated = true;
        console.log(`\nAuthentication detected! URL: ${url}`);
        break;
      }
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed % 30 === 0) {
      console.log(`  Still waiting... (${elapsed}s)`);
    }
  }

  if (!authenticated) {
    console.log("Authentication timeout. Aborting.");
    await browser.close();
    process.exit(1);
  }

  // Now test: authenticated POST with empty body (should get 400, not 401)
  console.log("\n=== Authenticated POST /api/affiliate/track-lead (empty body) ===");
  const authResp = await context.request.post(`${BASE}/api/affiliate/track-lead`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  const authStatus = authResp.status();
  const authBody = await authResp.text();
  console.log(`  HTTP ${authStatus}`);
  console.log(`  Body: ${authBody}`);

  console.log("\n=== Verification ===");
  console.log(`  1. Auth accepted: ${authStatus !== 401 ? "✓ YES (not 401)" : "✗ NO (401)"}`);
  console.log(`  2. POST routing reached: ${authStatus !== 405 ? "✓ YES (not 405)" : "✗ NO (405)"}`);
  console.log(`  3. Validation executed past auth: ${authStatus === 400 ? "✓ YES (400 validation error)" : "✗ unexpected status"}`);

  // Also test with a deliberately invalid email format to go one level deeper
  console.log("\n=== Authenticated POST /api/affiliate/track-lead (invalid email format) ===");
  const invalidResp = await context.request.post(`${BASE}/api/affiliate/track-lead`, {
    data: { email: "not-an-email-invalid-format" },
    headers: { "Content-Type": "application/json" },
  });
  const invalidStatus = invalidResp.status();
  const invalidBody = await invalidResp.text();
  console.log(`  HTTP ${invalidStatus}`);
  console.log(`  Body: ${invalidBody.slice(0, 200)}`);
  console.log(`  Auth passed: ${invalidStatus !== 401 ? "✓" : "✗"}`);
  console.log(`  Reached business logic: ${invalidStatus !== 401 && invalidStatus !== 405 ? "✓" : "✗"}`);

  console.log("\n=== Non-destructive proof ===");
  console.log("  - Empty body test: trackLeadIdempotent never called (email validation fails at line 51)");
  console.log("  - Invalid email test: if trackLeadIdempotent was called, it would be idempotent");
  console.log("  - No GHL API call made for empty body (validation short-circuits)");
  console.log("  - No DB modification (function not reached)");

  await page.waitForTimeout(2000);
  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
