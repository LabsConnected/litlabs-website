// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Serialization contract for clientRequestId — the post-disconnect
 * reconciliation path depends on it end-to-end:
 *
 *   POST messages → insertMessage (client_request_id column)
 *   → GET /messages → listMessages → mapMessage (clientRequestId field)
 *   → reconcileRunState matches on it.
 *
 * If either leg silently drops the field, recovery can never correlate
 * the run and would have to guess — so this test pins the contract.
 */

// In-memory query-builder stub — enough of the PostgREST chain for
// insertMessage's dedupe check + insert, and listMessages' select.
const storedRows: Record<string, unknown>[] = [];

function makeDb() {
  return {
    from: () => {
      const api: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      let mode: "select" | "insert" | "update" | null = null;
      let inserted: Record<string, unknown> | null = null;
      const chain = {
        select() { mode = mode ?? "select"; return chain; },
        insert(payload: Record<string, unknown>) {
          mode = "insert";
          inserted = {
            id: `msg-${storedRows.length + 1}`,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            ...payload,
          };
          return chain;
        },
        update() { mode = "update"; return chain; },
        eq(col: string, val: unknown) { filters.push([col, val]); return chain; },
        order() { return chain; },
        limit() {
          if (mode === "insert") {
            return Promise.resolve({ data: inserted ? [inserted] : [], error: null });
          }
          const rows = storedRows.filter((r) => filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: rows, error: null });
        },
        single() {
          if (inserted) {
            storedRows.push(inserted);
            return Promise.resolve({ data: inserted, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: makeDb(),
}));

vi.mock("@/lib/studio/project-resolver", () => ({
  resolveProject: vi.fn(),
}));

import { insertMessage, listMessages } from "./conversation-service";

describe("clientRequestId serialization (reconciliation contract)", () => {
  beforeEach(() => {
    storedRows.length = 0;
  });

  it("persists client_request_id on insert and returns it as clientRequestId on list", async () => {
    const { message } = await insertMessage({
      conversationId: "conv-1",
      ownerId: "user-1",
      projectId: "proj-1",
      role: "user",
      content: "build me a landing page",
      status: "completed",
      clientRequestId: "req-abc-123",
    });

    expect(message?.clientRequestId).toBe("req-abc-123");

    const listed = await listMessages("conv-1", "user-1");
    expect(listed).toHaveLength(1);
    // This is the field reconcileRunState matches on — must survive.
    expect(listed[0].clientRequestId).toBe("req-abc-123");
    expect(listed[0].content).toBe("build me a landing page");
  });

  it("correlates a duplicate send by client_request_id instead of inserting twice", async () => {
    const first = await insertMessage({
      conversationId: "conv-1",
      ownerId: "user-1",
      projectId: "proj-1",
      role: "user",
      content: "same request",
      status: "completed",
      clientRequestId: "req-dup-1",
    });
    expect(first.duplicate).toBe(false);

    const second = await insertMessage({
      conversationId: "conv-1",
      ownerId: "user-1",
      projectId: "proj-1",
      role: "user",
      content: "same request",
      status: "completed",
      clientRequestId: "req-dup-1",
    });
    expect(second.duplicate).toBe(true);
    expect(second.message?.id).toBe(first.message?.id);

    const listed = await listMessages("conv-1", "user-1");
    expect(listed).toHaveLength(1);
  });

  it("does not correlate a different user's identical clientRequestId", async () => {
    await insertMessage({
      conversationId: "conv-1",
      ownerId: "user-1",
      projectId: "proj-1",
      role: "user",
      content: "user A request",
      status: "completed",
      clientRequestId: "req-shared",
    });
    // Same clientRequestId but a different owner must NOT dedupe — the
    // dedupe check is owner-scoped.
    const other = await insertMessage({
      conversationId: "conv-1",
      ownerId: "user-2",
      projectId: "proj-1",
      role: "user",
      content: "user B request",
      status: "completed",
      clientRequestId: "req-shared",
    });
    expect(other.duplicate).toBe(false);
    expect((await listMessages("conv-1", "user-1"))).toHaveLength(1);
    expect((await listMessages("conv-1", "user-2"))).toHaveLength(1);
  });
});
