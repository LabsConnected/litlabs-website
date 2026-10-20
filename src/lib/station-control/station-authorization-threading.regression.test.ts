// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from "vitest";
import { z } from "zod";

/**
 * Regression tests for Repair R1a-2 — station authorization threading
 * (Diagnosis E2 S4, ART-20261020-039).
 *
 * The defect: the station→tool bridge manufactured approval out of thin
 * air. advertise.ts built every station context with a hardcoded
 * `hasApproval: true`, and delegate.ts passed `hasApproval: true` into
 * the inner toolRegistry.execute. The registry's own approval backstop
 * therefore waved every delegated mutation through, and the station
 * executor's approval gate was dead code for delegated calls. The
 * safety of the composition rested entirely on the OUTER tool's
 * advertised policy mirroring the delegate's — an invariant, not a
 * mechanism (production proof: browser.navigate is a MUTATING station
 * action whose delegate-of-record is READ_ONLY, so an unapproved call
 * reaches a mutating action with manufactured approval).
 *
 * These tests reproduce that exact production shape — a mutating
 * station action with NO requiresApproval flag whose delegate-of-record
 * carries a lax (read-only) policy, delegating to a genuinely gated
 * mutation tool — and pin the repair:
 *   - invoked through toolRegistry.execute WITHOUT approval, the
 *     delegate must NOT execute (pre-fix: it executed, via the
 *     hardcoded true);
 *   - invoked WITH a genuine approval (the outer execute carried
 *     hasApproval:true from a real decision), it still executes;
 *   - the station executor itself refuses a mutating action whose
 *     context carries no approval.
 */

import { toolRegistry } from "../litt-intelligence/tool-registry";
import type { LiTTToolDefinition } from "../litt-intelligence/types";
import { registerStationAction } from "./registry";
import type { StationAction } from "./types";
import { setDelegateToolId, syncStationActionsToToolRegistry } from "./advertise";
import { delegateToTool } from "./delegate";
import { buildStationContext } from "./project-session";
import { executeStationAction } from "./executor";
import { stationResultSchema } from "./stations/creator-helpers";

// NOTE: the handler must declare a parameter — toolRegistry.execute
// treats a zero-arity handler entry as a lazy loader.
const mutationSpy = vi.fn(async (_inputs: Record<string, unknown>) => ({ written: true }));

function toolDef(partial: Partial<LiTTToolDefinition> & { id: string }): LiTTToolDefinition {
  return {
    name: partial.id,
    description: "regression test tool",
    source: "internal",
    version: "1.0.0",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    requiredCapabilities: [],
    requiredPermissions: [],
    risk: "medium",
    permissionLevel: "workspace-write",
    approvalPolicy: {
      required: false,
      autoApproveReadOnly: true,
      requireExplicitForMutations: false,
      neverAllow: false,
    },
    timeoutMs: 5000,
    idempotent: false,
    readOnly: false,
    enabled: true,
    ...partial,
  } as LiTTToolDefinition;
}

beforeAll(() => {
  // The genuinely gated mutation tool the station action delegates to
  // (files.write class: MUTATION_APPROVAL, requireExplicitForMutations).
  toolRegistry.register(
    toolDef({
      id: "testauth.mutate",
      readOnly: false,
      approvalPolicy: {
        required: true,
        autoApproveReadOnly: false,
        requireExplicitForMutations: true,
        neverAllow: false,
      },
    }),
    mutationSpy as never,
  );
  // The delegate-of-record used ONLY for policy mirroring — deliberately
  // lax, mirroring production browser.navigate (READ_ONLY delegate for a
  // mutating station action).
  toolRegistry.register(
    toolDef({
      id: "testauth.laxmirror",
      readOnly: true,
      risk: "low",
      permissionLevel: "read",
    }),
    (async (_inputs: Record<string, unknown>) => ({})) as never,
  );

  // The probe station action: mutating, NO requiresApproval flag — the
  // shape whose only protection was the (lax) mirrored policy.
  registerStationAction({
    station: "files",
    id: "files.threadprobe",
    label: "Thread probe",
    description: "Mutating station action delegating to a gated tool",
    argsSchema: z.object({ path: z.string() }),
    resultType: stationResultSchema,
    mutating: true,
    // delegateToTool is a factory: its return value IS the execute fn.
    execute: delegateToTool("testauth.mutate"),
    // The cast mirrors how production station modules register
    // delegate-backed actions (stations/files.ts).
  } as unknown as StationAction);
  setDelegateToolId("files.threadprobe", "testauth.laxmirror");
  syncStationActionsToToolRegistry();
});

describe("station authorization threading (R1a-2)", () => {
  it("does NOT execute the delegate when the outer registry call carried no approval", async () => {
    mutationSpy.mockClear();
    const outcome = await toolRegistry.execute(
      "files.threadprobe",
      { path: "probe.txt" },
      { hasApproval: false },
    );
    // Pre-fix: advertise hardcoded hasApproval:true into the station
    // context and delegate passed hasApproval:true to the inner
    // execute — the spy ran and the outcome was a successful write.
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable — asserted above");
    const stationResult = outcome.result as { success?: boolean; errorCode?: string };
    expect(stationResult.success).toBe(false);
    expect(stationResult.errorCode).toBe("approval_required");
  });

  it("still executes the delegate when the outer call carried a genuine approval", async () => {
    mutationSpy.mockClear();
    const outcome = await toolRegistry.execute(
      "files.threadprobe",
      { path: "probe.txt" },
      { hasApproval: true },
    );
    expect(mutationSpy).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable — asserted above");
    const stationResult = outcome.result as { success?: boolean };
    expect(stationResult.success).toBe(true);
  });

  it("the station executor itself refuses a mutating action whose context carries no approval", async () => {
    mutationSpy.mockClear();
    const refused = await executeStationAction(
      "files.threadprobe",
      { path: "probe.txt" },
      buildStationContext({ userId: "user-r1a" }),
    );
    // Pre-fix the executor's approval gate only fired for actions with
    // requiresApproval set; this action has none, so the delegate ran.
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(refused.success).toBe(false);
    expect(refused.errorCode).toBe("approval_required");

    const allowed = await executeStationAction(
      "files.threadprobe",
      { path: "probe.txt" },
      buildStationContext({ userId: "user-r1a", hasApproval: true }),
    );
    expect(mutationSpy).toHaveBeenCalledTimes(1);
    expect(allowed.success).toBe(true);
  });
});
