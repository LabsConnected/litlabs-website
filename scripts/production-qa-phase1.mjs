/**
 * Production QA — Phase 1: Public / Signed-out experience.
 *
 * Opens https://www.litlabs.net in a real Chromium browser across 4 viewports,
 * captures screenshots, console errors, network failures, and DOM snapshots
 * for the public user journey.
 *
 * Usage: node scripts/production-qa-phase1.mjs <artifact-dir>
 */
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync, appendFileSync } from "fs";
import { join, resolve } from "path";

const BASE = "https://www.litlabs.net";
const artifactDir = resolve(process.argv[2] ?? "artifacts/production-qa/run");
const shotDir = join(artifactDir, "screenshots");
const domDir = join(artifactDir, "dom");
const netDir = join(artifactDir, "network");
for (const d of [shotDir, domDir, netDir]) mkdirSync(d, { recursive: true });

const consoleLogPath = join(artifactDir, "console-notes.md");
const networkLogPath = join(netDir, "notes.md");
const reportPath = join(artifactDir, "phase1-report.md");

// Reset logs
writeFileSync(consoleLogPath, "# Console Notes — Phase 1\n\n");
writeFileSync(networkLogPath, "# Network Notes — Phase 1\n\n");
writeFileSync(reportPath, "# Phase 1 Report — Public / Signed-out\n\n");

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
  { name: "narrow-mobile", width: 360, height: 800 },
];

const PUBLIC_PAGES = [
  { path: "/", name: "home" },
  { path: "/pricing", name: "pricing" },
  { path: "/sign-in", name: "signin" },
  { path: "/sign-up", name: "signup" },
];

const results = [];

function logConsole(msg) {
  const entry = `## ${msg.type().toUpperCase()} @ ${new Date().toISOString()}\n${msg.text()}\n\n`;
  appendFileSync(consoleLogPath, entry);
}

function logNetwork(request, response) {
  if (!response) return;
  const status = response.status();
  const url = response.url();
  // Only log failures and redirects
  if (status >= 400 || (status >= 300 && status < 400)) {
    const entry = `- **${status}** ${request.method()} ${url}\n`;
    appendFileSync(networkLogPath, entry);
  }
}

// Auth-protected API endpoints that correctly return 401 when signed out.
// These are NOT defects — they prove the auth boundary is working.
const EXPECTED_401_ENDPOINTS = [
  "/api/settings/profile",
  "/api/wallet",
  "/api/studio-projects",
  "/api/billing/portal",
  "/api/billing/checkout",
];

function isExpected401(url, status) {
  if (status !== 401) return false;
  try {
    const u = new URL(url);
    return EXPECTED_401_ENDPOINTS.some((ep) => u.pathname.startsWith(ep));
  } catch {
    return false;
  }
}

async function capturePage(page, viewportName, pageName, path) {
  const prefix = `${viewportName}-${pageName}`;
  const errors = [];
  const networkFails = [];

  // Collect console messages (filter expected 401 resource errors)
  page.on("console", (msg) => {
    logConsole(msg);
    if (msg.type() === "error") {
      const text = msg.text();
      // "Failed to load resource: 401" is expected for auth-protected APIs when signed out
      if (!text.includes("401")) {
        errors.push(text);
      }
    }
  });
  page.on("pageerror", (err) => {
    const entry = `## PAGEERROR @ ${new Date().toISOString()}\n${err.message}\n\n`;
    appendFileSync(consoleLogPath, entry);
    errors.push(`PAGEERROR: ${err.message}`);
  });

  // Collect network failures (exclude expected 401s on auth-protected APIs)
  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400 && !isExpected401(response.url(), status)) {
      networkFails.push(`${status} ${response.url()}`);
    }
    logNetwork(response.request(), response);
  });

  // Navigate
  const url = `${BASE}${path}`;
  let navStatus = "ok";
  let navDetail = "";
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    navStatus = resp ? `HTTP ${resp.status()}` : "no response";
    if (resp && resp.status() >= 400) navDetail = `HTTP ${resp.status()}`;
  } catch (err) {
    navStatus = "nav-error";
    navDetail = err.message;
  }

  // Wait for hydration
  await page.waitForTimeout(2000);

  // Full-page screenshot
  await page.screenshot({ path: join(shotDir, `${prefix}.png`), fullPage: true });

  // DOM snapshot (outer HTML, truncated to 500KB)
  const html = await page.content();
  writeFileSync(join(domDir, `${prefix}.html`), html.slice(0, 500000));

  // Check for visible text and controls
  const title = await page.title();
  const bodyText = await page.locator("body").innerText().catch(() => "");

  // Check for hydration errors visible on page
  const hasHydrationError = bodyText.toLowerCase().includes("hydration") ||
    bodyText.toLowerCase().includes("error occurred");

  // Check for Clerk loaded
  const clerkLoaded = await page.evaluate(() => {
    return !!window.Clerk || !!document.querySelector("[data-clerk]");
  }).catch(() => false);

  // Check layout overflow (horizontal scroll)
  const hasHorizontalScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  }).catch(() => false);

  // Check for broken images
  const brokenImages = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs.filter((img) => !img.complete || img.naturalWidth === 0).length;
  }).catch(() => 0);

  // Check for visible buttons/links
  const buttonCount = await page.locator("button:visible, a:visible").count().catch(() => 0);

  // Check accessibility: landmarks
  const landmarks = await page.evaluate(() => {
    return {
      hasMain: !!document.querySelector("main, [role=main]"),
      hasNav: !!document.querySelector("nav, [role=navigation]"),
      hasHeader: !!document.querySelector("header, [role=banner]"),
      hasFooter: !!document.querySelector("footer, [role=contentinfo]"),
      h1Count: document.querySelectorAll("h1").length,
    };
  }).catch(() => ({}));

  const result = {
    viewport: viewportName,
    page: pageName,
    path,
    url: page.url(),
    title,
    navStatus,
    navDetail,
    errors,
    networkFails,
    hasHydrationError,
    clerkLoaded,
    hasHorizontalScroll,
    brokenImages,
    buttonCount,
    landmarks,
  };
  results.push(result);

  const status = errors.length === 0 && networkFails.length === 0 && !hasHydrationError
    ? "PASS"
    : "FAIL";
  console.log(`[QA] ${prefix} — ${status} (${errors.length} errors, ${networkFails.length} net fails)`);

  return result;
}

