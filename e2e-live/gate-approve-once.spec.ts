import { test, expect } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";

/** ONE-SHOT: approve a specific pausedRun gate, then poll run to terminal. */
const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:3001";
const CONVERSATION_ID = process.env.GATE_CONVERSATION_ID;
const PAUSED_RUN_ID = process.env.GATE_PAUSED_RUN_ID;

test("approve one gate and observe outcome", async ({ page, request }) => {
  test.setTimeout(15 * 60_000);
  expect(CONVERSATION_ID && PAUSED_RUN_ID).toBeTruthy();
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

  const resp = await request.post(
    `${BASE}/api/studio/conversations/${CONVERSATION_ID}/approvals/${PAUSED_RUN_ID}`,
    { headers, data: { decision: "approved" } },
  );
  console.log(`[approve] ${resp.status()} ${await resp.text().then((t) => t.slice(0, 400))}`);

  // Poll action-run to terminal (deploy can take a few minutes).
  const deadline = Date.now() + 12 * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const ar = await request.get(
      `${BASE}/api/studio/conversations/${CONVERSATION_ID}/action-run`,
      { headers },
    );
    const ard = await ar.json().catch(() => null);
    const run = ard?.projection?.run ?? {};
    const status = run.status ?? "";
    const act = ard?.projection?.currentActivity ?? "";
    if (status !== last) {
      last = status;
      console.log(`[run] ${status} — ${act}`);
    }
    if (status && !["working", "waiting_for_user", "queued", "pending"].includes(status)) {
      console.log(`[terminal] ${JSON.stringify({ status, failure: ard?.projection?.failure, approvalReference: run.approvalReference })}`);
      break;
    }
    // A NEW gate would need separate approval — report and stop.
    if (status === "waiting_for_user" && run.approvalReference && run.approvalReference !== PAUSED_RUN_ID) {
      console.log(`[new-gate] ${run.approvalReference} activity=${act} — NOT approving`);
      break;
    }
    await page.waitForTimeout(5000);
  }
});
