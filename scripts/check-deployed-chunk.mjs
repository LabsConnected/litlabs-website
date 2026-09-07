import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();

  // Check what chunk is loaded
  let chunkUrl = "";
  page.on("request", (req) => {
    if (req.url().includes("sign-in/page")) {
      chunkUrl = req.url();
    }
  });

  await page.goto("https://www.litlabs.net/sign-in?redirect_url=test123", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  console.log("Sign-in page chunk:", chunkUrl || "NOT FOUND");

  // Check if the form action includes redirect_url
  const formAction = await page.evaluate(() => {
    const form = document.querySelector("form");
    return form?.action || "NO FORM";
  });
  console.log("Form action:", formAction);

  // Check if forceRedirectUrl is being used by looking for redirect_url in the form
  const hasRedirectUrl = formAction.includes("redirect_url");
  console.log("redirect_url preserved in form:", hasRedirectUrl);

  await browser.close();
}

main().catch(console.error);
