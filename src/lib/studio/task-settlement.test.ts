// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => ({
  from: () => {
    let patch: Record<string, unknown> = {};
    const filters: Array<[string, unknown]> = [];
    const query = {
      update(value: Record<string, unknown>) { patch = value; return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      is(key: string, value: unknown) { filters.push([key, value]); return query; },
      then(resolve: (value: unknown) => void) {
        for (const row of db.rows) if (filters.every(([key, value]) => row[key] === value)) Object.assign(row, patch);
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));
import { attachActionRunToConversationTask, settleConversationTask } from "./task-service";
describe("task resume synchronization", () => {
  beforeEach(() => { db.rows = [{ user_id: "owner", conversation_id: "conv", archived_at: null, latest_action_run_id: "old", status: "waiting_approval", verification_state: { verified: true } }]; });
  it("attaches a retry and clears verification from the prior attempt", async () => {
    await attachActionRunToConversationTask("owner", "conv", "new");
    expect(db.rows[0]).toMatchObject({ latest_action_run_id: "new", active_action_run_id: "new", status: "working", verification_state: { verified: false } });
  });
  it("settles the current attempt with explicit verification evidence", async () => {
    await attachActionRunToConversationTask("owner", "conv", "new");
    await settleConversationTask("owner", "conv", "completed", true, "new");
    expect(db.rows[0]).toMatchObject({ active_action_run_id: null, status: "complete", verification_state: { verified: true } });
  });
  it("ignores a late settlement from an older attempt", async () => {
    await attachActionRunToConversationTask("owner", "conv", "new");
    await settleConversationTask("owner", "conv", "failed", false, "old");
    expect(db.rows[0]).toMatchObject({ status: "working", active_action_run_id: "new" });
  });
  it("does not settle another owner's task", async () => {
    await settleConversationTask("stranger", "conv", "completed", true, "old");
    expect(db.rows[0].status).toBe("waiting_approval");
  });
});
