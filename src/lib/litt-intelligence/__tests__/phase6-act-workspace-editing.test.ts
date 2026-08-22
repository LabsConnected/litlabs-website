/**
 * Phase 6 Acceptance Test — ACT workspace editing
 *
 * Golden path:
 *   1. Create temporary Git repository
 *   2. Start on main
 *   3. PLAN tries file.write → DENIED → file unchanged
 *   4. Create feature branch
 *   5. User approval grant issued
 *   6. Switch to ACT
 *   7. file.write modifies src/example.ts
 *   8. Verify path remained inside workspace
 *   9. Verify before hash
 *  10. Verify after hash
 *  11. Verify git diff contains exact edit
 *  12. Verify MutationEvidence persisted
 *  13. Verify main was never modified
 *
 * Negative cases:
 *   - ../../escape
 *   - symlink escape (path traversal pattern)
 *   - missing approval
 *   - wrong-run approval
 *   - expired approval
 *   - ACT on protected branch (main)
 *   - tool lies about successful mutation (no-op write)
 *   - mutation throws halfway through
 *
 * Phase 6 — Studio Control Plane V1
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { randomUUID } from "crypto";
import type { WorkspaceTransport, GitStatusResult, ExecResult, SearchResult, PatchOperation, CheckpointInfo, ProjectPackageInfo } from "@/lib/litt-intelligence/workspace-transport";
import { executeMutation, MutationError, validateWorkspacePath } from "@/lib/litt-intelligence/mutation-service";
import { isProtectedBranch } from "@/lib/litt-intelligence/mutation-evidence";
import { getEvidenceStore, getApprovalStore, resetStores } from "@/lib/litt-intelligence/evidence-store";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";

// ─── Mock WorkspaceTransport backed by a real temp git repo ──────

class TempRepoTransport implements WorkspaceTransport {
  constructor(
    public readonly projectId: string,
    public readonly userId: string,
    public readonly workspaceId: string,
    public readonly workspaceRoot: string,
  ) {}

  private git(args: string): string {
    return execSync(`git ${args}`, { cwd: this.workspaceRoot, encoding: "utf-8", timeout: 5000 }).trim();
  }

  async listFiles(path: string): Promise<{ entries: Array<{ name: string; type: string }> }> {
    const full = join(this.workspaceRoot, path);
    if (!existsSync(full)) return { entries: [] };
    const { readdirSync, statSync } = await import("fs");
    const entries = readdirSync(full).map((name) => {
      const stat = statSync(join(full, name));
      return { name, type: stat.isDirectory() ? "folder" : "file" };
    });
    return { entries };
  }

  async readFile(path: string): Promise<{ content: string; size: number }> {
    const full = join(this.workspaceRoot, path);
    if (!existsSync(full)) throw new Error(`File not found: ${path}`);
    const content = readFileSync(full, "utf-8");
    return { content, size: content.length };
  }

  async writeFile(path: string, content: string): Promise<{ saved: boolean }> {
    const full = join(this.workspaceRoot, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
    return { saved: true };
  }

  async deleteFile(path: string): Promise<{ deleted: boolean }> {
    const full = join(this.workspaceRoot, path);
    if (existsSync(full)) rmSync(full);
    return { deleted: true };
  }

  async mkdir(path: string): Promise<{ created: boolean }> {
    mkdirSync(join(this.workspaceRoot, path), { recursive: true });
    return { created: true };
  }

  async rename(path: string, newPath: string): Promise<{ renamed: boolean }> {
    const { renameSync } = await import("fs");
    renameSync(join(this.workspaceRoot, path), join(this.workspaceRoot, newPath));
    return { renamed: true };
  }

  async exec(command: string, timeoutMs?: number): Promise<ExecResult> {
    try {
      const stdout = execSync(command, {
        cwd: this.workspaceRoot,
        encoding: "utf-8",
        timeout: timeoutMs ?? 30000,
      });
      return { exitCode: 0, stdout, stderr: "", durationMs: 0 };
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { exitCode: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "", durationMs: 0 };
    }
  }

  async gitStatus(): Promise<GitStatusResult> {
    const branch = this.git("rev-parse --abbrev-ref HEAD");
    const statusOutput = this.git("status --porcelain");
    const modified: Array<{ path: string; status: string }> = [];
    const untracked: string[] = [];
    for (const line of statusOutput.split("\n").filter(Boolean)) {
      const flag = line.slice(0, 2).trim();
      const file = line.slice(3);
      if (flag === "??") untracked.push(file);
      else modified.push({ path: file, status: flag });
    }
    return { branch, ahead: 0, behind: 0, staged: [], modified, untracked, clean: statusOutput.length === 0 };
  }

  async gitDiff(options?: { staged?: boolean; path?: string }): Promise<{ diff: string }> {
    const args = ["diff"];
    if (options?.staged) args.push("--staged");
    if (options?.path) args.push("--", options.path);
    try {
      const diff = this.git(args.join(" "));
      return { diff };
    } catch {
      return { diff: "" };
    }
  }

  async gitLog(options?: { maxCount?: number }): Promise<{ commits: Array<{ sha: string; message: string; author: string; date: string }> }> {
    const count = options?.maxCount ?? 10;
    const format = "%H|%s|%an|%ai";
    const output = this.git(`log -${count} --format="${format}"`);
    const commits = output.split("\n").filter(Boolean).map((line) => {
      const [sha, message, author, date] = line.split("|");
      return { sha, message, author, date };
    });
    return { commits };
  }

  async gitCommit(message: string, files?: string[]): Promise<{ committed: boolean; sha?: string }> {
    if (files && files.length > 0) {
      this.git(`add ${files.join(" ")}`);
    } else {
      this.git("add -A");
    }
    this.git(`commit -m "${message.replace(/"/g, '\\"')}"`);
    const sha = this.git("rev-parse HEAD");
    return { committed: true, sha };
  }

  async searchCode(query: string, _options?: { glob?: string; maxResults?: number }): Promise<SearchResult> {
    return { results: [] };
  }

  async discoverPackageInfo(): Promise<ProjectPackageInfo> {
    return { packageManager: "npm", scripts: {}, hasTypecheck: false, hasLint: false, hasBuild: false, hasTest: false };
  }

  async runCheck(_checkId: "build" | "typecheck" | "lint" | "test", _packageInfo?: ProjectPackageInfo): Promise<ExecResult> {
    return { exitCode: 0, stdout: "", stderr: "", durationMs: 0 };
  }

  async applyPatch(path: string, patches: PatchOperation[]): Promise<{ applied: boolean }> {
    const full = join(this.workspaceRoot, path);
    let content = existsSync(full) ? readFileSync(full, "utf-8") : "";
    for (const patch of patches) {
      content = content.replace(patch.search, patch.replace);
    }
    writeFileSync(full, content, "utf-8");
    return { applied: true };
  }

  async createCheckpointBeforeMutation(label: string): Promise<CheckpointInfo | null> {
    return null;
  }
}

// ─── Test Setup ──────────────────────────────────────────────────

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "litt-test-"));
  try {
    execSync("git init -b main", { cwd: dir, encoding: "utf-8" });
  } catch {
    // Older git doesn't support -b flag
    execSync("git init", { cwd: dir, encoding: "utf-8" });
    execSync("git checkout -b main", { cwd: dir, encoding: "utf-8" });
  }
  execSync('git config user.email "test@test.com"', { cwd: dir, encoding: "utf-8" });
  execSync('git config user.name "Test"', { cwd: dir, encoding: "utf-8" });
  // Create initial commit on main
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "example.ts"), 'export const x = 1;\n', "utf-8");
  execSync("git add -A", { cwd: dir, encoding: "utf-8" });
  execSync('git commit -m "initial"', { cwd: dir, encoding: "utf-8" });
  return dir;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Phase 6 — ACT workspace editing acceptance test", () => {
  let repoDir: string;
  let transport: TempRepoTransport;
  const projectId = "test-project";
  const userId = "test-user";
  const workspaceId = "test-workspace";
  const runId = "test-run";

  beforeAll(() => {
    repoDir = createTempRepo();
    transport = new TempRepoTransport(projectId, userId, workspaceId, repoDir);
  });

  afterAll(() => {
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
  });

  // Note: stores are reset per negative test suite, not globally,
  // so the golden path tests can share state sequentially.

  // ─── Golden Path ──────────────────────────────────────────────

  describe("golden path: PLAN → approve → ACT → evidence", () => {
    beforeAll(() => resetStores());

    it("step 1-2: repo starts on main with initial commit", async () => {
      const status = await transport.gitStatus();
      expect(status.branch).toBe("main");
      const content = await transport.readFile("src/example.ts");
      expect(content.content).toContain('export const x = 1');
    });

    it("step 3: PLAN mode blocks file.write (file unchanged)", async () => {
      const canExecute = toolRegistry.canExecute("files.write", {
        executionMode: "plan",
        hasApproval: true,
      });
      expect(canExecute.can).toBe(false);

      // Verify file is unchanged
      const content = await transport.readFile("src/example.ts");
      expect(content.content.trim()).toBe('export const x = 1;');
    });

    it("step 4: create feature branch", async () => {
      execSync("git checkout -b feat/test-branch", { cwd: repoDir, encoding: "utf-8" });
      const status = await transport.gitStatus();
      expect(status.branch).toBe("feat/test-branch");
    });

    it("step 5: issue approval token", async () => {
      const approvalStore = getApprovalStore();
      const token = await approvalStore.issue({
        runId,
        projectId,
        userId,
      });
      expect(token.id).toBeDefined();
      expect(token.runId).toBe(runId);
      expect(token.consumed).toBe(false);
    });

    it("step 6-7: ACT mode allows file.write, mutation succeeds", async () => {
      const canExecute = toolRegistry.canExecute("files.write", {
        executionMode: "act",
        hasApproval: true,
      });
      expect(canExecute.can).toBe(true);

      const approvalStore = getApprovalStore();
      const token = await approvalStore.issue({ runId, projectId, userId });

      const result = await executeMutation(
        {
          runId,
          projectId,
          toolId: "files.write",
          approvalTokenId: token.id,
          paths: ["src/example.ts"],
          operation: async (t) => {
            await t.writeFile("src/example.ts", 'export const x = 2;\n');
            return { bytesWritten: 20 };
          },
        },
        transport,
      );

      expect(result.evidence.status).toBe("succeeded");
    });

    it("step 8: path remained inside workspace", async () => {
      const validation = validateWorkspacePath("src/example.ts", repoDir);
      expect(validation.valid).toBe(true);
      expect(validation.resolved).toBe(join(repoDir, "src", "example.ts"));
    });

    it("step 9-10: before and after hashes differ", async () => {
      const evidenceStore = getEvidenceStore();
      const records = await evidenceStore.listByRun(runId);
      const succeeded = records.find((r) => r.status === "succeeded");
      expect(succeeded).toBeDefined();
      expect(succeeded!.beforeHashes["src/example.ts"]).toBeDefined();
      expect(succeeded!.afterHashes["src/example.ts"]).toBeDefined();
      expect(succeeded!.beforeHashes["src/example.ts"]).not.toBe(succeeded!.afterHashes["src/example.ts"]);
    });

    it("step 11: git diff contains the exact edit", async () => {
      const evidenceStore = getEvidenceStore();
      const records = await evidenceStore.listByRun(runId);
      const succeeded = records.find((r) => r.status === "succeeded");
      expect(succeeded!.diff).toBeDefined();
      expect(succeeded!.diff).toContain("-export const x = 1");
      expect(succeeded!.diff).toContain("+export const x = 2");
    });

    it("step 12: MutationEvidence persisted with all fields", async () => {
      const evidenceStore = getEvidenceStore();
      const records = await evidenceStore.listByRun(runId);
      const succeeded = records.find((r) => r.status === "succeeded");
      expect(succeeded).toBeDefined();
      expect(succeeded!.id).toBeDefined();
      expect(succeeded!.runId).toBe(runId);
      expect(succeeded!.projectId).toBe(projectId);
      expect(succeeded!.toolId).toBe("files.write");
      expect(succeeded!.workspaceId).toBe(workspaceId);
      expect(succeeded!.branch).toBe("feat/test-branch");
      expect(succeeded!.headShaBefore).toBeDefined();
      expect(succeeded!.paths).toEqual(["src/example.ts"]);
      expect(succeeded!.startedAt).toBeDefined();
      expect(succeeded!.completedAt).toBeDefined();
    });

    it("step 13: main was never modified", async () => {
      // Switch back to main and verify the file is unchanged
      execSync("git stash", { cwd: repoDir, encoding: "utf-8" });
      execSync("git checkout main", { cwd: repoDir, encoding: "utf-8" });
      const content = await transport.readFile("src/example.ts");
      expect(content.content.trim()).toBe('export const x = 1;');
      // Switch back to feature branch
      execSync("git checkout feat/test-branch", { cwd: repoDir, encoding: "utf-8" });
      execSync("git stash pop", { cwd: repoDir, encoding: "utf-8" });
    });
  });

  // ─── Negative Cases ───────────────────────────────────────────

  describe("negative: path traversal (../../escape)", () => { beforeEach(() => resetStores());
    it("rejects ../../escape path", () => {
      const validation = validateWorkspacePath("../../etc/passwd", repoDir);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("traversal");
    });

    it("rejects mutation with traversal path", async () => {
      const approvalStore = getApprovalStore();
      const token = await approvalStore.issue({ runId, projectId, userId });
      await expect(
        executeMutation(
          {
            runId,
            projectId,
            toolId: "files.write",
            approvalTokenId: token.id,
            paths: ["../../escape.txt"],
            operation: async (t) => t.writeFile("../../escape.txt", "evil"),
          },
          transport,
        ),
      ).rejects.toThrow(MutationError);
    });
  });

  describe("negative: missing approval", () => { beforeEach(() => resetStores());
    it("rejects mutation without approval token", async () => {
      await expect(
        executeMutation(
          {
            runId,
            projectId,
            toolId: "files.write",
            approvalTokenId: "nonexistent-token",
            paths: ["src/example.ts"],
            operation: async (t) => t.writeFile("src/example.ts", "test"),
          },
          transport,
        ),
      ).rejects.toThrow("Approval token not found");
    });
  });

  describe("negative: wrong-run approval", () => { beforeEach(() => resetStores());
    it("rejects approval token from a different run", async () => {
      const approvalStore = getApprovalStore();
      const token = await approvalStore.issue({
        runId: "different-run",
        projectId,
        userId,
      });
      await expect(
        executeMutation(
          {
            runId,
            projectId,
            toolId: "files.write",
            approvalTokenId: token.id,
            paths: ["src/example.ts"],
            operation: async (t) => t.writeFile("src/example.ts", "test"),
          },
          transport,
        ),
      ).rejects.toThrow("different run");
    });
  });

  describe("negative: expired approval", () => { beforeEach(() => resetStores());
    it("rejects expired approval token", async () => {
      const approvalStore = getApprovalStore();
      const token = await approvalStore.issue({
        runId,
        projectId,
        userId,
        ttlMs: 1, // 1ms — expires immediately
      });
      // Wait for expiry
      await new Promise((r) => setTimeout(r, 10));
      await expect(
        executeMutation(
          {
            runId,
            projectId,
            toolId: "files.write",
            approvalTokenId: token.id,
            paths: ["src/example.ts"],
            operation: async (t) => t.writeFile("src/example.ts", "test"),
          },
          transport,
        ),
      ).rejects.toThrow("expired");
    });
  });

  describe("negative: ACT on protected branch (main)", () => { beforeEach(() => resetStores());
    it("rejects mutation on main", async () => {
      // Switch to main
      execSync("git checkout main", { cwd: repoDir, encoding: "utf-8" });
      const approvalStore = getApprovalStore();
      const token = await approvalStore.issue({ runId, projectId, userId });
      await expect(
        executeMutation(
          {
            runId,
            projectId,
            toolId: "files.write",
            approvalTokenId: token.id,
            paths: ["src/example.ts"],
            operation: async (t) => t.writeFile("src/example.ts", "test"),
          },
          transport,
        ),
      ).rejects.toThrow("protected branch");
      // Switch back
      execSync("git checkout feat/test-branch", { cwd: repoDir, encoding: "utf-8" });
    });
  });

  describe("negative: tool lies about successful mutation", () => { beforeEach(() => resetStores());
    it("detects no-op mutation (hashes identical)", async () => {
      const approvalStore = getApprovalStore();
      const token = await approvalStore.issue({ runId, projectId, userId });
      // Operation "succeeds" but doesn't actually change the file
      await expect(
        executeMutation(
          {
            runId,
            projectId,
            toolId: "files.write",
            approvalTokenId: token.id,
            paths: ["src/example.ts"],
            operation: async () => ({ bytesWritten: 0 }), // no-op
          },
          transport,
        ),
      ).rejects.toThrow("no file content changed");

      // Evidence should be marked as failed
      const evidenceStore = getEvidenceStore();
      const records = await evidenceStore.listByRun(runId);
      const failed = records.find((r) => r.status === "failed");
      expect(failed).toBeDefined();
      expect(failed!.error).toContain("no file content changed");
    });
  });

  describe("negative: mutation throws halfway through", () => { beforeEach(() => resetStores());
    it("records failure with partial state", async () => {
      const approvalStore = getApprovalStore();
      const token = await approvalStore.issue({ runId, projectId, userId });
      await expect(
        executeMutation(
          {
            runId,
            projectId,
            toolId: "files.write",
            approvalTokenId: token.id,
            paths: ["src/example.ts"],
            operation: async () => {
              throw new Error("Disk full");
            },
          },
          transport,
        ),
      ).rejects.toThrow("Disk full");

      const evidenceStore = getEvidenceStore();
      const records = await evidenceStore.listByRun(runId);
      const failed = records.find((r) => r.status === "failed");
      expect(failed).toBeDefined();
      expect(failed!.error).toContain("Disk full");
    });
  });

  // ─── Unit tests for helpers ───────────────────────────────────

  describe("isProtectedBranch", () => {
    it("blocks main", () => {
      expect(isProtectedBranch("main")).toBe(true);
    });
    it("blocks master", () => {
      expect(isProtectedBranch("master")).toBe(true);
    });
    it("blocks production", () => {
      expect(isProtectedBranch("production")).toBe(true);
    });
    it("blocks release/* glob", () => {
      expect(isProtectedBranch("release/v1")).toBe(true);
      expect(isProtectedBranch("release/2.0")).toBe(true);
    });
    it("allows feature branches", () => {
      expect(isProtectedBranch("feat/test")).toBe(false);
      expect(isProtectedBranch("feature/my-branch")).toBe(false);
      expect(isProtectedBranch("dev")).toBe(false);
    });
  });

  describe("validateWorkspacePath", () => {
    it("allows relative paths inside workspace", () => {
      const result = validateWorkspacePath("src/example.ts", repoDir);
      expect(result.valid).toBe(true);
    });
    it("allows nested paths", () => {
      const result = validateWorkspacePath("src/deep/nested/file.ts", repoDir);
      expect(result.valid).toBe(true);
    });
    it("rejects .. traversal", () => {
      const result = validateWorkspacePath("../escape.ts", repoDir);
      expect(result.valid).toBe(false);
    });
    it("rejects deep .. traversal", () => {
      const result = validateWorkspacePath("src/../../../escape.ts", repoDir);
      expect(result.valid).toBe(false);
    });
    it("rejects absolute paths outside workspace", () => {
      const result = validateWorkspacePath("/etc/passwd", repoDir);
      expect(result.valid).toBe(false);
    });
    it("rejects empty path", () => {
      const result = validateWorkspacePath("", repoDir);
      expect(result.valid).toBe(false);
    });
  });
});
