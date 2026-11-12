// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Entered-but-contentless reuse (tier 2 of findReusableEmptyBlankProject):
 * the #903 "untouched" rule disqualifies a blank shell forever the
 * moment it is entered — and the Website entry flow routes straight
 * into chat — so every re-entry minted another duplicate "New Website"
 * (five in production). Tier 2 loosens the predicate from "provably
 * untouched" to "no user-authored content yet": messages, tasks and
 * paused runs no longer disqualify IF the project has no deployments
 * AND its workspace is proven byte-identical to the seeded starter
 * (workspace-seed-check, mocked here; its own suite proves the check).
 *
 * Hard lines exercised below: a deployment always disqualifies; an
 * unprovable count always disqualifies (and the workspace check is
 * never even consulted); a workspace that differs from the seed in any
 * way (edited file, added file) always disqualifies.
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
      if (countMode) return { data: null, error: null, count: resolveList().length };
      return { data: resolveList(), error: null, count: null };
    };

    const chain: Record<string, unknown> = {
      select(_cols?: unknown, opts?: { count?: string; head?: boolean }) {
        if (opts?.count) countMode = true;
        return chain;
      },
      insert() {
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

const seedCheck = vi.hoisted(() => ({
  results: new Map<string, boolean>(),
  calls: [] as string[],
}));

vi.mock("./workspace-seed-check", () => ({
  isWorkspaceSeedIdentical: async (
    _userId: string,
    project: { id: string },
  ): Promise<boolean> => {
    seedCheck.calls.push(project.id);
    return seedCheck.results.get(project.id) ?? false;
  },
}));

import { findReusableEmptyBlankProject } from "./project-repository";

const USER = "user-1";
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
    workspace_id: "ws-1",
    workspace_branch: "main",
    workspace_status: "ready",
    workspace_root: "/workspaces/proj",
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

function seedConversation(projectId: string): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: `conv-${++state.counter}`,
    owner_id: USER,
    project_id: projectId,
    title: null,
    archived_at: null,
    created_at: "2026-11-11T00:00:00Z",
    updated_at: "2026-11-11T00:00:00Z",
  };
  tables.studio_conversations.push(row);
  return row;
}

function enterProject(projectId: string): void {
  const conv = seedConversation(projectId);
  tables.studio_conversation_messages.push({
    id: `msg-${++state.counter}`,
    conversation_id: conv.id,
    role: "user",
    content: "build me a bakery site",
    created_at: "2026-11-11T00:01:00Z",
  });
  tables.studio_tasks.push({
    id: `task-${++state.counter}`,
    user_id: USER,
    project_id: projectId,
    created_at: "2026-11-11T00:02:00Z",
  });
  tables.agent_paused_runs.push({
    id: `run-${++state.counter}`,
    user_id: USER,
    project_id: projectId,
    conversation_id: conv.id,
    created_at: "2026-11-11T00:02:00Z",
  });
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  state.counter = 0;
  failTables.clear();
  seedCheck.results.clear();
  seedCheck.calls.length = 0;
});

describe("findReusableEmptyBlankProject — entered but contentless (tier 2)", () => {
  it("reuses an entered project whose workspace is still seed-identical", async () => {
    const blank = seedProject();
    enterProject(blank.id as string);
    seedCheck.results.set(blank.id as string, true);

    const found = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(found?.id).toBe(blank.id);
    expect(seedCheck.calls).toEqual([blank.id]);
  });

  it("never reuses a seed-identical project that has been deployed", async () => {
    const blank = seedProject();
    enterProject(blank.id as string);
    tables.user_project_deployments.push({
      id: `dep-${++state.counter}`,
      user_id: USER,
      project_id: blank.id,
      created_at: "2026-11-11T00:03:00Z",
    });
    seedCheck.results.set(blank.id as string, true);

    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
    // The deployment disqualifies on counts alone — no workspace proof
    // is ever consulted for a deployed project.
    expect(seedCheck.calls).toEqual([]);
  });

  it("never reuses an entered project when a workspace file differs from the seed", async () => {
    const blank = seedProject();
    enterProject(blank.id as string);
    // e.g. index.html overwritten (emptied) by a started build — the
    // seed check says the workspace is not the starter anymore.
    seedCheck.results.set(blank.id as string, false);

    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
    expect(seedCheck.calls).toEqual([blank.id]);
  });

  it("never reuses an entered project when a file was added to the workspace", async () => {
    const blank = seedProject();
    enterProject(blank.id as string);
    // e.g. an inserted image or a QUALITY_LOG.md — again the seed check
    // refuses, and so does the finder.
    seedCheck.results.set(blank.id as string, false);

    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
  });

  it("still reuses a provably untouched blank without consulting the workspace check", async () => {
    const blank = seedProject();
    seedCheck.results.set(blank.id as string, false);

    const found = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(found?.id).toBe(blank.id);
    expect(seedCheck.calls).toEqual([]);
  });

  it("never consults the workspace check when an activity count is unprovable", async () => {
    const blank = seedProject();
    enterProject(blank.id as string);
    seedCheck.results.set(blank.id as string, true);
    failTables.add("studio_tasks");

    await expect(findReusableEmptyBlankProject(USER, ENTRY)).resolves.toBeNull();
    expect(seedCheck.calls).toEqual([]);
  });

  it("skips a newer entered project whose workspace diverged and reuses an older seed-identical one", async () => {
    const older = seedProject({ id: "proj-older", updated_at: "2026-11-11T00:00:00Z" });
    const newer = seedProject({ id: "proj-newer", updated_at: "2026-11-11T02:00:00Z" });
    enterProject(older.id as string);
    enterProject(newer.id as string);
    seedCheck.results.set(older.id as string, true);
    seedCheck.results.set(newer.id as string, false);

    const found = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(found?.id).toBe(older.id);
  });

  it("prefers the most recently updated reusable candidate across tiers", async () => {
    const olderUntouched = seedProject({ id: "proj-older", updated_at: "2026-11-11T00:00:00Z" });
    const newerEntered = seedProject({ id: "proj-newer", updated_at: "2026-11-11T02:00:00Z" });
    enterProject(newerEntered.id as string);
    seedCheck.results.set(newerEntered.id as string, true);

    const found = await findReusableEmptyBlankProject(USER, ENTRY);
    expect(found?.id).toBe(newerEntered.id);
    expect(olderUntouched.id).not.toBe(found?.id);
  });
});
