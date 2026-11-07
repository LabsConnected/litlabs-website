// @vitest-environment node
// Review probe: all provider/database boundaries are in-memory; no paid calls.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  caller: null as string | null,
  lookupError: false,
  writes: [] as Record<string, unknown>[],
  simulate: vi.fn(async () => "simulated response"),
  entitlement: vi.fn(async () => ({ allowed: false, reason: "plan_required" as string | undefined })),
  generate: vi.fn(),
  spend: vi.fn(),
  charge: vi.fn(),
  metered: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ userId: state.caller, clerkId: state.caller }) }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (handler: unknown) => handler }));
vi.mock("@/lib/llm", () => ({ generateText: state.generate, streamText: vi.fn() }));
vi.mock("@/lib/agent-entitlements", () => ({
  resolveAgentEntitlement: state.entitlement,
  chargeAgentRun: state.charge,
}));
vi.mock("@/lib/llm-billing", () => ({ chargeLlmUsage: vi.fn() }));
vi.mock("@/lib/metered-llm-call", () => ({ assertSpendAuthorized: state.spend, meteredLlmCall: state.metered }));
vi.mock("@/lib/studio/logger", () => ({ studioLog: vi.fn() }));
vi.mock("@/lib/agent-logger", () => ({ logAgentEvent: async () => undefined }));
vi.mock("@/lib/agents", () => ({
  AGENTS: { litt: { id: "litt", name: "LiTT" } },
  CONVERSATION_TOPERS: ["test topic"],
  orchestrator: {
    getAgent: () => ({ id: "litt", name: "LiTT" }),
    sendMessage: state.dispatch,
    simulateAgentResponse: state.simulate,
    getConversation: () => null,
  },
}));

const sessionId = "11111111-1111-4111-8111-111111111111";
const tasks = [{ id: "alice-task", session_id: sessionId, user_id: "alice", sequence_order: 1 }];
const jobs = [
  { conversation_id: "alice-conversation", user_id: "db-alice", topic: "alice private" },
  { conversation_id: "bob-conversation", user_id: "db-bob", topic: "bob private" },
];

function query(table: string) {
  const filters = new Map<string, unknown>();
  let isCount = false;
  let insertion: Record<string, unknown>[] | undefined;
  const rows = () => {
    const source: Record<string, unknown>[] = table === "users"
      ? [{ id: "db-alice", clerk_id: "alice" }, { id: "db-bob", clerk_id: "bob" }]
      : table === "orchestration_jobs" ? jobs : table === "agent_tasks" ? tasks : [];
    return source.filter(row => [...filters].every(([column, value]) => row[column] === value));
  };
  const result = () => ({ data: rows(), error: null, count: isCount ? rows().length : null });
  const builder = {
    select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
      isCount = Boolean(options?.count);
      return builder;
    },
    eq: (column: string, value: unknown) => { filters.set(column, value); return builder; },
    order: () => builder,
    limit: () => builder,
    filter: () => builder,
    update: (values: Record<string, unknown>) => { state.writes.push(values); return builder; },
    insert: (values: Record<string, unknown>[]) => { insertion = values; state.writes.push(...values); return builder; },
    single: async () => ({ data: insertion?.[0] ? { id: "new-task", ...insertion[0] } : rows()[0] ?? null, error: null }),
    maybeSingle: async () => state.lookupError && table === "agent_tasks"
      ? { data: null, error: { message: "transient ownership lookup failure" } }
      : { data: rows()[0] ?? null, error: null },
    then: <T>(resolve: (value: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve),
  };
  return builder;
}
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (table: string) => query(table) },
  getSupabaseAdmin: () => ({ from: (table: string) => query(table) }),
}));

import { POST as chat } from "@/app/api/chat/route";
import { POST as unified } from "@/app/api/chat/unified/route";
import { GET as logs } from "@/app/api/agents/logs/route";
import { GET as listJobs, POST as manageJob } from "@/app/api/orchestrate/route";
import { POST as createTask } from "@/app/api/agent-tasks/route";

function request(path: string, payload?: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, payload ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  } : undefined);
}
const agentPayload = { mode: "agent", from: "litt", to: "litt", message: "Review probe", simulateResponse: true };
const taskPayload = { sessionId, assignedTo: "litt", dispatcher: "litt", taskInput: { prompt: "Review probe", context: {}, agentSlug: "litt" } };

