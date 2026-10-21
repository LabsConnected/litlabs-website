// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/**
 * Regression tests for Repair R5-A — deploy.production authorization
 * (live staging failure, 2026-10-20, Harbor Coffee acceptance run).
 *
 * The defect: the station executor ran its permission gate BEFORE the
 * approval gate and treated the deploy station's default permission
 * ("ask") as a hard denial. An explicitly approved publish therefore
 * died with `Permission denied: "deploy.production" mutates the deploy
 * station and the permission is not allow` — the granted approval was
 * never consulted. The build-time deploy in the same session succeeded
 * only because it bypassed the station executor entirely (the agent
 * called the project.deploy tool directly, through the loop's own
 * permission/approval flow).
 *
 * The repair evaluates the permission WITH the approval state
 * (evaluateMutationAuthorization): "ask" defers to the approval gate —
 * with a genuine approval the permission is satisfied; without one the
 * answer is approval_required, not a dead-end denial. "deny" remains a
 * hard denial that no approval overrides, and "allow" never waives the
 * approval gate for a gated action.
 *
 * These tests drive the REAL registered deploy.production /
 * deploy.preview station actions (station: deploy, mutating,
 * requiresApproval) with the REAL default permissions. Only the
 * delegate tool (project.deploy) is stubbed, with the real tool's
 * approval policy, so execution attempts are observable without I/O.
 */

/* Same hermeticity mocks as station-acceptance.test.ts. */
vi.mock("@/lib/litt-intelligence/llm-tool-calling", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/alibaba-video", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isAlibabaConfigured: () => false,
}));

/* Registers all station actions. Does NOT advertise them. */
import "./index";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import type { LiTTToolDefinition } from "@/lib/litt-intelligence/types";
import { executeStationAction } from "./executor";
import { buildStationContext } from "./project-session";
import { DEFAULT_PERMISSIONS, evaluateMutationAuthorization } from "./permissions";
import { getStationAction } from "./registry";

const deploySpy = vi.fn(async (_inputs: Record<string, unknown>) => ({
  publicUrl: "https://example.invalid/sites/stub/",
}));

beforeAll(() => {
  // Stub the delegate target with the REAL project.deploy definition's
  // policy shape (MUTATION_APPROVAL, high risk, workspace-write): the
  // gate logic under test is the executor's, the deploy I/O is not.
  toolRegistry.register(
    {
      id: "project.deploy",
      name: "Deploy Project",
      description: "R5-A regression stub for the deploy delegate",
      source: "internal",
      version: "1.0.0",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object" },
      requiredCapabilities: [],
      requiredPermissions: ["deploy:create"],
      risk: "high",
      permissionLevel: "workspace-write",
      approvalPolicy: {
        required: true,
        autoApproveReadOnly: false,
        requireExplicitForMutations: true,
        neverAllow: false,
      },
      timeoutMs: 5000,
      idempotent: false,
      readOnly: false,
      enabled: true,
    } as LiTTToolDefinition,
    deploySpy as never,
  );
});

beforeEach(() => {
  deploySpy.mockClear();
});

