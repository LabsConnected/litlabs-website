import { test, expect } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";

/**
 * Visual preview verification — loads the tokenized static-preview URL in a
 * real browser page exactly as Studio's iframe would resolve it, captures a
 * screenshot of the RENDERED generated site, and fails on any subresource
 * HTTP error (403/404/5xx) — proving images/CSS/JS actually load.
 *
 * Env: PREVIEW_VISUAL_PROJECT_ID (defaults to the studio-live project).
 */
const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:3001";
const PROJECT_ID =
  process.env.PREVIEW_VISUAL_PROJECT_ID ?? "a7a3beba-1bf5-4ac6-92d2-647371a2f756";

test("generated site renders in browser with zero failed subresources", async ({
  page,
  request,
}) => {
  test.setTimeout(5 * 60_000);
  await clerkSetup();
  await setupClerkTestingToken({ page });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => Boolean((window as Window & { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
    undefined,
    { timeout: 60_000 },
  );
  await clerk.signIn({ page, emailAddress: process.env.CLERK_TEST_USER_A_EMAIL! });
  const token = await page.evaluate(async () => {
    const c = (window as Window & {
      Clerk?: { session?: { getToken?: (o?: { skipCache?: boolean }) => Promise<string | null> } };
    }).Clerk;
    return c?.session?.getToken ? c.session.getToken({ skipCache: true }) : null;
  });
  const headers = { Authorization: `Bearer ${token}` };

  const pv = await request.get(`${BASE}/api/studio-projects/${PROJECT_ID}/preview`, { headers });
  const pvd = await pv.json().catch(() => null);
  console.log(`[preview-status] http=${pv.status()} runtime=${pvd?.runtimeStatus}`);
  expect(pv.status(), "preview status endpoint").toBe(200);
  expect(pvd?.runtimeStatus, "runtime must be ready for a generated project").toBe("ready");
  const previewUrl = pvd.previewUrl as string;
  expect(previewUrl, "previewUrl present").toBeTruthy();

  // Track every response the document + its subresources produce.
  const failures: string[] = [];
  const assetStatuses = new Map<string, number>();
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/api/preview/")) return;
    assetStatuses.set(url, res.status());
    if (res.status() >= 400) failures.push(`${res.status()} ${url.slice(0, 160)}`);
  });

  const docResp = await page.goto(`${BASE}${previewUrl}`, { waitUntil: "load", timeout: 60_000 });
  console.log(`[doc] http=${docResp?.status()} url=${previewUrl.slice(0, 120)}…`);
  expect(docResp?.status(), "preview document must serve 200").toBe(200);

  // Let lazy/deferred subresources settle, then assert on the DOM: the
  // generated site must have rendered real content (not a blank/error page).
  await page.waitForTimeout(4000);
  const bodyText = (await page.locator("body").innerText().catch(() => "")).trim();
  const imgCount = await page.locator("img").count();
  const imgLoaded = await page
    .locator("img")
    .evaluateAll((els) => els.filter((el) => (el as HTMLImageElement).naturalWidth > 0).length)
    .catch(() => 0);
  console.log(`[dom] text=${JSON.stringify(bodyText.slice(0, 160))} imgs=${imgCount} loaded=${imgLoaded}`);
  expect(bodyText.length, "rendered document must contain visible text").toBeGreaterThan(20);

  await page.screenshot({ path: "e2e-live/shots/preview-visual-rendered.png", fullPage: false });

  const assetSummary = [...assetStatuses.entries()].map(([u, s]) => `${s} ${u.split("/t/")[1]?.slice(0, 40) ?? u}`);
  console.log(`[assets] ${assetSummary.length} preview requests: ${JSON.stringify(assetSummary.slice(0, 15))}`);
  expect(failures, `no preview subresource may fail: ${JSON.stringify(failures)}`).toHaveLength(0);
});
