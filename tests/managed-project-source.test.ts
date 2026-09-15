/**
 * Regression coverage for durable managed project source.
 *
 * The defect these lock down: LiTT equated "no GitHub repository" with
 * "no source". A managed project has durable files, a real Git
 * repository, history and a branch while having NO GitHub repo — and
 * the UI reported "No repository · —", the agent was denied git_status,
 * git_diff and checkpoints, and re-provisioning minted a fresh empty
 * directory that orphaned the user's files.
 */

import { describe, it, expect } from "vitest";
import {
  describeProjectSource,
  resolveSourceKind,
  resolveBranch,
  isManagedSourceType,
  formatSourceSummary,
  DEFAULT_MANAGED_BRANCH,
} from "@/lib/projects/project-source";
import {
  repoOnlyToolApplicability,
  checkApplicability,
  hasVersionControl,
  hasGithubRepository,
  capabilityNotice,
  notApplicableReason,
  type WorkspaceShape,
} from "@/lib/studio/workspace-capability";
import { rowToCanonical, type StudioProjectRow, type CanonicalProject } from "@/lib/projects/types";

/** A managed project whose workspace has been provisioned. */
function managedProject(overrides: Partial<CanonicalProject> = {}): CanonicalProject {
  const row: StudioProjectRow = {
    id: "proj-managed", user_id: "user_1", name: "Ember Roast", slug: "ember-roast",
    source_type: "blank", access_mode: "private", template_id: "blank-static",
    github_installation_id: null, github_repository_id: null, github_owner: null,
    github_repo: null, github_full_name: null, github_default_branch: null,
    github_branch: null, latest_commit_sha: null,
    workspace_id: "ws-proj-managed", workspace_branch: "main", workspace_status: "ready",
    workspace_root: "/data/littree-workspaces/user_1/proj-managed",
    workspace_error: null, workspace_prepared_at: "2026-09-15T00:00:00Z",
    runtime_status: "stopped", preview_url: null, runtime_error: null,
    framework: "static", package_manager: "none", root_directory: ".",
    development_command: null, build_command: null, test_command: null,
    install_command: null, workspace_type: "website",
    created_at: "2026-09-15T00:00:00Z", updated_at: "2026-09-15T00:00:00Z",
  };
  return { ...rowToCanonical(row), ...overrides };
}

/** A GitHub-backed project — must keep behaving exactly as before. */
function githubProject(overrides: Partial<CanonicalProject> = {}): CanonicalProject {
  return {
    ...managedProject(),
    id: "proj-github",
    sourceType: "github",
    templateId: null,
    githubInstallationId: 42,
    githubRepositoryId: 99,
    githubOwner: "LabsConnected",
    githubRepo: "ember-roast",
    githubFullName: "LabsConnected/ember-roast",
    githubDefaultBranch: "main",
    githubBranch: "main",
    framework: "nextjs",
    packageManager: "pnpm",
    ...overrides,
  };
}

function shapeOf(project: CanonicalProject): WorkspaceShape {
  return {
    framework: project.framework,
    packageManager: project.packageManager,
    githubFullName: project.githubFullName,
    sourceType: project.sourceType,
    gitInitialized: project.workspaceStatus === "ready",
  };
}

describe("managed source identity", () => {
  it("treats a project with no GitHub repository as managed, not sourceless", () => {
    const source = describeProjectSource(managedProject());
    expect(source.kind).toBe("managed");
    expect(source.label).toBe("LiTT Managed");
    expect(source.status).toBe("ready");
  });

  it("classifies blank and template as managed, github as github", () => {
    expect(isManagedSourceType("blank")).toBe(true);
    expect(isManagedSourceType("template")).toBe(true);
    expect(isManagedSourceType("managed")).toBe(true);
    expect(isManagedSourceType("github")).toBe(false);
  });

  it("keeps a durable workspace identity", () => {
    const source = describeProjectSource(managedProject());
    expect(source.workspaceId).toBe("ws-proj-managed");
    expect(managedProject().workspaceRoot).toContain("proj-managed");
  });

  it("reports Git version control without any GitHub repository", () => {
    const source = describeProjectSource(managedProject());
    expect(source.versionControl).toBe("git");
    expect(source.gitInitialized).toBe(true);
    expect(source.githubConnected).toBe(false);
    expect(source.githubRepository).toBeNull();
  });

  it("reports the real branch instead of null", () => {
    expect(describeProjectSource(managedProject()).branch).toBe("main");
  });

  it("falls back to main for a managed project whose branch was never persisted", () => {
    const project = managedProject({ workspaceBranch: null });
    expect(resolveBranch(project)).toBe(DEFAULT_MANAGED_BRANCH);
  });

  it("reports a writable workspace", () => {
    expect(describeProjectSource(managedProject()).writable).toBe(true);
  });

  it("becomes GitHub-backed once a repository is connected, without losing Git", () => {
    const published = managedProject({ githubFullName: "LabsConnected/ember-roast" });
    const source = describeProjectSource(published);
    expect(source.kind).toBe("github");
    expect(source.githubConnected).toBe(true);
    expect(source.versionControl).toBe("git");
  });
});

