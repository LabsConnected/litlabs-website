/**
 * Inspect the OAuth consent page state after the proxy URL fix.
 * Uses a fresh browser context (no existing session) to check:
 * - Does the sign-in page render?
 * - Does /v1/client return 200?
 * - What's the Clerk state on the consent page?
 *
 * Does NOT print cookies, tokens, or session values.
 */
import { chromium } from "@playwright/test";
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const ISSUER = "https://clerk.litlabs.net";
const CLIENT_ID = "YWeGjVVwoNnX4RTY";
const SCOPES = ["profile", "email", "offline_access"];

// Generate PKCE
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("hex");

const redirectUri = "http://127.0.0.1:9998/callback";
const authorizeUrl = new URL(`${ISSUER}/oauth/authorize`);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("client_id", CLIENT_ID);
authorizeUrl.searchParams.set("redirect_uri", redirectUri);
authorizeUrl.searchParams.set("scope", SCOPES.join(" "));
authorizeUrl.searchParams.set("state", state);
authorizeUrl.searchParams.set("code_challenge", challenge);
authorizeUrl.searchParams.set("code_challenge_method", "S256");

async function main() {
  console.log("=== OAuth Consent State Inspection ===");
  console.log(`Authorize URL: ${authorizeUrl.toString()}`);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // Collect all responses to clerk.litlabs.net
  const clerkResponses = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("clerk.litlabs.net") || url.includes("www.litlabs.net")) {
      try {
        const status = resp.status();
        const headers = resp.headers();
        let sessionCount = -1;
        let signedIn = null;
        let bodySnippet = "";

        if (url.includes("/v1/client")) {
          try {
            const body = await resp.text();
            const json = JSON.parse(body);
            sessionCount = json?.response?.sessions?.length ?? json?.sessions?.length ?? -1;
            signedIn = sessionCount > 0;
            bodySnippet = JSON.stringify({
              object: json?.object || json?.response?.object,
              id: json?.id || json?.response?.id,
              sessions: sessionCount,
              last_active_session_id: json?.last_active_session_id || json?.response?.last_active_session_id ? "present" : "null",
            });
          } catch {
            bodySnippet = "(could not parse)";
          }
        }

        clerkResponses.push({
          url: url.substring(0, 120),
          status,
          acao: headers["access-control-allow-origin"] || "none",
          acac: headers["access-control-allow-credentials"] || "none",
          sessionCount,
          signedIn,
          bodySnippet,
        });
      } catch {
        clerkResponses.push({ url: url.substring(0, 120), status: resp.status(), error: "read error" });
      }
    }
  });

  const consoleMessages = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleMessages.push({ type: msg.type(), text: msg.text().substring(0, 200) });
    }
  });

  const pageErrors = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message.substring(0, 200));
  });

  const failedRequests = [];
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (url.includes("clerk") || url.includes("accounts") || url.includes("litlabs")) {
      failedRequests.push({ url: url.substring(0, 120), failure: req.failure()?.errorText });
    }
  });

  // Navigate to the OAuth authorize URL
  console.log("\n--- Navigating to OAuth authorize URL ---");
  await page.goto(authorizeUrl.toString(), { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  const finalUrl = page.url();
  console.log(`Final URL: ${finalUrl}`);
  console.log(`Page title: ${await page.title()}`);

  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 800));
  console.log(`Body text:\n${bodyText}`);

  // Check Clerk state
  const clerkState = await page.evaluate(() => {
    return JSON.stringify({
      hasClerk: !!window.Clerk,
      loaded: window.Clerk?.loaded,
      isSignedIn: window.Clerk?.client?.isSignedIn,
      sessions: window.Clerk?.client?.sessions?.length,
      frontendApi: window.Clerk?.frontendApi,
      domain: window.Clerk?.domain,
      clerkJSVersion: window.Clerk?.version,
    });
  });
  console.log(`\nClerk state: ${clerkState}`);

  // Check for consent UI elements
  const consentUi = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const allText = document.body?.innerText || "";
    return {
      hasApproveButton: buttons.some((b) => /approve|allow|continue|authorize|accept/i.test(b.textContent || "")),
      hasDenyButton: buttons.some((b) => /deny|cancel|decline|reject/i.test(b.textContent || "")),
      buttonCount: buttons.length,
      bodyLength: allText.length,
      hasContent: allText.trim().length > 10,
      buttonTexts: buttons.slice(0, 10).map((b) => b.textContent?.trim()?.substring(0, 50)),
      formCount: document.querySelectorAll("form").length,
      inputCount: document.querySelectorAll("input").length,
    };
  });
  console.log(`Consent UI: ${JSON.stringify(consentUi, null, 2)}`);

  // Print all Clerk API responses
  console.log("\n--- Clerk API responses ---");
  for (const r of clerkResponses) {
    console.log(`  ${r.url}`);
    console.log(`    status: ${r.status}, sessions: ${r.sessionCount}, signedIn: ${r.signedIn}`);
    console.log(`    ACAO: ${r.acao}, ACAC: ${r.acac}`);
    if (r.bodySnippet) console.log(`    body: ${r.bodySnippet}`);
  }

  // Print errors
  if (pageErrors.length > 0) {
    console.log("\n--- Page errors ---");
    for (const e of pageErrors) console.log(`  ${e}`);
  } else {
    console.log("\n--- Page errors: none ---");
  }

  if (failedRequests.length > 0) {
    console.log("\n--- Failed requests ---");
    for (const r of failedRequests) console.log(`  ${r.url} — ${r.failure}`);
  } else {
    console.log("\n--- Failed requests: none ---");
  }

  if (consoleMessages.length > 0) {
    console.log("\n--- Console errors/warnings ---");
    for (const m of consoleMessages) console.log(`  [${m.type}] ${m.text}`);
  } else {
    console.log("\n--- Console errors/warnings: none ---");
  }

  // Take screenshot
  await page.screenshot({ path: "test-results/oauth-consent-auth/consent-inspection.png", fullPage: true });
  console.log("\nScreenshot: test-results/oauth-consent-auth/consent-inspection.png");

  // Save report
  const report = {
    authorizeUrl: authorizeUrl.toString(),
    finalUrl,
    clerkState: JSON.parse(clerkState),
    consentUi,
    clerkResponses,
    pageErrors,
    failedRequests,
    consoleMessages,
  };
  writeFileSync("test-results/oauth-consent-auth/inspection-report.json", JSON.stringify(report, null, 2));

  // Keep browser open for 10 seconds for visual inspection
  console.log("\n--- Keeping browser open for 10 seconds... ---");
  await page.waitForTimeout(10000);

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
