const puppeteer = require("puppeteer-core");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:3000/studio/visual-test", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 5000));

  const result = await page.evaluate(() => {
    const selector = document.querySelector("[data-testid='visual-test-state-selector']");
    const buttons = selector ? selector.querySelectorAll("button").length : 0;
    const bodyText = document.body.innerText.substring(0, 500);
    return { selectorFound: !!selector, buttonCount: buttons, bodyText };
  });

  console.log("Selector found:", result.selectorFound);
  console.log("Button count:", result.buttonCount);
  console.log("Body text:", result.bodyText);

  await page.screenshot({ path: "screenshots/visual-test/debug.png" });
  console.log("Screenshot saved to screenshots/visual-test/debug.png");

  await browser.close();
})();
