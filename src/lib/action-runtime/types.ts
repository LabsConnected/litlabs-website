export const ACTION_RUN_KINDS = [
  "browser",
  "studio",
  "deployment",
  "agent",
  "composite",
] as const;
export type ActionRunKind = (typeof ACTION_RUN_KINDS)[number];

export const ACTION_RUN_STATUSES = [
  "queued",
  "starting",
  "working",
  "waiting_for_user",
  "user_controlling",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ActionRunStatus = (typeof ACTION_RUN_STATUSES)[number];

export interface ActionRun {
  id: string;
  userId: string;
  projectId: string | null;
  conversationId: string | null;
  kind: ActionRunKind;
  status: ActionRunStatus;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  currentActivity: string | null;
  browserSessionId: string | null;
  cancellationRequestedAt: string | null;
  approvalReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export type ActionRunPatch = Partial<
  Pick<
    ActionRun,
    | "currentActivity"
    | "browserSessionId"
    | "cancellationRequestedAt"
    | "approvalReference"
    | "failureCode"
    | "failureMessage"
  >
>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type ActionEventPayload = Record<string, JsonValue>;

export const ACTION_EVENT_TYPES = [
  "run.created",
  "run.started",
  "run.status",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "agent.started",
  "agent.status",
  "agent.completed",
  "agent.failed",
  "browser.session.started",
  "browser.session.updated",
  "browser.session.completed",
  "browser.session.failed",
  "browser.action.started",
  "browser.action.completed",
  "browser.action.failed",
  "browser.user_required",
  "browser.user_control_started",
  "browser.user_control_returned",
  "approval.required",
  "approval.approved",
  "approval.rejected",
  "activity.created",
  "cancellation.requested",
  "deployment.started",
  "deployment.status",
  "deployment.completed",
  "deployment.failed",
] as const;
export type ActionEventType = (typeof ACTION_EVENT_TYPES)[number];

export interface ActionEvent {
  id: string;
  sequence: number;
  runId: string;
  userId: string;
  type: ActionEventType;
  createdAt: string;
  payload: ActionEventPayload;
}

export interface ActionActivity {
  id: string;
  runId: string;
  userId: string;
  message: string;
  createdAt: string;
  eventId: string | null;
}

export interface CreateActionRunInput {
  userId: string;
  projectId?: string | null;
  conversationId?: string | null;
  kind: ActionRunKind;
  currentActivity?: string | null;
  browserSessionId?: string | null;
}

/**
 * Identity of the user task currently executing. The orchestrator creates or
 * resolves the ActionRun ONCE and carries this context through every tool
 * call; low-level handlers must never invent or rediscover a run.
 */
export interface ActionExecutionContext {
  actionRunId: string;
  userId: string;
  conversationId?: string;
  projectId?: string;
}

/**
 * ActionExecutionContext narrowed to an attached browser session resource.
 * browserSessionId is the resource binding (session -> ActionRun.id), not the
 * run identity — actionRunId remains the identity.
 */
export interface BrowserActionContext extends ActionExecutionContext {
  browserSessionId: string;
}

export type BrowserToolExecutionResult =
  | { outcome: "completed" }
  | { outcome: "failed"; error?: unknown };

export class ActionRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "PERSISTENCE_UNAVAILABLE"
      | "INVALID_TRANSITION"
      | "NOT_FOUND"
      | "CONFLICT"
      | "ACTION_RUN_NOT_FOUND"
      | "ACTION_BROWSER_SESSION_MISMATCH"
      | "ACTION_RUN_TERMINAL",
  ) {
    super(message);
    this.name = "ActionRuntimeError";
  }
}

export function isActionRunStatus(value: string): value is ActionRunStatus {
  return (ACTION_RUN_STATUSES as readonly string[]).includes(value);
}

export function isActionEventType(value: string): value is ActionEventType {
  return (ACTION_EVENT_TYPES as readonly string[]).includes(value);
}
