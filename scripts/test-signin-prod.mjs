import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();

  await page.goto("https://www.litlabs.net/sign-in", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("URL:", page.url());
  console.log("Title:", await page.title());
  console.log("Body:\n", bodyText);

  const hasSignIn = bodyText.includes("Sign in to My Application");
  const hasEmail = bodyText.includes("Email address");
  const hasPassword = bodyText.includes("Password");
  const hasContinue = bodyText.includes("Continue");
  const has404 = bodyText.includes("Page Not Found");

  console.log("\nResults:");
  console.log("  Sign in form present:", hasSignIn);
  console.log("  Email input present:", hasEmail);
  console.log("  Password input present:", hasPassword);
  console.log("  Continue button present:", hasContinue);
  console.log("  404 present:", has404);

  await page.screenshot({ path: "test-results/oauth-consent-auth/signin-prod-test.png" });
  console.log("\nScreenshot: test-results/oauth-consent-auth/signin-prod-test.png");

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
