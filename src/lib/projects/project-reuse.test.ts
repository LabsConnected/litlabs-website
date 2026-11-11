// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Empty-project reuse on Studio Website entry (follow-up to
 * ART-20261111-021 item 5b): every `?creator=website` entry used to mint
 * a brand-new blank "New Website" project, so repeat entries piled up
 * identical untouched projects. Entry now reuses an existing UNTOUCHED
 * blank project of the same name + template instead — the project-level
 * equivalent of findReusableEmptyConversation. "Untouched" is proven,
 * not assumed: the name never changed, and the project has zero
 * conversation messages, zero tasks, zero agent runs, and zero
 * deployments. Any doubt (a count query error) counts as touched —
 * never reuse on uncertainty.
 *
 * The Supabase stub below is an in-memory PostgREST chain covering the
 * exact query shapes project-repository uses here. It lives in
 * vi.hoisted so the vi.mock factories can reference it.
 */

const harness = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const tables: Record<string, Row[]> = {
    studio_projects: [],
    studio_conversations: [],
    studio_conversation_messages: [],
    studio_tasks: [],
    agent_paused_runs: [],
    user_project_deployments: [],
  };
  const state = { counter: 0 };
  const failTables = new Set<string>();

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
      if (failTables.has(table)) {
        return { data: null, error: { message: `injected failure on ${table}` }, count: null };
      }
      if (pendingInsert) {
        const row: Row = {
          id: `proj-${++state.counter}`,
          created_at: "2026-11-11T00:00:00Z",
          updated_at: "2026-11-11T00:00:00Z",
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
  return { tables, state, failTables, db };
});

const { tables, state, failTables } = harness;

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: harness.db,
  getSupabaseAdmin: () => harness.db,
}));

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));

vi.mock("@/lib/terminal-internal-client", () => ({
  getPreviewStatusInternal: vi.fn(),
  buildPreviewProxyUrl: vi.fn(() => ""),
}));

import { createBlankProject, findReusableEmptyBlankProject } from "./project-repository";

const USER = "user-1";
const OTHER_USER = "user-2";
const ENTRY = { name: "New Website", templateId: "blank-static" as const };

function seedProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: `proj-${++state.counter}`,
    user_id: USER,
    name: "New Website",
    slug: "new-website",
    source_type: "blank",
    access_mode: "private",
    is_system: false,
    template_id: "blank-static",
    github_installation_id: null,
    github_repository_id: null,
    github_owner: null,
    github_repo: null,
    github_full_name: null,
    github_default_branch: null,
    github_branch: null,
    latest_commit_sha: null,
    workspace_id: null,
    workspace_branch: null,
    workspace_status: "ready",
    workspace_root: null,
    workspace_error: null,
    workspace_prepared_at: "2026-11-11T00:00:00Z",
    runtime_status: "stopped",
    preview_url: null,
    runtime_error: null,
    framework: "static",
    package_manager: "none",
    root_directory: ".",
    development_command: null,
    build_command: null,
    test_command: null,
    install_command: null,
    workspace_type: "website",
    created_at: "2026-11-11T00:00:00Z",
    updated_at: "2026-11-11T00:00:00Z",
    ...overrides,
  };
  tables.studio_projects.push(row);
  return row;
}

function seedConversation(projectId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: `conv-${++state.counter}`,
    owner_id: USER,
    project_id: projectId,
    title: null,
    archived_at: null,
    created_at: "2026-11-11T00:00:00Z",
    updated_at: "2026-11-11T00:00:00Z",
    ...overrides,
  };
  tables.studio_conversations.push(row);
  return row;
}

function seedMessage(conversationId: string): void {
  tables.studio_conversation_messages.push({
    id: `msg-${++state.counter}`,
    conversation_id: conversationId,
    role: "user",
    content: "build me a bakery site",
    created_at: "2026-11-11T00:01:00Z",
  });
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  state.counter = 0;
  failTables.clear();
});

