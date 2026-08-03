import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabaseAdmin before importing the repository
vi.mock("@/lib/supabase", () => {
  const mockChain = {
    _table: "" as string,
    _filters: [] as Array<{ column: string; value: unknown }>,
    _method: "" as string,
    _selectColumns: "" as string,
    _isMaybeSingle: false,
    _isSingle: false,

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
        // updateProjectWorkspace / updateProjectRuntime: scoped by user_id
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
} from "./project-repository";

describe("project-repository ownership enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
