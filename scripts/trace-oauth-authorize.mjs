import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const redirects = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      redirects.push({ url: frame.url(), status: "nav" });
    }
  });

  const responses = [];
  page.on("response", (resp) => {
    const url = resp.url();
    if (url.includes("clerk.litlabs.net") || url.includes("litlabs.net")) {
      responses.push({
        url: url.substring(0, 120),
        status: resp.status(),
        location: resp.headers()["location"]?.substring(0, 150) || "",
      });
    }
  });

  // Build the same authorize URL the CLI would use
  const authorizeUrl = new URL("https://clerk.litlabs.net/oauth/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", "YWeGjVVwoNnX4RTY");
  authorizeUrl.searchParams.set("redirect_uri", "http://127.0.0.1:9999/callback");
  authorizeUrl.searchParams.set("scope", "profile email offline_access");
  authorizeUrl.searchParams.set("state", "test-state-redacted");
  authorizeUrl.searchParams.set("code_challenge", "test-challenge-redacted");
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  console.log("Opening authorize URL:", authorizeUrl.toString().replace(/state=[^&]+/, "state=REDACTED").replace(/code_challenge=[^&]+/, "code_challenge=REDACTED"));

  await page.goto(authorizeUrl.toString(), { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log("\nFinal URL:", page.url());
  console.log("\nNavigation chain:");
  redirects.forEach((r, i) => {
    console.log(`  ${i}: ${r.url.replace(/state=[^&]+/, "state=REDACTED").replace(/code_challenge=[^&]+/, "code_challenge=REDACTED")}`);
  });

  console.log("\nKey responses (3xx):");
  responses.filter(r => r.status >= 300 && r.status < 400).forEach((r, i) => {
    console.log(`  ${r.status} ${r.url}`);
    if (r.location) console.log(`     → ${r.location.replace(/state=[^&]+/, "state=REDACTED").replace(/code_challenge=[^&]+/, "code_challenge=REDACTED")}`);
  });

  // Check if we landed on sign-in and what redirect_url is
  const currentUrl = page.url();
  if (currentUrl.includes("sign-in")) {
    const urlObj = new URL(currentUrl);
    const redirectUrl = urlObj.searchParams.get("redirect_url");
    console.log("\nredirect_url param:", redirectUrl ? redirectUrl.substring(0, 100) + "..." : "NOT PRESENT");
  }

  await page.screenshot({ path: "test-results/oauth-consent-auth/authorize-redirect.png" });

  // Keep browser open for 10 seconds so we can see
  await page.waitForTimeout(10000);
  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
