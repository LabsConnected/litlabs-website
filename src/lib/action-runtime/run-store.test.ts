// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

const admin = {
  rpc: mocks.rpc,
  from: mocks.from,
};

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => admin,
}));

import {
  appendActionEvent,
  createActionRun,
  getActionRunByBrowserSession,
  listActionEvents,
  patchActionRun,
  recordActionActivity,
  recordActionEventActivity,
  transitionActionRun,
} from "./run-store";

const runRow = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "user-one",
  project_id: null,
  conversation_id: "conversation-one",
  kind: "composite",
  status: "working",
  created_at: "2026-09-23T00:00:00.000Z",
  started_at: "2026-09-23T00:00:01.000Z",
  updated_at: "2026-09-23T00:00:02.000Z",
  completed_at: null,
  current_activity: "Working",
  browser_session_id: null,
  cancellation_requested_at: null,
  approval_reference: null,
  failure_code: null,
  failure_message: null,
  idempotency_key: null,
};

const eventRow = {
  id: "22222222-2222-2222-2222-222222222222",
  sequence: "9007199254740993",
  run_id: runRow.id,
  user_id: "user-one",
  type: "activity.created",
  created_at: "2026-09-23T00:00:03.000Z",
  payload: { message: "done" },
};

function ownedRunQuery(row = runRow) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  mocks.from.mockReturnValueOnce(query);
  return query;
}

function listQuery(rows: unknown[] = []) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
      return resolve({ data: rows, error: null });
    },
  };
  mocks.from.mockReturnValueOnce(query);
  return query;
}

