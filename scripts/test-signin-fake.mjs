import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const errors = [];
  const failed = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("requestfailed", (req) => {
    if (req.url().includes("clerk")) failed.push({ url: req.url(), error: req.failure()?.errorText });
  });

  await page.goto("https://www.litlabs.net/sign-in", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Fill a fake email and password and submit
  await page.fill("input[name='identifier']", "fake_test_user_12345@example.com");
  await page.fill("input[name='password']", "FakePassword123!");
  await page.click("button:has-text('Continue')");

  await page.waitForTimeout(5000);

  console.log("URL after submit:", page.url());

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log("Body text:\n", bodyText.substring(0, 1000));

  if (errors.length > 0) {
    console.log("\nConsole errors:");
    for (const e of errors) console.log(" ", e);
  }
  if (failed.length > 0) {
    console.log("\nFailed requests:");
    for (const f of failed) console.log(" ", f.url, "—", f.error);
  }

  await page.screenshot({ path: "test-results/oauth-consent-auth/signin-fake-test.png" });
  console.log("\nScreenshot: test-results/oauth-consent-auth/signin-fake-test.png");

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
