import { test, expect } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";

/** READ-ONLY: dump the pending approval gate state for a conversation. */
const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:3001";
const CONVERSATION_ID = process.env.GATE_CONVERSATION_ID;

test("dump pending approval gate state", async ({ page, request }) => {
  test.setTimeout(3 * 60_000);
  expect(CONVERSATION_ID).toBeTruthy();
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

  const ar = await request.get(
    `${BASE}/api/studio/conversations/${CONVERSATION_ID}/action-run`,
    { headers },
  );
  const ard = await ar.json().catch(() => null);
  console.log(`[action-run] ${JSON.stringify(ard?.projection ?? ard).slice(0, 6000)}`);

  // Also list pending approvals via messages endpoint if present.
  const msgs = await request.get(
    `${BASE}/api/studio/conversations/${CONVERSATION_ID}/messages`,
    { headers },
  );
  const md = await msgs.json().catch(() => null);
  const last = (md?.messages ?? []).slice(-3).map((m: { role: string; status?: string; content?: string }) => ({
    role: m.role, status: m.status, content: (m.content ?? "").slice(0, 200),
  }));
  console.log(`[messages.tail] ${JSON.stringify(last)}`);
});
