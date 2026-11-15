// @vitest-environment node
/**
 * Regression: /api/deployments "Published sites" labels.
 *
 * The live proof (2026-11-15) showed every published-site entry labelled
 * "Untitled project". The name join in getPublishedSites only consulted
 * `studio_projects`, but deployments can reference legacy `projects` rows
 * (project identity resolves across both tables — see getProject /
 * resolveCurrentProject), so legacy-backed deployments could never show
 * their name. The join now checks the legacy table too, deriving the
 * display name from repository_full_name || repository, and only falls
 * back to "Untitled project" when the project exists in neither table.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const tables = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user-a", clerkId: "user-a" })),
}));

vi.mock("@/lib/supabase", () => {
  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    constructor(private table: string) {}
    select() {
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push((row) => row[col] === val);
      return this;
    }
    in(col: string, vals: unknown[]) {
      this.filters.push((row) => vals.includes(row[col]));
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    gte() {
      return this;
    }
    then(resolve: (value: { data: Row[]; error: null }) => unknown) {
      const data = (tables.rows[this.table] ?? []).filter((row) =>
        this.filters.every((f) => f(row)),
      );
      return Promise.resolve({ data, error: null }).then(resolve);
    }
  }
  return { supabaseAdmin: { from: (table: string) => new Query(table) } };
});

const { GET } = await import("@/app/api/deployments/route");

function deploymentRow(id: string, projectId: string, status: string): Row {
  return {
    id,
    user_id: "user-a",
    project_id: projectId,
    workspace_id: `ws-${id}`,
    status,
    target: "litt-static",
    public_url: status === "ready" ? `https://www.litlabs.net/sites/${id}/` : null,
    url_verified: status === "ready",
    file_count: 3,
    total_bytes: 1024,
    content_hash: null,
    error_class: status === "failed" ? "verify" : null,
    error_message: status === "failed" ? "Deployment verification failed" : null,
    created_at: "2026-11-15T00:00:00.000Z",
    updated_at: "2026-11-15T00:00:00.000Z",
  };
}

describe("GET /api/deployments published-site names", () => {
  beforeEach(() => {
    tables.rows = {
      project_deployments: [],
      user_project_deployments: [
        deploymentRow("dep-studio", "studio-1", "ready"),
        deploymentRow("dep-legacy", "legacy-1", "ready"),
        deploymentRow("dep-gone", "gone-1", "failed"),
      ],
      studio_projects: [
        { id: "studio-1", name: "Studio One", user_id: "user-a", is_system: false },
      ],
      projects: [
        {
          id: "legacy-1",
          repository_full_name: "owner/legacy-repo",
          repository: "legacy-repo",
          user_id: "user-a",
        },
      ],
    };
  });

  it("labels sites from studio_projects, legacy projects, and the fallback", async () => {
    const response = await GET(new NextRequest("http://localhost/api/deployments"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    const byProject = new Map(
      (payload.sites as Array<{ projectId: string; projectName: string }>).map((s) => [
        s.projectId,
        s.projectName,
      ]),
    );
    expect(byProject.get("studio-1")).toBe("Studio One");
    expect(byProject.get("legacy-1")).toBe("owner/legacy-repo");
    expect(byProject.get("gone-1")).toBe("Untitled project");
  });
});