async function test404(page, viewportName) {
  const prefix = `${viewportName}-404`;
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  try {
    const resp = await page.goto(`${BASE}/this-page-does-not-exist-xyz`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(shotDir, `${prefix}.png`), fullPage: true });
    const status = resp?.status() ?? "no-resp";
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const has404Text = /404|not found|doesn't exist|does not exist/i.test(bodyText);

    results.push({
      viewport: viewportName,
      page: "404",
      path: "/this-page-does-not-exist-xyz",
      navStatus: `HTTP ${status}`,
      has404Text,
      errors,
    });
    console.log(`[QA] ${prefix} — HTTP ${status}, 404 text: ${has404Text}`);
  } catch (err) {
    console.log(`[QA] ${prefix} — ERROR: ${err.message}`);
  }
}

async function testProtectedRouteRedirect(page, viewportName) {
  // Studio/dashboard should redirect or show sign-in prompt when signed out
  const protectedRoutes = ["/studio", "/dashboard"];
  for (const route of protectedRoutes) {
    const prefix = `${viewportName}-protected-${route.replace("/", "")}`;
    try {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: join(shotDir, `${prefix}.png`), fullPage: true });
      const finalUrl = page.url();
      const redirected = !finalUrl.includes(route);
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const showsSignIn = /sign in|sign-in|log in|log-in|create account|sign up/i.test(bodyText);

      results.push({
        viewport: viewportName,
        page: `protected-${route}`,
        path: route,
        finalUrl,
        redirected,
        showsSignIn,
        navStatus: `HTTP ${resp?.status() ?? "?"}`,
      });
      console.log(`[QA] ${prefix} — redirected=${redirected}, showsSignIn=${showsSignIn}, final=${finalUrl}`);
    } catch (err) {
      console.log(`[QA] ${prefix} — ERROR: ${err.message}`);
    }
  }
}

async function testKeyboardNav(page, viewportName) {
  // Tab through the homepage and verify focus is visible
  const prefix = `${viewportName}-keyboard`;
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);

    // Tab through 10 elements
    const focusedElements = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(100);
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return {
          tag: el.tagName,
          text: (el.textContent || "").slice(0, 50),
          hasFocusVisible: !!el.matches(":focus-visible"),
          rect: el.getBoundingClientRect().toJSON(),
        };
      }).catch(() => null);
      if (info) focusedElements.push(info);
    }

    await page.screenshot({ path: join(shotDir, `${prefix}.png`), fullPage: true });

    results.push({
      viewport: viewportName,
      page: "keyboard-nav",
      focusedElements: focusedElements.length,
      focusVisibleCount: focusedElements.filter((e) => e.hasFocusVisible).length,
    });
    console.log(`[QA] ${prefix} — ${focusedElements.length} focused, ${focusedElements.filter((e) => e.hasFocusVisible).length} focus-visible`);
  } catch (err) {
    console.log(`[QA] ${prefix} — ERROR: ${err.message}`);
  }
}

