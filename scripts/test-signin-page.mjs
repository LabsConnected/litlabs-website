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

  const qs =
    "?redirect_url=https%3A%2F%2Fwww.litlabs.net%2Foauth-consent%3Fclient_id%3DYWeGjVVwoNnX4RTY%26redirect_uri%3Dhttp%253A%252F%252F127.0.0.1%253A9999%252Fcallback%26response_type%3Dcode%26scope%3Dprofile%2Bemail%2Boffline_access%26state%3Dtest%26code_challenge%3Dtest%26code_challenge_method%3DS256";

  await page.goto(`https://www.litlabs.net/sign-in${qs}`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log("URL:", page.url());
  console.log("Title:", await page.title());

  const clerkState = await page.evaluate(() =>
    JSON.stringify({
      hasClerk: !!window.Clerk,
      loaded: window.Clerk?.loaded,
      isSignedIn: window.Clerk?.client?.isSignedIn,
      sessions: window.Clerk?.client?.sessions?.length,
      frontendApi: window.Clerk?.frontendApi,
    }),
  );
  console.log("Clerk state:", clerkState);

  const inputs = await page.$$eval("input", (els) => els.map((e) => ({ name: e.name, type: e.type, placeholder: e.placeholder })));
  const buttons = await page.$$eval("button", (els) => els.map((e) => e.textContent.trim()));
  console.log("Inputs:", inputs);
  console.log("Buttons:", buttons);

  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("Body text:\n", bodyText);

  if (errors.length > 0) {
    console.log("\nConsole errors:");
    for (const e of errors) console.log(" ", e);
  }
  if (failed.length > 0) {
    console.log("\nFailed requests:");
    for (const f of failed) console.log(" ", f.url, "—", f.error);
  }

  await page.screenshot({ path: "test-results/oauth-consent-auth/signin-page-test.png" });
  console.log("\nScreenshot: test-results/oauth-consent-auth/signin-page-test.png");

  await page.waitForTimeout(5000);
  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
