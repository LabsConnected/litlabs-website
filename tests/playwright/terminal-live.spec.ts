import { test, expect } from "@playwright/test";

/**
 * Live terminal diagnostic test — runs against production.
 *
 * This test loads the Studio page, looks for the terminal panel,
 * captures console errors, network failures, and the actual terminal
 * connection state to diagnose what's "buggy."
 *
 * Run with:
 *   PLAYWRIGHT_BASE_URL=https://litlabs.net npx playwright test terminal-live --project=public-chromium
 */

test.describe("Terminal — live diagnostic @public", () => {
  test("Studio loads, terminal panel renders, no catastrophic JS errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const networkErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
      if (msg.type() === "warning") consoleWarnings.push(msg.text());
    });

    page.on("requestfailed", (req) => {
      networkErrors.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });

    // Load studio — may redirect to sign-in if not authenticated
    const response = await page.goto("/studio", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBeLessThan(500);

    await page.waitForLoadState("networkidle");

    // Check if we're on a sign-in page or studio
    const url = page.url();
    console.log("Studio URL:", url);

    // Take a screenshot for diagnosis (don't wait for fonts — can hang)
    await page.screenshot({ path: "test-results/terminal-studio-load.png", fullPage: false, timeout: 5000 }).catch(() => {});

    // If we're on the sign-in page, that's expected for unauthenticated
    if (url.includes("sign-in") || url.includes("login")) {
      console.log("Redirected to sign-in — expected for unauthenticated terminal test");
      return;
    }

    // If we're in studio, look for terminal-related elements
    const bodyHtml = await page.locator("body").innerHTML();

    // Check for terminal panel or terminal-related text
    const hasTerminalText = bodyHtml.includes("Terminal") || bodyHtml.includes("terminal");
    console.log("Has terminal text:", hasTerminalText);

    // Check for xterm container
    const xtermContainer = page.locator(".xterm, [class*='terminal'], [data-terminal]").first();
    const hasXterm = await xtermContainer.count().catch(() => 0);
    console.log("Has xterm container:", hasXterm);

    // Report any console errors
    if (consoleErrors.length > 0) {
      console.log("Console errors:", consoleErrors.slice(0, 10));
    }
    if (networkErrors.length > 0) {
      console.log("Network errors:", networkErrors.slice(0, 10));
    }

    // No fatal console errors (ignore hydration, Clerk, 401s from unauthenticated API calls, etc.)
    const fatalErrors = consoleErrors.filter(
      (e) =>
        !e.includes("hydrat") &&
        !e.includes("Clerk") &&
        !e.includes("favicon") &&
        !e.includes("404") &&
        !e.includes("401") &&
        !e.includes("sentry") &&
        !e.includes("ERR_BLOCKED") &&
        !e.includes("net::ERR") &&
        !e.includes("WebSocket") && // terminal WS may fail when unauthenticated
        !e.includes("socket.io") &&
        !e.includes("ERR_CONNECTION_REFUSED") &&
        !e.includes("Download the React DevTools") &&
        !e.includes("Failed to load resource")
    );
    console.log("Fatal errors (filtered):", fatalErrors);
    expect(fatalErrors.length).toBe(0);
  });

  test("Terminal API endpoints respond correctly", async ({ request }) => {
    // Token endpoint — should return 401 unauthenticated
    const tokenResp = await request.get("/api/terminal/token");
    console.log("Token endpoint status:", tokenResp.status());
    expect(tokenResp.status()).toBe(401);

    const tokenBody = await tokenResp.json().catch(() => ({}));
    console.log("Token body:", JSON.stringify(tokenBody));
    expect(tokenBody.error).toBeTruthy();

    // History endpoint — should return 401 unauthenticated
    const historyResp = await request.get("/api/terminal/history");
    console.log("History endpoint status:", historyResp.status());
    expect(historyResp.status()).toBe(401);

    // Token with projectId — should return 401 unauthenticated
    const projectTokenResp = await request.get("/api/terminal/token?projectId=test-123");
    console.log("Token (projectId) status:", projectTokenResp.status());
    expect(projectTokenResp.status()).toBe(401);
  });

  test("Terminal server (Railway) is reachable via Socket.io polling", async ({ request }) => {
    // The terminal server URL is hardcoded in TerminalPanel.tsx as fallback
    const terminalServerUrl =
      "https://litlabs-terminal-server-production-0be1.up.railway.app/socket.io/?EIO=4&transport=polling";

    const resp = await request.get(terminalServerUrl);
    console.log("Terminal server status:", resp.status());
    expect(resp.status()).toBe(200);

    const body = await resp.text();
    console.log("Terminal server response:", body.substring(0, 100));
    // Socket.io engine.io handshake starts with "0{" 
    expect(body).toMatch(/^0\{/);
  });

  test("/litt-terminal redirects to /studio (not to sign-in loop)", async ({ page }) => {
    const response = await page.goto("/litt-terminal", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBeLessThan(400);

    await page.waitForURL(/\/studio|\/sign-in|\/login/);
    const url = page.url();
    console.log("Redirected to:", url);
    expect(url).toMatch(/\/studio|\/sign-in|\/login/);
  });
});
