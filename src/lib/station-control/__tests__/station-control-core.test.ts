/**
 * Station Control Bridge — registry core unit tests (chunk A).
 *
 * Uses dummy actions only. Does NOT import index.ts (station modules from
 * chunks B/C may not exist yet).
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  registerStationAction,
  getStationAction,
  getActionsForStation,
  listStationActions,
} from "../registry";
import { executeStationAction } from "../executor";
import {
  DEFAULT_PERMISSIONS,
  stationToPermissionKey,
  canMutateAction,
} from "../permissions";
import {
  buildStationContext,
  createProjectSession,
} from "../project-session";
import {
  stationActionToToolDefinition,
  syncStationActionsToToolRegistry,
  setDelegateToolId,
  STATION_READ_ONLY_APPROVAL,
  STATION_MUTATION_APPROVAL,
} from "../advertise";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import type {
  ExecutionEvent,
  StationAction,
  StationExecutionContext,
} from "../types";

let n = 0;
const uid = (prefix: string) => `${prefix}.${++n}`;

function makeAction(
  id: string,
  overrides: Partial<StationAction> = {},
): StationAction {
  const [station] = id.split(".");
  return {
    id,
    station: station as StationAction["station"],
    description: `Test action ${id}`,
    argsSchema: z.object({ name: z.string() }),
    resultType: z.object({ ok: z.boolean() }),
    mutating: false,
    execute: async (args) => ({ ok: true, name: (args as { name: string }).name }),
    ...overrides,
  };
}

function makeCtx(
  overrides: Partial<StationExecutionContext> = {},
): { ctx: StationExecutionContext; events: ExecutionEvent[]; navigations: string[] } {
  const events: ExecutionEvent[] = [];
  const navigations: string[] = [];
  const ctx = buildStationContext({
    userId: "user-test",
    emitEvent: (e) => events.push(e as ExecutionEvent),
    navigateToStation: (s) => navigations.push(s),
  });
  return { ctx: { ...ctx, ...overrides }, events, navigations };
}

describe("registry", () => {
  it("rejects duplicate action ids", () => {
    const id = uid("code");
    registerStationAction(makeAction(id));
    expect(() => registerStationAction(makeAction(id))).toThrow(/duplicate/i);
  });

  it("rejects id/station mismatch", () => {
    const action = makeAction(uid("code"));
    action.id = "browser.totally-wrong-station";
    expect(() => registerStationAction(action)).toThrow(/mismatch/i);
  });

  it("getActionsForStation filters by station", () => {
    const codeId = uid("code");
    const filesId = uid("files");
    registerStationAction(makeAction(codeId));
    registerStationAction(makeAction(filesId));
    const codeActions = getActionsForStation("code");
    expect(codeActions.some((a) => a.id === codeId)).toBe(true);
    expect(codeActions.some((a) => a.id === filesId)).toBe(false);
  });

  it("listStationActions includes registered actions", () => {
    const id = uid("preview");
    registerStationAction(makeAction(id));
    expect(listStationActions().some((a) => a.id === id)).toBe(true);
    expect(getStationAction("no.such.action")).toBeUndefined();
  });
});

describe("permissions", () => {
  it("DEFAULT_PERMISSIONS matches contract §7", () => {
    expect(DEFAULT_PERMISSIONS).toEqual({
      files: "allow",
      terminal: "allow",
      browser: "allow",
      git: "allow",
      create: "allow",
      preview: "allow",
      deploy: "ask",
      production: "ask",
      payments: "ask",
      externalPost: "ask",
      secrets: "deny",
    });
  });

  it("stationToPermissionKey maps stations", () => {
    expect(stationToPermissionKey("code")).toBe("files");
    expect(stationToPermissionKey("assets")).toBe("files");
    expect(stationToPermissionKey("canvas")).toBe("create");
    expect(stationToPermissionKey("image")).toBe("create");
    expect(stationToPermissionKey("preview")).toBe("preview");
    expect(stationToPermissionKey("browser")).toBe("browser");
    expect(stationToPermissionKey("checks")).toBe("terminal");
    expect(stationToPermissionKey("git")).toBe("git");
    expect(stationToPermissionKey("deploy")).toBe("deploy");
  });

  it("stationToPermissionKey throws for stations with no actions", () => {
    expect(() => stationToPermissionKey("plan")).toThrow(/no permission key/i);
    expect(() => stationToPermissionKey("memory")).toThrow(/no permission key/i);
    expect(() => stationToPermissionKey("design")).toThrow(/no permission key/i);
  });

  it("canMutateAction allows reads regardless of permissions", () => {
    const read = makeAction(uid("files"), { mutating: false });
    expect(canMutateAction(read, { ...DEFAULT_PERMISSIONS, files: "deny" })).toBe(true);
  });

  it("canMutateAction requires allow for mutations", () => {
    const write = makeAction(uid("files"), { mutating: true });
    expect(canMutateAction(write, DEFAULT_PERMISSIONS)).toBe(true);
    expect(canMutateAction(write, { ...DEFAULT_PERMISSIONS, files: "ask" })).toBe(false);
    expect(canMutateAction(write, { ...DEFAULT_PERMISSIONS, files: "deny" })).toBe(false);
  });
});

describe("executor", () => {
  it("returns unknown_action for unregistered ids (never throws)", async () => {
    const { ctx } = makeCtx();
    const res = await executeStationAction("nope.not.real", {}, ctx);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errorCode).toBe("unknown_action");
      expect(res.error).toContain("nope.not.real");
    }
  });

  it("returns invalid_args on zod failure with details", async () => {
    const id = uid("files");
    registerStationAction(makeAction(id));
    const { ctx } = makeCtx();
    const res = await executeStationAction(id, { name: 42 }, ctx);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errorCode).toBe("invalid_args");
      expect(res.error).toContain(id);
    }
  });

  it("denies mutations in PLAN mode", async () => {
    const id = uid("files");
    registerStationAction(makeAction(id, { mutating: true }));
    const { ctx, events } = makeCtx({ missionMode: "plan" });
    const res = await executeStationAction(id, { name: "x" }, ctx);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.errorCode).toBe("permission_denied");
    expect(events.some((e) => e.type === "action_started")).toBe(false);
  });

  it("denies mutations when the permission is not allow", async () => {
    const id = uid("terminal");
    registerStationAction(makeAction(id, { mutating: true }));
    const { ctx } = makeCtx({
      permissions: { ...DEFAULT_PERMISSIONS, terminal: "deny" },
    });
    const res = await executeStationAction(id, { name: "x" }, ctx);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.errorCode).toBe("permission_denied");
  });

  it("requiresApproval without hasApproval emits approval_required and does not execute", async () => {
    const id = uid("files");
    const execute = vi.fn(async () => ({ ok: true }));
    registerStationAction(makeAction(id, { mutating: true, requiresApproval: true, execute }));
    const { ctx, events } = makeCtx();
    const res = await executeStationAction(id, { name: "x" }, ctx);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.errorCode).toBe("approval_required");
    expect(execute).not.toHaveBeenCalled();
    const gate = events.find((e) => e.type === "approval_required");
    expect(gate).toBeDefined();
    expect(gate?.actionId).toBe(id);
  });

  it("requiresApproval with hasApproval executes", async () => {
    const id = uid("files");
    registerStationAction(
      makeAction(id, { mutating: true, requiresApproval: true }),
    );
    const { ctx, events } = makeCtx({ hasApproval: true });
    const res = await executeStationAction(id, { name: "x" }, ctx);
    expect(res.success).toBe(true);
    expect(events.some((e) => e.type === "approval_required")).toBe(false);
  });

  it("honest execution failure returns success:false and emits action_failed", async () => {
    const id = uid("browser");
    registerStationAction(
      makeAction(id, {
        execute: async () => {
          throw new Error("boom: provider down");
        },
      }),
    );
    const { ctx, events } = makeCtx();
    const res = await executeStationAction(id, { name: "x" }, ctx);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errorCode).toBe("execution_failed");
      expect(res.error).toContain("boom: provider down");
    }
    const failed = events.find((e) => e.type === "action_failed");
    expect(failed).toBeDefined();
    expect(failed?.error).toContain("boom: provider down");
  });

  it("emits action_started before action_completed", async () => {
    const id = uid("preview");
    registerStationAction(makeAction(id));
    const { ctx, events, navigations } = makeCtx();
    const res = await executeStationAction(id, { name: "x" }, ctx);
    expect(res.success).toBe(true);
    const types = events.map((e) => e.type);
    expect(types).toEqual(["action_started", "action_completed"]);
    expect(navigations).toEqual(["preview"]);
  });

  it("navigateToStation failure does not break execution", async () => {
    const id = uid("code");
    registerStationAction(makeAction(id));
    const { ctx } = makeCtx({
      navigateToStation: () => {
        throw new Error("presenter exploded");
      },
    });
    const res = await executeStationAction(id, { name: "x" }, ctx);
    expect(res.success).toBe(true);
  });

  it("normalizes results: success-flagged objects pass through, others wrapped", async () => {
    const passthroughId = uid("git");
    registerStationAction(
      makeAction(passthroughId, {
        execute: async () => ({ success: false, error: "nested", errorCode: "not_implemented" }),
      }),
    );
    const { ctx } = makeCtx();
    const nested = await executeStationAction(passthroughId, { name: "x" }, ctx);
    expect(nested).toEqual({ success: false, error: "nested", errorCode: "not_implemented" });

    const plainId = uid("git");
    registerStationAction(makeAction(plainId, { execute: async () => ({ path: "/a" }) }));
    const plain = await executeStationAction(plainId, { name: "x" }, ctx);
    expect(plain).toEqual({ success: true, path: "/a" });
  });
});

describe("project-session", () => {
  it("createProjectSession builds contract §8 shape", () => {
    const s = createProjectSession({ userId: "u1", projectId: "p1" });
    expect(s.userId).toBe("u1");
    expect(s.projectId).toBe("p1");
    expect(s.workspace.station).toBe("plan");
    expect(s.permissions).toEqual(DEFAULT_PERMISSIONS);
    expect(s.terminalSessions).toEqual([]);
    expect(s.generatedAssets).toEqual([]);
  });

  it("buildStationContext defaults: warn-log emitEvent, no-op navigation, live_state via emitEvent", () => {
    const ctx = buildStationContext({ userId: "u1" });
    expect(ctx.missionMode).toBe("act");
    expect(ctx.permissions).toEqual(DEFAULT_PERMISSIONS);
    expect(ctx.hasApproval).toBe(false);
    // navigateToStation default is a headless no-op and must not throw.
    expect(() => ctx.navigateToStation("browser")).not.toThrow();
    // reportLiveState default must NOT be a no-op (§19.2).
    const seen: ExecutionEvent[] = [];
    const ctx2 = buildStationContext({
      userId: "u1",
      emitEvent: (e) => seen.push(e as ExecutionEvent),
    });
    ctx2.reportLiveState({ foo: "bar" });
    const live = seen.find((e) => e.type === "live_state");
    expect(live).toBeDefined();
    expect(live?.resultSummary).toContain("bar");
  });
});

describe("advertise", () => {
  it("stationActionToToolDefinition produces all required LiTTToolDefinition fields", () => {
    const action = makeAction(uid("image"), {
      argsSchema: z.object({
        prompt: z.string(),
        count: z.number().optional(),
        style: z.enum(["photo", "anime"]),
      }),
      mutating: true,
      requiresApproval: true,
    });
    const def = stationActionToToolDefinition(action);
    expect(def.id).toBe(action.id);
    expect(def.name).toBeTruthy();
    expect(def.description).toBe(action.description);
    expect(def.source).toBe("internal");
    expect(def.version).toBe("1.0.0");
    expect(def.inputSchema.type).toBe("object");
    expect(def.outputSchema).toEqual({ type: "object" });
    expect(def.requiredCapabilities).toEqual([]);
    expect(def.risk).toBe("medium");
    expect(def.permissionLevel).toBe("workspace-write");
    expect(def.approvalPolicy).toEqual(STATION_MUTATION_APPROVAL);
    expect(def.timeoutMs).toBe(120000);
    expect(def.idempotent).toBe(false);
    expect(def.readOnly).toBe(false);
    expect(def.enabled).toBe(true);
  });

  it("inputSchema required[] matches zod required keys", () => {
    const action = makeAction(uid("audio"), {
      argsSchema: z.object({
        prompt: z.string(),
        negativePrompt: z.string().optional(),
        duration: z.number(),
      }),
    });
    const def = stationActionToToolDefinition(action);
    const schema = def.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required?.sort()).toEqual(["duration", "prompt"]);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "duration",
      "negativePrompt",
      "prompt",
    ]);
  });

  it("read actions get read-only policy and low risk", () => {
    const action = makeAction(uid("files"), { mutating: false });
    const def = stationActionToToolDefinition(action);
    expect(def.approvalPolicy).toEqual(STATION_READ_ONLY_APPROVAL);
    expect(def.risk).toBe("low");
    expect(def.permissionLevel).toBe("read");
    expect(def.readOnly).toBe(true);
    expect(def.idempotent).toBe(true);
  });

  it("video.generate and music.generate get the long timeout", () => {
    expect(stationActionToToolDefinition(makeAction("video.generate", { mutating: true })).timeoutMs).toBe(600000);
    expect(stationActionToToolDefinition(makeAction("music.generate", { mutating: true })).timeoutMs).toBe(600000);
    expect(stationActionToToolDefinition(makeAction("code.search")).timeoutMs).toBe(120000);
  });

  it("syncStationActionsToToolRegistry is idempotent and skips collisions", () => {
    const id = uid("checks");
    registerStationAction(makeAction(id));
    // Pre-register a colliding tool: the existing tool must keep its ad.
    const existing = {
      id,
      name: "Existing",
      description: "pre-existing tool",
      source: "internal" as const,
      version: "0.0.1",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredCapabilities: [],
      requiredPermissions: [],
      risk: "low" as const,
      permissionLevel: "read" as const,
      approvalPolicy: STATION_READ_ONLY_APPROVAL,
      timeoutMs: 1000,
      idempotent: true,
      readOnly: true,
      enabled: true,
    };
    toolRegistry.register(existing);
    syncStationActionsToToolRegistry();
    syncStationActionsToToolRegistry();
    expect(toolRegistry.get(id)?.description).toBe("pre-existing tool");

    const freshId = uid("deploy");
    registerStationAction(makeAction(freshId, { mutating: true }));
    syncStationActionsToToolRegistry();
    const def = toolRegistry.get(freshId);
    expect(def?.description).toContain(freshId);
    expect(def?.source).toBe("internal");
  });

  it("delegate mirror: setDelegateToolId copies delegate capabilities/policy", () => {
    const delegateId = "delegate.tool.probe";
    toolRegistry.register({
      id: delegateId,
      name: "Delegate probe",
      description: "probe",
      source: "internal",
      version: "1.0.0",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredCapabilities: ["browser_beta"],
      requiredPermissions: ["browser"],
      risk: "high",
      permissionLevel: "external-write",
      approvalPolicy: STATION_MUTATION_APPROVAL,
      timeoutMs: 45000,
      idempotent: false,
      readOnly: false,
      enabled: true,
    });
    const actionId = uid("browser");
    setDelegateToolId(actionId, delegateId);
    const def = stationActionToToolDefinition(makeAction(actionId, { mutating: true }));
    expect(def.requiredCapabilities).toEqual(["browser_beta"]);
    expect(def.risk).toBe("high");
    expect(def.permissionLevel).toBe("external-write");
    expect(def.timeoutMs).toBe(45000);
  });
});
