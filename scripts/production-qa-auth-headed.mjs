/**
 * Production QA — Phase 2/3: Authenticated experience via headed Clerk login.
 *
 * This script:
 * 1. Launches a HEADED browser (visible to the user)
 * 2. Navigates to https://www.litlabs.net/sign-in
 * 3. Waits for the user to manually complete Clerk login
 * 4. Detects successful authentication (URL change away from /sign-in)
 * 5. Saves storageState to tests/playwright/.auth/production-session.json
 * 6. Automatically continues with full authenticated QA:
 *    - Clerk session touch
 *    - /api/account, /api/wallet, /api/settings/profile, /api/user/ensure, /api/affiliate/track-lead
 *    - Studio load + interaction
 *    - Desktop + mobile authenticated flows
 *    - Logout + post-logout protection
 *
 * The storage state file is gitignored (tests/playwright/.auth/).
 * No secrets, cookies, or tokens are printed or committed.
 */
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const BASE = "https://www.litlabs.net";
const artifactDir = "artifacts/production-qa/20260905-232031";
const shotDir = `${artifactDir}/screenshots`;
const authFile = "tests/playwright/.auth/production-session.json";

// Ensure dirs exist
mkdirSync(shotDir, { recursive: true });
mkdirSync("tests/playwright/.auth", { recursive: true });

const consoleErrors = [];
const allApiResults = {};

async function main() {
  // ─── Step 1: Check if we already have a saved session ───
  if (existsSync(authFile)) {
    console.log("[QA] Found existing saved session. Validating it...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: authFile });
    const testResp = await context.request.get(`${BASE}/api/wallet`);
    console.log(`[QA] Session validation: GET /api/wallet => HTTP ${testResp.status()}`);
    if (testResp.status() !== 401) {
      console.log("[QA] Existing session is valid. Skipping login.");
      await browser.close();
      return await runAuthenticatedQA(authFile);
    }
    console.log("[QA] Existing session is expired. Proceeding with login.");
    await browser.close();
  }

  // ─── Step 2: Launch headed browser for manual login ───
  console.log("\n[QA] ═══ HEADED LOGIN REQUIRED ═══");
  console.log("[QA] Launching visible browser at https://www.litlabs.net/sign-in");
  console.log("[QA] Please complete the Clerk sign-in in the browser window.");
  console.log("[QA] The script will automatically detect successful login.");
  console.log("[QA] Waiting for authentication...\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Navigate to sign-in
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Wait for the user to authenticate — detect by URL changing away from /sign-in
  // or by the appearance of authenticated UI elements
  let authenticated = false;
  const maxWaitMs = 300000; // 5 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(2000);
    const url = page.url();

    // Check if we've navigated away from sign-in
    if (!url.includes("/sign-in") && !url.includes("/sign-up")) {
      // Verify auth by hitting a protected endpoint
      const testResp = await context.request.get(`${BASE}/api/wallet`);
      if (testResp.status() !== 401) {
        authenticated = true;
        console.log(`[QA] Authentication detected! URL: ${url}, /api/wallet: ${testResp.status()}`);
        break;
      }
    }

    // Also check if we're on the homepage but authenticated
    if (url === `${BASE}/` || url === `${BASE}/studio`) {
      const testResp = await context.request.get(`${BASE}/api/wallet`);
      if (testResp.status() !== 401) {
        authenticated = true;
        console.log(`[QA] Authentication detected! URL: ${url}, /api/wallet: ${testResp.status()}`);
        break;
      }
    }

    // Print periodic status
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed % 30 === 0) {
      console.log(`[QA] Still waiting for login... (${elapsed}s elapsed, URL: ${url})`);
    }
  }

  if (!authenticated) {
    console.log("[QA] Authentication timeout (5 minutes). Aborting.");
    await browser.close();
    process.exit(1);
  }

  // ─── Step 3: Save storage state ───
  await context.storageState({ path: authFile });
  console.log(`[QA] Storage state saved to ${authFile} (gitignored)`);

  // Take a screenshot of the authenticated state
  await page.screenshot({ path: `${shotDir}/02-after-login.png`, fullPage: true });

  // Keep the browser open for a moment so the user can see
  await page.waitForTimeout(2000);
  await browser.close();

  // ─── Step 4: Run full authenticated QA ───
  console.log("\n[QA] Starting authenticated QA...\n");
  await runAuthenticatedQA(authFile);
}

