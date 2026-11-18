import { describe, it, expect } from "vitest";
import {
  describeProjectSource,
  formatSourceSummary,
  isRepoWorkspaceGated,
} from "./project-source";
import type { CanonicalProject } from "./types";

/**
 * Repo gate (B2): a GitHub-backed project whose workspace prepare was
 * refused with HOST_EXECUTION_DISABLED is deliberately NOT YET AVAILABLE
 * on the hosted service — a product decision, not a broken source. The
 * canonical source view must report "unavailable" (never "error") for
 * exactly that case, and keep every other case exactly as before.
 */

// The exact string production stores as workspaceError when a repo-backed
// prepare hits the terminal-server's fail-closed 503.
const HOST_EXEC_STORED =
  'Workspace prepare failed (503): {"error":"Host execution is disabled in production (workspace.prepare(git,install)); a verified sandbox is required","code":"HOST_EXECUTION_DISABLED"}';

function project(overrides: Partial<CanonicalProject> = {}): CanonicalProject {
  return {
    id: "p1",
    userId: "u1",
    name: "Demo",
    slug: "demo",
    sourceType: "github",
    accessMode: "private",
    templateId: null,
    githubInstallationId: 1,
    githubRepositoryId: 2,
    githubOwner: "owner",
    githubRepo: "repo",
    githubFullName: "owner/repo",
    githubDefaultBranch: "main",
    githubBranch: "main",
    latestCommitSha: null,
    workspaceId: null,
    workspaceBranch: null,
    workspaceStatus: "failed",
    workspaceRoot: null,
    workspaceError: HOST_EXEC_STORED,
    workspacePreparedAt: null,
    workspaceProvisioningToken: null,
    runtimeStatus: "stopped",
    previewUrl: null,
    runtimeError: null,
    framework: null,
    packageManager: null,
    rootDirectory: "",
    developmentCommand: null,
    buildCommand: null,
    testCommand: null,
    installCommand: null,
    workspaceType: "website",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("describeProjectSource — repo gate", () => {
  it("reports a coded host-execution refusal as unavailable, not error", () => {
    const view = describeProjectSource(project());
    expect(view.kind).toBe("github");
    expect(view.status).toBe("unavailable");
    expect(view.error).toBeNull();
    expect(isRepoWorkspaceGated(view)).toBe(true);
    expect(
      formatSourceSummary({
        kind: view.kind,
        status: view.status,
        versionControl: view.versionControl,
        branch: view.branch,
        githubRepository: view.githubRepository,
      }),
    ).toBe("Repo workspace unavailable");
  });

  it("keeps a genuine repo provisioning failure as error", () => {
    const view = describeProjectSource(project({ workspaceError: "terminal down" }));
    expect(view.status).toBe("error");
    expect(view.error).toBe("terminal down");
    expect(isRepoWorkspaceGated(view)).toBe(false);
  });

  it("keeps a fresh repo project at needs_setup before any refusal", () => {
    const view = describeProjectSource(
      project({ workspaceStatus: "not_prepared", workspaceError: null }),
    );
    expect(view.status).toBe("needs_setup");
    expect(isRepoWorkspaceGated(view)).toBe(false);
  });

  it("does not gate managed projects, even with a coded stored error", () => {
    const view = describeProjectSource(
      project({
        sourceType: "blank",
        githubInstallationId: null,
        githubRepositoryId: null,
        githubOwner: null,
        githubRepo: null,
        githubFullName: null,
      }),
    );
    expect(view.kind).toBe("managed");
    expect(view.status).toBe("error");
    expect(isRepoWorkspaceGated(view)).toBe(false);
  });

  it("keeps a ready repo project ready", () => {
    const view = describeProjectSource(
      project({ workspaceStatus: "ready", workspaceId: "ws-1", workspaceError: null }),
    );
    expect(view.status).toBe("ready");
    expect(view.writable).toBe(true);
    expect(isRepoWorkspaceGated(view)).toBe(false);
  });
});
