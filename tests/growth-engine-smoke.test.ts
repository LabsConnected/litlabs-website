/**
 * Growth Engine Phase 1a — End-to-end smoke test.
 *
 * Runs the full 8-step tool chain against the REAL Supabase database
 * and the REAL OpenRouter LLM, then verifies DB rows and two failure
 * cases. Cleans up all test rows afterward.
 *
 * Usage: pnpm vitest run --config vitest.integration.config.ts
 *
 * Requires (from .env.local, loaded by vitest.integration.config.ts):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - OPENROUTER_API_KEY
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeProjectTool } from "@/lib/project-tools/registry";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createPublication,
  upsertRules,
} from "@/lib/growth/growth-repository";
import { getProvider } from "@/lib/growth/provider-registry";
import { buildUtmUrl, defaultUtmParams } from "@/lib/growth/utm";
import type { ToolResult } from "@/lib/vapi-tools";

// ─── Test isolation ──────────────────────────────────────────────
// Synthetic Clerk user ID so this test never collides with real users.
const TEST_USER_ID = `smoke-growth-${Date.now()}`;

// Relaxed rules so the policy engine doesn't block back-to-back marks.
const RELAXED_RULES = {
  daily_post_limit: 100,
  min_interval_minutes: 0,
  cooldown_minutes: 0,
  require_approval: true,
} as const;

// Track IDs for cleanup and cross-step references.
let campaignId = "";
const contentIds: Record<string, string> = {}; // provider → contentId
let approvedContentId = "";
let publicationId = "";

// ─── Helpers ─────────────────────────────────────────────────────

function unwrap(r: ToolResult) {
  return {
    success: r.success,
    message: r.message,
    data: r.data as Record<string, unknown> | null,
  };
}

function step(name: string, r: ToolResult) {
  const { success, message, data } = unwrap(r);
  const tag = success ? "PASS" : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`\n  [${tag}] ${name}: ${message}`);
  if (data && Object.keys(data).length > 0) {
    // eslint-disable-next-line no-console
    console.log(`         data: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { success, message, data };
}

// ─── Cleanup ─────────────────────────────────────────────────────

async function cleanupTestUser() {
  if (!supabaseAdmin) return;
  // Delete in dependency order (publications → content → campaigns → accounts → rules → logs).
  // campaigns/content have ON DELETE CASCADE for content, SET NULL for publications.
  await supabaseAdmin.from("growth_publications").delete().eq("user_id", TEST_USER_ID);
  await supabaseAdmin.from("growth_content").delete().eq("user_id", TEST_USER_ID);
  await supabaseAdmin.from("growth_campaigns").delete().eq("user_id", TEST_USER_ID);
  await supabaseAdmin.from("growth_accounts").delete().eq("user_id", TEST_USER_ID);
  await supabaseAdmin.from("growth_rules").delete().eq("user_id", TEST_USER_ID);
  // agent_logs stores metadata.userId — query then delete by id since
  // the Supabase JS client's JSON filter can be unreliable.
  const { data: logRows } = await supabaseAdmin
    .from("agent_logs")
    .select("id")
    .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if (logRows && logRows.length > 0) {
    // Filter in JS to find our test entries, then delete by id.
    const { data: ourLogs } = await supabaseAdmin
      .from("agent_logs")
      .select("id, metadata")
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
    const ourIds = (ourLogs ?? [])
      .filter((l: { metadata?: { userId?: string } }) => l.metadata?.userId === TEST_USER_ID)
      .map((l: { id: string }) => l.id);
    if (ourIds.length > 0) {
      await supabaseAdmin.from("agent_logs").delete().in("id", ourIds);
    }
  }
}

// ─── Test suite ──────────────────────────────────────────────────

describe("Growth Engine Phase 1a — end-to-end smoke test", () => {
  beforeAll(async () => {
    // Pre-clean any leftover rows from a prior aborted run.
    await cleanupTestUser();

    // Insert relaxed rules for all 4 providers so the policy engine
    // doesn't reject back-to-back mark_published calls.
    for (const p of ["x", "reddit", "hackernews", "producthunt"] as const) {
      await upsertRules(TEST_USER_ID, p, RELAXED_RULES);
    }
  });

  afterAll(async () => {
    await cleanupTestUser();
  });

  // ── Step 1: create_campaign ────────────────────────────────────
  it("1. growth_create_campaign creates a campaign row", async () => {
    const r = step(
      "growth_create_campaign",
      await executeProjectTool("growth_create_campaign", TEST_USER_ID, {
        name: "Smoke Test Launch",
        objective: "launch",
        event_summary:
          "LiTT Growth Engine Phase 1a is live: one campaign becomes platform-native content for X, Reddit, HN, and Product Hunt. Manual publishing with UTM tracking. No paid APIs.",
        target_providers: ["x", "reddit", "hackernews", "producthunt"],
      }),
    );
    expect(r.success, r.message).toBe(true);
    expect(r.data?.campaignId).toBeTruthy();
    campaignId = String(r.data?.campaignId);
  });

  // ── Step 2: generate_content for all 4 providers ───────────────
  it("2. growth_generate_content for X", async () => {
    const r = step(
      "growth_generate_content (x)",
      await executeProjectTool("growth_generate_content", TEST_USER_ID, {
        campaign_id: campaignId,
        provider: "x",
      }),
    );
    expect(r.success, r.message).toBe(true);
    expect(r.data?.contentId).toBeTruthy();
    contentIds.x = String(r.data?.contentId);
    expect(typeof r.data?.preview).toBe("string");
    expect(Number(r.data?.length)).toBeGreaterThan(0);
  });

  it("2. growth_generate_content for Reddit", async () => {
    const r = step(
      "growth_generate_content (reddit)",
      await executeProjectTool("growth_generate_content", TEST_USER_ID, {
        campaign_id: campaignId,
        provider: "reddit",
      }),
    );
    expect(r.success, r.message).toBe(true);
    expect(r.data?.contentId).toBeTruthy();
    contentIds.reddit = String(r.data?.contentId);
  });

  it("2. growth_generate_content for Hacker News", async () => {
    const r = step(
      "growth_generate_content (hackernews)",
      await executeProjectTool("growth_generate_content", TEST_USER_ID, {
        campaign_id: campaignId,
        provider: "hackernews",
      }),
    );
    expect(r.success, r.message).toBe(true);
    expect(r.data?.contentId).toBeTruthy();
    contentIds.hackernews = String(r.data?.contentId);
  });

  it("2. growth_generate_content for Product Hunt", async () => {
    const r = step(
      "growth_generate_content (producthunt)",
      await executeProjectTool("growth_generate_content", TEST_USER_ID, {
        campaign_id: campaignId,
        provider: "producthunt",
      }),
    );
    expect(r.success, r.message).toBe(true);
    expect(r.data?.contentId).toBeTruthy();
    contentIds.producthunt = String(r.data?.contentId);
  });

  // ── Step 3: list_drafts ────────────────────────────────────────
  it("3. growth_list_drafts returns 4 drafts for the campaign", async () => {
    const r = step(
      "growth_list_drafts",
      await executeProjectTool("growth_list_drafts", TEST_USER_ID, {
        campaign_id: campaignId,
      }),
    );
    expect(r.success, r.message).toBe(true);
    expect(Number(r.data?.count)).toBe(4);
    const drafts = r.data?.drafts as Array<{ provider: string; contentId: string }>;
    expect(drafts).toHaveLength(4);
    const providers = drafts.map((d) => d.provider).sort();
    expect(providers).toEqual(["hackernews", "producthunt", "reddit", "x"]);
  });

  // ── Step 4: rewrite_post on the X draft ────────────────────────
  it("4. growth_rewrite_post creates a new version of the X draft", async () => {
    const r = step(
      "growth_rewrite_post (x)",
      await executeProjectTool("growth_rewrite_post", TEST_USER_ID, {
        content_id: contentIds.x,
        instructions: "Make it shorter and punchier. Lead with the hook.",
      }),
    );
    expect(r.success, r.message).toBe(true);
    expect(r.data?.contentId).toBeTruthy();
    // The rewrite creates a NEW content row (new version).
    contentIds.x = String(r.data?.contentId);
    expect(Number(r.data?.version)).toBeGreaterThan(1);
  });

  // ── Step 5: approve_post on the rewritten X draft ──────────────
  it("5. growth_approve_post approves the X draft", async () => {
    const r = step(
      "growth_approve_post (x)",
      await executeProjectTool("growth_approve_post", TEST_USER_ID, {
        content_id: contentIds.x,
      }),
    );
    expect(r.success, r.message).toBe(true);
    expect(r.data?.status).toBe("approved");
    approvedContentId = String(r.data?.contentId);
    expect(String(r.data?.provider)).toBe("x");
  });

  // ── Step 6: verify manual compose URL + clipboard payload ──────
  it("6. provider.prepare() returns correct compose URL + clipboard for X", async () => {
    const provider = getProvider("x");
    expect(provider).toBeTruthy();
    const utm = defaultUtmParams("Smoke Test Launch", "x");
    const prepared = await provider!.prepare({
      content: "Test post content for the smoke test.",
      contentType: "text",
      campaignName: "Smoke Test Launch",
      utmUrl: buildUtmUrl("https://litlabs.net", utm),
    });
    step("provider.prepare (x)", {
      success: true,
      message: `composeUrl=${prepared.composeUrl}`,
      projectId: null,
      data: {
        provider: prepared.provider,
        platformLabel: prepared.platformLabel,
        composeUrl: prepared.composeUrl,
        clipboardPayload: prepared.clipboardPayload.slice(0, 80),
      },
    } as ToolResult);
    expect(prepared.provider).toBe("x");
    expect(prepared.composeUrl).toContain("https://twitter.com/compose/post?text=");
    expect(prepared.clipboardPayload).toBeTruthy();
    expect(prepared.platformLabel).toBe("X (Twitter)");
  });

  it("6b. all 4 providers return valid compose URLs", async () => {
    for (const p of ["x", "reddit", "hackernews", "producthunt"] as const) {
      const provider = getProvider(p);
      expect(provider, `provider ${p} missing`).toBeTruthy();
      const prepared = await provider!.prepare({
        content: "Smoke test content.",
        contentType: "text",
        campaignName: "Smoke Test Launch",
        utmUrl: "https://litlabs.net?utm_campaign=smoke&utm_source=x&utm_medium=social",
      });
      expect(prepared.composeUrl, `${p} composeUrl`).toMatch(/^https:\/\//);
      expect(prepared.clipboardPayload, `${p} clipboardPayload`).toBeTruthy();
      expect(prepared.platformLabel, `${p} platformLabel`).toBeTruthy();
    }
  });

  // ── Step 7: mark_published ─────────────────────────────────────
  it("7. growth_mark_published records the publication", async () => {
    const r = step(
      "growth_mark_published (x)",
      await executeProjectTool("growth_mark_published", TEST_USER_ID, {
        content_id: approvedContentId,
        external_url: "https://twitter.com/litlabs/status/1234567890",
        external_id: "1234567890",
      }),
    );
    expect(r.success, r.message).toBe(true);
    expect(r.data?.status).toBe("published");
    expect(r.data?.externalUrl).toBe("https://twitter.com/litlabs/status/1234567890");
    expect(r.data?.publishedAt).toBeTruthy();
    expect(r.data?.utm).toBeTruthy();
    publicationId = String(r.data?.publicationId);
  });

  // ── Step 8: confirm DB rows + agent_logs ───────────────────────
  it("8a. growth_campaigns row exists with correct fields", async () => {
    expect(supabaseAdmin).toBeTruthy();
    const { data, error } = await supabaseAdmin!
      .from("growth_campaigns")
      .select("*")
      .eq("id", campaignId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.user_id).toBe(TEST_USER_ID);
    expect(data!.name).toBe("Smoke Test Launch");
    expect(data!.objective).toBe("launch");
    expect(data!.target_providers).toEqual(["x", "reddit", "hackernews", "producthunt"]);
  });

  it("8b. growth_content has 5 rows (4 generated + 1 rewrite)", async () => {
    const { data, error } = await supabaseAdmin!
      .from("growth_content")
      .select("*")
      .eq("campaign_id", campaignId);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBe(5); // 4 original + 1 rewrite version
    const approved = data!.filter((c: { status: string }) => c.status === "approved");
    expect(approved).toHaveLength(1);
    expect(approved[0].provider).toBe("x");
  });

  it("8c. growth_publications has 1 published row", async () => {
    const { data, error } = await supabaseAdmin!
      .from("growth_publications")
      .select("*")
      .eq("user_id", TEST_USER_ID);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBe(1);
    const pub = data![0];
    expect(pub.status).toBe("published");
    expect(pub.provider).toBe("x");
    expect(pub.external_url).toBe("https://twitter.com/litlabs/status/1234567890");
    expect(pub.external_id).toBe("1234567890");
    expect(pub.published_at).toBeTruthy();
    expect(pub.utm_campaign).toBeTruthy();
    expect(pub.utm_source).toBe("x");
    expect(pub.utm_medium).toBe("social");
    expect(pub.mode).toBe("manual");
    expect(pub.idempotency_key).toBeTruthy();
  });

  it("8d. agent_logs has growth_* audit entries", async () => {
    // Query recent agent_logs and filter in JS — the Supabase JS client's
    // JSON filter syntax (metadata->>userId) can be unreliable across versions.
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin!
      .from("agent_logs")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: true });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    // Filter to only entries from this test run.
    const ours = data!.filter(
      (l: { metadata?: { userId?: string } }) => l.metadata?.userId === TEST_USER_ID,
    );
    expect(ours.length).toBeGreaterThanOrEqual(6); // create + 4 generate + rewrite + approve + mark
    const types = ours.map((l: { metadata: { _type?: string } }) => l.metadata?._type);
    expect(types).toContain("growth_create_campaign");
    expect(types).toContain("growth_generate_content");
    expect(types).toContain("growth_rewrite_post");
    expect(types).toContain("growth_approve_post");
    expect(types).toContain("growth_mark_published");
  });

  // ── Failure case 1: mark_published on unapproved draft ─────────
  it("9. growth_mark_published on an UNAPPROVED draft fails truthfully", async () => {
    // Use the Reddit draft (still in 'draft' status).
    const r = step(
      "growth_mark_published (reddit — unapproved)",
      await executeProjectTool("growth_mark_published", TEST_USER_ID, {
        content_id: contentIds.reddit,
        external_url: "https://reddit.com/r/test/comments/abc",
      }),
    );
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/approve/i);
  });

  // ── Failure case 2: duplicate idempotency key ──────────────────
  it("10. createPublication with a DUPLICATE idempotency key does not create a duplicate", async () => {
    const key = `dup-test-${Date.now()}`;
    // First insert — creates the row.
    const first = await createPublication(TEST_USER_ID, {
      campaign_id: campaignId,
      content_id: approvedContentId,
      provider: "x",
      idempotency_key: key,
      mode: "manual",
    });
    expect(first.row).toBeTruthy();
    expect(first.created).toBe(true);
    const firstId = first.row!.id;

    // Second insert with the SAME key — must return the existing row, not a new one.
    const second = await createPublication(TEST_USER_ID, {
      campaign_id: campaignId,
      content_id: approvedContentId,
      provider: "x",
      idempotency_key: key,
      mode: "manual",
    });
    expect(second.row).toBeTruthy();
    expect(second.created).toBe(false);
    expect(second.row!.id).toBe(firstId);

    // Verify only 1 row in DB with this key.
    const { data, error } = await supabaseAdmin!
      .from("growth_publications")
      .select("id")
      .eq("idempotency_key", key);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});