async function runAuthenticatedQA(sessionFile) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: sessionFile,
  });
  const page = await context.newPage();

  // Collect console errors
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));

  // ═══ Phase 2: Clerk Auth Verification ═══
  console.log("═══ Phase 2: Clerk Auth Verification ═══\n");

  // ─── 2a: Clerk session touch ───
  console.log("[QA] Clerk session touch:");
  // Clerk's Frontend API session check — the browser's Clerk JS SDK
  // automatically touches the session. We verify by hitting a protected endpoint.
  const sessionTouchResp = await context.request.get(`${BASE}/api/wallet`);
  const sessionTouchStatus = sessionTouchResp.status();
  console.log(`  GET /api/wallet (session touch): HTTP ${sessionTouchStatus} ${sessionTouchStatus === 200 ? "✓ session valid" : "✗ session invalid"}`);
  allApiResults["sessionTouch"] = sessionTouchStatus;

  // ─── 2b: Authenticated API endpoints ───
  console.log("\n[QA] Authenticated API endpoints:");
  const apiTests = [
    { path: "/api/account", method: "GET", expectNon401: true },
    { path: "/api/wallet", method: "GET", expectNon401: true },
    { path: "/api/settings/profile", method: "GET", expectNon401: true },
    { path: "/api/user/ensure", method: "GET", expectNon401: true },
    { path: "/api/affiliate/track-lead", method: "GET", expectNon401: true },
    { path: "/api/studio-projects", method: "GET", expectNon401: true },
  ];

  for (const api of apiTests) {
    const resp = await context.request.get(`${BASE}${api.path}`);
    const status = resp.status();
    const ok = status !== 401;
    const body = await resp.text().catch(() => "");
    let bodySummary = "";
    try {
      const json = JSON.parse(body);
      bodySummary = JSON.stringify(json).slice(0, 120);
    } catch {
      bodySummary = body.slice(0, 120);
    }
    console.log(`  GET ${api.path}: HTTP ${status} ${ok ? "✓" : "✗"} ${bodySummary}`);
    allApiResults[api.path] = { status, ok, bodySummary };
  }

  // ─── 2c: Authenticated homepage ───
  console.log("\n[QA] Authenticated homepage:");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${shotDir}/02-home-authenticated.png`, fullPage: true });

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const hasSignOut = /sign out|log out|logout/i.test(bodyText);
  const hasUserName = /Larry|laidback|LiTTree/i.test(bodyText);
  console.log(`  Sign-out visible: ${hasSignOut}`);
  console.log(`  User name visible: ${hasUserName}`);

  // ═══ Phase 3: Studio ═══
  console.log("\n═══ Phase 3: Studio ═══\n");

  // ─── 3a: Studio loads ───
  console.log("[QA] Studio load:");
  try {
    const resp = await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    const finalUrl = page.url();
    console.log(`  HTTP ${resp?.status()}, URL: ${finalUrl}`);
    await page.screenshot({ path: `${shotDir}/03-studio-authenticated.png`, fullPage: true });

    const studioText = await page.locator("body").innerText().catch(() => "");
    const hasComposer = await page.locator("textarea, [contenteditable], [role='textbox']").count();
    const hasProjectList = /project|workspace|session|mission/i.test(studioText);
    const hasError = /error|failed|unable|something went wrong/i.test(studioText);

    console.log(`  Composer/input elements: ${hasComposer}`);
    console.log(`  Project/workspace text: ${hasProjectList}`);
    console.log(`  Error text on page: ${hasError}`);
    console.log(`  Text sample: "${studioText.slice(0, 150).replace(/\n/g, " ")}..."`);

    // ─── 3b: Studio interaction (non-destructive) ───
    console.log("\n[QA] Studio interaction (non-destructive):");
    if (hasComposer > 0) {
      // Type a simple test message — do NOT submit if it would trigger AI
      const composer = page.locator("textarea, [contenteditable], [role='textbox']").first();
      await composer.click({ timeout: 5000 }).catch(() => {});
      await composer.fill("QA test — please ignore", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${shotDir}/03b-studio-composer-typed.png`, fullPage: true });
      console.log("  Typed test message into composer (not submitted)");

      // Clear the input
      await composer.fill("", { timeout: 5000 }).catch(() => {});
      console.log("  Cleared composer input");
    } else {
      console.log("  No composer found — skipping interaction test");
    }

    // ─── 3c: Refresh retains session ───
    console.log("\n[QA] Refresh retains session:");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const postRefreshUrl = page.url();
    const refreshStillAuth = await context.request.get(`${BASE}/api/wallet`);
    console.log(`  Post-refresh URL: ${postRefreshUrl}`);
    console.log(`  Post-refresh /api/wallet: HTTP ${refreshStillAuth.status()} ${refreshStillAuth.status() !== 401 ? "✓ session retained" : "✗ session lost"}`);
    await page.screenshot({ path: `${shotDir}/04-studio-after-refresh.png`, fullPage: true });

  } catch (err) {
    console.log(`  Studio ERROR: ${err.message.slice(0, 150)}`);
    await page.screenshot({ path: `${shotDir}/03-studio-error.png`, fullPage: true }).catch(() => {});
  }

  // ═══ Phase 7: Mobile Authenticated Flow ═══
  console.log("\n═══ Phase 7: Mobile Authenticated Flow ═══\n");

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: sessionFile,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();

  // Mobile home
  console.log("[QA] Mobile authenticated home:");
  await mobilePage.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await mobilePage.waitForTimeout(3000);
  await mobilePage.screenshot({ path: `${shotDir}/05-mobile-home-authenticated.png`, fullPage: true });
  const mobileBodyText = await mobilePage.locator("body").innerText().catch(() => "");
  const mobileHasSignOut = /sign out|log out|logout/i.test(mobileBodyText);
  console.log(`  Sign-out visible on mobile: ${mobileHasSignOut}`);

  // Mobile studio
  console.log("\n[QA] Mobile authenticated studio:");
  try {
    await mobilePage.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await mobilePage.waitForTimeout(5000);
    await mobilePage.screenshot({ path: `${shotDir}/05b-mobile-studio-authenticated.png`, fullPage: true });
    const mobileStudioText = await mobilePage.locator("body").innerText().catch(() => "");
    const mobileHasComposer = await mobilePage.locator("textarea, [contenteditable], [role='textbox']").count();
    console.log(`  Mobile studio composer: ${mobileHasComposer}`);
    console.log(`  Mobile studio text sample: "${mobileStudioText.slice(0, 100).replace(/\n/g, " ")}..."`);

    // Check for horizontal overflow
    const hScroll = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    console.log(`  Mobile studio horizontal scroll: ${hScroll}`);
  } catch (err) {
    console.log(`  Mobile studio ERROR: ${err.message.slice(0, 100)}`);
  }

  await mobileContext.close();

  // ═══ Logout + Post-logout Protection ═══
  console.log("\n═══ Logout + Post-logout Protection ═══\n");

  // Go back to desktop page for logout
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Look for sign-out button/link
  console.log("[QA] Looking for logout control:");
  const signOutSelectors = [
    "button:has-text('Sign out')",
    "button:has-text('Sign Out')",
    "button:has-text('Log out')",
    "button:has-text('Log Out')",
    "a:has-text('Sign out')",
    "a:has-text('Sign Out')",
    "[data-clerk='sign-out']",
    "button[aria-label*='sign out' i]",
  ];

  let loggedOut = false;
  for (const sel of signOutSelectors) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      console.log(`  Found logout control: ${sel}`);
      // Click it — might need to open a user menu first
      await el.click({ timeout: 5000 }).catch(async () => {
        // Try opening user menu first
        const userMenu = page.locator("[data-clerk='userButton'], .cl-userButton, button:has-text('Larry'), [aria-label*='account' i]").first();
        if (await userMenu.count()) {
          await userMenu.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(1000);
          await el.click({ timeout: 5000 }).catch(() => {});
        }
      });
      await page.waitForTimeout(3000);
      loggedOut = true;
      break;
    }
  }

  if (!loggedOut) {
    // Try Clerk's UserButton menu
    console.log("  No direct logout button found. Trying Clerk UserButton...");
    const userButton = page.locator(".cl-userButtonTrigger, [data-clerk='userButton'], .cl-rootBox .cl-userButton").first();
    if (await userButton.count()) {
      await userButton.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${shotDir}/06-user-menu.png`, fullPage: true });
      // Look for sign-out in the menu
      for (const sel of signOutSelectors) {
        const el = page.locator(sel).first();
        if (await el.count()) {
          await el.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(3000);
          loggedOut = true;
          console.log(`  Logged out via menu: ${sel}`);
          break;
        }
      }
    }
  }

  if (loggedOut) {
    await page.screenshot({ path: `${shotDir}/06-after-logout.png`, fullPage: true });
    console.log("  Logout screenshot captured");
  } else {
    console.log("  Could not find logout UI — testing post-logout via cleared context");
  }

  // ─── Post-logout protection ───
  console.log("\n[QA] Post-logout protection:");
  // Create a fresh context with no session
  const freshContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [] },
  });

  const protectedTests = [
    { path: "/api/wallet", expectStatus: 401 },
    { path: "/api/account", expectStatus: 401 },
    { path: "/api/settings/profile", expectStatus: 401 },
    { path: "/api/studio-projects", expectStatus: 401 },
  ];

  for (const test of protectedTests) {
    const resp = await freshContext.request.get(`${BASE}${test.path}`);
    const status = resp.status();
    const ok = status === test.expectStatus || (test.expectStatus === 401 && (status === 401 || status === 307));
    console.log(`  GET ${test.path}: HTTP ${status} ${ok ? "✓ protected after logout" : "✗ NOT protected"}`);
  }

  // Also test /studio redirect after logout
  const studioPage = await freshContext.newPage();
  await studioPage.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  await studioPage.waitForTimeout(2000);
  const studioUrl = studioPage.url();
  const redirectedToSignIn = studioUrl.includes("/sign-in");
  console.log(`  /studio after logout: ${redirectedToSignIn ? "✓ redirected to sign-in" : `URL: ${studioUrl}`}`);
  await studioPage.screenshot({ path: `${shotDir}/07-post-logout-studio.png`, fullPage: true });

  await freshContext.close();

  // ═══ Summary ═══
  console.log("\n═══ Authenticated QA Summary ═══");
  console.log(`  Console errors: ${consoleErrors.length}`);
  if (consoleErrors.length) {
    console.log("  Errors:");
    for (const e of consoleErrors.slice(0, 10)) console.log(`    - ${e.slice(0, 150)}`);
  }

  // API results summary
  console.log("\n  API Results:");
  for (const [path, result] of Object.entries(allApiResults)) {
    if (typeof result === "number") {
      console.log(`    ${path}: HTTP ${result}`);
    } else {
      console.log(`    ${path}: HTTP ${result.status} ${result.ok ? "✓" : "✗"}`);
    }
  }

  await context.close();
  await browser.close();

  console.log("\n[QA] Authenticated QA complete.");
  console.log(`[QA] Screenshots: ${shotDir}`);
  console.log(`[QA] Session file (gitignored): ${authFile}`);
}

main().catch((err) => {
  console.error("[QA] FATAL:", err);
  process.exit(1);
});