describe("findReusableEmptyBlankProject", () => {
  it("returns null when the user has no projects at all", async () => {
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("finds an untouched blank project from a previous Website entry", async () => {
    const blank = seedProject();
    const found = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(found?.id).toBe(blank.id);
    expect(found?.name).toBe("New Website");
  });

  it("still reuses a blank whose only conversation is an empty shell (no messages)", async () => {
    const blank = seedProject();
    seedConversation(blank.id as string);
    const found = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(found?.id).toBe(blank.id);
  });

  it("never reuses a project that was renamed away from the entry name", async () => {
    seedProject({ name: "My Bakery Site" });
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("never reuses a project with a conversation message", async () => {
    const blank = seedProject();
    const conv = seedConversation(blank.id as string);
    seedMessage(conv.id as string);
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("never reuses a project with a studio task", async () => {
    const blank = seedProject();
    tables.studio_tasks.push({
      id: `task-${++state.counter}`,
      user_id: USER,
      project_id: blank.id,
      created_at: "2026-11-11T00:02:00Z",
    });
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("never reuses a project with an agent paused run", async () => {
    const blank = seedProject();
    tables.agent_paused_runs.push({
      id: `run-${++state.counter}`,
      user_id: USER,
      project_id: blank.id,
      conversation_id: "conv-x",
      created_at: "2026-11-11T00:02:00Z",
    });
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("never reuses a project that has been deployed", async () => {
    const blank = seedProject();
    tables.user_project_deployments.push({
      id: `dep-${++state.counter}`,
      user_id: USER,
      project_id: blank.id,
      created_at: "2026-11-11T00:02:00Z",
    });
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("never returns another user's blank project", async () => {
    seedProject({ user_id: OTHER_USER });
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("returns the caller's own blank even when another user's untouched blank exists", async () => {
    seedProject({ user_id: OTHER_USER, updated_at: "2026-11-11T03:00:00Z" });
    const mine = seedProject({ updated_at: "2026-11-11T01:00:00Z" });
    const found = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(found?.id).toBe(mine.id);
  });

  it("ignores GitHub-backed and system projects with the entry name", async () => {
    seedProject({ source_type: "github" });
    seedProject({ is_system: true });
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("does not reuse across templates", async () => {
    seedProject({ template_id: "nextjs" });
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("prefers the most recently updated untouched blank, skipping touched newer ones", async () => {
    const older = seedProject({ id: "proj-older", updated_at: "2026-11-11T00:00:00Z" });
    const newerTouched = seedProject({ id: "proj-newer", updated_at: "2026-11-11T02:00:00Z" });
    const conv = seedConversation(newerTouched.id as string);
    seedMessage(conv.id as string);
    const found = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(found?.id).toBe(older.id);
  });

  it("treats an activity-count failure as touched — never reuse on uncertainty", async () => {
    // A conversation shell exists, so the message count must actually
    // be queried; when that query fails the count is unknown, and
    // unknown counts as touched.
    const blank = seedProject();
    seedConversation(blank.id as string);
    failTables.add("studio_conversation_messages");
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("treats a task-count failure as touched", async () => {
    seedProject();
    failTables.add("studio_tasks");
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("returns null when the candidate lookup itself fails", async () => {
    seedProject();
    failTables.add("studio_projects");
    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });
});

describe("Website entry flow (finder + createBlankProject)", () => {
  it("two entries mint exactly one project: the second entry reuses the first", async () => {
    // First entry: nothing to reuse → create.
    const firstReusable = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(firstReusable).toBeNull();
    const created = await createBlankProject({
      userId: USER,
      name: ENTRY.name,
      templateId: ENTRY.templateId,
      accessMode: "private",
    });
    expect(tables.studio_projects).toHaveLength(1);

    // Second entry (a separate submission, minutes later): the finder
    // returns the project the first entry made — no new row is minted.
    const secondReusable = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(secondReusable?.id).toBe(created.id);
    expect(tables.studio_projects).toHaveLength(1);
  });

  it("a second entry after the first project got a message mints a new project", async () => {
    const created = await createBlankProject({
      userId: USER,
      name: ENTRY.name,
      templateId: ENTRY.templateId,
      accessMode: "private",
    });
    const conv = seedConversation(created.id);
    seedMessage(conv.id as string);

    const reusable = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(reusable).toBeNull();
  });
});
