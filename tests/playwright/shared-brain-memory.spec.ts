/**
 * Shared-brain memory acceptance test — PREPARED, NOT YET EXECUTED.
 *
 * Exercises the real sequence requested for final staging verification:
 *   n8n (signed webhook) -> POST /api/n8n/memory -> Supabase `memories`
 *   -> GET /api/memory as the owning user (stands in for "Windows LiTT
 *      retrieval" and "Android Dex retrieval" — both now call this
 *      exact route; see packages/litt-cli/src/lib/memory/memory-client.ts
 *      and packages/litt-companion/app/memory.tsx)
 *   -> a FRESH, uncached API request context (stands in for "process
 *      restart" — a real OS process restart isn't meaningful for a
 *      stateless HTTP client; a fresh context with zero client-side
 *      state is the correct proxy: any successful read necessarily
 *      came from Supabase, not an in-memory artifact of the first call)
 *   -> repeat the identical webhook -> no duplicate record
 *   -> User B (a different synthetic Clerk identity) never sees it
 *
 * Requirements to actually run this (none are present in the sandbox
 * this was written in — see the shared-brain delivery report for the
 * exact list):
 *   - A running website instance (pnpm dev / pnpm start) with a real
 *     Supabase project configured (NEXT_PUBLIC_SUPABASE_URL,
 *     SUPABASE_SERVICE_ROLE_KEY) and a real Clerk project configured
 *     (CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).
 *   - LITT_N8N_BRIDGE_SECRET set identically in the website process.
 *   - CLERK_TEST_USER_A_EMAIL / CLERK_TEST_USER_B_EMAIL set, and
 *     `pnpm exec playwright test --project=auth-setup` already run
 *     (produces tests/playwright/.clerk/user-a.json and user-b.json —
 *     this spec reuses those exact fixtures, not a new auth mechanism).
 *
 * Run:
 *   PLAYWRIGHT_INTEGRATION=true pnpm exec playwright test shared-brain-memory --project=self-contained-auth
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { createHmac } from "crypto";
import path from "path";
import { existsSync, readFileSync } from "fs";

const authDir = path.join(__dirname, ".clerk");
const userAFile = path.join(authDir, "user-a.json");
const userBFile = path.join(authDir, "user-b.json");
const authFilesExist = existsSync(userAFile) && existsSync(userBFile);

const BRIDGE_SECRET = process.env.LITT_N8N_BRIDGE_SECRET;

function requireFixtures() {
  test.skip(!authFilesExist, "Auth files missing — run `pnpm exec playwright test --project=auth-setup` first");
  test.skip(!BRIDGE_SECRET, "LITT_N8N_BRIDGE_SECRET not set in this process — cannot sign webhook requests");
}

/** Decode the Clerk session JWT's `sub` claim straight out of Playwright's saved storage state — no network call, no guessed app endpoint. */
function clerkUserIdFromStorageState(storageStatePath: string): string {
  const state = JSON.parse(readFileSync(storageStatePath, "utf-8"));
  const cookies: Array<{ name: string; value: string }> =
    state.cookies ?? state.origins?.flatMap((o: { localStorage?: unknown[] }) => []) ?? [];
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error(`No __session cookie found in ${storageStatePath}`);
  }
  const [, payloadB64] = sessionCookie.value.split(".");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  if (typeof payload.sub !== "string") {
    throw new Error("Decoded Clerk JWT has no `sub` claim");
  }
  return payload.sub;
}

function signN8nPayload(payload: Record<string, unknown>): { body: string; signature: string; timestamp: number } {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", BRIDGE_SECRET!).update(body).digest("hex");
  return { body, signature, timestamp };
}

async function postN8nMemory(request: APIRequestContext, payload: Record<string, unknown>) {
  const { body, signature, timestamp } = signN8nPayload(payload);
  return request.post("/api/n8n/memory", {
    data: body,
    headers: {
      "Content-Type": "application/json",
      "x-litt-signature": signature,
      "x-litt-timestamp": String(timestamp),
    },
  });
}

