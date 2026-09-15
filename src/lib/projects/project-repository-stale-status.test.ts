import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));

vi.mock("@/lib/supabase", () => {
  interface MockChain {
    _op: string;
    _values: Record<string, unknown> | null;
    from(): MockChain;
    select(): MockChain;
    update(values: Record<string, unknown>): MockChain;
    eq(): MockChain;
    maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }>;
  }
  const chain: MockChain = {
    _op: "",
    _values: null,
    from() {
      chain._op = "";
      chain._values = null;
      return chain;
    },
    select() {
      // update().select() is part of the write chain — don't clobber it
      if (!chain._values) chain._op = "select";
      return chain;
    },
    update(values: Record<string, unknown>) {
      chain._op = "update";
      chain._values = values;
      return chain;
    },
    eq() {
      return chain;
    },
    async maybeSingle() {
      const values = chain._values;
      if (chain._op === "update" && values) {
        dbState.updates.push(values);
        const merged = {
          ...(dbState.row ?? {}),
          runtime_status: values.runtime_status,
          preview_url: values.preview_url,
          runtime_error: values.runtime_error,
          updated_at: values.updated_at,
        };
        return { data: merged, error: null };
      }
      return { data: dbState.row, error: null };
    },
  };
  return { supabaseAdmin: { from: () => chain.from() } };
});

vi.mock("@/lib/terminal-internal-client", () => ({
  getPreviewStatusInternal: vi.fn(),
  buildPreviewProxyUrl: vi.fn(
    (workspaceId: string) => `https://terminal.example/preview/${workspaceId}?token=t`,
  ),
}));

import {
  getProject,
  STALE_STARTING_AFTER_MS,
} from "@/lib/projects/project-repository";
import {
  getPreviewStatusInternal,
  buildPreviewProxyUrl,
} from "@/lib/terminal-internal-client";

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    user_id: "user-1",
    name: "Ember Roast V1 Acceptance 09-09-12",
    slug: "ember-roast-v1-acceptance-09-09-12",
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
    workspace_id: "ws-proj-1",
    workspace_branch: "main",
    workspace_status: "ready",
    workspace_root: "/data/ws",
    workspace_error: null,
    workspace_prepared_at: new Date().toISOString(),
    runtime_status: "starting",
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function liveStatus(
  status: "stopped" | "starting" | "ready" | "failed" | "restarting",
  extra: Record<string, unknown> = {},
) {
  return {
    status,
    port: 4100,
    framework: "static",
    command: "npx serve",
    startedAt: Date.now(),
    lastHealthCheck: Date.now(),
    error: null,
    errorCode: null,
    logs: [],
    ...extra,
  };
}

describe("reconcileStaleStartingStatus (via getProject)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.row = null;
    dbState.updates = [];
  });

  it("does not call the terminal server for a fresh 'starting' project", async () => {
    dbState.row = baseRow(); // updatedAt = now
    const project = await getProject("proj-1", "user-1");
    expect(project?.runtimeStatus).toBe("starting");
    expect(getPreviewStatusInternal).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(0);
  });

  it("does not call the terminal server for non-starting projects, even when stale", async () => {
    dbState.row = baseRow({
      runtime_status: "ready",
      updated_at: new Date(Date.now() - STALE_STARTING_AFTER_MS - 1000).toISOString(),
    });
    const project = await getProject("proj-1", "user-1");
    expect(project?.runtimeStatus).toBe("ready");
    expect(getPreviewStatusInternal).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(0);
  });

  it("does not call the terminal server for stale 'starting' rows without a workspace", async () => {
    dbState.row = baseRow({
      workspace_id: null,
      updated_at: new Date(Date.now() - STALE_STARTING_AFTER_MS - 1000).toISOString(),
    });
    const project = await getProject("proj-1", "user-1");
    expect(project?.runtimeStatus).toBe("starting");
    expect(getPreviewStatusInternal).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(0);
  });

  it("reconciles a stale 'starting' row to ready with a fresh preview URL", async () => {
    dbState.row = baseRow({
      updated_at: new Date(Date.now() - STALE_STARTING_AFTER_MS - 1000).toISOString(),
    });
    vi.mocked(getPreviewStatusInternal).mockResolvedValue(liveStatus("ready"));
    const project = await getProject("proj-1", "user-1");
    expect(getPreviewStatusInternal).toHaveBeenCalledWith("ws-proj-1", "user-1");
    expect(buildPreviewProxyUrl).toHaveBeenCalledWith("ws-proj-1");
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0].runtime_status).toBe("ready");
    expect(dbState.updates[0].preview_url).toContain("ws-proj-1");
    expect(project?.runtimeStatus).toBe("ready");
    expect(project?.previewUrl).toContain("ws-proj-1");
  });

  it("reconciles a stale 'starting' row to failed with the live error", async () => {
    dbState.row = baseRow({
      updated_at: new Date(Date.now() - STALE_STARTING_AFTER_MS - 1000).toISOString(),
    });
    vi.mocked(getPreviewStatusInternal).mockResolvedValue(
      liveStatus("failed", { error: "Dev server did not become healthy", errorCode: "preview_port_never_ready" }),
    );
    const project = await getProject("proj-1", "user-1");
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0].runtime_status).toBe("failed");
    expect(dbState.updates[0].preview_url).toBeNull();
    expect(dbState.updates[0].runtime_error).toBe("Dev server did not become healthy");
    expect(project?.runtimeStatus).toBe("failed");
  });

  it("marks a stale 'starting' row stopped when the terminal server has no record of the workspace", async () => {
    dbState.row = baseRow({
      updated_at: new Date(Date.now() - STALE_STARTING_AFTER_MS - 1000).toISOString(),
    });
    vi.mocked(getPreviewStatusInternal).mockResolvedValue(null);
    const project = await getProject("proj-1", "user-1");
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0].runtime_status).toBe("stopped");
    expect(dbState.updates[0].preview_url).toBeNull();
    expect(project?.runtimeStatus).toBe("stopped");
  });

  it("leaves the row untouched when the terminal server is unreachable", async () => {
    dbState.row = baseRow({
      updated_at: new Date(Date.now() - STALE_STARTING_AFTER_MS - 1000).toISOString(),
    });
    vi.mocked(getPreviewStatusInternal).mockRejectedValue(new Error("fetch failed"));
    const project = await getProject("proj-1", "user-1");
    expect(dbState.updates).toHaveLength(0);
    // Returned as-is so the next read retries (updatedAt unbumped)
    expect(project?.runtimeStatus).toBe("starting");
  });

  it("refreshes the timestamp when the server confirms a start is genuinely still in flight", async () => {
    const staleAt = new Date(Date.now() - STALE_STARTING_AFTER_MS - 1000).toISOString();
    dbState.row = baseRow({ updated_at: staleAt });
    vi.mocked(getPreviewStatusInternal).mockResolvedValue(liveStatus("starting"));
    const project = await getProject("proj-1", "user-1");
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0].runtime_status).toBe("starting");
    expect(project?.runtimeStatus).toBe("starting");
    // updatedAt was bumped past the stale marker by the real updateProjectRuntime
    expect(Date.parse(project!.updatedAt)).toBeGreaterThan(Date.parse(staleAt));
  });
});
