const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = "http://localhost:3001/studio";

const viewports = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "390x844", width: 390, height: 844 },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });

  const results = [];

  for (const vp of viewports) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    // Extract visual audit data from the page
    const audit = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;

      // Horizontal overflow check
      const bodyScrollW = body.scrollWidth;
      const clientW = html.clientWidth;
      const hasHorizontalOverflow = bodyScrollW > clientW + 2; // 2px tolerance

      // Opacity-0 elements (invisible focusable controls)
      const allEls = body.querySelectorAll("*");
      const opacityZero = [];
      allEls.forEach((el) => {
        const style = window.getComputedStyle(el);
        if (style.opacity === "0" && el.tagName !== "SCRIPT" && el.tagName !== "STYLE") {
          opacityZero.push({
            tag: el.tagName,
            id: el.id || "",
            class: (el.className || "").toString().slice(0, 60),
            focusable: el.hasAttribute("tabindex") || el.tagName === "BUTTON" || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "A",
          });
        }
      });

      // Check for sign-in wall (expected for unauthenticated)
      const signInWall = !!body.querySelector("a[href*='sign-in']");
      const signInText = body.textContent?.includes("Sign in to Studio") || false;
      const demoLink = body.textContent?.includes("public demo") || false;

      // Check for studio elements (should not render without auth)
      const composer = body.querySelector("[aria-label='Message input']");
      const transcript = body.querySelector("[data-testid='studio-transcript']");

      // Check for horizontal scrollbar
      const hasHorizontalScrollbar = window.innerWidth < body.scrollWidth;

      return {
        bodyScrollWidth: bodyScrollW,
        clientWidth: clientW,
        hasHorizontalOverflow,
        hasHorizontalScrollbar,
        opacityZeroCount: opacityZero.length,
        opacityZeroFocusable: opacityZero.filter((e) => e.focusable).length,
        opacityZeroSamples: opacityZero.slice(0, 5),
        signInWall,
        signInText,
        demoLinkPresent: demoLink,
        composerPresent: !!composer,
        transcriptPresent: !!transcript,
        bodyTextSample: body.textContent?.slice(0, 200).replace(/\s+/g, " ").trim(),
      };
    });

    results.push({ viewport: vp.name, ...audit });
    await page.close();
  }

  await browser.close();

  // Print results
  console.log("\n=== VISUAL INTERACTION GATE RESULTS ===\n");
  for (const r of results) {
    console.log(`\n--- ${r.viewport} ---`);
    console.log(`  Horizontal overflow:       ${r.hasHorizontalOverflow ? "FAIL" : "PASS"} (scrollW=${r.bodyScrollWidth}, clientW=${r.clientWidth})`);
    console.log(`  Horizontal scrollbar:      ${r.hasHorizontalScrollbar ? "FAIL" : "PASS"}`);
    console.log(`  Opacity-0 elements:        ${r.opacityZeroCount} total, ${r.opacityZeroFocusable} focusable ${r.opacityZeroFocusable === 0 ? "PASS" : "FAIL"}`);
    if (r.opacityZeroSamples.length > 0) {
      console.log(`    Samples: ${JSON.stringify(r.opacityZeroSamples)}`);
    }
    console.log(`  Sign-in wall visible:      ${r.signInWall && r.signInText ? "PASS" : "FAIL"}`);
    console.log(`  Demo link removed:         ${!r.demoLinkPresent ? "PASS" : "FAIL"}`);
    console.log(`  Composer hidden (no auth): ${!r.composerPresent ? "PASS" : "FAIL"}`);
    console.log(`  Transcript hidden (no auth): ${!r.transcriptPresent ? "PASS" : "FAIL"}`);
    console.log(`  Body text: "${r.bodyTextSample}"`);
  }

  // Summary
  const allPass = results.every((r) =>
    !r.hasHorizontalOverflow &&
    !r.hasHorizontalScrollbar &&
    r.opacityZeroFocusable === 0 &&
    r.signInWall &&
    r.signInText &&
    !r.demoLinkPresent &&
    !r.composerPresent &&
    !r.transcriptPresent
  );
  console.log(`\n=== OVERALL: ${allPass ? "ALL PASS" : "ISSUES FOUND"} ===\n`);
  process.exit(allPass ? 0 : 1);
})().catch((err) => {
  console.error("Visual audit failed:", err);
  process.exit(1);
});
