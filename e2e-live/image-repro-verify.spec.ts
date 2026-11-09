import { test, expect } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";

/**
 * READ-ONLY verification for the image-approval repro project — no new
 * generation, no approvals, no charges. Signs in, lists project files,
 * checks preview. Project id passed via IMAGE_REPRO_PROJECT_ID.
 */

const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:3001";
const PROJECT_ID = process.env.IMAGE_REPRO_PROJECT_ID;

test("verify image asset persisted + preview for repro project", async ({ page, request }) => {
  test.setTimeout(5 * 60_000);
  expect(PROJECT_ID, "IMAGE_REPRO_PROJECT_ID must be set").toBeTruthy();

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

  // Recursive file listing (the files API lists one dir at a time).
  async function listDir(pathname: string): Promise<string[]> {
    const r = await request.get(
      `${BASE}/api/studio-projects/${PROJECT_ID}/files?path=${encodeURIComponent(pathname)}`,
      { headers },
    );
    const data = await r.json().catch(() => null);
    const entries = (data?.entries ?? []) as { name: string; type: string }[];
    if (pathname === ".") console.log(`[entries:raw] ${JSON.stringify(entries)}`);
    const out: string[] = [];
    for (const e of entries) {
      const rel = pathname === "." ? e.name : `${pathname}/${e.name}`;
      out.push(rel);
      if (e.type !== "file" && e.type !== "blob") {
        out.push(...(await listDir(rel)));
      }
    }
    return out;
  }

  const all = await listDir(".");
  console.log(`[files] ${JSON.stringify(all)}`);
  const images = all.filter((f) => /\.(png|jpe?g|webp|gif|avif)$/i.test(f) || /assets\/images\//i.test(f));
  console.log(`[images] ${JSON.stringify(images)}`);

  const pv = await request.get(`${BASE}/api/studio-projects/${PROJECT_ID}/preview`, { headers });
  const pvd = await pv.json().catch(() => ({}));
  console.log(`[preview] status=${pv.status()} runtime=${pvd.runtimeStatus} url=${pvd.previewUrl ?? "none"}`);
  let previewHttp = 0;
  let previewHasImg = false;
  if (pvd.previewUrl) {
    const pr = await request.get(`${BASE}${pvd.previewUrl}`, { headers });
    previewHttp = pr.status();
    if (pr.status() === 200) previewHasImg = /<img[^>]+src=/i.test(await pr.text());
    console.log(`[preview.http] ${previewHttp} hasImg=${previewHasImg}`);
  }

  expect(images.length, "image asset must exist in project workspace").toBeGreaterThan(0);
});
