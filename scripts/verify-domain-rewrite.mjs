import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();

  // Simulate the redirect_url Clerk would pass (with accounts.litlabs.net)
  const signInUrl = "https://www.litlabs.net/sign-in?redirect_url=" + encodeURIComponent(
    "https://accounts.litlabs.net/oauth-consent?client_id=YWeGjVVwoNnX4RTY&code_challenge=test123&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A9999%2Fcallback&response_type=code&scope=profile+email+offline_access&state=test123"
  );

  await page.goto(signInUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  const formAction = await page.evaluate(() => {
    const form = document.querySelector("form");
    return form?.action || "NO FORM";
  });

  console.log("Form action:", formAction);
  console.log("Contains accounts.litlabs.net:", formAction.includes("accounts.litlabs.net"));
  console.log("Contains www.litlabs.net/oauth-consent:", formAction.includes("www.litlabs.net/oauth-consent"));

  await browser.close();
}

main().catch(console.error);
