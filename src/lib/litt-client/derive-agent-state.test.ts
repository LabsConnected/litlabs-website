import { describe, expect, it } from "vitest";
import type { ActionRunDisplayState } from "@/lib/action-runtime/projection";
import { ACTION_RUN_STATUSES, type ActionRunStatus } from "@/lib/action-runtime/types";
import { TASK_STATUSES, type StudioTaskStatus } from "@/lib/studio/task-types";
import type { MessageStatus } from "@/lib/studio/types";
import type { ExecutionPhase } from "@/app/(app)/studio/stores/useExecutionStore";
import {
  AGENT_STATE_LABELS,
  TOOL_EXECUTION_UNAVAILABLE,
  deriveAgentState,
  type AgentProgressSignal,
  type AgentState,
  type AgentStateKind,
  type DeriveAgentStateInput,
  type LittActionRunDisplayState,
  type LittExecutionPhase,
} from "./derive-agent-state";

type Expect<T extends true> = T;
type Identical<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type _phaseLock = Expect<Identical<ExecutionPhase, LittExecutionPhase>>;
type _displayLock = Expect<Identical<ActionRunDisplayState, LittActionRunDisplayState>>;

const enumLocks: [_phaseLock, _displayLock] = [true, true];

const MESSAGE_STATUSES = [
  "pending",
  "streaming",
  "completed",
  "failed",
  "cancelled",
  "awaiting_approval",
] as const satisfies readonly MessageStatus[];

const EXECUTION_PHASES = [
  "idle",
  "planning",
  "inspecting",
  "editing",
  "testing",
  "verifying",
  "done",
  "failed",
  "cancelled",
  "awaiting_approval",
  "awaiting_input",
] as const satisfies readonly LittExecutionPhase[];

const DISPLAY_STATES = [
  "queued",
  "starting",
  "running",
  "waiting_for_user",
  "awaiting_approval",
  "paused",
  "stopping",
  "stopped",
  "completed",
  "failed",
] as const satisfies readonly LittActionRunDisplayState[];

function expectKind(input: DeriveAgentStateInput, kind: AgentStateKind | null, extra?: Partial<AgentState>) {
  const actual = deriveAgentState(input);
  if (kind === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).toMatchObject({
    kind,
    label: AGENT_STATE_LABELS[kind],
    ...extra,
  });
}

describe("deriveAgentState labels", () => {
  it("keeps the consumer phase unions identical to Studio's", () => {
    expect(enumLocks).toEqual([true, true]);
  });

  it("uses the four consumer labels", () => {
    expect(AGENT_STATE_LABELS).toEqual({
      working: "Working",
      waiting_approval: "Waiting for approval",
      done: "Done",
      needs_attention: "Needs attention",
    });
  });

  it("shows nothing when no run is in flight", () => {
    expectKind({}, null);
    expectKind({ executionPhase: "idle" }, null);
    expectKind({ taskStatus: "closed" }, null);
  });
});

describe("deriveAgentState message status", () => {
  const expected: Record<MessageStatus, AgentStateKind | null> = {
    pending: "working",
    streaming: "working",
    completed: "done",
    failed: "needs_attention",
    cancelled: "done",
    awaiting_approval: "waiting_approval",
  };

  it.each(MESSAGE_STATUSES)("maps message status %s", (status) => {
    const kind = expected[status];
    expectKind(
      { messageStatus: status },
      kind,
      status === "cancelled" ? { stopped: true, note: "Stopped" } : undefined,
    );
  });
});

describe("deriveAgentState execution phase", () => {
  const expected: Record<LittExecutionPhase, AgentStateKind | null> = {
    idle: null,
    planning: "working",
    inspecting: "working",
    editing: "working",
    testing: "working",
    verifying: "working",
    done: "done",
    failed: "needs_attention",
    cancelled: "done",
    awaiting_approval: "waiting_approval",
    awaiting_input: "needs_attention",
  };

  it.each(EXECUTION_PHASES)("maps execution phase %s", (phase) => {
    expectKind(
      { executionPhase: phase },
      expected[phase],
      phase === "cancelled"
        ? { stopped: true, note: "Stopped" }
        : phase === "awaiting_input"
          ? { note: "Waiting for you" }
          : phase === "failed"
            ? { note: "Failed" }
            : undefined,
    );
  });
});

describe("deriveAgentState action run status", () => {
  const expected: Record<ActionRunStatus, AgentStateKind> = {
    queued: "working",
    starting: "working",
    working: "working",
    waiting_for_user: "working",
    user_controlling: "working",
    paused: "working",
    completed: "done",
    failed: "needs_attention",
    cancelled: "done",
  };

  it("covers every ACTION_RUN_STATUSES member", () => {
    expect(ACTION_RUN_STATUSES).toEqual(Object.keys(expected));
  });

  it.each(ACTION_RUN_STATUSES)("maps action run status %s", (status) => {
    expectKind(
      { actionRunStatus: status },
      expected[status],
      status === "cancelled" ? { stopped: true, note: "Stopped" } : undefined,
    );
  });
});

