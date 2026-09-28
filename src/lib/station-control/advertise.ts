/**
 * Station Control Bridge — tool-registry advertisement (server-only).
 *
 * Makes registered station actions visible to the LiTT agent loop by
 * converting each StationAction into a LiTTToolDefinition and registering
 * it on the canonical toolRegistry. Additive only: on an id collision the
 * EXISTING tool keeps its advertisement and the station action is skipped.
 *
 * Contract: docs/LITT-OS-IMPLEMENTATION-CONTRACT.md §16 (additive first —
 * the full registry swap happens after the release gate).
 */
import "server-only";
import { z } from "zod";
import { toolRegistry } from "../litt-intelligence/tool-registry";
import type {
  ApprovalPolicy,
  LiTTToolDefinition,
  ToolPermissionLevel,
  ToolRisk,
} from "../litt-intelligence/types";
import type { ToolExecutionContext } from "../litt-intelligence/tool-registry";
import type { StationAction, StationResult } from "./types";
import { listStationActions } from "./registry";
import { stationToPermissionKey } from "./permissions";
import { buildStationContext } from "./project-session";
import { executeStationAction } from "./executor";
import { getStationEventSink } from "./loop-events";

/**
 * Approval policies. NOTE: READ_ONLY_APPROVAL / MUTATION_APPROVAL are
 * module-private in tool-registry.ts (not exported) — these local copies
 * carry the identical values, kept in sync by convention (see test).
 */
export const STATION_READ_ONLY_APPROVAL: ApprovalPolicy = {
  required: false,
  autoApproveReadOnly: true,
  requireExplicitForMutations: false,
  neverAllow: false,
};

export const STATION_MUTATION_APPROVAL: ApprovalPolicy = {
  required: true,
  autoApproveReadOnly: false,
  requireExplicitForMutations: true,
  neverAllow: false,
};

/**
 * Station action id → tool-registry id for delegate-mirrored advertisements.
 * Chunks B/C call setDelegateToolId when a station action delegates to an
 * existing tool; the advertisement then mirrors the delegate's capabilities,
 * risk, permission level, approval policy, and timeout.
 */
const DELEGATE_TOOL_IDS = new Map<string, string>();

export function setDelegateToolId(stationActionId: string, toolId: string): void {
  DELEGATE_TOOL_IDS.set(stationActionId, toolId);
}

export function getDelegateToolId(stationActionId: string): string | undefined {
  return DELEGATE_TOOL_IDS.get(stationActionId);
}

/** Long-running generations get a bigger budget. */
const LONG_RUNNING_ACTION_IDS = new Set(["video.generate", "music.generate"]);

function deriveToolName(actionId: string): string {
  return actionId
    .split(".")
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/**
 * Convert a zod args schema to JSON Schema for the tool definition.
 * Falls back to a generic object schema rather than breaking the sync —
 * honest failure at call time still applies (safeParse in the executor).
 */
function argsSchemaToJsonSchema(action: StationAction): Record<string, unknown> {
  try {
    const converted = z.toJSONSchema(action.argsSchema, { io: "input" }) as Record<string, unknown>;
    const { $schema: _ignored, ...rest } = converted;
    return { type: "object", ...rest };
  } catch (err) {
    console.warn(
      `[station-control] could not convert argsSchema for "${action.id}" to JSON Schema; using generic object schema`,
      err instanceof Error ? err.message : err,
    );
    return { type: "object" };
  }
}

export function stationActionToToolDefinition(action: StationAction): LiTTToolDefinition {
  const delegateId = DELEGATE_TOOL_IDS.get(action.id);
  const delegate = delegateId ? toolRegistry.get(delegateId) : undefined;

  let permissionKeySuffix: string[] = [];
  try {
    permissionKeySuffix = [stationToPermissionKey(action.station)];
  } catch {
    // Station with no permission key (no cataloged actions) — no permissions.
    permissionKeySuffix = [];
  }

  const risk: ToolRisk = delegate?.risk ?? (action.mutating ? "medium" : "low");
  const permissionLevel: ToolPermissionLevel =
    delegate?.permissionLevel ?? (action.mutating ? "workspace-write" : "read");
  const approvalPolicy: ApprovalPolicy = action.mutating
    ? (delegate?.approvalPolicy ?? STATION_MUTATION_APPROVAL)
    : STATION_READ_ONLY_APPROVAL;
  const timeoutMs =
    delegate?.timeoutMs ?? (LONG_RUNNING_ACTION_IDS.has(action.id) ? 600000 : 120000);

  return {
    id: action.id,
    name: deriveToolName(action.id),
    description: action.description,
    source: "internal",
    version: "1.0.0",
    inputSchema: argsSchemaToJsonSchema(action),
    outputSchema: { type: "object" },
    requiredCapabilities: delegate?.requiredCapabilities ?? [],
    requiredPermissions: delegate?.requiredPermissions ?? permissionKeySuffix,
    risk,
    permissionLevel,
    approvalPolicy,
    timeoutMs,
    idempotent: !action.mutating,
    readOnly: !action.mutating,
    enabled: true,
  };
}

/** Station action ids already synced into the tool registry (idempotent sync). */
const SYNCED_ACTION_IDS = new Set<string>();

/**
 * Register every station action as a tool-registry tool. Idempotent — safe
 * to call twice. On an id collision the existing tool keeps its
 * advertisement (additive, never clobbering the stabilized registry).
 */
export function syncStationActionsToToolRegistry(): void {
  for (const action of listStationActions()) {
    if (SYNCED_ACTION_IDS.has(action.id)) continue;
    if (toolRegistry.get(action.id)) {
      // Collision: the existing tool keeps its advertisement.
      SYNCED_ACTION_IDS.add(action.id);
      continue;
    }
    const def = stationActionToToolDefinition(action);
    const actionId = action.id;
    // NOTE: ToolRegistry.execute() invokes handlers as
    // handler(inputs, transport, { actionRunId, actionContext, userId }) —
    // the 3-arg form works at runtime but is not in register()'s declared
    // signature, so we cast. The extra params are received positionally.
    const handler = (
      inputs: Record<string, unknown>,
      transport: unknown,
      execCtx?: ToolExecutionContext,
    ): Promise<StationResult> => {
      // Chunk E: when the agent loop registered an event sink for this
      // run's transport, station execution events flow into the run's
      // Activity stream. Otherwise the default console-log emitEvent
      // applies (standalone / UI callers). Approval semantics untouched:
      // the loop pauses for approval BEFORE invoking this handler.
      const stationSink = getStationEventSink(transport);
      const ctx = buildStationContext({
        transport,
        actionContext: execCtx?.actionContext
          ? {
              userId: execCtx.actionContext.userId,
              projectId: execCtx.actionContext.projectId,
              actionRunId: execCtx.actionContext.actionRunId,
            }
          : undefined,
        userId: execCtx?.userId ?? execCtx?.actionContext?.userId ?? "unknown",
        // The agent loop pauses for approval BEFORE invoking this handler,
        // and toolRegistry.execute enforces requireExplicitForMutations —
        // approval has already been granted on this path.
        hasApproval: true,
        ...(stationSink ? { emitEvent: (event) => stationSink(event) } : {}),
      });
      return executeStationAction(actionId, inputs, ctx);
    };
    toolRegistry.register(
      def,
      handler as (inputs: Record<string, unknown>) => Promise<unknown>,
    );
    SYNCED_ACTION_IDS.add(action.id);
  }
}