beforeEach(() => {
  state.caller = null;
  state.lookupError = false;
  state.writes = [];
  vi.clearAllMocks();
  state.entitlement.mockResolvedValue({ allowed: false, reason: "plan_required" });
  state.spend.mockResolvedValue({ ok: true, billingExempt: false });
  state.charge.mockResolvedValue({ error: null });
  state.metered.mockResolvedValue({ ok: true, result: { text: "authorized reply" } });
  state.dispatch.mockReturnValue({ id: "message" });
  vi.stubEnv("LITTLABS_VAPI_OWNER_CLERK_ID", "review-owner");
  vi.stubEnv("ADMIN_CLERK_IDS", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in security review"); }));
});

describe("#828 authentication and cross-user boundaries", () => {
  it.each([["chat", chat], ["unified", unified]] as const)("rejects anonymous %s agent spend before dispatch", async (_name, route) => {
    expect((await route(request("/api/chat", agentPayload))).status).toBe(401);
    expect(state.simulate).not.toHaveBeenCalled();
    expect(state.generate).not.toHaveBeenCalled();
  });
  it.each(["", "?type=commands"])("rejects anonymous and non-owner logs %s", async suffix => {
    for (const caller of [null, "bob"]) {
      state.caller = caller;
      expect((await logs(request(`/api/agents/logs${suffix}`))).status).toBe(403);
    }
  });
  it("allows the configured owner to read empty logs", async () => {
    state.caller = "review-owner";
    expect((await logs(request("/api/agents/logs"))).status).toBe(200);
  });
  it("rejects anonymous orchestration list and mutation", async () => {
    expect((await listJobs(request("/api/orchestrate"))).status).toBe(401);
    expect((await manageJob(request("/api/orchestrate", { action: "stop", conversationId: "alice-conversation" }))).status).toBe(401);
    expect(state.writes).toEqual([]);
  });
  it.each(["stop", "status"])("rejects cross-user orchestration %s", async action => {
    state.caller = "bob";
    expect((await manageJob(request("/api/orchestrate", { action, conversationId: "alice-conversation" }))).status).toBe(404);
    expect(state.writes).toEqual([]);
  });
  it("returns only the caller's orchestration jobs", async () => {
    state.caller = "bob";
    const response = await listJobs(request("/api/orchestrate"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.activeConversations.map((job: { id: string }) => job.id)).toEqual(["bob-conversation"]);
  });
  it("allows the owner to stop their conversation", async () => {
    state.caller = "alice";
    expect((await manageJob(request("/api/orchestrate", { action: "stop", conversationId: "alice-conversation" }))).status).toBe(200);
    expect(state.writes).toEqual([{ status: "paused" }]);
  });
  it("rejects anonymous task writes", async () => {
    expect((await createTask(request("/api/agent-tasks", taskPayload))).status).toBe(401);
    expect(state.writes).toEqual([]);
  });
  it("rejects cross-user task injection with existing rows", async () => {
    state.caller = "bob";
    expect((await createTask(request("/api/agent-tasks", taskPayload))).status).toBe(403);
    expect(state.writes).toEqual([]);
  });
  it("rejects malformed session UUID before writing", async () => {
    state.caller = "alice";
    expect((await createTask(request("/api/agent-tasks", { ...taskPayload, sessionId: "invalid" }))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
  it("permits a valid existing owner task", async () => {
    state.caller = "alice";
    expect((await createTask(request("/api/agent-tasks", taskPayload))).status).toBe(201);
  });
});

describe("security fault-injection regressions", () => {
  it("fails closed when session ownership lookup errors", async () => {
    state.caller = "bob";
    state.lookupError = true;
    expect.soft((await createTask(request("/api/agent-tasks", taskPayload))).status).toBe(500);
    expect(state.writes).toEqual([]);
  });
  it.each([["chat", chat], ["unified", unified]] as const)("meters and charges an entitled %s agent reply", async (_name, route) => {
    state.caller = "bob";
    state.entitlement.mockResolvedValue({ allowed: true, reason: undefined });
    const response = await route(request("/api/chat", { ...agentPayload, requestId: "request-123" }));
    expect(response.status).toBe(200);
    expect((await response.json()).received).toEqual({ id: "message" });
    expect(state.charge).toHaveBeenCalledWith({ clerkId: "bob", agentSlug: "litt", idempotencyKey: "agentrun:bob:litt:request-123" });
    expect(state.metered).toHaveBeenCalledWith(expect.objectContaining({ clerkId: "bob", feature: "agent-chat", callId: expect.any(String) }));
    expect(state.simulate).not.toHaveBeenCalled();
    expect(state.metered.mock.calls[0][0].callId).not.toBe("request-123");
  });
  it.each([["chat", chat], ["unified", unified]] as const)("blocks %s before dispatch when spend authorization fails", async (_name, route) => {
    state.caller = "bob";
    state.entitlement.mockResolvedValue({ allowed: true, reason: undefined });
    state.spend.mockResolvedValue({ ok: false, status: 402, error: "Insufficient LiTTBits", code: "insufficient_credits" });
    expect((await route(request("/api/chat", agentPayload))).status).toBe(402);
    expect(state.charge).not.toHaveBeenCalled();
    expect(state.metered).not.toHaveBeenCalled();
    expect(state.dispatch).not.toHaveBeenCalled();
  });
  it.each([["chat", chat], ["unified", unified]] as const)("blocks %s before model execution when agent debit fails", async (_name, route) => {
    state.caller = "bob";
    state.entitlement.mockResolvedValue({ allowed: true, reason: undefined });
    state.charge.mockResolvedValue({ error: "insufficient credits" });
    expect((await route(request("/api/chat", agentPayload))).status).toBe(402);
    expect(state.metered).not.toHaveBeenCalled();
    expect(state.dispatch).not.toHaveBeenCalled();
  });
  it.each([["chat", chat], ["unified", unified]] as const)("withholds %s response when final usage billing rejects it", async (_name, route) => {
    state.caller = "bob";
    state.entitlement.mockResolvedValue({ allowed: true, reason: undefined });
    state.metered.mockResolvedValue({ ok: false, status: 402, error: "Insufficient LiTTBits", code: "insufficient_credits" });
    expect((await route(request("/api/chat", agentPayload))).status).toBe(402);
    expect(state.dispatch).not.toHaveBeenCalled();
  });
  it.each([["chat", chat], ["unified", unified]] as const)("does not allow an unentitled user to buy-free simulate through %s agent mode", async (_name, route) => {
    state.caller = "bob";
    expect.soft((await route(request("/api/chat", agentPayload))).status).toBe(403);
    expect(state.simulate).not.toHaveBeenCalled();
  });
});