test.describe("Shared-brain memory — write, retrieval, restart, dedup (User A)", () => {
  requireFixtures();
  test.use({ storageState: userAFile });

  const idempotencyKey = `playwright-acceptance-${Date.now()}`;
  const content = `synthetic shared-brain acceptance memory ${idempotencyKey}`;
  let userAId: string;
  let firstMemoryId: string;

  test.beforeAll(() => {
    if (!authFilesExist) return;
    userAId = clerkUserIdFromStorageState(userAFile);
  });

  test("n8n writes a memory for User A", async ({ request }) => {
    const res = await postN8nMemory(request, { userId: userAId, idempotencyKey, content });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.memory.owner_id).toBe(userAId);
    firstMemoryId = json.memory.id;
  });

  test("Windows LiTT / Android Dex retrieval: User A reads it back via the shared /api/memory route", async ({ request }) => {
    const res = await request.get("/api/memory");
    expect(res.status()).toBe(200);
    const json = await res.json();
    const found = json.memories.find((m: { content: string }) => m.content === content);
    expect(found, "the n8n-written memory should be visible to its owner").toBeTruthy();
    expect(found.id).toBe(firstMemoryId);
  });

  test("survives a fresh, uncached request context (process-restart proxy)", async ({ playwright }) => {
    const fresh = await playwright.request.newContext({ storageState: userAFile });
    try {
      const res = await fresh.get("/api/memory");
      expect(res.status()).toBe(200);
      const json = await res.json();
      const found = json.memories.find((m: { content: string }) => m.content === content);
      expect(found, "memory must survive in a brand-new client context with no shared cache").toBeTruthy();
    } finally {
      await fresh.dispose();
    }
  });

  test("repeating the identical webhook does not create a duplicate record", async ({ request }) => {
    const res = await postN8nMemory(request, { userId: userAId, idempotencyKey, content });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.memory.id, "retried delivery must upsert the SAME row, not insert a new one").toBe(firstMemoryId);

    const list = await (await request.get("/api/memory")).json();
    const matches = list.memories.filter((m: { content: string }) => m.content === content);
    expect(matches, "exactly one row for this idempotencyKey, never two").toHaveLength(1);
  });
});

test.describe("Shared-brain memory — cross-user isolation (User B)", () => {
  requireFixtures();
  test.use({ storageState: userBFile });

  test("User B never sees User A's n8n-sourced memory", async ({ request }) => {
    const userAId = clerkUserIdFromStorageState(userAFile);
    const userBId = clerkUserIdFromStorageState(userBFile);
    expect(userAId).not.toBe(userBId);

    const res = await request.get("/api/memory");
    expect(res.status()).toBe(200);
    const json = await res.json();
    const leaked = json.memories.find((m: { content: string }) => m.content.startsWith("synthetic shared-brain acceptance memory"));
    expect(leaked, "User A's n8n-sourced memories must never appear in User B's list").toBeFalsy();
  });
});

test.describe("Shared-brain memory — n8n auth boundary (no Clerk session needed)", () => {
  test.skip(!BRIDGE_SECRET, "LITT_N8N_BRIDGE_SECRET not set");

  test("wrong signature is rejected and nothing is persisted", async ({ request }) => {
    const body = JSON.stringify({ userId: "user_synthetic", idempotencyKey: "bad-sig", content: "x" });
    const res = await request.post("/api/n8n/memory", {
      data: body,
      headers: {
        "Content-Type": "application/json",
        "x-litt-signature": "0".repeat(64),
        "x-litt-timestamp": String(Math.floor(Date.now() / 1000)),
      },
    });
    expect(res.status()).toBe(401);
  });

  test("stale timestamp is rejected (replay protection)", async ({ request }) => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 600;
    const payload = { userId: "user_synthetic", idempotencyKey: "stale-ts", content: "x" };
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", BRIDGE_SECRET!).update(body).digest("hex");
    const res = await request.post("/api/n8n/memory", {
      data: body,
      headers: {
        "Content-Type": "application/json",
        "x-litt-signature": signature,
        "x-litt-timestamp": String(staleTimestamp),
      },
    });
    expect(res.status()).toBe(401);
  });
});
