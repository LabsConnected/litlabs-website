import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));

// In-memory Supabase stand-in covering exactly the query shapes used by
// listProjects (select + eq + order) and recoverStaleProvisioning
// (select + eq + lt + maybeSingle, then update + eq + lt).
const { db } = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    studio: [] as Row[],
    legacy: [] as Row[],
    updateCalls: [] as Array<{ table: string; values: Row; count: number }>,
  };

  function makeChain(table: string) {
    const filters: Array<{ col: string; op: "eq" | "lt"; value: unknown }> = [];
    let method = "";
    let updateValues: Row | null = null;
    let maybe = false;

    function matches(row: Row): boolean {
      return filters.every((f) =>
        f.op === "eq"
          ? row[f.col] === f.value
          : String(row[f.col]) < String(f.value),
      );
    }

    function execute() {
      const rows = table === "studio_projects" ? state.studio : state.legacy;
      if (method === "select") {
        const found = rows.filter(matches);
        if (maybe) {
          return {
            data: found[0]
              ? { workspace_error: found[0].workspace_error ?? null }
              : null,
            error: null,
          };
        }
        return { data: found, error: null };
      }
      if (method === "update") {
        const targets = rows.filter(matches);
        for (const r of targets) Object.assign(r, updateValues ?? {});
        state.updateCalls.push({
          table,
          values: updateValues ?? {},
          count: targets.length,
        });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }

    const chain: Record<string, unknown> = {
      select: () => {
        method = "select";
        return chain;
      },
      update: (values: Row) => {
        method = "update";
        updateValues = values;
        return chain;
      },
      eq: (col: string, value: unknown) => {
        filters.push({ col, op: "eq", value });
        return chain;
      },
      lt: (col: string, value: unknown) => {
        filters.push({ col, op: "lt", value });
        return chain;
      },
      order: () => chain,
      maybeSingle: () => {
        maybe = true;
        return chain;
      },
      then: (resolve: (v: unknown) => void) => {
        resolve(execute());
      },
    };
    return chain;
  }

  return { db: { state, makeChain } };
});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (table: string) => db.makeChain(table) },
}));

import { listProjects } from "./project-repository";

const DAY = 24 * 60 * 60 * 1000;

function studioRow(overrides: Record<string, unknown>) {
  return {
    id: "proj-1",
    user_id: "user-1",
    is_system: false,
    name: "SMOKE-TEST-AI-2026-09-28",
    slug: "smoke-test-ai",
    source_type: "blank",
    access_mode: "private",
    template_id: null,
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
    workspace_status: "provisioning",
    workspace_root: null,
    workspace_error: null,
    workspace_prepared_at: null,
    workspace_provisioning_token: "tok-1",
    runtime_status: "stopped",
    preview_url: null,
    runtime_error: null,
    framework: null,
    package_manager: null,
    root_directory: ".",
    development_command: null,
    build_command: null,
    test_command: null,
    install_command: null,
    workspace_type: "website",
    created_at: new Date(Date.now() - 42 * DAY).toISOString(),
    updated_at: new Date(Date.now() - 42 * DAY).toISOString(),
    ...overrides,
  };
}

describe("listProjects — stale provisioning reconciliation", () => {
  beforeEach(() => {
    db.state.studio = [];
    db.state.legacy = [];
    db.state.updateCalls = [];
  });

  it("settles a 42-day-old provisioning row to failed (Provisioning timed out)", async () => {
    db.state.studio = [studioRow({})];
    const { projects } = await listProjects("user-1");
    expect(projects).toHaveLength(1);
    expect(projects[0].workspaceStatus).toBe("failed");
    expect(projects[0].workspaceError).toContain("Provisioning timed out");
    // The persisted row is settled too, so every other surface agrees.
    expect(db.state.studio[0].workspace_status).toBe("failed");
  });

  it("leaves a fresh provisioning row untouched", async () => {
    db.state.studio = [
      studioRow({ updated_at: new Date().toISOString() }),
    ];
    const { projects } = await listProjects("user-1");
    expect(projects[0].workspaceStatus).toBe("provisioning");
    expect(db.state.updateCalls).toHaveLength(0);
  });

  it("leaves a ready project untouched", async () => {
    db.state.studio = [
      studioRow({ workspace_status: "ready", runtime_status: "ready" }),
    ];
    const { projects } = await listProjects("user-1");
    expect(projects[0].workspaceStatus).toBe("ready");
    expect(db.state.updateCalls).toHaveLength(0);
  });
});