async function main() {
  console.log(`[QA] Phase 1 starting — artifacts: ${artifactDir}`);
  const browser = await chromium.launch({ headless: true });

  for (const vp of VIEWPORTS) {
    console.log(`\n[QA] === Viewport: ${vp.name} (${vp.width}x${vp.height}) ===`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      // Clean context — no cookies, signed out
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    // Public pages
    for (const p of PUBLIC_PAGES) {
      await capturePage(page, vp.name, p.name, p.path);
    }

    // 404
    await test404(page, vp.name);

    // Protected route redirect
    await testProtectedRouteRedirect(page, vp.name);

    // Keyboard nav (desktop only)
    if (vp.name === "desktop") {
      await testKeyboardNav(page, vp.name);
    }

    await context.close();
  }

  await browser.close();

  // Write final report
  let report = "# Phase 1 Report — Public / Signed-out\n\n";
  report += `**Base URL:** ${BASE}\n`;
  report += `**Timestamp:** ${new Date().toISOString()}\n`;
  report += `**Viewports:** ${VIEWPORTS.map((v) => `${v.name}(${v.width}x${v.height})`).join(", ")}\n\n`;

  // Summary table
  report += "## Summary\n\n";
  report += "| Viewport | Page | Status | Console Errors | Network Fails | Notes |\n";
  report += "|----------|------|--------|-----------------|---------------|-------|\n";
  for (const r of results) {
    const errs = r.errors?.length ?? 0;
    const nets = r.networkFails?.length ?? 0;
    const status = errs === 0 && nets === 0 && !r.hasHydrationError ? "PASS" : "FAIL";
    const notes = [
      r.hasHydrationError ? "hydration-error" : "",
      r.hasHorizontalScroll ? "h-scroll" : "",
      r.brokenImages ? `${r.brokenImages}-broken-imgs` : "",
      r.redirected ? "redirected" : "",
      r.showsSignIn ? "shows-signin" : "",
      r.has404Text === false ? "no-404-text" : "",
    ].filter(Boolean).join(", ");
    report += `| ${r.viewport} | ${r.page} | ${status} | ${errs} | ${nets} | ${notes} |\n`;
  }
  report += "\n";

  // Detailed findings
  report += "## Detailed Findings\n\n";
  for (const r of results) {
    report += `### ${r.viewport} / ${r.page}\n`;
    report += `- **Path:** ${r.path}\n`;
    report += `- **Final URL:** ${r.url ?? r.finalUrl ?? "n/a"}\n`;
    report += `- **Nav status:** ${r.navStatus}\n`;
    if (r.navDetail) report += `- **Nav detail:** ${r.navDetail}\n`;
    if (r.title) report += `- **Title:** ${r.title}\n`;
    if (r.errors?.length) {
      report += `- **Console errors:**\n`;
      for (const e of r.errors) report += `  - ${e}\n`;
    }
    if (r.networkFails?.length) {
      report += `- **Network failures:**\n`;
      for (const n of r.networkFails) report += `  - ${n}\n`;
    }
    if (r.hasHydrationError) report += `- **Hydration error detected on page**\n`;
    if (r.clerkLoaded !== undefined) report += `- **Clerk loaded:** ${r.clerkLoaded}\n`;
    if (r.hasHorizontalScroll) report += `- **Horizontal scroll overflow**\n`;
    if (r.brokenImages) report += `- **Broken images:** ${r.brokenImages}\n`;
    if (r.buttonCount !== undefined) report += `- **Visible buttons/links:** ${r.buttonCount}\n`;
    if (r.landmarks) report += `- **Landmarks:** ${JSON.stringify(r.landmarks)}\n`;
    if (r.redirected !== undefined) report += `- **Redirected:** ${r.redirected}\n`;
    if (r.showsSignIn !== undefined) report += `- **Shows sign-in:** ${r.showsSignIn}\n`;
    if (r.has404Text !== undefined) report += `- **404 text shown:** ${r.has404Text}\n`;
    if (r.focusedElements !== undefined) report += `- **Keyboard focus elements:** ${r.focusedElements} (${r.focusVisibleCount} focus-visible)\n`;
    report += "\n";
  }

  // Aggregate stats
  const totalPass = results.filter((r) => {
    const errs = r.errors?.length ?? 0;
    const nets = r.networkFails?.length ?? 0;
    return errs === 0 && nets === 0 && !r.hasHydrationError;
  }).length;
  report += `## Totals\n\n`;
  report += `- Total checks: ${results.length}\n`;
  report += `- Passed: ${totalPass}\n`;
  report += `- Failed: ${results.length - totalPass}\n`;

  writeFileSync(reportPath, report);
  console.log(`\n[QA] Phase 1 complete — report: ${reportPath}`);
  console.log(`[QA] Screenshots: ${shotDir}`);
  console.log(`[QA] Total: ${results.length}, Passed: ${totalPass}, Failed: ${results.length - totalPass}`);
}

main().catch((err) => {
  console.error("[QA] FATAL:", err);
  process.exit(1);
});
