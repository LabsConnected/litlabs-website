// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/studio/conversations — empty-conversation reuse.
 *
 * A bare "New Chat" POST (no title) must focus an existing empty,
 * untitled conversation in the project instead of minting another
 * record. A POST with an explicit title always creates.
 */

const harness = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const tables: Record<string, Row[]> = {
    studio_conversations: [],
    studio_conversation_messages: [],
  };
  const state = { counter: 0 };

  function makeChain(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let orderSpec: { col: string; ascending: boolean } | null = null;
    let limitN: number | null = null;
    let pendingInsert: Row | null = null;
    let countMode = false;

    const resolveList = (): Row[] => {
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (orderSpec) {
        const { col, ascending } = orderSpec;
        rows = [...rows].sort((a, b) => {
          const av = (a[col] as string | null) ?? null;
          const bv = (b[col] as string | null) ?? null;
          if (av === bv) return 0;
          if (av === null) return ascending ? -1 : 1;
          if (bv === null) return ascending ? 1 : -1;
          return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return rows;
    };

    const settle = () => {
      if (pendingInsert) {
        const row: Row = {
          id: `${table}-${++state.counter}`,
          created_at: "2026-11-10T00:00:00Z",
          updated_at: "2026-11-10T00:00:00Z",
          ...pendingInsert,
        };
        (tables[table] ??= []).push(row);
        return { data: row, error: null, count: null };
      }
      if (countMode) return { data: null, error: null, count: resolveList().length };
      return { data: resolveList(), error: null, count: null };
    };

    const chain: Record<string, unknown> = {
      select(_cols?: unknown, opts?: { count?: string; head?: boolean }) {
        if (opts?.count) countMode = true;
        return chain;
      },
      insert(row: Row) {
        pendingInsert = row;
        return chain;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return chain;
      },
      is(col: string, val: unknown) {
        filters.push((r) => (r[col] ?? null) === val);
        return chain;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderSpec = { col, ascending: opts?.ascending !== false };
        return chain;
      },
      limit(n: number) {
        limitN = n;
        return chain;
      },
      single() {
        if (pendingInsert) return Promise.resolve(settle());
        return Promise.resolve({ data: resolveList()[0] ?? null, error: null, count: null });
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(settle()).then(onF, onR);
      },
    };
    return chain;
  }

  const db = { from: (table: string) => makeChain(table) };
  return { tables, state, db };
});

const { tables, state } = harness;

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: harness.db,
  getSupabaseAdmin: () => harness.db,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user-1" })),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: unknown) => handler,
}));

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(async (id: string) => ({ id })),
  listProjects: vi.fn(async () => ({ projects: [{ id: "proj-1" }], legacyOnly: [] })),
  createBlankProject: vi.fn(async () => ({ id: "proj-blank" })),
}));

vi.mock("@/lib/studio/project-resolver", () => ({
  resolveProject: vi.fn(async () => ({ id: "proj-1" })),
}));

import { POST } from "./route";

function postRequest(body: Record<string, unknown>): Request {
  return new Request("http://test.local/api/studio/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedConversation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: `conv-${++state.counter}`,
    owner_id: "user-1",
    project_id: "proj-1",
    title: null,
    active_agent_slug: "litt",
    active_agent_mode: "standard",
    agent_instance_id: null,
    revision: 1,
    created_at: "2026-11-10T00:00:00Z",
    updated_at: "2026-11-10T00:00:00Z",
    archived_at: null,
    ...overrides,
  };
  tables.studio_conversations.push(row);
  return row;
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  state.counter = 0;
});

describe("POST /api/studio/conversations — reuse", () => {
  it("returns the existing empty untitled conversation instead of creating one", async () => {
    const existing = seedConversation();

    const res = await POST(postRequest({ projectId: "proj-1" }) as never);
    const body = (await res.json()) as {
      conversation: { id: string };
      reused?: boolean;
    };

    expect(res.status).toBe(200);
    expect(body.reused).toBe(true);
    expect(body.conversation.id).toBe(existing.id);
    expect(tables.studio_conversations).toHaveLength(1);
  });

  it("creates a fresh conversation when none is reusable", async () => {
    const res = await POST(postRequest({ projectId: "proj-1" }) as never);
    const body = (await res.json()) as { conversation: { id: string } };

    expect(res.status).toBe(201);
    expect(body.conversation.id).toBeTruthy();
    expect(tables.studio_conversations).toHaveLength(1);
  });

  it("creates a fresh conversation when an explicit title is given", async () => {
    seedConversation();

    const res = await POST(
      postRequest({ projectId: "proj-1", title: "My new chat" }) as never,
    );

    expect(res.status).toBe(201);
    expect(tables.studio_conversations).toHaveLength(2);
  });
});