describe("R5-A: deploy station authorization (executor)", () => {
  it("the real deploy.production action is registered mutating + approval-gated on the deploy station", () => {
    const action = getStationAction("deploy.production");
    expect(action).toBeDefined();
    expect(action?.station).toBe("deploy");
    expect(action?.mutating).toBe(true);
    expect(action?.requiresApproval).toBe(true);
    // The default permission for the deploy station is "ask" — the
    // level the old executor misread as a denial.
    expect(DEFAULT_PERMISSIONS.deploy).toBe("ask");
  });

  it("(1) an APPROVED publish executes under the default 'ask' permission", async () => {
    const result = await executeStationAction(
      "deploy.production",
      { environment: "production" },
      buildStationContext({ userId: "user-r5a", hasApproval: true }),
    );
    // Pre-fix: success=false, errorCode="permission_denied" — the exact
    // live failure. The approval was never consulted.
    expect(deploySpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("(2) an UNAPPROVED publish is refused with approval_required — not executed, not a dead-end denial", async () => {
    const result = await executeStationAction(
      "deploy.production",
      { environment: "production" },
      buildStationContext({ userId: "user-r5a", hasApproval: false }),
    );
    expect(deploySpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("approval_required");
  });

  it("(3) a missing (deny) permission refuses the publish outright", async () => {
    const result = await executeStationAction(
      "deploy.production",
      { environment: "production" },
      buildStationContext({
        userId: "user-r5a",
        hasApproval: false,
        permissions: { ...DEFAULT_PERMISSIONS, deploy: "deny" },
      }),
    );
    expect(deploySpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("permission_denied");
  });

  it("(4) a granted approval does NOT override a 'deny' permission", async () => {
    const result = await executeStationAction(
      "deploy.production",
      { environment: "production" },
      buildStationContext({
        userId: "user-r5a",
        hasApproval: true,
        permissions: { ...DEFAULT_PERMISSIONS, deploy: "deny" },
      }),
    );
    expect(deploySpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("permission_denied");
  });

  it("(5) 'allow' permission never waives the approval gate for a gated action", async () => {
    const result = await executeStationAction(
      "deploy.production",
      { environment: "production" },
      buildStationContext({
        userId: "user-r5a",
        hasApproval: false,
        permissions: { ...DEFAULT_PERMISSIONS, deploy: "allow" },
      }),
    );
    expect(deploySpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("approval_required");
  });

  it("(6) PLAN mode refuses an approved publish", async () => {
    const result = await executeStationAction(
      "deploy.production",
      { environment: "production" },
      buildStationContext({ userId: "user-r5a", hasApproval: true, missionMode: "plan" }),
    );
    expect(deploySpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("permission_denied");
  });

  it("(7) an approved deploy.preview executes through the same wiring", async () => {
    const result = await executeStationAction(
      "deploy.preview",
      {},
      buildStationContext({ userId: "user-r5a", hasApproval: true }),
    );
    expect(deploySpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("(8) retry cannot bypass: a refused attempt followed by an approved one executes exactly once", async () => {
    const refused = await executeStationAction(
      "deploy.production",
      { environment: "production" },
      buildStationContext({ userId: "user-r5a", hasApproval: false }),
    );
    expect(refused.success).toBe(false);
    const approved = await executeStationAction(
      "deploy.production",
      { environment: "production" },
      buildStationContext({ userId: "user-r5a", hasApproval: true }),
    );
    expect(approved.success).toBe(true);
    expect(deploySpy).toHaveBeenCalledTimes(1);
  });
});

describe("R5-A: evaluateMutationAuthorization matrix", () => {
  const action = { station: "deploy", mutating: true } as never;

  it("allow → allowed with or without approval", () => {
    const perms = { ...DEFAULT_PERMISSIONS, deploy: "allow" as const };
    expect(evaluateMutationAuthorization(action, perms, false).allowed).toBe(true);
    expect(evaluateMutationAuthorization(action, perms, true).allowed).toBe(true);
  });

  it("ask → approval_required without approval, allowed with a genuine approval", () => {
    const perms = { ...DEFAULT_PERMISSIONS, deploy: "ask" as const };
    expect(evaluateMutationAuthorization(action, perms, false)).toEqual({
      allowed: false,
      reason: "approval_required",
    });
    expect(evaluateMutationAuthorization(action, perms, true).allowed).toBe(true);
  });

  it("deny → denied with or without approval", () => {
    const perms = { ...DEFAULT_PERMISSIONS, deploy: "deny" as const };
    expect(evaluateMutationAuthorization(action, perms, false)).toEqual({
      allowed: false,
      reason: "denied",
    });
    expect(evaluateMutationAuthorization(action, perms, true)).toEqual({
      allowed: false,
      reason: "denied",
    });
  });

  it("a non-mutating action is always allowed", () => {
    const readOnly = { station: "deploy", mutating: false } as never;
    const perms = { ...DEFAULT_PERMISSIONS, deploy: "deny" as const };
    expect(evaluateMutationAuthorization(readOnly, perms, false).allowed).toBe(true);
  });

  it("an UNRECOGNIZED permission level is denied — fail closed, approval does not rescue it", () => {
    const perms = { ...DEFAULT_PERMISSIONS, deploy: "sometimes" as never };
    expect(evaluateMutationAuthorization(action, perms, false)).toEqual({
      allowed: false,
      reason: "denied",
    });
    expect(evaluateMutationAuthorization(action, perms, true)).toEqual({
      allowed: false,
      reason: "denied",
    });
  });

  it("a station with NO permission key is denied — fail closed, approval does not rescue it", () => {
    // "plan" (like memory/design/game/voice/camera) has no registered
    // permission key: stationToPermissionKey throws, and the evaluation
    // must turn that into a denial, never an allow.
    const unmapped = { station: "plan", mutating: true } as never;
    expect(evaluateMutationAuthorization(unmapped, DEFAULT_PERMISSIONS, false)).toEqual({
      allowed: false,
      reason: "denied",
    });
    expect(evaluateMutationAuthorization(unmapped, DEFAULT_PERMISSIONS, true)).toEqual({
      allowed: false,
      reason: "denied",
    });
  });
});
