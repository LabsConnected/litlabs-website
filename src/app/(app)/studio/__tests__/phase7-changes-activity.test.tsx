/**
 * Phase 7 Acceptance Test — Changes + Activity wired to real evidence
 *
 * Gate:
 *   ACT mutation
 *   → persisted evidence
 *   → Changes updates
 *   → Activity updates
 *   → reload (re-fetch)
 *   → same evidence still exists
 *
 * Phase 7 — Studio Control Plane V1
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { createHash } from "crypto";
import type { WorkspaceTransport, GitStatusResult, ExecResult, SearchResult, PatchOperation, CheckpointInfo, ProjectPackageInfo } from "@/lib/litt-intelligence/workspace-transport";
import { executeMutation } from "@/lib/litt-intelligence/mutation-service";
import { getEvidenceStore, getApprovalStore, resetStores } from "@/lib/litt-intelligence/evidence-store";
import { getRunEventStore, resetRunEventStore } from "@/lib/litt-intelligence/run-event-store";
import { createRunEvent } from "@/lib/litt-intelligence/run-events";
import { StudioChangesPanel } from "@/app/(app)/studio/components/StudioChangesPanel";
import { StudioActivityEvents } from "@/app/(app)/studio/components/StudioActivityEvents";
import { render } from "@testing-library/react";

// ─── Mock Transport (same as Phase 6 test) ───────────────────────

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

  async listFiles(_path: string): Promise<{ entries: Array<{ name: string; type: string }> }> { return { entries: [] }; }
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
  async mkdir(path: string): Promise<{ created: boolean }> { mkdirSync(join(this.workspaceRoot, path), { recursive: true }); return { created: true }; }
  async rename(_path: string, _newPath: string): Promise<{ renamed: boolean }> { return { renamed: true }; }
  async exec(command: string, timeoutMs?: number): Promise<ExecResult> {
    try {
      const stdout = execSync(command, { cwd: this.workspaceRoot, encoding: "utf-8", timeout: timeoutMs ?? 30000 });
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
    try { return { diff: this.git(args.join(" ")) }; } catch { return { diff: "" }; }
  }
  async gitLog(options?: { maxCount?: number }): Promise<{ commits: Array<{ sha: string; message: string; author: string; date: string }> }> {
    const count = options?.maxCount ?? 10;
    const output = this.git(`log -${count} --format="%H|%s|%an|%ai"`);
    const commits = output.split("\n").filter(Boolean).map((line) => {
      const [sha, message, author, date] = line.split("|");
      return { sha, message, author, date };
    });
    return { commits };
  }
  async gitCommit(message: string, files?: string[]): Promise<{ committed: boolean; sha?: string }> {
    if (files && files.length > 0) this.git(`add ${files.join(" ")}`);
    else this.git("add -A");
    this.git(`commit -m "${message.replace(/"/g, '\\"')}"`);
    return { committed: true, sha: this.git("rev-parse HEAD") };
  }
  async searchCode(_q: string): Promise<SearchResult> { return { results: [] }; }
  async discoverPackageInfo(): Promise<ProjectPackageInfo> { return { packageManager: "npm", scripts: {}, hasTypecheck: false, hasLint: false, hasBuild: false, hasTest: false }; }
  async runCheck(): Promise<ExecResult> { return { exitCode: 0, stdout: "", stderr: "", durationMs: 0 }; }
  async applyPatch(path: string, patches: PatchOperation[]): Promise<{ applied: boolean }> {
    const full = join(this.workspaceRoot, path);
    let content = existsSync(full) ? readFileSync(full, "utf-8") : "";
    for (const patch of patches) content = content.replace(patch.search, patch.replace);
    writeFileSync(full, content, "utf-8");
    return { applied: true };
  }
  async createCheckpointBeforeMutation(): Promise<CheckpointInfo | null> { return null; }
}

// ─── Setup ───────────────────────────────────────────────────────

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "litt-p7-"));
  try { execSync("git init -b main", { cwd: dir, encoding: "utf-8" }); }
  catch { execSync("git init", { cwd: dir, encoding: "utf-8" }); execSync("git checkout -b main", { cwd: dir, encoding: "utf-8" }); }
  execSync('git config user.email "test@test.com"', { cwd: dir, encoding: "utf-8" });
  execSync('git config user.name "Test"', { cwd: dir, encoding: "utf-8" });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "app.ts"), 'export const x = 1;\n', "utf-8");
  execSync("git add -A", { cwd: dir, encoding: "utf-8" });
  execSync('git commit -m "initial"', { cwd: dir, encoding: "utf-8" });
  return dir;
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Phase 7 — Changes + Activity wired to real evidence", () => {
  let repoDir: string;
  let transport: TempRepoTransport;
  const projectId = "p7-test-project";
  const userId = "p7-test-user";
  const workspaceId = "p7-test-workspace";
  const runId = "p7-test-run";

  beforeAll(() => {
    repoDir = createTempRepo();
    transport = new TempRepoTransport(projectId, userId, workspaceId, repoDir);
    execSync("git checkout -b feat/p7-test", { cwd: repoDir, encoding: "utf-8" });
  });

  afterAll(() => {
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetStores();
    resetRunEventStore();
  });

  it("ACT mutation → persisted evidence → Changes panel renders", async () => {
    // 1. Issue approval
    const approvalStore = getApprovalStore();
    const token = await approvalStore.issue({ runId, projectId, userId });

    // 2. Record run events
    const runEventStore = getRunEventStore();
    await runEventStore.insert(createRunEvent(runId, projectId, "plan_created", {}));
    await runEventStore.insert(createRunEvent(runId, projectId, "approval_requested", { toolId: "files.write" }));
    await runEventStore.insert(createRunEvent(runId, projectId, "approval_granted", {}, { evidenceId: token.id }));

    // 3. Execute mutation
    const result = await executeMutation(
      {
        runId,
        projectId,
        toolId: "files.write",
        approvalTokenId: token.id,
        paths: ["src/app.ts"],
        operation: async (t) => {
          await t.writeFile("src/app.ts", 'export const x = 2;\n');
          return { bytesWritten: 20 };
        },
      },
      transport,
    );

    // 4. Record post-mutation events
    await runEventStore.insert(createRunEvent(runId, projectId, "file_changed", { path: "src/app.ts" }, { evidenceId: result.evidence.id }));
    await runEventStore.insert(createRunEvent(runId, projectId, "diff_captured", {}, { evidenceId: result.evidence.id }));
    await runEventStore.insert(createRunEvent(runId, projectId, "mutation_verified", {}, { evidenceId: result.evidence.id }));
    await runEventStore.insert(createRunEvent(runId, projectId, "act_completed", {}));

    // 5. Verify evidence persisted
    const evidenceStore = getEvidenceStore();
    const records = await evidenceStore.listByRun(runId);
    expect(records.length).toBe(1);
    expect(records[0].status).toBe("succeeded");

    // 6. Changes panel renders real data
    const { getByTestId } = render(<StudioChangesPanel evidence={records} loading={false} />);
    expect(getByTestId("studio-changes-panel")).toBeDefined();
    expect(getByTestId("changes-mutation-status").textContent).toBe("succeeded");
    expect(getByTestId("changes-worktree-status").textContent).toContain("Dirty");
    expect(getByTestId("changes-file-src/app.ts")).toBeDefined();
    expect(getByTestId("changes-diff").textContent).toContain("export const x = 2");
  });

  it("Activity panel renders chronological run events", async () => {
    const runEventStore = getRunEventStore();
    await runEventStore.insert(createRunEvent(runId, projectId, "plan_created", {}));
    await runEventStore.insert(createRunEvent(runId, projectId, "approval_requested", { toolId: "files.write" }));
    await runEventStore.insert(createRunEvent(runId, projectId, "approval_granted", {}));
    await runEventStore.insert(createRunEvent(runId, projectId, "act_started", {}));
    await runEventStore.insert(createRunEvent(runId, projectId, "file_changed", { path: "src/app.ts" }));
    await runEventStore.insert(createRunEvent(runId, projectId, "mutation_verified", {}));
    await runEventStore.insert(createRunEvent(runId, projectId, "act_completed", {}));

    const events = await runEventStore.listByRun(runId);
    expect(events.length).toBe(7);

    const { getByTestId } = render(<StudioActivityEvents events={events} loading={false} />);
    expect(getByTestId("studio-activity-events")).toBeDefined();
    expect(getByTestId("activity-event-plan_created")).toBeDefined();
    expect(getByTestId("activity-event-approval_granted")).toBeDefined();
    expect(getByTestId("activity-event-file_changed")).toBeDefined();
    expect(getByTestId("activity-event-mutation_verified")).toBeDefined();
    expect(getByTestId("activity-event-act_completed")).toBeDefined();
  });

  it("reload (re-fetch) → same evidence still exists", async () => {
    // Simulate the reload gate: evidence is persisted, so re-fetching
    // from the store returns the same records.
    const approvalStore = getApprovalStore();
    const token = await approvalStore.issue({ runId, projectId, userId });

    await executeMutation(
      {
        runId,
        projectId,
        toolId: "files.write",
        approvalTokenId: token.id,
        paths: ["src/app.ts"],
        operation: async (t) => {
          await t.writeFile("src/app.ts", 'export const x = 3;\n');
          return {};
        },
      },
      transport,
    );

    const evidenceStore = getEvidenceStore();

    // First fetch
    const records1 = await evidenceStore.listByRun(runId);
    expect(records1.length).toBe(1);
    const evidenceId = records1[0].id;

    // Simulate reload — re-fetch from the same store
    const records2 = await evidenceStore.listByRun(runId);
    expect(records2.length).toBe(1);
    expect(records2[0].id).toBe(evidenceId);
    expect(records2[0].status).toBe("succeeded");
    expect(records2[0].afterHashes["src/app.ts"]).toBe(records1[0].afterHashes["src/app.ts"]);
  });

  it("Changes panel shows empty state when no evidence", () => {
    const { getByTestId } = render(<StudioChangesPanel evidence={[]} loading={false} />);
    expect(getByTestId("changes-empty")).toBeDefined();
  });

  it("Activity panel shows empty state when no events", () => {
    const { getByTestId } = render(<StudioActivityEvents events={[]} loading={false} />);
    expect(getByTestId("activity-empty")).toBeDefined();
  });

  it("Changes panel shows failure state with error", async () => {
    const approvalStore = getApprovalStore();
    const token = await approvalStore.issue({ runId, projectId, userId });

    // Execute a no-op mutation (will be detected as failed)
    try {
      await executeMutation(
        {
          runId,
          projectId,
          toolId: "files.write",
          approvalTokenId: token.id,
          paths: ["src/app.ts"],
          operation: async () => ({}), // no-op
        },
        transport,
      );
    } catch {
      // Expected to throw
    }

    const evidenceStore = getEvidenceStore();
    const records = await evidenceStore.listByRun(runId);
    const failed = records.find((r) => r.status === "failed");
    expect(failed).toBeDefined();

    const { getByTestId } = render(<StudioChangesPanel evidence={records} loading={false} />);
    expect(getByTestId("changes-mutation-status").textContent).toBe("failed");
    expect(getByTestId("changes-error")).toBeDefined();
  });
});
