/**
 * Test OAuth consent page using the user's existing Chrome profile.
 * This verifies whether the Account Portal now recognizes the user's
 * Clerk session after removing NEXT_PUBLIC_CLERK_PROXY_URL.
 *
 * Does NOT print cookies, tokens, or session values.
 */
import { chromium } from "@playwright/test";
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const CHROME_USER_DATA = "C:\\Users\\litbi\\AppData\\Local\\Temp\\chrome-oauth-test";
const ISSUER = "https://clerk.litlabs.net";
const CLIENT_ID = "YWeGjVVwoNnX4RTY";
const SCOPES = ["profile", "email", "offline_access"];

// Generate PKCE
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("hex");

const redirectUri = "http://127.0.0.1:9999/callback";
const authorizeUrl = new URL(`${ISSUER}/oauth/authorize`);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("client_id", CLIENT_ID);
authorizeUrl.searchParams.set("redirect_uri", redirectUri);
authorizeUrl.searchParams.set("scope", SCOPES.join(" "));
authorizeUrl.searchParams.set("state", state);
authorizeUrl.searchParams.set("code_challenge", challenge);
authorizeUrl.searchParams.set("code_challenge_method", "S256");

const screenshots = [];

async function main() {
  console.log("=== OAuth Consent Authenticated Test ===");
  console.log(`Authorize URL: ${authorizeUrl.toString()}`);
  console.log(`Using Chrome profile: ${CHROME_USER_DATA}`);

  const context = await chromium.launchPersistentContext(CHROME_USER_DATA, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = await context.newPage();

  // Collect console messages
  const consoleMessages = [];
  page.on("console", (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  // Collect page errors
  const pageErrors = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  // Collect failed requests
  const failedRequests = [];
  page.on("requestfailed", (req) => {
    failedRequests.push({
      url: req.url(),
      failure: req.failure()?.errorText,
    });
  });

  // Track /v1/client responses
  const clientResponses = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("/v1/client")) {
      try {
        const status = resp.status();
        const headers = resp.headers();
        const body = await resp.text();
        let sessionCount = -1;
        let signedIn = null;
        try {
          const json = JSON.parse(body);
          sessionCount = json?.response?.sessions?.length ?? json?.sessions?.length ?? -1;
          signedIn = sessionCount > 0;
        } catch {}
        clientResponses.push({
          url,
          status,
          acao: headers["access-control-allow-origin"],
          acac: headers["access-control-allow-credentials"],
          sessionCount,
          signedIn,
        });
      } catch {
        clientResponses.push({ url, status: resp.status(), error: "could not read body" });
      }
    }
  });

  // Step 1: Check if user is already signed in on www.litlabs.net
  console.log("\n--- Step 1: Check existing auth state on www.litlabs.net ---");
  await page.goto("https://www.litlabs.net", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const webClerkState = await page.evaluate(() => {
    return JSON.stringify({
      hasClerk: !!window.Clerk,
      loaded: window.Clerk?.loaded,
      isSignedIn: window.Clerk?.client?.isSignedIn,
      sessions: window.Clerk?.client?.sessions?.length,
      frontendApi: window.Clerk?.frontendApi,
      domain: window.Clerk?.domain,
    });
  });
  console.log(`www.litlabs.net Clerk state: ${webClerkState}`);
  await page.screenshot({ path: "test-results/oauth-consent-auth/01-www-home.png" });
  screenshots.push("01-www-home.png");

  const webParsed = JSON.parse(webClerkState);

  if (!webParsed.isSignedIn) {
    console.log("\n⚠️  User is NOT signed in on www.litlabs.net in this Chrome profile.");
    console.log("    Cannot test authenticated consent flow without an active session.");
    console.log("    Taking screenshot of current state and exiting.");

    // Still navigate to the OAuth URL to see what happens
    console.log("\n--- Step 2: Navigate to OAuth authorize URL (unauthenticated) ---");
    await page.goto(authorizeUrl.toString(), { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    console.log(`Final URL: ${finalUrl}`);
    console.log(`Page title: ${await page.title()}`);

    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500));
    console.log(`Body text (first 500 chars): ${bodyText}`);

    await page.screenshot({ path: "test-results/oauth-consent-auth/02-oauth-unauth.png" });
    screenshots.push("02-oauth-unauth.png");

    const consentClerkState = await page.evaluate(() => {
      return JSON.stringify({
        hasClerk: !!window.Clerk,
        loaded: window.Clerk?.loaded,
        isSignedIn: window.Clerk?.client?.isSignedIn,
        sessions: window.Clerk?.client?.sessions?.length,
        frontendApi: window.Clerk?.frontendApi,
      });
    });
    console.log(`OAuth page Clerk state: ${consentClerkState}`);

    writeReport({
      signedInOnWeb: false,
      finalUrl,
      clientResponses,
      consoleMessages,
      pageErrors,
      failedRequests,
      screenshots,
    });

    await context.close();
    return;
  }

  console.log("\n✅ User IS signed in on www.litlabs.net!");
  console.log(`   Sessions: ${webParsed.sessions}`);

  // Step 2: Navigate to OAuth authorize URL
  console.log("\n--- Step 2: Navigate to OAuth authorize URL ---");
  await page.goto(authorizeUrl.toString(), { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  const finalUrl = page.url();
  console.log(`Final URL: ${finalUrl}`);
  console.log(`Page title: ${await page.title()}`);

  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 1000));
  console.log(`Body text (first 1000 chars): ${bodyText}`);

  await page.screenshot({ path: "test-results/oauth-consent-auth/02-oauth-consent.png" });
  screenshots.push("02-oauth-consent.png");

  // Check Clerk state on the consent/redirect page
  const consentClerkState = await page.evaluate(() => {
    return JSON.stringify({
      hasClerk: !!window.Clerk,
      loaded: window.Clerk?.loaded,
      isSignedIn: window.Clerk?.client?.isSignedIn,
      sessions: window.Clerk?.client?.sessions?.length,
      frontendApi: window.Clerk?.frontendApi,
      domain: window.Clerk?.domain,
    });
  });
  console.log(`Consent page Clerk state: ${consentClerkState}`);

  // Check if consent UI rendered
  const consentUi = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const links = Array.from(document.querySelectorAll("a"));
    const allText = document.body?.innerText || "";
    return {
      hasApproveButton: buttons.some((b) => /approve|allow|continue|authorize|accept/i.test(b.textContent || "")),
      hasDenyButton: buttons.some((b) => /deny|cancel|decline|reject/i.test(b.textContent || "")),
      buttonCount: buttons.length,
      linkCount: links.length,
      bodyLength: allText.length,
      hasContent: allText.trim().length > 10,
      buttonTexts: buttons.slice(0, 10).map((b) => b.textContent?.trim()?.substring(0, 50)),
    };
  });
  console.log(`Consent UI: ${JSON.stringify(consentUi, null, 2)}`);

  // Check if we got redirected to sign-in instead of consent
  if (finalUrl.includes("/sign-in")) {
    console.log("\n⚠️  Redirected to sign-in page instead of consent page.");
    console.log("    This means the Account Portal does not recognize the session.");
  } else if (finalUrl.includes("/oauth-consent")) {
    console.log("\n✅ Reached OAuth consent page!");
    if (consentUi.hasContent && consentUi.hasApproveButton) {
      console.log("✅ Consent UI is rendering with buttons!");
    } else {
      console.log("⚠️  Consent page reached but UI may be blank.");
    }
  } else if (finalUrl.includes("127.0.0.1")) {
    console.log("\n✅ Redirected to callback! OAuth flow completed (auto-approved?)");
  }

  // Print /v1/client responses
  console.log("\n--- /v1/client responses ---");
  for (const r of clientResponses) {
    console.log(`  ${r.url}`);
    console.log(`    status: ${r.status}, sessions: ${r.sessionCount}, signedIn: ${r.signedIn}`);
    console.log(`    ACAO: ${r.acao}, ACAC: ${r.acac}`);
  }

  // Print errors
  if (pageErrors.length > 0) {
    console.log("\n--- Page errors ---");
    for (const e of pageErrors) console.log(`  ${e}`);
  }
  if (failedRequests.length > 0) {
    console.log("\n--- Failed requests ---");
    for (const r of failedRequests) console.log(`  ${r.url} — ${r.failure}`);
  }
  if (consoleMessages.some((m) => m.type === "error")) {
    console.log("\n--- Console errors ---");
    for (const m of consoleMessages.filter((m) => m.type === "error")) {
      console.log(`  ${m.text.substring(0, 200)}`);
    }
  }

  writeReport({
    signedInOnWeb: true,
    webClerkState: webParsed,
    finalUrl,
    consentClerkState: JSON.parse(consentClerkState),
    consentUi,
    clientResponses,
    consoleMessages,
    pageErrors,
    failedRequests,
    screenshots,
  });

  await context.close();
}

function writeReport(data) {
  writeFileSync(
    "test-results/oauth-consent-auth/report.json",
    JSON.stringify(data, null, 2),
  );
  console.log("\n--- Report saved to test-results/oauth-consent-auth/report.json ---");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
