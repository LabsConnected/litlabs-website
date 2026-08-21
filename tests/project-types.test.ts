// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  rowToCanonical,
  legacyRowToCanonical,
  type StudioProjectRow,
  type LegacyProjectRow,
} from "../src/lib/projects/types";

describe("project types — rowToCanonical", () => {
  it("maps a blank studio project row correctly", () => {
    const row: StudioProjectRow = {
      id: "p1",
      user_id: "user_abc",
      name: "My Blank Project",
      slug: "my-blank-project",
      source_type: "blank",
      access_mode: "private",
      template_id: "nextjs",
      github_installation_id: null,
      github_repository_id: null,
      github_owner: null,
      github_repo: null,
      github_full_name: null,
      github_default_branch: null,
      github_branch: null,
      latest_commit_sha: null,
      workspace_id: "ws-abc12345-def67890",
      workspace_status: "ready",
      workspace_root: "/tmp/workspaces/ws-abc",
      workspace_error: null,
      workspace_prepared_at: "2026-07-26T00:00:00Z",
      runtime_status: "stopped",
      preview_url: null,
      runtime_error: null,
      framework: "nextjs",
      package_manager: "pnpm",
      root_directory: ".",
      development_command: "pnpm dev",
      build_command: "pnpm build",
      test_command: "pnpm test",
      install_command: "pnpm install",
      workspace_type: "website",
      created_at: "2026-07-26T00:00:00Z",
      updated_at: "2026-07-26T00:00:00Z",
    };

    const project = rowToCanonical(row);
    expect(project.id).toBe("p1");
    expect(project.userId).toBe("user_abc");
    expect(project.sourceType).toBe("blank");
    expect(project.templateId).toBe("nextjs");
    expect(project.workspaceStatus).toBe("ready");
    expect(project.workspaceId).toBe("ws-abc12345-def67890");
    expect(project.githubRepositoryId).toBeNull();
    expect(project.workspaceType).toBe("website");
  });

  it("maps a github studio project row correctly", () => {
    const row: StudioProjectRow = {
      id: "p2",
      user_id: "user_xyz",
      name: "litlabs-website",
      slug: "litlabs-website",
      source_type: "github",
      access_mode: "private",
      template_id: null,
      github_installation_id: 12345,
      github_repository_id: 67890,
      github_owner: "LabsConnected",
      github_repo: "litlabs-website",
      github_full_name: "LabsConnected/litlabs-website",
      github_default_branch: "main",
      github_branch: "main",
      latest_commit_sha: "abc123",
      workspace_id: null,
      workspace_status: "not_prepared",
      workspace_root: null,
      workspace_error: null,
      workspace_prepared_at: null,
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
      created_at: "2026-07-26T00:00:00Z",
      updated_at: "2026-07-26T00:00:00Z",
    };

    const project = rowToCanonical(row);
    expect(project.sourceType).toBe("github");
    expect(project.githubRepositoryId).toBe(67890);
    expect(project.workspaceStatus).toBe("not_prepared");
  });
});

describe("project types — legacyRowToCanonical", () => {
  it("maps a legacy projects row to canonical shape", () => {
    const row: LegacyProjectRow = {
      id: "legacy-1",
      user_id: "user_abc",
      github_installation_id: 999,
      repository_id: 888,
      owner: "someorg",
      repository: "somerepo",
      default_branch: "main",
      working_branch: "dev",
      workspace_id: null,
            status: "offline",
      connection_status: "disconnected",
      connection_error: null,
      connected_at: null,
      disconnected_at: null,
      selected_branch: "dev",
      repository_full_name: "someorg/somerepo",
      repository_html_url: "https://github.com/someorg/somerepo",
      repository_private: false,
      vercel_project_id: null,
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
    };

    const project = legacyRowToCanonical(row);
    expect(project.id).toBe("legacy-1");
    expect(project.sourceType).toBe("github");
    expect(project.githubRepositoryId).toBe(888);
    expect(project.githubBranch).toBe("dev");
    expect(project.workspaceStatus).toBe("not_prepared");
    expect(project.name).toBe("someorg/somerepo");
  });
});

describe("project types — unauthorized access prevention", () => {
  it("rowToCanonical preserves userId for ownership checks", () => {
    const row: StudioProjectRow = {
      id: "p3",
      user_id: "user_owner",
      name: "Test",
      slug: "test",
      source_type: "blank",
      access_mode: "private",
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
      workspace_status: "not_prepared",
      workspace_root: null,
      workspace_error: null,
      workspace_prepared_at: null,
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
      created_at: "2026-07-26T00:00:00Z",
      updated_at: "2026-07-26T00:00:00Z",
    };

    const project = rowToCanonical(row);
    // The caller (repository) must verify project.userId === requestingUserId
    expect(project.userId).toBe("user_owner");
    expect(project.userId).not.toBe("user_attacker");
  });
});
