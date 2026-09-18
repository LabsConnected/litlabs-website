import { describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: query } }));

import { resolvePausedRun, completePausedRun, failPausedRun } from "@/lib/litt-intelligence/paused-run-store";

function row(status: string) {
  return {
    id: "run-1", user_id: "user-1", conversation_id: "conversation-1", project_id: "project-1",
    workspace_id: "workspace-1", tool_id: "image.generate", tool_call_id: "call-1", inputs: { prompt: "sunset" },
    reason: "approval", paused_messages: [], execution_mode: "act", system_prompt: "", checkpoint_id: null,
    status, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
    resolved_at: null, error: null,
  };
}

function setup(result: unknown) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["update", "eq", "or", "select"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({ data: result, error: null }));
  query.mockReturnValue(builder);
  return builder;
}

describe("paused approval lifecycle", () => {
  it("atomically claims pending work and only completes afterward", async () => {
    const builder = setup(row("executing"));
    await resolvePausedRun("run-1", "user-1", "approved");
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "executing", error: null }));
    expect(builder.or).toHaveBeenCalledWith("status.eq.pending");

    setup({});
    await completePausedRun("run-1", "user-1");
    expect(query().update).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  it("records failure and permits only explicit retry of the same run", async () => {
    const failed = setup({});
    await failPausedRun("run-1", "user-1", "provider failed");
    expect(failed.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "provider failed" }));

    const retry = setup(row("executing"));
    await resolvePausedRun("run-1", "user-1", "approved", true);
    expect(retry.or).toHaveBeenCalledWith("status.eq.pending,status.eq.failed");
    expect(retry.update).toHaveBeenCalledWith(expect.objectContaining({ status: "executing", error: null }));
  });
});
