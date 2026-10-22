// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests for Repair R1a-1 — /api/litt/browser/execute trusted a
 * client-supplied approval flag (Diagnosis E2 S1, ART-20261020-039).
 *
 * The defect: the route read `body.hasApproval === true` and passed it
 * straight into toolRegistry.execute, so the seven MUTATION_APPROVAL
 * browser tools (click/type/select/scroll/press/upload/download) executed
 * on a self-asserted boolean — no paused-run record, no decision, no
 * audit. The exemplary /api/litt/tools/execute route never honors a
 * client flag: approval-gated tools record a pending execution and
 * return 202; everything else executes with hasApproval:false.
 *
 * These tests pin the browser route to the same contract: a mutation
 * tool is NEVER executed from this endpoint, with or without a client
 * "hasApproval": true — it gets the pending/202 treatment instead.
 * Non-gated tools keep executing exactly as before.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user_1" })),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: unknown) => handler,
}));

// No Supabase in tests: the pending-execution record insert is guarded on
// supabaseAdmin being present (same convention as tools/execute).
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: null,
}));

// The registry's browser-runtime bookkeeping is not under test here; the
// session simply has no attached action run.
vi.mock("@/lib/action-runtime/browser-runtime", () => ({
  resolveBrowserActionRun: vi.fn(async () => null),
  recordBrowserToolStarted: vi.fn(async () => undefined),
  recordBrowserToolCompleted: vi.fn(async () => undefined),
  recordBrowserToolFailed: vi.fn(async () => undefined),
  markBrowserRunPersistenceDegraded: vi.fn(async () => undefined),
}));

import { POST } from "./route";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import type { LiTTToolDefinition } from "@/lib/litt-intelligence/types";

// NOTE: handlers must declare a parameter — toolRegistry.execute treats
// a zero-arity handler entry as a lazy loader and calls it as a factory.
const mutationSpy = vi.fn(async (_inputs: Record<string, unknown>) => ({ clicked: true }));
const readSpy = vi.fn(async (_inputs: Record<string, unknown>) => ({ title: "Example" }));

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
  // A MUTATION_APPROVAL browser tool, standing in for browser.click &
  // family (the real ones are registered the same way).
  toolRegistry.register(
    toolDef({
      id: "browser.testclick",
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
  // A read-only browser tool (browser.snapshot class) — never gated.
  toolRegistry.register(
    toolDef({
      id: "browser.testread",
      readOnly: true,
      risk: "low",
      permissionLevel: "read",
    }),
    readSpy as never,
  );
});

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/litt/browser/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/litt/browser/execute — client approval flag is never honored (R1a-1)", () => {
  it("does NOT execute a mutation tool even when the client asserts hasApproval:true", async () => {
    mutationSpy.mockClear();
    const res = await POST(
      makeRequest({
        sessionId: "sess-1",
        toolId: "browser.testclick",
        inputs: {},
        hasApproval: true,
      }),
    );
    // On the unmodified tree this fails twice over: the route passed the
    // client's boolean into the registry, the handler ran, and the
    // response was 200 { success: true, data: { clicked: true } }.
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(202);
    const body = (await res.json()) as { requiresApproval?: boolean; toolId?: string };
    expect(body.requiresApproval).toBe(true);
    expect(body.toolId).toBe("browser.testclick");
  });

  it("gives a mutation tool the pending/202 treatment without any client flag too", async () => {
    mutationSpy.mockClear();
    const res = await POST(
      makeRequest({ sessionId: "sess-1", toolId: "browser.testclick", inputs: {} }),
    );
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(202);
  });

  it("still executes a non-gated read-only browser tool (contract unchanged)", async () => {
    readSpy.mockClear();
    const res = await POST(
      makeRequest({ sessionId: "sess-1", toolId: "browser.testread", inputs: {} }),
    );
    expect(res.status).toBe(200);
    expect(readSpy).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { success?: boolean; data?: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ title: "Example" });
  });
});
