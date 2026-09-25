import "server-only";

import type { PausedRunRecord } from "@/lib/litt-intelligence/paused-run-store";
import type { ActionEvent, ActionEventPayload, ActionRun } from "./types";
import { isTerminalActionRunStatus } from "./state-machine";

export type ActionRunDisplayState =
  | "queued"
  | "starting"
  | "running"
  | "waiting_for_user"
  | "awaiting_approval"
  | "paused"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed";

export type ActionCapabilityStatus =
  | "not_started"
  | "running"
  | "ready"
  | "completed"
  | "cancelled"
  | "failed";

export interface ActionCapabilityProjection {
  status: ActionCapabilityStatus;
  updatedAt: string | null;
  message: string | null;
}

export interface ActionApprovalProjection {
  id: string;
  toolId: string;
  toolCallId: string;
  reason: string;
  status: PausedRunRecord["status"];
  runStatus: PausedRunRecord["runStatus"];
  runError: string | null;
  actionRunId: string | null;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  deferredToolCount: number;
}

export interface ActionDeploymentProjection {
  status: ActionCapabilityStatus;
  deploymentId: string | null;
  publicUrl: string | null;
  verified: boolean;
  httpStatus: number | null;
  updatedAt: string | null;
  error: string | null;
}

export interface ActionRunProjection {
  run: ActionRun;
  displayState: ActionRunDisplayState;
  currentActivity: string | null;
  timeline: ActionEvent[];
  approvals: ActionApprovalProjection[];
  pendingApprovals: ActionApprovalProjection[];
  capabilities: {
    agent: ActionCapabilityProjection;
    files: ActionCapabilityProjection;
    terminal: ActionCapabilityProjection;
    browser: ActionCapabilityProjection;
    preview: ActionCapabilityProjection;
    deployment: ActionDeploymentProjection;
    verification: ActionCapabilityProjection;
    approval: ActionCapabilityProjection;
  };
  tools: {
    started: string[];
    running: string[];
    completed: string[];
    failed: string[];
  };
  failure: {
    code: string | null;
    message: string | null;
  } | null;
  deployment: {
    id: string | null;
    publicUrl: string | null;
    verified: boolean;
  };
}

const TERMINAL_TOOL_PREFIXES = [
  "terminal.",
  "build.",
  "test.",
  "typecheck.",
  "lint.",
  "package.",
  "git.",
] as const;

const FILE_TOOL_PREFIXES = [
  "files.",
  "file.",
  "workspace.",
  "read_file",
  "write_file",
  "edit_file",
  "create_file",
  "list_files",
  "apply_patch",
] as const;

const VERIFICATION_TOOL_IDS = new Set([
  "deploy.verify",
  "deployment.verify",
  "site.verify",
  "url.verify",
]);

function eventMessage(event: ActionEvent): string | null {
  const message = event.payload.message;
  if (typeof message === "string" && message.trim()) return message;
  const error = event.payload.error;
  if (typeof error === "string" && error.trim()) return error;
  return null;
}

function capability(status: ActionCapabilityStatus, event: ActionEvent | null = null): ActionCapabilityProjection {
  return {
    status,
    updatedAt: event?.createdAt ?? null,
    message: event ? eventMessage(event) : null,
  };
}

function toolId(event: ActionEvent): string | null {
  const id = event.payload.toolId;
  return typeof id === "string" && id ? id : null;
}

function hasPrefix(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value === prefix || value.startsWith(prefix));
}

function eventPhase(type: string): "started" | "completed" | "failed" | "ready" | "status" | null {
  if (type.endsWith(".started")) return "started";
  if (type.endsWith(".completed")) return "completed";
  if (type.endsWith(".failed")) return "failed";
  if (type.endsWith(".ready")) return "ready";
  if (type.endsWith(".status")) return "status";
  return null;
}