describe("deriveAgentState action run display state", () => {
  const expected: Record<LittActionRunDisplayState, AgentStateKind> = {
    queued: "working",
    starting: "working",
    running: "working",
    waiting_for_user: "working",
    awaiting_approval: "waiting_approval",
    paused: "working",
    stopping: "working",
    stopped: "done",
    completed: "done",
    failed: "needs_attention",
  };

  it.each(DISPLAY_STATES)("maps display state %s", (display) => {
    expectKind(
      { actionRunDisplayState: display },
      expected[display],
      display === "stopped" ? { stopped: true, note: "Stopped" } : undefined,
    );
  });
});

describe("deriveAgentState task status", () => {
  const expected: Record<StudioTaskStatus, AgentStateKind | null> = {
    working: "working",
    ready: "done",
    waiting_approval: "waiting_approval",
    needs_verification: "needs_attention",
    failed: "needs_attention",
    complete: "done",
    closed: null,
  };

  it("covers every TASK_STATUSES member", () => {
    expect([...TASK_STATUSES]).toEqual(Object.keys(expected));
  });

  it.each(TASK_STATUSES)("maps task status %s", (status) => {
    expectKind(
      { taskStatus: status },
      expected[status],
      status === "needs_verification" ? { note: "Needs verification" } : undefined,
    );
  });
});

describe("deriveAgentState progress and recovery", () => {
  const inFlight: AgentProgressSignal["type"][] = [
    "phase",
    "tool_start",
    "tool_result",
    "text",
    "tool_execution",
    "checkpoint",
    "build_start",
    "build_result",
    "workspace_change",
    "repair_attempt",
    "preview_start",
    "preview_status",
    "preview_result",
    "deploy_start",
    "deploy_status",
    "deploy_result",
    "deploy_verify",
    "model_routing",
    "step_timing",
    "model_response",
    "reasoning",
    "status",
    "quality_verdict",
    "actions",
  ];

  it.each(inFlight)("treats progress %s as working", (type) => {
    expectKind({ progressEvent: { type } as AgentProgressSignal }, "working");
  });

  it("maps approval progress to waiting for approval", () => {
    expectKind({ progressEvent: { type: "approval_required" } }, "waiting_approval");
    expectKind({ progressEvent: { type: "pending_approval" } }, "waiting_approval");
    expectKind({ approvalPending: true }, "waiting_approval");
  });

  it("maps a failed finish and model failure to needs attention", () => {
    expectKind({ progressEvent: { type: "finished", success: false } }, "needs_attention", { note: "Failed" });
    expectKind({ progressEvent: { type: "model_failed" } }, "needs_attention", { note: "Failed" });
    expectKind({ progressEvent: { type: "error", code: "EMPTY_PROVIDER_RESPONSE" } }, "needs_attention", { note: "Failed" });
  });

  it("maps a successful finish to done", () => {
    expectKind({ progressEvent: { type: "finished", success: true } }, "done");
    expectKind({ progressEvent: { type: "finished" } }, "done");
    expectKind({ progressEvent: { type: "done" } }, "done");
    expectKind({ progressEvent: { type: "done", assistantStatus: "completed" } }, "done");
  });

  it("maps reconcile outcomes", () => {
    expectKind({ reconcileState: "running" }, "working");
    expectKind({ reconcileState: "completed" }, "done");
    expectKind({ reconcileState: "awaiting_approval" }, "waiting_approval");
    expectKind({ reconcileState: "failed" }, "needs_attention", { note: "Failed" });
    expectKind({ reconcileState: "unknown" }, "needs_attention", { note: "Couldn't recover this run" });
    expectKind({ reconcileState: "cancelled" }, "done", { stopped: true, note: "Stopped" });
  });
});

describe("deriveAgentState precedence", () => {
  it("shows a user stop as Done with a Stopped note, not needs attention", () => {
    expectKind(
      { userStopped: true, messageStatus: "failed", error: true, stalled: true },
      "done",
      { stopped: true, note: "Stopped" },
    );
  });

  it("shows a user stop as Done even if an approval gate was open", () => {
    expectKind(
      { userStopped: true, approvalPending: true, messageStatus: "awaiting_approval" },
      "done",
      { stopped: true, note: "Stopped" },
    );
  });

  it("keeps an unconfirmed stop as Working", () => {
    expectKind({ actionRunDisplayState: "stopping" }, "working");
  });

  it("lets a pending approval beat failure, stall, and streaming", () => {
    expectKind(
      { approvalPending: true, messageStatus: "failed", stalled: true, errorCode: TOOL_EXECUTION_UNAVAILABLE },
      "waiting_approval",
    );
  });

  it("surfaces TOOL_EXECUTION_UNAVAILABLE as needs attention", () => {
    expectKind(
      { errorCode: TOOL_EXECUTION_UNAVAILABLE },
      "needs_attention",
      { note: "Tools unavailable" },
    );
    expectKind(
      { progressEvent: { type: "error", code: TOOL_EXECUTION_UNAVAILABLE }, messageStatus: "streaming" },
      "needs_attention",
      { note: "Tools unavailable" },
    );
  });

  it("lets a stall beat an in-flight stream", () => {
    expectKind({ stalled: true, messageStatus: "streaming" }, "needs_attention", { note: "Stalled" });
  });

  it("treats an unrecoverable run as needs attention", () => {
    expectKind({ unrecoverable: true }, "needs_attention", { note: "Couldn't recover this run" });
  });

  it("uses a generic error note when the failure is not more specific", () => {
    expectKind({ error: true }, "needs_attention", { note: "Error" });
  });
});
