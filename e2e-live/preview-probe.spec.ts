import { test, expect } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";

/**
 * READ-ONLY preview probe — verifies the static-preview URL contract on
 * staging: session GET of the token-embedded previewUrl, cookie-less
 * token-mode asset reads, and manifest coverage for real generated assets.
 *
 * Env: PREVIEW_PROBE_PROJECT_ID (defaults to today's generated project).
 */
const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:3001";
const PROJECT_ID =
  process.env.PREVIEW_PROBE_PROJECT_ID ?? "87c809d7-ad44-4b74-9710-9ba1bf901f63";

test("static preview URL contract", async ({ page, request }) => {
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

  // 1. Project + workspace state.
  const pv = await request.get(`${BASE}/api/studio-projects/${PROJECT_ID}/preview`, { headers });
  const pvd = await pv.json().catch(() => null);
  console.log(`[preview-status] http=${pv.status()} ${JSON.stringify(pvd).slice(0, 800)}`);

  const files = await request.get(`${BASE}/api/studio-projects/${PROJECT_ID}/files?path=.`, { headers });
  const fd = await files.json().catch(() => null);
  const entries = (fd?.entries ?? []) as Array<{ name: string; type: string }>;
  console.log(`[files] ${JSON.stringify(entries.map((e) => `${e.type}:${e.name}`))}`);

  const previewUrl = typeof pvd?.previewUrl === "string" ? pvd.previewUrl : null;
  if (!previewUrl) {
    console.log("[probe] no previewUrl — static preview not ready; stopping.");
    return;
  }
  console.log(`[preview-url] ${previewUrl}`);

  // 2. Session-authenticated GET of the previewUrl exactly as the
  //    StudioPreviewPanel iframe/probe fetches it.
  const docResp = await request.get(`${BASE}${previewUrl}`, { headers });
  const docCt = docResp.headers()["content-type"] ?? "";
  const docBody = await docResp.text();
  console.log(
    `[doc:session] http=${docResp.status()} ct=${docCt} bytes=${docBody.length} ` +
      `marker=${docBody.includes("LITT-WELCOME-SCREEN") ? "welcome" : docBody.includes("<") ? "html" : "other"}`,
  );
  if (docResp.status() !== 200) {
    console.log(`[doc:session] body=${docBody.slice(0, 300)}`);
  }

  // 3. Cookie-less GET of the same URL — the opaque-iframe path.
  const anonResp = await request.get(`${BASE}${previewUrl}`);
  const anonBody = await anonResp.text();
  console.log(`[doc:anon] http=${anonResp.status()} bytes=${anonBody.length}`);
  if (anonResp.status() !== 200) console.log(`[doc:anon] body=${anonBody.slice(0, 300)}`);

  // 4. Extract rewritten asset URLs from the ANON-served document and
  //    probe each WITHOUT session (token-mode) — this is what the
  //    sandboxed iframe subresources experience.
  const anonDoc = anonBody;
  const assetBaseMatch = anonDoc.match(/\/api\/preview\/[^"'\s]+\/t\/[A-Za-z0-9_.-]+\//);
  const tokenMatch = previewUrl.match(/\/t\/([A-Za-z0-9_.-]+)\//);
  console.log(`[token] embedded=${Boolean(assetBaseMatch)} inUrl=${tokenMatch?.[1]?.slice(0, 24) ?? "none"}…`);
  const rewrittenAssets = [...anonDoc.matchAll(/(?:src|href)="(\/api\/preview\/[^"]+)"/g)].map((m) => m[1]);
  console.log(`[doc-assets] rewritten=${JSON.stringify(rewrittenAssets.slice(0, 10))}`);
  const relAssets = [...anonDoc.matchAll(/(?:src|href)="((?:assets|images|css|js|fonts)\/[^"]+)"/g)].map((m) => m[1]);
  console.log(`[doc-assets] relative=${JSON.stringify(relAssets.slice(0, 10))}`);

  if (anonResp.status() === 200 && tokenMatch) {
    const tokenPath = `/t/${tokenMatch[1]}`;
    // Probe every token-rewritten URL the document actually emitted.
    for (const rewritten of rewrittenAssets.slice(0, 6)) {
      const r = await request.get(`${BASE}${rewritten}`);
      console.log(`[asset:rewritten] ${rewritten.slice(0, 110)} -> ${r.status()}`);
    }
    // Probe same-workspace non-script assets (images/fonts) under the
    // token prefix — manifest scope decides whether they can load.
    for (const rel of relAssets.slice(0, 6)) {
      const resolved = `/api/preview/${encodeURIComponent(PROJECT_ID)}${tokenPath}/${rel}`;
      const r = await request.get(`${BASE}${resolved}`);
      console.log(`[asset:relative] ${rel} -> ${r.status()}`);
    }
    // Collect same-workspace asset references from the raw file list and
    // probe the ones a generated site would use.
    const assetCandidates: string[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth > 3) return;
      const r = await request.get(
        `${BASE}/api/studio-projects/${PROJECT_ID}/files?path=${encodeURIComponent(dir)}`,
        { headers },
      );
      const d = await r.json().catch(() => null);
      for (const e of (d?.entries ?? []) as Array<{ name: string; type: string }>) {
        const p = dir === "." ? e.name : `${dir}/${e.name}`;
        if (e.type === "folder" || e.type === "directory") await walk(p, depth + 1);
        else if (/\.(png|jpe?g|webp|svg|gif|css|js|mjs|woff2?|ttf|json|webmanifest)$/i.test(e.name)) {
          assetCandidates.push(p);
        }
      }
    };
    await walk(".", 0);
    console.log(`[assets] candidates=${JSON.stringify(assetCandidates.slice(0, 20))}`);

    for (const asset of assetCandidates.slice(0, 8)) {
      const assetUrl = `/api/preview/${encodeURIComponent(PROJECT_ID)}${tokenPath}/${asset}`;
      const ar = await request.get(`${BASE}${assetUrl}`);
      const ab = await ar.text();
      console.log(`[asset:anon] ${asset} -> ${ar.status()} ${ab.slice(0, 60).replace(/\n/g, " ")}`);
      const arSession = await request.get(`${BASE}${assetUrl}`, { headers });
      console.log(`[asset:sess] ${asset} -> ${arSession.status()}`);
    }
  }
});
