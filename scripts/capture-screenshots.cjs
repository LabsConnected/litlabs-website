const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = path.join(__dirname, "..", "screenshots");
const URL = "http://localhost:3001/studio";

const viewports = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "390x844", width: 390, height: 844 },
];

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });

  for (const vp of viewports) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
    // Wait for content to settle
    await new Promise((r) => setTimeout(r, 2000));
    const file = path.join(OUT, `studio-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`Saved: ${file}`);
    await page.close();
  }

  await browser.close();
  console.log("All screenshots captured.");
})().catch((err) => {
  console.error("Screenshot script failed:", err);
  process.exit(1);
});
