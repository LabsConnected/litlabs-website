/**
 * cancel-repro — API-only run: no Studio page, no UI.
 *
 * Discriminates the ghost /cancel origin: if a run started purely over
 * the messages API (with the Studio page closed) still ends `cancelled`,
 * the canceller is NOT this client's UI — it is server-internal or a
 * different session. Also logs per-call tool activity + latency on the
 * slim local toolset.
 */
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";

const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:3001";

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

test("API-only run — ghost cancel repro + latency probe", async ({ page, request }) => {
  test.setTimeout(15 * 60_000);
  await clerkSetup();
  await setupClerkTestingToken({ page });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const auth = await bearer(page);

  // 1. Project
  const create = await request.post(`${BASE}/api/studio-projects`, {
    headers: auth,
    data: { sourceType: "managed", name: `cancel-repro-${Date.now()}`, templateId: "blank-static" },
  });
  expect(create.status()).toBe(201);
  const projectId = (await create.json()).project.id;
  console.log(`[proj] ${projectId}`);

  // 2. Conversation
  const conv = await request.post(`${BASE}/api/studio/conversations`, {
    headers: auth,
    data: { projectId, title: "cancel-repro" },
  });
  expect(conv.status()).toBe(201);
  const convId = (await conv.json()).conversation.id;
  console.log(`[conv] ${convId}`);

  // 3. Send the build prompt via the messages API — SSE response held open.
  const reqId = `req_noUI_${Date.now()}`;
  const send = request.post(`${BASE}/api/studio/conversations/${convId}/messages`, {
    headers: { ...auth, "Content-Type": "application/json" },
    data: {
      message: "Build a modern responsive website.",
      clientRequestId: reqId,
      projectId,
      executionMode: "act",
    },
    timeout: 0, // SSE — held open for the run's duration
  }).catch((e) => {
    console.log(`[send] stream ended: ${String(e).slice(0, 120)}`);
    return null;
  });
  void send;

  // 4. Close the Studio page entirely — removes the UI as a cancel suspect.
  await page.close().catch(() => {});
  console.log(`[diag] page closed — UI cannot issue cancel() now. Watching ${reqId}`);

  // 5. Poll the action-run until terminal or ~11min.
  const t0 = Date.now();
  const deadline = t0 + 11 * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15_000));
    const ar = await request.get(`${BASE}/api/studio/conversations/${convId}/action-run`, {
      headers: auth,
    });
    const d = await ar.json().catch(() => null);
    const st = d?.projection?.run?.status ?? "";
    const act = d?.projection?.currentActivity ?? "";
    const fail = d?.projection?.failure ?? null;
    if (`${st}|${act}` !== last) {
      last = `${st}|${act}`;
      console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] status=${st} activity=${act}`);
      if (fail) console.log(`[failure] ${JSON.stringify(fail).slice(0, 300)}`);
      const tools = d?.projection?.tools;
      if (tools?.started?.length) {
        console.log(`[tools] started=${JSON.stringify(tools.started.map((t: { toolId?: string }) => t.toolId)).slice(0, 300)}`);
      }
    }
    if (st && !["working", "waiting_for_user", "queued", "pending"].includes(st)) break;
  }
  console.log(`[done] final=${last}`);
});
