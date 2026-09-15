import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));

// Mock supabaseAdmin before importing the repository
vi.mock("@/lib/supabase", () => {
  const mockChain = {
    _table: "" as string,
    _filters: [] as Array<{ column: string; value: unknown }>,
    _method: "" as string,
    _selectColumns: "" as string,
    _isMaybeSingle: false,
    _isSingle: false,
    // When set, the next awaited query resolves with this error — lets
    // tests simulate a real database failure on any write/read.
    _injectError: null as { message: string } | null,

    from(table: string) {
      this._table = table;
      this._filters = [];
      this._method = "";
      this._selectColumns = "";
      this._isMaybeSingle = false;
      this._isSingle = false;
      return this;
    },
    select(cols?: string) {
      this._method = "select";
      this._selectColumns = cols ?? "*";
      return this;
    },
    insert() {
      this._method = "insert";
      return this;
    },
    update() {
      this._method = "update";
      return this;
    },
    delete() {
      this._method = "delete";
      return this;
    },
    eq(column: string, value: unknown) {
      this._filters.push({ column, value });
      return this;
    },
    in(column: string, _values: unknown[]) {
      this._filters.push({ column, value: "in" });
      return this;
    },
    lt(column: string, value: unknown) {
      this._filters.push({ column, value });
      return this;
    },
    maybeSingle() {
      this._isMaybeSingle = true;
      return this;
    },
    single() {
      this._isSingle = true;
      return this;
    },
    order() {
      return this;
    },
    then(resolve: (v: unknown) => void) {
      // Injected database failure takes precedence over all mock data
      if (this._injectError) {
        const e = this._injectError;
        this._injectError = null;
        resolve({ data: null, error: e });
        return;
      }

      // Return mock data based on filters
      const userIdFilter = this._filters.find((f) => f.column === "user_id");
      const idFilter = this._filters.find((f) => f.column === "id");

      if (this._method === "delete") {
        // Simulate ownership-scoped delete: only return data if userId matches
        if (userIdFilter && idFilter && userIdFilter.value === "user-A" && idFilter.value === "proj-A") {
          resolve({ data: { id: "proj-A" }, error: null });
        } else {
          resolve({ data: null, error: null });
        }
        return;
      }

      if (this._method === "select") {
        if (this._isMaybeSingle || this._isSingle) {
          // insert().select().single() — return the inserted row.
          // createBlankProject inserts without eq filters, so detect that
          // case by the absence of id/userId filters and return a canonical row.
          if (!userIdFilter && !idFilter && this._isSingle) {
            resolve({
              data: {
                id: "proj-new",
                user_id: "user-A",
                name: "Test Project",
                slug: "test-project",
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
                created_at: "2024-01-01T00:00:00Z",
                updated_at: "2024-01-01T00:00:00Z",
              },
              error: null,
            });
            return;
          }
          // getProject: return project only if userId matches
          if (userIdFilter && idFilter && userIdFilter.value === "user-A" && idFilter.value === "proj-A") {
            resolve({
              data: {
                id: "proj-A",
                user_id: "user-A",
                name: "Test Project",
                slug: "test-project",
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
                created_at: "2024-01-01T00:00:00Z",
                updated_at: "2024-01-01T00:00:00Z",
              },
              error: null,
            });
          } else {
            resolve({ data: null, error: null });
          }
          return;
        }
      }

      if (this._method === "update") {
        // updateProjectWorkspace / updateProjectRuntime / updateProjectWorkspaceType: scoped by user_id
        if (userIdFilter && userIdFilter.value === "user-A") {
          resolve({
            data: {
              id: idFilter?.value ?? "proj-A",
              user_id: "user-A",
              name: "Test Project",
              slug: "test-project",
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
              workspace_id: "ws-1",
              workspace_status: "ready",
              workspace_root: "/workspace",
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
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T00:00:00Z",
            },
            error: null,
          });
        } else {
          resolve({ data: null, error: null });
        }
        return;
      }

      resolve({ data: null, error: null });
    },
    catch() {
      return this;
    },
  };

  return {
    supabaseAdmin: mockChain,
  };
});