describe("ActionRun persistence boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: runRow, error: null });
  });

  it("sanitizes free-form run patches before persistence", async () => {
    ownedRunQuery();

    await patchActionRun(runRow.id, "user-one", {
      currentActivity: "Opening page Authorization: Bearer eyJabc.def.ghi",
      approvalReference: "approval token=approval-secret",
      failureMessage: "Provider failed cookie=session-secret",
    });

    const rpcInput = mocks.rpc.mock.calls[0][1] as Record<string, unknown>;
    const patch = rpcInput.p_patch as Record<string, unknown>;
    expect(JSON.stringify(patch)).not.toContain("eyJabc.def.ghi");
    expect(JSON.stringify(patch)).not.toContain("approval-secret");
    expect(JSON.stringify(patch)).not.toContain("session-secret");
    expect(patch.currentActivity).toContain("[REDACTED]");
    expect(patch.approvalReference).toContain("[REDACTED]");
    expect(patch.failureMessage).toContain("[REDACTED]");
  });

  it("rejects terminal run mutation before any RPC write", async () => {
    ownedRunQuery({ ...runRow, status: "completed" });

    await expect(patchActionRun(runRow.id, "user-one", { currentActivity: "mutate" }))
      .rejects.toMatchObject({ code: "ACTION_RUN_TERMINAL_IMMUTABLE" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sanitizes transition patches and the activity they echo into events", async () => {
    ownedRunQuery();

    await transitionActionRun(runRow.id, "user-one", "completed", {
      currentActivity: "Finished with cookie=private-cookie",
      failureMessage: "Provider failed Authorization: Bearer private-token",
    });

    const rpcInput = mocks.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(JSON.stringify(rpcInput.p_patch)).not.toContain("private-cookie");
    expect(JSON.stringify(rpcInput.p_patch)).not.toContain("private-token");
    expect(JSON.stringify(rpcInput.p_event_payload)).not.toContain("private-cookie");
  });

  it("sanitizes secret values inside event payloads, not just secret keys", async () => {
    await appendActionEvent({
      runId: runRow.id,
      userId: "user-one",
      type: "browser.action.failed",
      payload: { toolId: "browser.eval", error: "failed Authorization: Bearer private-token", cookie: "session=raw" },
    });

    const rpcInput = mocks.rpc.mock.calls[0][1] as Record<string, unknown>;
    const payload = rpcInput.p_payload as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain("private-token");
    expect(JSON.stringify(payload)).not.toContain("session=raw");
    expect(payload.error).toContain("[REDACTED]");
    expect(payload.cookie).toBe("[REDACTED]");
    expect(payload.toolId).toBe("browser.eval");
  });

  it("redacts every canonical secret-named key at any depth in event payloads", async () => {
    await appendActionEvent({
      runId: runRow.id,
      userId: "user-one",
      type: "browser.action.failed",
      payload: {
        nested: {
          secret: "s1",
          password: "p1",
          token: "t1",
          authorization: "a1",
          cookie: "c1",
          apiKey: "k1",
          CLERK_SECRET_KEY: "ck1",
          deeper: { private_key: "pk1", api_key: "ak1" },
        },
        safe: "keep-me",
      },
    });

    const rpcInput = mocks.rpc.mock.calls[0][1] as Record<string, unknown>;
    const payload = JSON.stringify(rpcInput.p_payload);
    for (const raw of ["s1", "p1", "t1", "a1", "c1", "k1", "ck1", "pk1", "ak1"]) {
      expect(payload).not.toContain(`"${raw}"`);
    }
    expect(payload).toContain('"safe":"keep-me"');
  });

  it("sanitizes activity messages on event+activity writes", async () => {
    await recordActionEventActivity({
      runId: runRow.id,
      userId: "user-one",
      type: "browser.action.completed",
      payload: { toolId: "browser.navigate", browserSessionId: "session-one" },
      message: "Completed with Authorization: Bearer private-token",
    });

    expect(mocks.rpc).toHaveBeenCalledWith("action_runtime_event_activity", expect.objectContaining({
      p_message: expect.stringContaining("[REDACTED]"),
    }));
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toContain("private-token");
  });

  it("returns the real durable event ID and exact BIGINT sequence for activity", async () => {
    mocks.rpc.mockResolvedValue({ data: { run: runRow, event: eventRow }, error: null });

    const activity = await recordActionActivity(runRow.id, "user-one", "Deployment verified");

    expect(activity).toEqual({
      id: eventRow.id,
      runId: runRow.id,
      userId: "user-one",
      message: "Deployment verified",
      createdAt: eventRow.created_at,
      eventId: eventRow.id,
      sequence: "9007199254740993",
    });
    expect(activity.id).not.toBe(runRow.id);
  });

  it("rejects empty activity messages instead of persisting an empty event", async () => {
    await expect(
      recordActionActivity(runRow.id, "user-one", "   "),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("coerces an empty event-activity message to NULL so no empty activity row is emitted", async () => {
    await recordActionEventActivity({
      runId: runRow.id,
      userId: "user-one",
      type: "browser.action.completed",
      payload: { toolId: "browser.navigate" },
      message: "   ",
    });

    expect(mocks.rpc).toHaveBeenCalledWith("action_runtime_event_activity", expect.objectContaining({
      p_message: null,
    }));
  });

  it("keeps event sequence filters and results as exact BIGINT strings", async () => {
    ownedRunQuery();
    const query = listQuery([eventRow]);

    const events = await listActionEvents(runRow.id, "user-one", {
      afterSequence: "9007199254740992",
      limit: 10,
    });

    expect(query.select).toHaveBeenCalledWith("id, sequence:sequence::text, run_id, user_id, type, created_at, payload");
    expect(query.gt).toHaveBeenCalledWith("sequence", "9007199254740992");
    expect(events[0]?.sequence).toBe("9007199254740993");
  });

  it("passes caller-controlled idempotency identity into run creation", async () => {
    await createActionRun({
      id: runRow.id,
      userId: "user-one",
      kind: "composite",
      conversationId: "conversation-one",
      idempotencyKey: "request-one",
      currentActivity: "Starting Authorization: Bearer private-token",
    });

    expect(mocks.rpc).toHaveBeenCalledWith("action_runtime_create_run", expect.objectContaining({
      p_id: runRow.id,
      p_idempotency_key: "request-one",
      p_current_activity: expect.stringContaining("[REDACTED]"),
    }));
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toContain("private-token");
  });

  it("maps database invariant errors to stable ActionRuntimeError codes", async () => {
    const cases = [
      ["ACTION_RUN_NOT_FOUND", "ACTION_RUN_NOT_FOUND"],
      ["ACTION_RUN_INVALID_TRANSITION", "ACTION_RUN_INVALID_TRANSITION"],
      ["ACTION_RUN_TERMINAL_IMMUTABLE", "ACTION_RUN_TERMINAL_IMMUTABLE"],
      ["ACTION_BROWSER_SESSION_MISMATCH", "ACTION_BROWSER_SESSION_MISMATCH"],
      ["ACTION_BROWSER_SESSION_OWNER_MISMATCH", "ACTION_BROWSER_SESSION_OWNER_MISMATCH"],
      ["ACTION_EVENT_INVALID_TYPE", "ACTION_EVENT_INVALID_TYPE"],
      ["ACTION_RUN_CONFLICT", "ACTION_RUN_CONFLICT"],
    ] as const;

    for (const [databaseCode, expected] of cases) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: databaseCode } });
      await expect(appendActionEvent({
        runId: runRow.id,
        userId: "user-one",
        type: "browser.action.started",
        payload: {},
      })).rejects.toMatchObject({ code: expected });
    }
  });

  it("recovers terminal run truth through the browser-session association", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { ...runRow, status: "completed" }, error: null }),
    };
    mocks.from.mockReturnValueOnce(query);

    const run = await getActionRunByBrowserSession("user-one", "session-one");

    expect(run?.status).toBe("completed");
  });

  it("uses the durable session index for browser recovery lookup", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: runRow, error: null }),
    };
    mocks.from.mockReturnValueOnce(query);

    const run = await getActionRunByBrowserSession("user-one", "session-one");

    expect(run?.id).toBe(runRow.id);
    expect(query.eq).toHaveBeenCalledWith("browser_session_id", "session-one");
    expect(query).not.toHaveProperty("not");
  });
});
