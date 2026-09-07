import { chromium } from "@playwright/test";
import { createServer } from "http";

async function main() {
  // Start a fake callback server to capture the callback
  let callbackReceived = null;
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${serverPort}`);
    callbackReceived = {
      path: url.pathname,
      hasCode: url.searchParams.has("code"),
      hasState: url.searchParams.has("state"),
      hasError: url.searchParams.has("error"),
      error: url.searchParams.get("error") || "",
    };
    console.log("\n*** CALLBACK RECEIVED ***");
    console.log("  path:", callbackReceived.path);
    console.log("  hasCode:", callbackReceived.hasCode);
    console.log("  hasState:", callbackReceived.hasState);
    console.log("  hasError:", callbackReceived.hasError);
    if (callbackReceived.error) console.log("  error:", callbackReceived.error);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h1>Callback received! You can close this tab.</h1></body></html>");
  });

  const serverPort = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
  console.log("Callback server listening on http://127.0.0.1:" + serverPort + "/callback");

  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const redirects = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      if (!redirects.includes(url)) {
        redirects.push(url);
        console.log("[NAV]", url.replace(/state=[^&]+/g, "state=REDACTED").replace(/code_challenge=[^&]+/g, "code_challenge=REDACTED").replace(/code=[^&]+/g, "code=REDACTED"));
      }
    }
  });

  // Build the authorize URL with our callback server
  const authorizeUrl = new URL("https://clerk.litlabs.net/oauth/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", "YWeGjVVwoNnX4RTY");
  authorizeUrl.searchParams.set("redirect_uri", `http://127.0.0.1:${serverPort}/callback`);
  authorizeUrl.searchParams.set("scope", "profile email offline_access");
  authorizeUrl.searchParams.set("state", "test-state-redacted");
  // Generate a valid PKCE challenge (43+ chars)
  authorizeUrl.searchParams.set("code_challenge", "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz01");
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  console.log("\nOpening authorize URL...");
  await page.goto(authorizeUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });

  console.log("\n=== BROWSER OPENED ===");
  console.log("Please sign in with your real account.");
  console.log("Watch the [NAV] logs above to see where redirects go.");
  console.log("The test will wait up to 5 minutes for the callback.\n");

  // Wait for callback or timeout
  const startTime = Date.now();
  const maxWait = 5 * 60 * 1000; // 5 minutes

  while (!callbackReceived && Date.now() - startTime < maxWait) {
    await page.waitForTimeout(1000);
  }

  if (callbackReceived) {
    console.log("\n=== SUCCESS: Callback was received! ===");
    console.log("The OAuth flow completed.");
  } else {
    console.log("\n=== TIMEOUT: No callback received after 5 minutes ===");
    console.log("Final URL:", page.url());
    console.log("Redirect chain:");
    redirects.forEach((r, i) => {
      console.log(`  ${i}: ${r.replace(/state=[^&]+/g, "state=REDACTED").replace(/code_challenge=[^&]+/g, "code_challenge=REDACTED").replace(/code=[^&]+/g, "code=REDACTED")}`);
    });

    // Check Clerk state at final URL
    const clerkState = await page.evaluate(() => {
      const clerk = window.Clerk;
      if (!clerk) return { hasClerk: false };
      const client = clerk.client;
      if (!client) return { hasClerk: true, hasClient: false };
      return {
        hasClerk: true,
        hasClient: true,
        isSignedIn: client.isSignedIn,
        sessions: client.sessions.length,
        activeSessionStatus: client.sessions.find(s => s.status === "active")?.status || "none",
      };
    }).catch(() => "could not evaluate");
    console.log("Clerk state at final URL:", JSON.stringify(clerkState, null, 2));
  }

  await page.screenshot({ path: "test-results/oauth-consent-auth/final-state.png" });
  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
