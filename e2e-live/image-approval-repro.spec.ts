import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

/**
 * BOUNDED image.generate approval repro — ONE run, ONE manual approval.
 *
 * Differs from studio-live.spec.ts deliberately:
 *  - approves ONLY the first legitimate gate it sees;
 *  - records every distinct pausedRunId (gate) with timestamps;
 *  - STOPS and dumps the timeline if the SAME gate re-appears after
 *    approval (loop) or a SECOND gate appears (possible chained gate);
 *  - verifies image asset persistence + preview after the run.
 *
 * Evidence → e2e-live/image-repro-evidence.json + shots/image-repro-*.png
 */

const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:3001";
const SHOTS = path.join(__dirname, "shots");
mkdirSync(SHOTS, { recursive: true });

const PROMPT =
  "Build a modern coffee-shop website with a large hero section. " +
  "You MUST call the image.generate tool to create one NEW hero image " +
  "(a coffee cup on a wooden table, no stock photos), then make sure it " +
  "is saved into the project.";

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

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

async function apiGet(request: APIRequestContext, url: string, headers: Record<string, string>) {
  const r = await request.get(url, { headers });
  return r.json().catch(() => null);
}

test("image.generate approval — one gate, one image, saved asset", async ({ page, request }) => {
  test.setTimeout(15 * 60_000);
  const evidence: Record<string, unknown> = { gates: [] as unknown[], startedAt: new Date().toISOString() };
  const gates: { pausedRunId: string; firstSeen: string; approvedAt?: string; lastStatus?: string; tool?: string }[] = [];
  let approvedCount = 0;
  let stoppedReason: string | null = null;

  // ── Auth ──────────────────────────────────────────────────────
  await clerkSetup();
  await setupClerkTestingToken({ page });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => Boolean((window as Window & { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
    undefined,
    { timeout: 60_000 },
  );
  const email = process.env.CLERK_TEST_USER_A_EMAIL;
  expect(email).toBeTruthy();
  await clerk.signIn({ page, emailAddress: email! });
  evidence.userId = await page.evaluate(
    () => (window as Window & { Clerk?: { user?: { id?: string } | null } }).Clerk?.user?.id,
  );

  // ── Project ───────────────────────────────────────────────────
  const create = await request.post(`${BASE}/api/studio-projects`, {
    headers: await bearer(page),
    data: { sourceType: "managed", name: `img-repro-${Date.now()}`, templateId: "blank-static" },
  });
  expect(create.status(), `project create ${create.status()}`).toBe(201);
  const projectId = ((await create.json()) as { project?: { id?: string } }).project?.id;
  expect(projectId).toBeTruthy();
  evidence.projectId = projectId;

  await page.goto(`${BASE}/studio?project=${projectId}`, { waitUntil: "domcontentloaded" });
  const composer = page.getByTestId("studio-command-input");
  await expect(composer).toBeVisible({ timeout: 120_000 });
  await shot(page, "image-repro-01-loaded");

  // ── Send the image-forcing prompt ─────────────────────────────
  await composer.fill(PROMPT);
  const sendBtn = page.getByTestId("studio-send-button");
  try {
    await sendBtn.click({ timeout: 10_000 });
  } catch {
    await composer.press("Enter").catch(() => {});
  }
  console.log("[send] image-forcing prompt submitted");

  // ── Drive: approve ONLY the first gate; stop on repeats/seconds ──
  const deadline = Date.now() + 12 * 60_000;
  let lastStatus = "";
  let projectionDumped = false;

  while (Date.now() < deadline && !stoppedReason) {
    const convs = await apiGet(request, `${BASE}/api/studio/conversations`, await bearer(page));
    const conv = (convs?.conversations ?? [])[0];
    if (!conv) {
      await page.waitForTimeout(3000);
      continue;
    }
    const ar = await apiGet(
      request,
      `${BASE}/api/studio/conversations/${conv.id}/action-run`,
      await bearer(page),
    );
    const run = ar?.projection?.run ?? {};
    const status: string = run.status ?? "";
    const pausedRef: string | undefined = run.approvalReference;
    const activity: string = ar?.projection?.currentActivity ?? "";
    if (status !== lastStatus) {
      lastStatus = status;
      console.log(`[run] status=${status} activity=${activity}`);
    }

    if (status === "waiting_for_user" && pausedRef) {
      let gate = gates.find((g) => g.pausedRunId === pausedRef);
      if (!gate) {
        gate = { pausedRunId: pausedRef, firstSeen: new Date().toISOString() };
        gates.push(gate);
        console.log(`[gate:new] ${pausedRef} (total gates=${gates.length}, approved=${approvedCount})`);
        if (!projectionDumped) {
          projectionDumped = true;
          evidence.projectionSample = JSON.stringify(ar?.projection ?? {}).slice(0, 4000);
        }
      }
      gate.lastStatus = status;

      if (gate.approvedAt) {
        // SAME gate re-appeared after approval → loop.
        stoppedReason = `REPEAT_APPROVAL: gate ${pausedRef} re-surfaced after approval at ${gate.approvedAt}`;
        console.log(`[STOP] ${stoppedReason}`);
        break;
      }
      if (approvedCount > 0) {
        // A SECOND distinct gate — do not auto-approve; keep watching briefly.
        console.log(`[gate:second] ${pausedRef} — not approving (investigating)`);
        stoppedReason = `SECOND_GATE: ${pausedRef} appeared after approving ${approvedCount} gate(s)`;
        console.log(`[STOP] ${stoppedReason}`);
        break;
      }
      // FIRST legitimate gate → approve exactly once.
      approvedCount += 1;
      gate.approvedAt = new Date().toISOString();
      console.log(`[approve:once] ${pausedRef}`);
      const resp = await request.post(
        `${BASE}/api/studio/conversations/${conv.id}/approvals/${pausedRef}`,
        { headers: await bearer(page), data: { decision: "approved" } },
      );
      console.log(`[approve:resp] ${resp.status()}`);
      await page.waitForTimeout(2500);
      continue;
    }

    if (status && !["working", "waiting_for_user", "queued", "pending"].includes(status)) {
      evidence.finalStatus = status;
      evidence.failure = ar?.projection?.failure ?? null;
      evidence.tools = ar?.projection?.tools ?? null;
      break;
    }
    await page.waitForTimeout(3000);
  }

  if (!stoppedReason && Date.now() >= deadline) stoppedReason = "TIMEOUT";
  evidence.stoppedReason = stoppedReason;
  evidence.gates = gates;
  evidence.approvedCount = approvedCount;
  evidence.finishedAt = new Date().toISOString();

  // ── Verify assets + preview regardless of stop reason ─────────
  const filesResp = await apiGet(
    request,
    `${BASE}/api/studio-projects/${projectId}/files?path=.`,
    await bearer(page),
  );
  const files = (filesResp?.files ?? filesResp ?? []) as { name?: string; path?: string }[];
  evidence.files = files.map((f) => f.name ?? f.path);
  const imageAssets = evidence.files.filter((f) => /\.(png|jpe?g|webp|gif|avif)$/i.test(String(f)) || /images?\//i.test(String(f)));
  evidence.imageAssets = imageAssets;

  const pv = await request.get(`${BASE}/api/studio-projects/${projectId}/preview`, {
    headers: await bearer(page),
  });
  const pvd = await pv.json().catch(() => ({}));
  evidence.preview = { status: pv.status(), runtimeStatus: pvd.runtimeStatus, url: pvd.previewUrl };
  if (pvd.previewUrl) {
    const pr = await request.get(`${BASE}${pvd.previewUrl}`, { headers: await bearer(page) });
    evidence.preview.http = pr.status();
    if (pr.status() === 200) {
      const html = await pr.text();
      evidence.preview.hasImgTag = /<img[^>]+src=/i.test(html);
    }
  }

  await shot(page, "image-repro-02-final");
  writeFileSync(path.join(__dirname, "image-repro-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`[evidence] ${JSON.stringify({ stoppedReason, gates: gates.length, approvedCount, finalStatus: evidence.finalStatus, imageAssets })}`);

  // Hard assertions for the success path only.
  if (!stoppedReason) {
    expect(approvedCount, "exactly one approval should have been needed").toBe(1);
    expect(imageAssets.length, "an image asset must be persisted in the project").toBeGreaterThan(0);
  } else {
    // Loop/second-gate/timeout = the failure mode under investigation.
    expect(stoppedReason, "approval loop or stall reproduced").toBe("SHOULD_NOT_HAPPEN");
  }
});