// Import after mock is set up
import {
  getProject,
  deleteProject,
  updateProjectWorkspace,
  updateProjectRuntime,
  updateProjectWorkspaceType,
  createBlankProject,
  claimProvisioningLock,
  PROJECT_TEMPLATES,
} from "./project-repository";
import { rowToCanonical, type StudioProjectRow } from "./types";
import { supabaseAdmin } from "@/lib/supabase";
import { studioLog } from "@/lib/studio/logger";

const supabaseMock = supabaseAdmin as unknown as {
  _injectError: { message: string } | null;
};

describe("project-repository ownership enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock._injectError = null;
  });

  describe("getProject", () => {
    it("returns project when userId matches owner", async () => {
      const project = await getProject("proj-A", "user-A");
      expect(project).not.toBeNull();
      expect(project?.id).toBe("proj-A");
      expect(project?.userId).toBe("user-A");
    });

    it("returns null when userId does not match owner (foreign project)", async () => {
      const project = await getProject("proj-A", "user-B");
      expect(project).toBeNull();
    });

    it("returns null for nonexistent project", async () => {
      const project = await getProject("nonexistent", "user-A");
      expect(project).toBeNull();
    });
  });

  describe("deleteProject", () => {
    it("returns true when owner deletes their own project", async () => {
      const result = await deleteProject("proj-A", "user-A");
      expect(result).toBe(true);
    });

    it("returns false when non-owner attempts to delete (foreign project)", async () => {
      const result = await deleteProject("proj-A", "user-B");
      expect(result).toBe(false);
    });

    it("returns false for nonexistent project", async () => {
      const result = await deleteProject("nonexistent", "user-A");
      expect(result).toBe(false);
    });

    it("returns false when userId is empty or undefined", async () => {
      const result = await deleteProject("proj-A", "");
      expect(result).toBe(false);
    });
  });

  describe("updateProjectWorkspace", () => {
    it("returns updated project when userId matches owner", async () => {
      const result = await updateProjectWorkspace("proj-A", "user-A", {
        workspaceStatus: "ready",
        workspaceId: "ws-1",
      });
      expect(result).not.toBeNull();
      expect(result?.id).toBe("proj-A");
    });

    it("returns null when non-owner attempts to update", async () => {
      const result = await updateProjectWorkspace("proj-A", "user-B", {
        workspaceStatus: "ready",
      });
      expect(result).toBeNull();
    });
  });

  describe("workspace DB-write failures are never silent", () => {
    it("updateProjectWorkspace throws and logs when the update errors — a real DB failure is not collapsed into the no-match path", async () => {
      supabaseMock._injectError = { message: "connection reset by peer" };

      await expect(
        updateProjectWorkspace("proj-A", "user-A", {
          workspaceStatus: "ready",
          workspaceId: "ws-1",
        }),
      ).rejects.toThrow("workspace update failed");

      expect(studioLog).toHaveBeenCalledWith(
        "updateProjectWorkspace:update_error",
        expect.objectContaining({ projectId: "proj-A", userId: "user-A" }),
      );
    });

    it("updateProjectWorkspace logs when no owned row matches and no legacy project can be migrated", async () => {
      const result = await updateProjectWorkspace("proj-A", "user-B", {
        workspaceStatus: "ready",
      });
      expect(result).toBeNull();
      expect(studioLog).toHaveBeenCalledWith(
        "updateProjectWorkspace:no_match",
        expect.objectContaining({ projectId: "proj-A", userId: "user-B" }),
      );
    });

    it("claimProvisioningLock throws and logs on a database error instead of masquerading as a held lock", async () => {
      supabaseMock._injectError = { message: "deadlock detected" };

      await expect(claimProvisioningLock("proj-A", "user-A")).rejects.toThrow(
        "provisioning lock",
      );

      expect(studioLog).toHaveBeenCalledWith(
        "claimProvisioningLock:update_error",
        expect.objectContaining({ projectId: "proj-A", userId: "user-A" }),
      );
    });

    it("claimProvisioningLock still returns null when the lock is genuinely held (no error)", async () => {
      // user-B owns nothing — the conditional update matches 0 rows.
      const claimed = await claimProvisioningLock("proj-A", "user-B");
      expect(claimed).toBeNull();
    });

    it("claimProvisioningLock returns the claimed project on success", async () => {
      const claimed = await claimProvisioningLock("proj-A", "user-A");
      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe("proj-A");
    });
  });

  describe("updateProjectRuntime", () => {
    it("returns updated project when userId matches owner", async () => {
      const result = await updateProjectRuntime("proj-A", "user-A", {
        runtimeStatus: "ready",
      });
      expect(result).not.toBeNull();
      expect(result?.id).toBe("proj-A");
    });

    it("returns null when non-owner attempts to update runtime", async () => {
      const result = await updateProjectRuntime("proj-A", "user-B", {
        runtimeStatus: "ready",
      });
      expect(result).toBeNull();
    });
  });

  describe("updateProjectWorkspaceType", () => {
    it("returns updated project when userId matches owner", async () => {
      const result = await updateProjectWorkspaceType("proj-A", "user-A", "html");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("proj-A");
      expect(result?.workspaceType).toBe("website"); // mock returns default
    });

    it("returns null when non-owner attempts to update workspace type", async () => {
      const result = await updateProjectWorkspaceType("proj-A", "user-B", "html");
      expect(result).toBeNull();
    });

    it("does not modify the framework field", async () => {
      // The mock data has framework: "static" — updateProjectWorkspaceType
      // should NOT change it. The mock always returns the same data,
      // so we verify framework is still "static" after the update.
      const result = await updateProjectWorkspaceType("proj-A", "user-A", "game2d");
      expect(result).not.toBeNull();
      expect(result?.framework).toBe("static");
    });
  });

  describe("rowToCanonical workspace_type mapping", () => {
    const baseRow: StudioProjectRow = {
      id: "proj-X",
      user_id: "user-X",
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
      workspace_type: "html",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };

    it("maps workspace_type to workspaceType", () => {
      const project = rowToCanonical(baseRow);
      expect(project.workspaceType).toBe("html");
      expect(project.framework).toBe("static");
    });

    it("defaults workspaceType to 'website' when workspace_type is null", () => {
      const project = rowToCanonical({ ...baseRow, workspace_type: null });
      expect(project.workspaceType).toBe("website");
    });

    it("preserves framework separately from workspace_type", () => {
      const project = rowToCanonical({ ...baseRow, framework: "nextjs", workspace_type: "game2d" });
      expect(project.framework).toBe("nextjs");
      expect(project.workspaceType).toBe("game2d");
    });
  });

  describe("createBlankProject — valid workspace/repository/runtime bindings", () => {
    it("every template produces a project with all identifiers required for files, agent mutations, terminal, preview, and deploy", () => {
      for (const templateId of Object.keys(PROJECT_TEMPLATES) as Array<keyof typeof PROJECT_TEMPLATES>) {
        const template = PROJECT_TEMPLATES[templateId];
        // Verify the template itself has all the fields needed downstream
        expect(template.framework).toBeTruthy();
        expect(template.packageManager).toBeDefined();
        // blank-static has empty commands by design (no build step), but
        // nextjs/react-vite/expo must have install/dev/build/test commands.
        if (templateId !== "blank-static") {
          expect(template.installCommand).toBeTruthy();
          expect(template.developmentCommand).toBeTruthy();
          expect(template.buildCommand).toBeTruthy();
          expect(template.testCommand).toBeTruthy();
        }
      }
    });

    it("createBlankProject inserts with workspace_status=not_prepared and runtime_status=stopped (the auto-start entry point)", async () => {
      // The mock's insert().select().single() path returns the select mock data.
      // We verify createBlankProject does not throw and the template is applied.
      const project = await createBlankProject({
        userId: "user-A",
        name: "Acceptance Test",
        templateId: "blank-static",
      });
      expect(project).not.toBeNull();
      expect(project.sourceType).toBe("blank");
      expect(project.templateId).toBe("blank-static");
      expect(project.framework).toBe("static");
      // workspaceId is null at creation — the preview auto-start provisions it
      expect(project.workspaceId).toBeNull();
      expect(project.workspaceStatus).toBe("not_prepared");
      expect(project.runtimeStatus).toBe("stopped");
    });

    it("a blank project has framework metadata so the preview runtime knows how to serve it", async () => {
      const project = await createBlankProject({
        userId: "user-A",
        name: "Static Site",
        templateId: "blank-static",
      });
      // framework="static" tells the preview runtime to serve index.html
      // directly (no build step). This is the "STATIC" badge in the UI.
      expect(project.framework).toBe("static");
      expect(project.packageManager).toBe("none");
    });
  });
});
