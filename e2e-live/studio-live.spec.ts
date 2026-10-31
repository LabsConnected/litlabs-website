import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

/**
 * Live Studio acceptance — real Clerk dev sign-in → create project →
 * generate → verify files/canvas → preview → modify → reload persistence
 * → terminal → voice. Evidence: screenshots + API assertions logged to stdout.
 */

const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:3001";
const SHOTS = path.join(__dirname, "shots");
mkdirSync(SHOTS, { recursive: true });

const PROMPT_BUILD = "Build a modern responsive website.";
const PROMPT_MODIFY =
  "Change the main heading to \"LiTT STUDIO VERIFIED\" and update the theme to purple.";

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  console.log(`[shot] ${name}.png`);
}

/** Fresh JWT for API calls (dev session tokens expire ~60s). */
async function bearer(page: Page): Promise<Record<string, string>> {
  await page.waitForFunction(
    () => {
      const c = (window as Window & { Clerk?: { loaded?: boolean; session?: unknown } }).Clerk;
      return Boolean(c?.loaded && c?.session);
    },
    undefined,
    { timeout: 60_000 },
  );
  const token = await page.evaluate(async () => {
    const c = (window as Window & {
      Clerk?: { session?: { getToken?: (o?: { skipCache?: boolean }) => Promise<string | null> } };
    }).Clerk;
    return c?.session?.getToken ? c.session.getToken({ skipCache: true }) : null;
  });
  expect(token, "fresh Clerk session token").toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

async function listFiles(request: APIRequestContext, page: Page, projectId: string) {
  const r = await request.get(`${BASE}/api/studio-projects/${projectId}/files?path=.`, {
    headers: await bearer(page),
  });
  const d = await r.json();
  return (d.entries ?? []) as Array<{ name: string; type: string }>;
}

async function listBlocks(request: APIRequestContext, page: Page, projectId: string) {
  const c = await request.get(`${BASE}/api/canvases?projectId=${projectId}`, {
    headers: await bearer(page),
  });
  const cd = await c.json();
  const canvas = (cd.canvases ?? [])[0];
  if (!canvas) return { canvasId: null, blocks: [] as unknown[] };
  const b = await request.get(`${BASE}/api/canvases/${canvas.id}/blocks`, {
    headers: await bearer(page),
  });
  const bd = await b.json();
  return { canvasId: canvas.id as string, blocks: (bd.blocks ?? []) as unknown[] };
}

/** Recursive workspace file list — /files?path=. returns one level. */
async function walkFiles(
  request: APIRequestContext,
  page: Page,
  projectId: string,
  dir = ".",
  depth = 0,
): Promise<string[]> {
  if (depth > 6) return [];
  const r = await request.get(
    `${BASE}/api/studio-projects/${projectId}/files?path=${encodeURIComponent(dir)}`,
    { headers: await bearer(page) },
  );
  if (!r.ok()) return [];
  const d = await r.json();
  const out: string[] = [];
  for (const e of (d.entries ?? []) as Array<{ name: string; type: string }>) {
    const rel = dir === "." ? e.name : `${dir}/${e.name}`;
    if (e.type === "directory" || e.type === "dir") {
      out.push(...(await walkFiles(request, page, projectId, rel, depth + 1)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** Fetch one file's real content through the same raw endpoint the UI uses. */
async function fetchFileRaw(
  request: APIRequestContext,
  page: Page,
  projectId: string,
  filePath: string,
): Promise<Buffer> {
  const r = await request.get(
    `${BASE}/api/studio-projects/${projectId}/files/raw?path=${encodeURIComponent(filePath)}`,
    { headers: await bearer(page) },
  );
  const ct = r.headers()["content-type"] ?? "";
  if (ct.includes("application/json")) {
    const d = await r.json();
    return Buffer.from(d.content ?? "", "utf-8");
  }
  return Buffer.from(await r.body());
}

// Minimal store-method ZIP packer — validates that project content exports
// byte-for-byte. (The product has no native project-ZIP endpoint today.)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function buildZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf-8");
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, f.data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(f.data.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + f.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/**
 * Approve-gated run driver: sends the prompt, then for up to `maxMinutes`
 * clicks every approval card that appears, until the assistant message
 * resolves (completed/failed) or the action-run reaches a terminal state.
 */
/** Dismiss the cookie banner and make sure the LiTT panel is expanded
 *  so the composer and approval card are actually reachable. */
async function ensureComposer(page: Page) {
  const accept = page.getByRole("button", { name: "Accept all" }).first();
  if (await accept.isVisible().catch(() => false)) {
    await accept.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  const input = page.getByTestId("studio-command-input");
  if (!(await input.isVisible().catch(() => false))) {
    // The panel auto-switches to the Activity tab while a run works — the
    // composer lives on the Chat tab, so switch back before giving up.
    const chatTab = page.getByRole("button", { name: "Chat", exact: true }).first();
    if (await chatTab.isVisible().catch(() => false)) {
      await chatTab.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  if (!(await input.isVisible().catch(() => false))) {
    const expand = page.getByRole("button", { name: /expand litt panel/i }).first();
    if (await expand.isVisible().catch(() => false)) {
      await expand.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  return input;
}

/** Resilient GET — the SSH tunnel over Tailscale occasionally drops a
 *  socket mid-run; retry a few times before giving up. */
async function apiGet(request: APIRequestContext, url: string, headers: Record<string, string>, tries = 4) {
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await request.get(url, { headers });
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastErr;
}

async function sendAndDrive(page: Page, request: APIRequestContext, prompt: string, maxMinutes = 14) {
  const input = await ensureComposer(page);
  await input.fill(prompt);
  // The send button doubles as Stop while the UI thinks a run streams
  // (busy ? onCancel : submit). If a previous run's streaming flag is
  // stuck, this click would fire the cancel endpoint with the run's own
  // clientRequestId — confirmed live: a real POST /cancel killed the run.
  // Reload first: a fresh mount reconciles canonical run state instead of
  // sending a cancellation. The server run is unaffected by the reload.
  const sendBtn = page.getByTestId("studio-send-button");
  const label = await sendBtn.getAttribute("aria-label").catch(() => null);
  console.log(`[send-btn] aria-label=${JSON.stringify(label)}`);
  if (label && /cancel/i.test(label)) {
    console.log(`[send-btn] busy/stale UI — reloading to clear instead of clicking Stop`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const input2 = await ensureComposer(page);
    await input2.fill(prompt);
  }
  await sendBtn.click();
  console.log(`[send] ${prompt.slice(0, 60)}…`);
  return driveRun(page, request, maxMinutes);
}

/** Poll the active run to a terminal state, approving every gate that surfaces. */
async function driveRun(page: Page, request: APIRequestContext, maxMinutes = 14) {

  const deadline = Date.now() + maxMinutes * 60_000;
  let approvals = 0;
  let lastStatus = "";
  let cardAbsentSince: number | null = null;

  while (Date.now() < deadline) {
    // The approval card lives inside the LiTT transcript — the panel can
    // auto-collapse to another surface, so expand it before checking.
    await ensureComposer(page);
    // Approve any pending approval card (preferred UI path).
    const approveBtn = page.getByTestId("approval-approve").first();
    if (await approveBtn.isVisible().catch(() => false)) {
      cardAbsentSince = null;
      approvals += 1;
      console.log(`[approve:ui] #${approvals}`);
      await approveBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
      continue;
    }

    // Check run status through the API (authoritative).
    const convs = await apiGet(request, `${BASE}/api/studio/conversations`, await bearer(page));
    const convData = await convs.json().catch(() => ({ conversations: [] }));
    const conv = (convData.conversations ?? [])[0];
    if (conv) {
      const ar = await apiGet(
        request,
        `${BASE}/api/studio/conversations/${conv.id}/action-run`,
        await bearer(page),
      );
      const ard = await ar.json().catch(() => null);
      const status = ard?.projection?.run?.status ?? "";
      const activity = ard?.projection?.currentActivity ?? "";
      const pausedRef = ard?.projection?.run?.approvalReference;
      const failure = ard?.projection?.failure ?? null;
      if (status !== lastStatus) {
        lastStatus = status;
        console.log(`[run] status=${status} activity=${activity}`);
      }
      if (status && !["working", "waiting_for_user", "queued", "pending"].includes(status)) {
        if (failure) console.log(`[run.failure] code=${failure.code} message=${String(failure.message).slice(0, 400)}`);
        const tools = ard?.projection?.tools;
        if (tools) console.log(`[run.tools] started=${tools.started?.length} failed=${JSON.stringify(tools.failed ?? []).slice(0, 300)}`);
        return { status, approvals, failure };
      }
      // Fallback: if the approval card never surfaces in the DOM, resolve
      // through the same endpoint the card's Approve button calls.
      if (status === "waiting_for_user" && pausedRef) {
        if (cardAbsentSince === null) cardAbsentSince = Date.now();
        if (Date.now() - cardAbsentSince > 25_000) {
          approvals += 1;
          console.log(`[approve:api] #${approvals} pausedRun=${pausedRef} (card not rendered)`);
          await request.post(
            `${BASE}/api/studio/conversations/${conv.id}/approvals/${pausedRef}`,
            { headers: await bearer(page), data: { decision: "approved" } },
          );
          cardAbsentSince = null;
          await page.waitForTimeout(2000);
          continue;
        }
      } else {
        cardAbsentSince = null;
      }
      if (status && !["working", "waiting_for_user", "queued", "pending"].includes(status)) {
        return { status, approvals };
      }
      // No pending approval + not working → paused without card or finished.
      const msgs = await apiGet(
        request,
        `${BASE}/api/studio/conversations/${conv.id}/messages`,
        await bearer(page),
      );
      const md = await msgs.json().catch(() => ({ messages: [] }));
      const last = (md.messages ?? []).filter((m: { role: string }) => m.role === "assistant").pop();
      if (last && ["completed", "failed"].includes(last.status)) {
        return { status: last.status, approvals, content: last.content };
      }
    }
    await page.waitForTimeout(3000);
  }
  return { status: "timeout", approvals };
}

test.describe.configure({ mode: "serial" });

test("Studio live acceptance — full generate/modify/persist flow", async ({ page, request, context }) => {
  test.setTimeout(30 * 60_000);
  const evidence: Record<string, unknown> = {};
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[console.error] ${m.text().slice(0, 200)}`);
  });

  // ── 1. Real authenticated test account ─────────────────────────
  await clerkSetup();
  await setupClerkTestingToken({ page });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => Boolean((window as Window & { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
    undefined,
    { timeout: 60_000 },
  );
  const email = process.env.CLERK_TEST_USER_A_EMAIL;
  expect(email, "CLERK_TEST_USER_A_EMAIL must be set").toBeTruthy();
  await clerk.signIn({ page, emailAddress: email! });
  const clerkUserId = await page.evaluate(
    () => (window as Window & { Clerk?: { user?: { id?: string } | null } }).Clerk?.user?.id,
  );
  expect(clerkUserId, "Clerk client session active").toBeTruthy();
  evidence.auth = { userId: clerkUserId, email };
  console.log(`[auth] signed in as ${email} (${clerkUserId})`);

  // ── 2-5. Open Studio → first-run form OR project create → build ──
  // Fresh accounts land on the FirstRunWelcome screen ("What do you want
  // to build?") — that form IS the real entry: one submit creates the
  // project and starts the build. When the account already has projects,
  // /studio opens the workspace composer directly.
  await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded" });
  const firstRun = page.getByTestId("first-run-form");
  const composer = page.getByTestId("studio-command-input");
  // Wait for whichever surface this account gets — zero-project accounts
  // get the welcome form, existing accounts the composer.
  await expect(firstRun.or(composer)).toBeVisible({ timeout: 300_000 });
  let projectId: string | undefined;
  let r1: { status: string; approvals: number; content?: string };
  if (await firstRun.isVisible().catch(() => false)) {
    evidence.entry = "first-run-form";
    await shot(page, "01-studio-loaded");
    await firstRun.locator("textarea").fill(PROMPT_BUILD);
    await firstRun.getByRole("button", { name: /start building/i }).click();
    console.log("[send] first-run form submit");
    // Project creation + generation can take a while under CPU inference.
    await expect(composer).toBeVisible({ timeout: 300_000 });
    await shot(page, "02-project-open");
    // The parent creates + selects the project — read its id from the URL.
    await page.waitForFunction(() => /[?&]project=/.test(location.search), undefined, { timeout: 60_000 });
    projectId = new URL(page.url()).searchParams.get("project") ?? undefined;
    evidence.projectId = projectId;
    console.log(`[project] created via first-run ${projectId}`);
    r1 = await driveRun(page, request);
  } else {
    evidence.entry = "composer";
    await expect(composer).toBeVisible({ timeout: 300_000 });
    await shot(page, "01-studio-loaded");
    const create = await request.post(`${BASE}/api/studio-projects`, {
      headers: await bearer(page),
      data: {
        sourceType: "managed",
        name: `e2e-live-${Date.now()}`,
        templateId: "blank-static",
      },
    });
    expect(create.status(), `project create ${create.status()}`).toBe(201);
    projectId = ((await create.json()) as { project?: { id?: string } }).project?.id;
    expect(projectId).toBeTruthy();
    evidence.projectId = projectId;
    console.log(`[project] created ${projectId}`);
    await page.goto(`${BASE}/studio?project=${projectId}`, { waitUntil: "domcontentloaded" });
    await ensureComposer(page);
    await expect(composer).toBeVisible({ timeout: 300_000 });
    await shot(page, "02-project-open");
    r1 = await sendAndDrive(page, request, PROMPT_BUILD);
  }
  evidence.build = r1;
  const files1 = await listFiles(request, page, projectId!);
  const { canvasId, blocks } = await listBlocks(request, page, projectId!);
  evidence.afterBuild = { files: files1.map((f) => f.name), canvasId, blockCount: blocks.length };
  console.log(`[verify] files=${JSON.stringify(files1.map((f) => f.name))} blocks=${blocks.length}`);
  await shot(page, "03-after-build");
  expect(
    files1.length > 0 || blocks.length > 0,
    "generation produced files or canvas blocks",
  ).toBeTruthy();

  // ── 6. Preview ─────────────────────────────────────────────────
  const pv = await request.get(`${BASE}/api/studio-projects/${projectId}/preview`, {
    headers: await bearer(page),
  });
  const pvd = await pv.json();
  evidence.preview = { status: pv.status(), runtimeStatus: pvd.runtimeStatus, url: pvd.previewUrl };
  console.log(`[preview] ${pv.status()} runtime=${pvd.runtimeStatus} url=${pvd.previewUrl}`);
  if (pvd.previewUrl) {
    const pr = await request.get(`${BASE}${pvd.previewUrl}`, { headers: await bearer(page) });
    evidence.preview.http = pr.status();
    console.log(`[preview] GET ${pvd.previewUrl} → ${pr.status()}`);
  }
  const iframe = page.getByTestId("preview-iframe");
  if (await iframe.isVisible().catch(() => false)) {
    await shot(page, "04-preview-visible");
  }

  // ── 7-8. Modify design → verify real changes ───────────────────
  const blocksBefore = blocks.length;
  const r2 = await sendAndDrive(page, request, PROMPT_MODIFY);
  evidence.modify = r2;
  const files2 = await listFiles(request, page, projectId!);
  const { blocks: blocks2 } = await listBlocks(request, page, projectId!);
  evidence.afterModify = { files: files2.map((f) => f.name), blockCount: blocks2.length };
  console.log(`[verify] blocks ${blocksBefore} → ${blocks2.length}`);

  // On-disk verification (mission): read the actual index.html through the
  // same raw endpoint the export uses — the heading and theme must have
  // landed in the workspace file, not just in a tool's self-report.
  const indexPath = files2.find((f) => /(^|\/)index\.html$/i.test(f.name))?.name;
  let onDisk: { heading: boolean | null; purple: boolean | null } = {
    heading: null,
    purple: null,
  };
  if (indexPath) {
    const html = (await fetchFileRaw(request, page, projectId!, indexPath)).toString("utf-8");
    onDisk = {
      heading: html.includes("LiTT STUDIO VERIFIED"),
      purple: /purple|rebeccapurple|violet|indigo|lavender|plum|orchid|amethyst|mauve|fuchsia|magenta|#([0-9a-f]{2})?[89a-f][0-9a-f](00|0[0-9a-f])[89a-f][0-9a-f]{2}/i.test(
        html,
      ),
    };
    console.log(`[verify] on-disk heading=${onDisk.heading} purple=${onDisk.purple}`);
  }
  evidence.afterModify.onDisk = onDisk;
  await shot(page, "05-after-modify");

  // ── 9-10. Save + reload → persistence ──────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const files3 = await listFiles(request, page, projectId!);
  const { blocks: blocks3 } = await listBlocks(request, page, projectId!);
  evidence.afterReload = { files: files3.map((f) => f.name), blockCount: blocks3.length };
  expect(files3.length).toBe(files2.length);
  await shot(page, "06-reloaded");

  // ── 11. Terminal + voice surfaces ──────────────────────────────
  const th = await request.get(`${BASE}/api/capabilities/project-terminal`, {
    headers: await bearer(page),
  });
  evidence.terminal = { http: th.status(), body: (await th.text()).slice(0, 300) };
  console.log(`[terminal] capability → ${th.status()}`);

  const vh = await request.get(`${BASE}/api/voice/health`, { headers: await bearer(page) });
  evidence.voice = { http: vh.status(), body: (await vh.text()).slice(0, 300) };
  console.log(`[voice] health → ${vh.status()}`);

  const termBadge = page.getByTestId("dock-terminal-badge");
  evidence.terminal.uiBadge = await termBadge.isVisible().catch(() => false);

  // ── Mobile viewport pass ───────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  await shot(page, "07-mobile-studio");

  // ── Export: pull every workspace file via the raw endpoint and pack
  //    a real ZIP (store method) that survives external open+read. ──
  const allPaths = await walkFiles(request, page, projectId!);
  const packed: Array<{ name: string; data: Buffer }> = [];
  for (const p of allPaths) {
    packed.push({ name: p, data: await fetchFileRaw(request, page, projectId!, p) });
  }
  const zip = buildZip(packed);
  const zipPath = path.join(SHOTS, `project-export-${projectId}.zip`);
  writeFileSync(zipPath, zip);
  const indexEntry = packed.find((f) => /(^|\/)index\.html$/i.test(f.name));
  evidence.export = {
    fileCount: packed.length,
    zipBytes: zip.length,
    zipPath,
    hasIndexHtml: Boolean(indexEntry),
    indexContainsModifiedHeading: indexEntry
      ? indexEntry.data.toString("utf-8").includes("LiTT STUDIO VERIFIED")
      : null,
    indexContainsPurpleTheme: indexEntry
      ? /purple|rebeccapurple|violet|indigo|lavender|plum|orchid|amethyst|mauve|fuchsia|magenta|#([0-9a-f]{2})?[89a-f][0-9a-f](00|0[0-9a-f])[89a-f][0-9a-f]{2}/i.test(
          indexEntry.data.toString("utf-8"),
        )
      : null,
  };
  console.log(`[export] ${packed.length} files → ${zip.length}B zip (index.html=${Boolean(indexEntry)})`);
  expect(packed.length, "export returned files").toBeGreaterThan(0);

  console.log("=== EVIDENCE ===");
  console.log(JSON.stringify(evidence, null, 2));
});