describe("provisioning states are truthful", () => {
  it("reports provisioning rather than ready", () => {
    const source = describeProjectSource(managedProject({ workspaceStatus: "provisioning" }));
    expect(source.status).toBe("provisioning");
    expect(source.writable).toBe(false);
  });

  it("surfaces a recoverable error instead of a silent spinner", () => {
    const source = describeProjectSource(
      managedProject({ workspaceStatus: "failed", workspaceError: "Disk full" }),
    );
    expect(source.status).toBe("error");
    expect(source.error).toBe("Disk full");
  });

  it("classifies a legacy never-provisioned project as needs_setup, not broken", () => {
    const legacy = managedProject({ workspaceId: null, workspaceStatus: "not_prepared" });
    const source = describeProjectSource(legacy);
    expect(source.status).toBe("needs_setup");
    expect(source.kind).toBe("managed");
  });
});

describe("project card copy", () => {
  it("never renders 'No repository' for a healthy managed project", () => {
    const source = describeProjectSource(managedProject());
    const summary = formatSourceSummary({
      kind: source.kind, status: source.status,
      versionControl: source.versionControl, branch: source.branch,
      githubRepository: source.githubRepository,
    });
    expect(summary).toBe("LiTT Managed · Git · main");
    expect(summary).not.toContain("No repository");
    expect(summary).not.toContain("—");
  });

  it("renders GitHub metadata when a repository is connected", () => {
    const source = describeProjectSource(githubProject());
    const summary = formatSourceSummary({
      kind: source.kind, status: source.status,
      versionControl: source.versionControl, branch: source.branch,
      githubRepository: source.githubRepository,
    });
    expect(summary).toBe("LabsConnected/ember-roast · Git · main");
  });

  it("shows provisioning progress rather than a false ready state", () => {
    expect(formatSourceSummary({ kind: "managed", status: "provisioning" })).toBe("Preparing source…");
  });
});

describe("Git is not GitHub — tool applicability", () => {
  const managed = shapeOf(managedProject());

  it.each([
    "git_status", "git_diff", "git_log", "create_branch",
    "commit_changes", "create_checkpoint", "restore_checkpoint", "apply_patch",
  ])("allows %s on a managed project with no GitHub repo", (tool) => {
    expect(repoOnlyToolApplicability(managed, tool)).toBe("applicable");
  });

  it.each(["push_branch", "create_pull_request", "github_read_file"])(
    "still gates %s behind a connected GitHub repository",
    (tool) => {
      expect(repoOnlyToolApplicability(managed, tool)).toBe("not_applicable");
      expect(repoOnlyToolApplicability(shapeOf(githubProject()), tool)).toBe("applicable");
    },
  );

  it("withholds Git tools only while the workspace is unprovisioned", () => {
    const unprovisioned: WorkspaceShape = { ...managed, gitInitialized: false };
    expect(repoOnlyToolApplicability(unprovisioned, "git_status")).toBe("not_applicable");
    expect(notApplicableReason(unprovisioned, "git_status")).toContain("not been provisioned");
  });

  it("separates version control from GitHub connectivity", () => {
    expect(hasVersionControl(managed)).toBe(true);
    expect(hasGithubRepository(managed)).toBe(false);
  });

  it("defaults to Git available when gitInitialized is not supplied", () => {
    const { gitInitialized: _omitted, ...withoutFlag } = managed;
    expect(hasVersionControl(withoutFlag as WorkspaceShape)).toBe(true);
  });

  it("keeps toolchain checks keyed on the package manager, not the repo", () => {
    expect(checkApplicability(managed, "typecheck")).toBe("not_applicable");
    expect(checkApplicability(shapeOf(githubProject()), "typecheck")).toBe("applicable");
  });

  it("never tells the model to connect GitHub in order to edit files", () => {
    const notice = capabilityNotice(managed) ?? "";
    expect(notice).toContain("GitHub is optional");
    expect(notice).toMatch(/Never tell the user to connect GitHub/i);
  });

  it("emits no capability caveat for a fully-equipped GitHub project", () => {
    expect(capabilityNotice(shapeOf(githubProject()))).toBeNull();
  });
});

describe("GitHub-backed projects are not migrated incorrectly", () => {
  it("keeps reporting GitHub as the source and preserves its branch", () => {
    const source = describeProjectSource(githubProject({ githubBranch: "release/v2" }));
    expect(source.kind).toBe("github");
    expect(source.label).toBe("GitHub");
    expect(source.githubRepository).toBe("LabsConnected/ember-roast");
  });

  it("prefers the workspace branch over the GitHub branch when they differ", () => {
    // The workspace is what the terminal, preview and agent actually use.
    const project = githubProject({ workspaceBranch: "feature/hero", githubBranch: "main" });
    expect(resolveBranch(project)).toBe("feature/hero");
  });

  it("resolves source kind for a project with no stored source_type", () => {
    expect(resolveSourceKind({ sourceType: null, githubFullName: null })).toBe("managed");
    expect(resolveSourceKind({ sourceType: null, githubFullName: "o/r" })).toBe("github");
  });
});
