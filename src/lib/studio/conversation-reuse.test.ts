// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Empty-conversation hygiene (route-honesty follow-up to the 2026-11-10
 * Sudsy diagnosis §5): "New Chat" / "New worktab" used to mint a brand-new
 * conversation record on every click, so stray clicks permanently piled
 * up empty "Untitled conversation" entries. Creation now reuses an
 * existing empty, untitled conversation in the same project (focusing it
 * instead of creating another record). Nothing is deleted or migrated —
 * reuse only avoids NEW duplicates.
 *
 * The Supabase stub below is an in-memory PostgREST chain covering the
 * exact query shapes conversation-service + task-service use here. It
 * lives in vi.hoisted so the vi.mock factories can reference it.
 */

const harness = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const tables: Record<string, Row[]> = {
    studio_conversations: [],
    studio_conversation_messages: [],
    studio_tasks: [],
    action_runs: [],
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
      update() {
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
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
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
      maybeSingle() {
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

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(async (id: string) => ({ id })),
}));

vi.mock("@/lib/studio/project-resolver", () => ({
  resolveProject: vi.fn(async () => ({ id: "proj-1" })),
}));

import {
  findReusableEmptyConversation,
  isPlaceholderConversationTitle,
} from "./conversation-service";
import { createStudioTask } from "./task-service";

const USER = "user-1";
const PROJECT = "proj-1";

function seedConversation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: `conv-${++state.counter}`,
    owner_id: USER,
    project_id: PROJECT,
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

function seedMessage(conversationId: string): void {
  tables.studio_conversation_messages.push({
    id: `msg-${++state.counter}`,
    conversation_id: conversationId,
    owner_id: USER,
    project_id: PROJECT,
    role: "user",
    content: "hello",
    status: "completed",
    created_at: "2026-11-10T00:00:00Z",
    updated_at: "2026-11-10T00:00:00Z",
  });
}

function seedTask(conversationId: string | null, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: `task-${++state.counter}`,
    user_id: USER,
    project_id: PROJECT,
    title: "New conversation",
    task_type: "general",
    status: "ready",
    conversation_id: conversationId,
    active_action_run_id: null,
    latest_action_run_id: null,
    browser_session_id: null,
    preview_workspace_id: null,
    preview_url: null,
    selected_artifact: null,
    verification_state: {},
    metadata: {},
    last_opened_surface: "studio",
    last_opened_at: "2026-11-10T00:00:00Z",
    archived_at: null,
    created_at: "2026-11-10T00:00:00Z",
    updated_at: "2026-11-10T00:00:00Z",
    ...overrides,
  };
  tables.studio_tasks.push(row);
  return row;
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  state.counter = 0;
});

describe("isPlaceholderConversationTitle", () => {
  it("treats null, blank, and the eager default as placeholder titles", () => {
    expect(isPlaceholderConversationTitle(null)).toBe(true);
    expect(isPlaceholderConversationTitle("")).toBe(true);
    expect(isPlaceholderConversationTitle("   ")).toBe(true);
    expect(isPlaceholderConversationTitle("New conversation")).toBe(true);
  });

  it("never treats a real title as a placeholder", () => {
    expect(isPlaceholderConversationTitle("Sudsy Paws")).toBe(false);
    expect(isPlaceholderConversationTitle("Voice call — 11/10/2026")).toBe(false);
  });
});

describe("findReusableEmptyConversation", () => {
  it("returns null when the project has no conversations", async () => {
    await expect(findReusableEmptyConversation(USER, PROJECT)).resolves.toBeNull();
  });

  it("finds an empty untitled conversation", async () => {
    const conv = seedConversation();
    const found = await findReusableEmptyConversation(USER, PROJECT);
    expect(found?.id).toBe(conv.id);
  });

  it("skips titled conversations, even empty ones", async () => {
    seedConversation({ title: "Sudsy Paws" });
    await expect(findReusableEmptyConversation(USER, PROJECT)).resolves.toBeNull();
  });

  it("skips untitled conversations that already have messages", async () => {
    const conv = seedConversation();
    seedMessage(conv.id as string);
    await expect(findReusableEmptyConversation(USER, PROJECT)).resolves.toBeNull();
  });

  it("skips archived conversations", async () => {
    seedConversation({ archived_at: "2026-11-10T01:00:00Z" });
    await expect(findReusableEmptyConversation(USER, PROJECT)).resolves.toBeNull();
  });

  it("prefers the most recently updated empty conversation", async () => {
    seedConversation({ id: "conv-old", updated_at: "2026-11-10T00:00:00Z" });
    seedConversation({ id: "conv-new", updated_at: "2026-11-10T02:00:00Z" });
    const found = await findReusableEmptyConversation(USER, PROJECT);
    expect(found?.id).toBe("conv-new");
  });

  it("respects the requested agent slug (surface separation)", async () => {
    seedConversation({ active_agent_slug: "spark" });
    await expect(
      findReusableEmptyConversation(USER, PROJECT, { activeAgentSlug: "litt" }),
    ).resolves.toBeNull();
    const found = await findReusableEmptyConversation(USER, PROJECT, {
      activeAgentSlug: "spark",
    });
    expect(found).not.toBeNull();
  });

  it("does not leak another owner's or project's conversations", async () => {
    seedConversation({ owner_id: "someone-else" });
    seedConversation({ project_id: "other-project" });
    await expect(findReusableEmptyConversation(USER, PROJECT)).resolves.toBeNull();
  });
});

describe("createStudioTask — empty-conversation reuse", () => {
  it("returns the existing open task instead of minting another empty conversation", async () => {
    const conv = seedConversation();
    const existing = seedTask(conv.id as string);

    const task = await createStudioTask(USER, {
      projectId: PROJECT,
      title: "New conversation",
      taskType: "general",
    });

    expect(task?.id).toBe(existing.id);
    expect(task?.conversationId).toBe(conv.id);
    // No new records of either kind.
    expect(tables.studio_tasks).toHaveLength(1);
    expect(tables.studio_conversations).toHaveLength(1);
  });

  it("binds a fresh task to an existing task-less empty conversation", async () => {
    const conv = seedConversation();

    const task = await createStudioTask(USER, {
      projectId: PROJECT,
      title: "New conversation",
      taskType: "general",
    });

    expect(task?.conversationId).toBe(conv.id);
    expect(tables.studio_tasks).toHaveLength(1);
    // The conversation was reused, not duplicated.
    expect(tables.studio_conversations).toHaveLength(1);
  });

  it("creates a new conversation when the existing untitled one has messages", async () => {
    const conv = seedConversation();
    seedTask(conv.id as string);
    seedMessage(conv.id as string);

    const task = await createStudioTask(USER, {
      projectId: PROJECT,
      title: "New conversation",
      taskType: "general",
    });

    expect(task?.conversationId).not.toBe(conv.id);
    expect(tables.studio_tasks).toHaveLength(2);
    expect(tables.studio_conversations).toHaveLength(2);
  });

  it("does not reuse a closed task's conversation binding", async () => {
    const conv = seedConversation();
    seedTask(conv.id as string, { archived_at: "2026-11-10T03:00:00Z" });

    const task = await createStudioTask(USER, {
      projectId: PROJECT,
      title: "New conversation",
      taskType: "general",
    });

    // The empty conversation is reused, but as a NEW open task — the
    // closed task stays closed and untouched.
    expect(task?.conversationId).toBe(conv.id);
    expect(task?.status).not.toBe("closed");
    expect(tables.studio_tasks).toHaveLength(2);
    expect(tables.studio_conversations).toHaveLength(1);
  });
});