function statusFromPhase(phase: ReturnType<typeof eventPhase>): ActionCapabilityStatus {
  switch (phase) {
    case "started":
    case "status":
      return "running";
    case "ready":
      return "ready";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "not_started";
  }
}

function stringField(payload: ActionEventPayload, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function numberField(payload: ActionEventPayload, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function nestedDeployment(payload: ActionEventPayload): ActionEventPayload {
  const deployment = payload.deployment;
  return deployment && typeof deployment === "object" && !Array.isArray(deployment)
    ? deployment as ActionEventPayload
    : {};
}

function approvalProjection(record: PausedRunRecord): ActionApprovalProjection {
  return {
    id: record.id,
    toolId: record.toolId,
    toolCallId: record.toolCallId,
    reason: record.reason,
    status: record.status,
    runStatus: record.runStatus,
    runError: record.runError,
    actionRunId: record.actionRunId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    resolvedAt: record.resolvedAt,
    deferredToolCount: record.deferredToolCalls?.length ?? 0,
  };
}

function displayState(run: ActionRun, pendingApprovals: ActionApprovalProjection[]): ActionRunDisplayState {
  if (run.status === "cancelled") return "stopped";
  if (run.status === "failed") return "failed";
  if (run.status === "completed") return "completed";
  if (pendingApprovals.length > 0) return "awaiting_approval";
  if (run.cancellationRequestedAt) return "stopping";
  if (run.status === "queued") return "queued";
  if (run.status === "starting") return "starting";
  if (run.status === "paused") return "paused";
  if (run.status === "waiting_for_user" || run.status === "user_controlling") return "waiting_for_user";
  return "running";
}

export function buildActionRunProjection(input: {
  run: ActionRun;
  events: ActionEvent[];
  pausedRuns?: PausedRunRecord[];
}): ActionRunProjection {
  const run = input.run;
  const events = [...input.events].sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1);
  const pausedRuns = input.pausedRuns ?? [];
  const approvals = pausedRuns.map(approvalProjection);
  const pendingApprovals = isTerminalActionRunStatus(run.status)
    ? []
    : approvals.filter((approval) => approval.status === "pending");

  const latest = {
    agent: null as ActionEvent | null,
    files: null as ActionEvent | null,
    terminal: null as ActionEvent | null,
    browser: null as ActionEvent | null,
    preview: null as ActionEvent | null,
    deployment: null as ActionEvent | null,
    verification: null as ActionEvent | null,
    approval: null as ActionEvent | null,
    activity: null as ActionEvent | null,
  };
  const started = new Set<string>();
  const running = new Set<string>();
  const completed = new Set<string>();
  const failed = new Set<string>();

  for (const event of events) {
    const phase = eventPhase(event.type);
    const id = toolId(event);

    if (event.type === "activity.created") latest.activity = event;
    if (event.type.startsWith("agent.")) latest.agent = event;
    if (event.type.startsWith("browser.")) latest.browser = event;
    if (event.type.startsWith("preview.") || id?.startsWith("preview.")) latest.preview = event;
    if (event.type.startsWith("approval.")) latest.approval = event;

    if (id) {
      if (phase === "started") {
        started.add(id);
        running.add(id);
        completed.delete(id);
        failed.delete(id);
      } else if (phase === "completed" || phase === "ready") {
        started.add(id);
        running.delete(id);
        completed.add(id);
        failed.delete(id);
      } else if (phase === "failed") {
        started.add(id);
        running.delete(id);
        completed.delete(id);
        failed.add(id);
      }

      if (hasPrefix(id, FILE_TOOL_PREFIXES)) latest.files = event;
      if (hasPrefix(id, TERMINAL_TOOL_PREFIXES)) latest.terminal = event;
      if (id.startsWith("browser.")) latest.browser = event;
      if (VERIFICATION_TOOL_IDS.has(id)) latest.verification = event;
    }

    if (event.type.startsWith("deployment.")) {
      latest.deployment = event;
      const nested = nestedDeployment(event.payload);
      const nestedToolId = stringField(nested, "toolId");
      if ((id && VERIFICATION_TOOL_IDS.has(id)) || (nestedToolId && VERIFICATION_TOOL_IDS.has(nestedToolId))) {
        latest.verification = event;
      }
    }
  }

  const latestDeployment = latest.deployment;
  const deploymentNested = latestDeployment ? nestedDeployment(latestDeployment.payload) : {};
  const deploymentId = latestDeployment
    ? stringField(latestDeployment.payload, "deploymentId", "deployment_id", "id")
      ?? stringField(deploymentNested, "deploymentId", "deployment_id", "id")
    : null;
  const publicUrl = latestDeployment
    ? stringField(latestDeployment.payload, "publicUrl", "liveUrl", "url")
      ?? stringField(deploymentNested, "publicUrl", "liveUrl", "url")
    : null;
  const httpStatus = latestDeployment
    ? numberField(latestDeployment.payload, "httpStatus", "statusCode")
      ?? numberField(deploymentNested, "httpStatus", "statusCode")
    : null;
  const verified = latestDeployment?.payload.verified === true
    || deploymentNested.verified === true
    || (typeof httpStatus === "number" && httpStatus >= 200 && httpStatus < 400)
    || (latest.verification ? latest.verification.type.endsWith(".completed") : false);

  const failureMessage = run.failureMessage
    ?? latestFailedMessage(events)
    ?? (latestDeployment?.type === "deployment.failed" ? eventMessage(latestDeployment) : null);
  const lastEvent = events.at(-1) ?? null;
  const currentActivity = run.currentActivity
    ?? (latest.activity ? eventMessage(latest.activity) : null)
    ?? (lastEvent ? `${lastEvent.type} recorded` : null);

  const capabilities: ActionRunProjection["capabilities"] = {
    agent: capability(statusFromPhase(eventPhase(latest.agent?.type ?? "")), latest.agent),
    files: capability(statusFromPhase(eventPhase(latest.files?.type ?? "")), latest.files),
    terminal: capability(statusFromPhase(eventPhase(latest.terminal?.type ?? "")), latest.terminal),
    browser: capability(statusFromPhase(eventPhase(latest.browser?.type ?? "")), latest.browser),
    preview: capability(statusFromPhase(eventPhase(latest.preview?.type ?? "")), latest.preview),
    deployment: {
      status: statusFromPhase(eventPhase(latestDeployment?.type ?? "")),
      deploymentId,
      publicUrl,
      verified,
      httpStatus,
      updatedAt: latestDeployment?.createdAt ?? null,
      error: latestDeployment?.type === "deployment.failed" ? eventMessage(latestDeployment) : null,
    },
    verification: capability(
      verified ? "completed" : statusFromPhase(eventPhase(latest.verification?.type ?? "")),
      latest.verification ?? latestDeployment,
    ),
    approval: capability(
      pendingApprovals.length > 0 ? "running" : statusFromPhase(eventPhase(latest.approval?.type ?? "")),
      latest.approval,
    ),
  };
  if (run.status === "cancelled") {
    for (const capability of Object.values(capabilities)) {
      if (capability.status === "running") capability.status = "cancelled";
    }
    running.clear();
  }

  return {
    run,
    displayState: displayState(run, pendingApprovals),
    currentActivity,
    timeline: events,
    approvals,
    pendingApprovals,
    capabilities,
    tools: {
      started: [...started],
      running: [...running],
      completed: [...completed],
      failed: [...failed],
    },
    failure: run.status === "failed" || run.failureCode || run.failureMessage || failed.size > 0
      ? { code: run.failureCode, message: failureMessage }
      : null,
    deployment: {
      id: deploymentId,
      publicUrl,
      verified,
    },
  };
}

function latestFailedMessage(events: ActionEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type.endsWith(".failed")) return eventMessage(events[index]);
  }
  return null;
}
