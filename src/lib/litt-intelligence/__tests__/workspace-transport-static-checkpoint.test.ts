import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Static workspaces are gitless BY DESIGN (Gate 1: prepareStaticWorkspace
 * never initializes a repository; git add/commit can execute hooks, so
 * all git operations are blocked in production). The transport used to
 * run the git checkpoint anyway: it failed, the failure was recorded in
 * lastCheckpointError, and settlement attached "Checkpoint creation
 * failed: <git error>" to runs whose file work had actually succeeded —
 * a static project's first build "hit a git error".
 *
 * The fix: the factory derives isStaticWorkspace from the verified
 * project row (same predicate workspace-recovery uses to pick the
 * prepare path), and createCheckpointBeforeMutation returns null
 * WITHOUT recording an error — "not applicable", not "failed" — so
 * settlement falls back to its gitless volume-listing read-back
 * verification. Git-backed projects keep the exact old behavior.
 */

const verifyProjectWorkspaceMock = vi.fn();
vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: (...args: unknown[]) => verifyProjectWorkspaceMock(...args),
}));
vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "t", expiresAt: Date.now() + 60_000 })),
}));
vi.mock("@/lib/terminal-url", () => ({
  getTerminalServerUrl: vi.fn(() => "https://terminal.test"),
}));
vi.mock("@/lib/studio/workspace-recovery", () => ({
  ensureWorkspaceAlive: vi.fn(),
}));
vi.mock("@/lib/missions/workspace-checkpoint", () => ({
  createWorkspaceCheckpoint: vi.fn(),
}));

import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { createWorkspaceCheckpoint } from "@/lib/missions/workspace-checkpoint";
import {
  computeWorkspaceChange,
  workspaceChangeFromVolumeListing,
} from "@/lib/litt-intelligence/workspace-change-producer";

const realFetch = globalThis.fetch;

function verifiedProject(project: Record<string, unknown>) {
  return {
    project,
    workspaceId: "ws_test",
    workspaceRoot: "/data/ws_test",
  };
}

const STATIC_PROJECT = {
  sourceType: "blank",
  templateId: "blank-static",
  githubFullName: null,
  framework: "static",
};
const MANAGED_FRAMEWORK_PROJECT = {
  sourceType: "blank",
  templateId: "nextjs",
  githubFullName: null,
  framework: "nextjs",
};
const GITHUB_PROJECT = {
  sourceType: "github",
  templateId: null,
  githubFullName: "owner/repo",
  framework: "nextjs",
};

beforeEach(() => {
  verifyProjectWorkspaceMock.mockReset();
  vi.mocked(createWorkspaceCheckpoint).mockReset();
  // The factory's reachability probe: answer the /ws-files listing.
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ entries: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("WorkspaceTransport — static (gitless) workspaces", () => {
  it("flags a static-template managed project as a static workspace", async () => {
    verifyProjectWorkspaceMock.mockResolvedValue(verifiedProject(STATIC_PROJECT));
    const transport = await createWorkspaceTransport("proj_test", "user_test");
    expect(transport.isStaticWorkspace).toBe(true);
  });

  it("skips the git checkpoint entirely and records NO error", async () => {
    verifyProjectWorkspaceMock.mockResolvedValue(verifiedProject(STATIC_PROJECT));
    const transport = await createWorkspaceTransport("proj_test", "user_test");
    const result = await transport.createCheckpointBeforeMutation("pre-mutation");
    expect(result).toBeNull();
    expect(createWorkspaceCheckpoint).not.toHaveBeenCalled();
    expect(transport.lastCheckpointError).toBeNull();
  });

  it("settlement stays gitless: no 'Checkpoint creation failed', read-back verifies the change", async () => {
    verifyProjectWorkspaceMock.mockResolvedValue(verifiedProject(STATIC_PROJECT));
    const transport = await createWorkspaceTransport("proj_test", "user_test");
    const checkpoint = await transport.createCheckpointBeforeMutation("pre-mutation");

    // Mirror settleWorkspaceChangeEvidence in agent-loop-v2: the primary
    // probe cannot answer without a checkpoint, and the reason must not
    // blame a checkpoint failure that never happened.
    const primary = await computeWorkspaceChange(transport, checkpoint, {
      checkpointError: transport.lastCheckpointError ?? undefined,
    });
    expect(primary.status).toBe("unknown");
    expect(primary.unknownReason).not.toMatch(/Checkpoint creation failed/);

    // The gitless read-back fallback then verifies the paths the run's
    // successful mutations declared against the volume listing.
    const settled = await workspaceChangeFromVolumeListing(primary, {
      candidatePaths: ["index.html"],
      listDir: async () => [{ name: "index.html", type: "file" }],
    });
    expect(settled.status).toBe("changed");
    expect(settled.files).toEqual(["index.html"]);
    expect(settled.evidenceSource).toBe("volume-listing");
  });
});

describe("WorkspaceTransport — git-backed workspaces keep checkpointing", () => {
  it("a managed framework project is not static and checkpoints as before", async () => {
    verifyProjectWorkspaceMock.mockResolvedValue(verifiedProject(MANAGED_FRAMEWORK_PROJECT));
    vi.mocked(createWorkspaceCheckpoint).mockResolvedValue({
      checkpointId: "cp-1",
      label: "pre-mutation",
      gitSha: "abc123",
      createdAt: new Date().toISOString(),
    } as never);
    const transport = await createWorkspaceTransport("proj_test", "user_test");
    expect(transport.isStaticWorkspace).toBe(false);
    const result = await transport.createCheckpointBeforeMutation("pre-mutation");
    expect(createWorkspaceCheckpoint).toHaveBeenCalledTimes(1);
    expect(result?.gitSha).toBe("abc123");
    expect(transport.lastCheckpointError).toBeNull();
  });

  it("a GitHub project with no templateId is NOT treated as static", async () => {
    // isStaticTemplateId(null) defaults to true for the provisioning
    // default, but a GitHub source is a clone — the static predicate is
    // scoped to LiTT-managed sources, exactly as in workspace-recovery.
    verifyProjectWorkspaceMock.mockResolvedValue(verifiedProject(GITHUB_PROJECT));
    vi.mocked(createWorkspaceCheckpoint).mockRejectedValue(
      new Error("Checkpoint exec failed (500)"),
    );
    const transport = await createWorkspaceTransport("proj_test", "user_test");
    expect(transport.isStaticWorkspace).toBe(false);
    const result = await transport.createCheckpointBeforeMutation("pre-mutation");
    expect(result).toBeNull();
    expect(createWorkspaceCheckpoint).toHaveBeenCalledTimes(1);
    expect(transport.lastCheckpointError).toMatch(/500/);
  });
});
