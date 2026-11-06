import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockUpsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { rpc: mockRpc, from: mockFrom },
}));

const {
  writeRunCheckpoint,
  claimRunCheckpoint,
  renewRunCheckpointLease,
  listStaleRunCheckpoints,
  getRunCheckpoint,
  settleRunCheckpoint,
} = await import("./run-checkpoint-store");

const baseState = {
  actionRunId: "ar-1",
  userId: "u-1",
  conversationId: "c-1",
  messages: [{ role: "user" as const, content: "hi" }],
  stepsUsed: 3,
  hadInterveningMutation: true,
};

describe("run-checkpoint-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => ({
      upsert: mockUpsert,
      update: mockUpdate,
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }));
    mockUpsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "cp-1" }, error: null }),
      }),
    });
    mockUpdate.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  });

  it("writeRunCheckpoint upserts on action_run_id and returns the checkpoint id", async () => {
    const id = await writeRunCheckpoint(baseState);
    expect(id).toBe("cp-1");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ action_run_id: "ar-1", steps_used: 3, phase: "loop" }),
      { onConflict: "action_run_id" },
    );
  });

  it("writeRunCheckpoint returns null when the table is missing (migration not applied)", async () => {
    mockUpsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "42P01", message: 'relation "agent_run_checkpoints" does not exist' },
        }),
      }),
    });
    expect(await writeRunCheckpoint(baseState)).toBeNull();
  });

  it("claimRunCheckpoint returns the claimed row (PostgREST array shape)", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "cp-1", execution_token: "tok-1" }], error: null });
    const row = await claimRunCheckpoint("cp-1");
    expect(row?.execution_token).toBe("tok-1");
    expect(mockRpc).toHaveBeenCalledWith("claim_run_checkpoint", {
      p_checkpoint_id: "cp-1",
      p_lease_seconds: 90,
    });
  });

  it("renewRunCheckpointLease returns false when fenced (token mismatch)", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect(await renewRunCheckpointLease("cp-1", "old-token")).toBe(false);
  });

  it("renewRunCheckpointLease treats transient errors as non-fatal", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    expect(await renewRunCheckpointLease("cp-1", "tok-1")).toBe(true);
  });

  it("listStaleRunCheckpoints returns expired-lease rows", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "cp-9" }, { id: "cp-10" }], error: null });
    const rows = await listStaleRunCheckpoints();
    expect(rows).toHaveLength(2);
    expect(mockRpc).toHaveBeenCalledWith("stale_run_checkpoints", { p_max_attempts: 2 });
  });

  it("settleRunCheckpoint marks terminal outcome", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq });
    await settleRunCheckpoint("cp-1", "completed");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ run_status: "completed" }),
    );
    expect(eq).toHaveBeenCalledWith("id", "cp-1");
  });
});
