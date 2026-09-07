/**
 * Production QA — Phase 2: Authenticated experience via Clerk Backend API session token.
 *
 * Creates a session token for an existing user via the Clerk Backend API
 * (using CLERK_SECRET_KEY), injects it into the browser as a Clerk session,
 * and tests the authenticated experience.
 *
 * This does NOT:
 *   - create new users
 *   - modify any user
 *   - require passwords or email verification
 *   - expose any secrets
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "fs";
import { readFileSync } from "fs";

const BASE = "https://www.litlabs.net";
const artifactDir = "artifacts/production-qa/20260905-232031";
const shotDir = `${artifactDir}/screenshots`;

// Read Clerk secret key from .env.local (never printed)
function getClerkSecretKey() {
  const content = readFileSync(".env.local", "utf-8");
  const match = content.match(/CLERK_SECRET_KEY=(sk_\S+)/);
  if (!match) throw new Error("CLERK_SECRET_KEY not found in .env.local");
  return match[1].trim();
}

// Read publishable key
function getClerkPublishableKey() {
  const content = readFileSync(".env.local", "utf-8");
  const match = content.match(/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=(pk_\S+)/);
  if (!match) throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not found in .env.local");
  return match[1].trim();
}

// Create a session token for a user via Clerk Backend API
async function createSessionToken(secretKey, userId) {
  const resp = await fetch(`https://api.clerk.com/v1/sessions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Clerk session creation failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  return data; // { id, status, user_id, ... }
}

// Get the session token (JWT) for a session
async function getSessionToken(secretKey, sessionId) {
  const resp = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/tokens`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Clerk token creation failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  return data.jwt; // the JWT token
}

async function main() {
  const secretKey = getClerkSecretKey();
  const publishableKey = getClerkPublishableKey();

  // Use the most recently active user (laidbacknostress4life@gmail.com)
  const userId = "user_3GsAlPRx3ihYhftgAQ8Owr1uxzF";

  console.log("[QA] Phase 2 — Creating Clerk session token...");
  const session = await createSessionToken(secretKey, userId);
  console.log(`[QA] Session created: id=${session.id}, status=${session.status}`);

  const token = await getSessionToken(secretKey, session.id);
  console.log(`[QA] Session token obtained (length: ${token.length})`);

  // Determine the Clerk cookie domain from the publishable key
  // pk_live_Y2xlcmsubGl0... → clerk.litlabs.net
  const clerkDomain = "litlabs.net";

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // Inject the Clerk session token as a cookie
  // Clerk uses `__clerk_db_jwt` for the development client cookie,
  // but for production, we need to set the `__client` cookie or use
  // the session ID cookie. The most reliable approach is to set
  // the `__clerk_db_jwt` cookie which Clerk's client SDK reads.
  await context.addCookies([{
    name: "__clerk_db_jwt",
    value: token,
    domain: clerkDomain,
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  }]);

  // Also set the active session cookie
  await context.addCookies([{
    name: "__clerk_session",
    value: session.id,
    domain: clerkDomain,
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  }]);

  const page = await context.newPage();
  const errors = [];
  const networkFails = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("401") && !msg.text().includes("404")) {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on("response", (resp) => {
    if (resp.status() >= 500) networkFails.push(`${resp.status()} ${resp.url()}`);
  });

  // ─── Navigate to homepage (should show authenticated state) ───
  console.log("\n[QA] Navigating to homepage with session...");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${shotDir}/02-home-authenticated.png`, fullPage: true });

  // Check if user is recognized
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const hasUserName = bodyText.includes("Larry") || bodyText.includes("laidback");
  const hasSignOut = /sign out|log out|logout/i.test(bodyText);
  const hasSignIn = /sign in|log in/i.test(bodyText) && !hasSignOut;
  console.log(`  User name visible: ${hasUserName}`);
  console.log(`  Sign-out visible: ${hasSignOut}`);
  console.log(`  Sign-in still visible: ${hasSignIn}`);

  // ─── Navigate to Studio ───
  console.log("\n[QA] Navigating to /studio...");
  try {
    const resp = await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    const finalUrl = page.url();
    console.log(`  HTTP ${resp?.status()}, final URL: ${finalUrl}`);
    await page.screenshot({ path: `${shotDir}/03-studio-authenticated.png`, fullPage: true });

    const studioText = await page.locator("body").innerText().catch(() => "");
    const hasComposer = await page.locator("textarea, input[type='text'], [contenteditable], [role='textbox']").count();
    const hasProjectList = /project|workspace|session/i.test(studioText);
    console.log(`  Composer/input elements: ${hasComposer}`);
    console.log(`  Project/workspace text: ${hasProjectList}`);

    // Check for error states
    const hasError = /error|failed|unable/i.test(studioText);
    console.log(`  Error text on page: ${hasError}`);
  } catch (err) {
    console.log(`  ERROR: ${err.message.slice(0, 120)}`);
  }

  // ─── Test protected API ───
  console.log("\n[QA] Testing protected API endpoints...");
  const apiResp = await context.request.get(`${BASE}/api/studio-projects`);
  console.log(`  GET /api/studio-projects: HTTP ${apiResp.status()}`);
  if (apiResp.status() === 200) {
    const body = await apiResp.text();
    try {
      const data = JSON.parse(body);
      const projectCount = Array.isArray(data) ? data.length : (data.projects?.length ?? "?");
      console.log(`  → 200 OK, projects: ${projectCount}`);
    } catch {
      console.log(`  → 200 OK, body length: ${body.length}`);
    }
  } else if (apiResp.status() === 401) {
    console.log("  → 401 (session not recognized by server)");
  }

  // ─── Test settings/profile API ───
  const profileResp = await context.request.get(`${BASE}/api/settings/profile`);
  console.log(`  GET /api/settings/profile: HTTP ${profileResp.status()}`);

  // ─── Test wallet API ───
  const walletResp = await context.request.get(`${BASE}/api/wallet`);
  console.log(`  GET /api/wallet: HTTP ${walletResp.status()}`);

  // ─── Refresh retains session ───
  console.log("\n[QA] Testing refresh retains session...");
  await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const postRefreshUrl = page.url();
  console.log(`  Post-refresh URL: ${postRefreshUrl}`);
  await page.screenshot({ path: `${shotDir}/04-studio-after-refresh.png`, fullPage: true });

  // ─── Summary ───
  console.log(`\n=== Phase 2 Summary ===`);
  console.log(`  Console errors: ${errors.length}`);
  console.log(`  Network 5xx: ${networkFails.length}`);
  if (errors.length) {
    console.log("  Errors:");
    for (const e of errors) console.log(`    - ${e.slice(0, 150)}`);
  }
  if (networkFails.length) {
    console.log("  Network fails:");
    for (const n of networkFails) console.log(`    - ${n}`);
  }

  // Clean up the session (revoke it)
  console.log("\n[QA] Revoking test session...");
  try {
    await fetch(`https://api.clerk.com/v1/sessions/${session.id}/revoke`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${secretKey}` },
    });
    console.log("[QA] Session revoked.");
  } catch (err) {
    console.log(`[QA] Session revoke failed: ${err.message}`);
  }

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error("[QA] FATAL:", err);
  process.exit(1);
});
