/**
 * Workspace Transport — the single HTTP client that routes all LiTT coding
 * tool operations through the existing authenticated, workspace-scoped
 * terminal-server infrastructure.
 *
 * No local fs / execSync / process.cwd() — every operation is an HTTP call
 * to the terminal server's existing endpoints:
 *   - File ops:  /ws-files/*  (user JWT auth via createTerminalToken)
 *   - Commands:  /internal/workspace/:workspaceId/exec  (service key auth)
 *
 * Factory: createWorkspaceTransport() calls verifyProjectWorkspace() to
 * resolve the workspaceId and workspaceRoot before any tool runs.
 */

import "server-only";

import { createTerminalToken } from "@/lib/terminal-auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createWorkspaceCheckpoint } from "@/lib/missions/workspace-checkpoint";
import { getTerminalServerUrl } from "@/lib/terminal-url";

// ─── Types ────────────────────────────────────────────────────────

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  staged: Array<{ path: string; status: string }>;
  modified: Array<{ path: string; status: string }>;
  untracked: string[];
  clean: boolean;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SearchResult {
  results: Array<{ file: string; line: number; content: string }>;
}

export interface PatchOperation {
  type: "search_replace";
  search: string;
  replace: string;
}

export interface CheckpointInfo {
  checkpointId: string;
  label: string;
  gitSha: string;
}

export interface ProjectPackageInfo {
  packageManager: string;
  scripts: Record<string, string>;
  hasTypecheck: boolean;
  hasLint: boolean;
  hasBuild: boolean;
  hasTest: boolean;
}

// ─── Transport interface ──────────────────────────────────────────

export interface WorkspaceTransport {
  readonly workspaceId: string;
  readonly userId: string;
  readonly workspaceRoot: string;
  readonly projectId: string;

  // File operations
  listFiles(path: string): Promise<{ entries: Array<{ name: string; type: string }> }>;
  readFile(path: string): Promise<{ content: string; size: number }>;
  writeFile(path: string, content: string): Promise<{ saved: boolean }>;
  deleteFile(path: string): Promise<{ deleted: boolean }>;
  mkdir(path: string): Promise<{ created: boolean }>;
  rename(path: string, newPath: string): Promise<{ renamed: boolean }>;

  // Command execution
  exec(command: string, timeoutMs?: number): Promise<ExecResult>;

  // Git operations (built on exec)
  gitStatus(): Promise<GitStatusResult>;
  gitDiff(options?: { staged?: boolean; path?: string }): Promise<{ diff: string }>;
  gitLog(options?: { maxCount?: number }): Promise<{ commits: Array<{ sha: string; message: string; author: string; date: string }> }>;
  gitCommit(message: string, files?: string[]): Promise<{ committed: boolean; sha?: string }>;

  // Search
  searchCode(query: string, options?: { glob?: string; maxResults?: number }): Promise<SearchResult>;

  // Build/test/lint
  discoverPackageInfo(): Promise<ProjectPackageInfo>;
  runCheck(checkId: "build" | "typecheck" | "lint" | "test", packageInfo?: ProjectPackageInfo): Promise<ExecResult>;

  // Patch
  applyPatch(path: string, patches: PatchOperation[]): Promise<{ applied: boolean }>;

  // Checkpoint
  createCheckpointBeforeMutation(label: string): Promise<CheckpointInfo | null>;
}

// ─── Helpers ──────────────────────────────────────────────────────

function terminalBase(): string {
  return (
    process.env.TERMINAL_SERVER_INTERNAL_URL ??
    getTerminalServerUrl()
  );
}

function internalServiceKey(): string {
  return process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
}

// ─── Factory ──────────────────────────────────────────────────────

export async function createWorkspaceTransport(
  projectId: string,
  userId: string,
): Promise<WorkspaceTransport> {
  if (!projectId || !userId) {
    throw new Error("createWorkspaceTransport requires projectId and userId");
  }

  const verified = await verifyProjectWorkspace(projectId, userId);
  const { workspaceId, workspaceRoot } = verified;

  return new WorkspaceTransportImpl(projectId, userId, workspaceId, workspaceRoot);
}

// ─── Implementation ───────────────────────────────────────────────

class WorkspaceTransportImpl implements WorkspaceTransport {
  constructor(
    public readonly projectId: string,
    public readonly userId: string,
    public readonly workspaceId: string,
    public readonly workspaceRoot: string,
  ) {}

  private get token(): string {
    return createTerminalToken(this.userId, {
      workspaceId: this.workspaceId,
      projectId: this.projectId,
    }).token;
  }

  private get wsFileHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
      "X-Workspace-Id": this.workspaceId,
    };
  }

  // ── File operations ──

  async listFiles(path: string): Promise<{ entries: Array<{ name: string; type: string }> }> {
    const resp = await fetch(
      `${terminalBase()}/ws-files?path=${encodeURIComponent(path || ".")}`,
      { headers: this.wsFileHeaders },
    );
    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`listFiles failed (${resp.status}): ${err}`);
    }
    return resp.json();
  }

  async readFile(path: string): Promise<{ content: string; size: number }> {
    const resp = await fetch(`${terminalBase()}/ws-files/read`, {
      method: "POST",
      headers: this.wsFileHeaders,
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`readFile failed (${resp.status}): ${err}`);
    }
    return resp.json();
  }

  async writeFile(path: string, content: string): Promise<{ saved: boolean }> {
    const resp = await fetch(`${terminalBase()}/ws-files/write`, {
      method: "POST",
      headers: this.wsFileHeaders,
      body: JSON.stringify({ path, content }),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`writeFile failed (${resp.status}): ${err}`);
    }
    return resp.json();
  }

  async deleteFile(path: string): Promise<{ deleted: boolean }> {
    const resp = await fetch(`${terminalBase()}/ws-files/delete`, {
      method: "POST",
      headers: this.wsFileHeaders,
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`deleteFile failed (${resp.status}): ${err}`);
    }
    return resp.json();
  }

  async mkdir(path: string): Promise<{ created: boolean }> {
    const resp = await fetch(`${terminalBase()}/ws-files/mkdir`, {
      method: "POST",
      headers: this.wsFileHeaders,
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`mkdir failed (${resp.status}): ${err}`);
    }
    return resp.json();
  }

  async rename(path: string, newPath: string): Promise<{ renamed: boolean }> {
    const resp = await fetch(`${terminalBase()}/ws-files/rename`, {
      method: "POST",
      headers: this.wsFileHeaders,
      body: JSON.stringify({ path, newPath }),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`rename failed (${resp.status}): ${err}`);
    }
    return resp.json();
  }

  // ── Command execution ──

  async exec(command: string, timeoutMs = 30_000): Promise<ExecResult> {
    const t0 = Date.now();
    const resp = await fetch(
      `${terminalBase()}/internal/workspace/${this.workspaceId}/exec`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Key": internalServiceKey(),
        },
        body: JSON.stringify({ command, userId: this.userId, timeout: timeoutMs }),
        signal: AbortSignal.timeout(timeoutMs + 5_000),
      },
    );
    const durationMs = Date.now() - t0;
    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`exec failed (${resp.status}): ${err}`);
    }
    const data = await resp.json();
    return {
      exitCode: data.exitCode ?? data.exit_code ?? 1,
      stdout: data.stdout ?? "",
      stderr: data.stderr ?? "",
      durationMs,
    };
  }

  // ── Git operations ──

  async gitStatus(): Promise<GitStatusResult> {
    const result = await this.exec("git status --porcelain=v1 -b");
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    const branchLine = lines[0] || "";
    const branch = branchLine.replace(/^## /, "").replace(/\.\.\..*$/, "").trim() || "main";

    const staged: Array<{ path: string; status: string }> = [];
    const modified: Array<{ path: string; status: string }> = [];
    const untracked: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const index = line[0] || " ";
      const workDir = line[1] || " ";
      const filePath = line.slice(3);

      if (index === "?" && workDir === "?") {
        untracked.push(filePath);
      } else {
        const entry = { path: filePath, status: `${index}${workDir}` };
        if (index !== " " && index !== "?") {
          staged.push(entry);
        } else {
          modified.push(entry);
        }
      }
    }

    const aheadMatch = branchLine.match(/ahead (\d+)/);
    const behindMatch = branchLine.match(/behind (\d+)/);

    return {
      branch,
      ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : 0,
      behind: behindMatch ? parseInt(behindMatch[1], 10) : 0,
      staged,
      modified,
      untracked,
      clean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
    };
  }

  async gitDiff(options?: { staged?: boolean; path?: string }): Promise<{ diff: string }> {
    const parts = ["git diff"];
    if (options?.staged) parts.push("--staged");
    if (options?.path) parts.push(`-- ${options.path}`);
    const result = await this.exec(parts.join(" "));
    return { diff: result.stdout };
  }

  async gitLog(options?: { maxCount?: number }): Promise<{ commits: Array<{ sha: string; message: string; author: string; date: string }> }> {
    const count = options?.maxCount ?? 10;
    const result = await this.exec(
      `git log --pretty=format:"%H|%an|%ad|%s" --date=short -${count}`,
    );
    const commits = result.stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [sha, author, date, ...msgParts] = line.split("|");
      return { sha, author, date, message: msgParts.join("|") };
    });
    return { commits };
  }

  async gitCommit(message: string, files?: string[]): Promise<{ committed: boolean; sha?: string }> {
    if (files && files.length > 0) {
      await this.exec(`git add ${files.map((f) => `"${f}"`).join(" ")}`);
    } else {
      await this.exec("git add -A");
    }
    const escapedMsg = message.replace(/"/g, '\\"');
    const result = await this.exec(`git commit -m "${escapedMsg}"`);
    if (result.exitCode !== 0) {
      return { committed: false };
    }
    const shaResult = await this.exec("git rev-parse HEAD");
    return { committed: true, sha: shaResult.stdout.trim() };
  }

  // ── Search ──

  async searchCode(query: string, options?: { glob?: string; maxResults?: number }): Promise<SearchResult> {
    const max = options?.maxResults ?? 50;
    const parts = ["rg", "--line-number", "--no-heading", "--max-count", String(max)];
    if (options?.glob) parts.push(`--glob "${options.glob}"`);
    parts.push(`"${query.replace(/"/g, '\\"')}"`);
    const result = await this.exec(parts.join(" "));

    const results = result.stdout.trim().split("\n").filter(Boolean).map((line) => {
      const colonIdx = line.indexOf(":");
      const secondColon = line.indexOf(":", colonIdx + 1);
      return {
        file: line.slice(0, colonIdx),
        line: parseInt(line.slice(colonIdx + 1, secondColon), 10) || 0,
        content: line.slice(secondColon + 1),
      };
    });

    return { results };
  }

  // ── Package discovery ──

  async discoverPackageInfo(): Promise<ProjectPackageInfo> {
    // Detect package manager
    let packageManager = "npm";
    const pnpmCheck = await this.exec("test -f pnpm-lock.yaml && echo yes || echo no");
    if (pnpmCheck.stdout.trim() === "yes") {
      packageManager = "pnpm";
    } else {
      const yarnCheck = await this.exec("test -f yarn.lock && echo yes || echo no");
      if (yarnCheck.stdout.trim() === "yes") {
        packageManager = "yarn";
      }
    }

    // Read package.json
    let scripts: Record<string, string> = {};
    try {
      const { content } = await this.readFile("package.json");
      const pkg = JSON.parse(content);
      scripts = pkg.scripts ?? {};
    } catch {
      // No package.json — return defaults
    }

    return {
      packageManager,
      scripts,
      hasTypecheck: "typecheck" in scripts || "tsc" in scripts,
      hasLint: "lint" in scripts,
      hasBuild: "build" in scripts,
      hasTest: "test" in scripts || "test:unit" in scripts,
    };
  }

  async runCheck(
    checkId: "build" | "typecheck" | "lint" | "test",
    packageInfo?: ProjectPackageInfo,
  ): Promise<ExecResult> {
    const info = packageInfo ?? await this.discoverPackageInfo();
    const pm = info.packageManager;

    const commandMap: Record<string, string | null> = {
      build: info.hasBuild ? `${pm} run build` : null,
      typecheck: info.hasTypecheck
        ? `${pm} run typecheck`
        : `${pm} exec tsc --noEmit`,
      lint: info.hasLint ? `${pm} run lint` : null,
      test: info.hasTest ? `${pm} run test` : null,
    };

    const cmd = commandMap[checkId];
    if (!cmd) {
      return {
        exitCode: 0,
        stdout: `No ${checkId} script found — skipping.`,
        stderr: "",
        durationMs: 0,
      };
    }

    return this.exec(cmd, 120_000);
  }

  // ── Patch (read → search/replace → write) ──

  async applyPatch(path: string, patches: PatchOperation[]): Promise<{ applied: boolean }> {
    const { content } = await this.readFile(path);
    let updated = content;

    for (const patch of patches) {
      if (!updated.includes(patch.search)) {
        throw new Error(`Patch search string not found in ${path}: "${patch.search.slice(0, 80)}..."`);
      }
      updated = updated.replace(patch.search, patch.replace);
    }

    await this.writeFile(path, updated);
    return { applied: true };
  }

  // ── Checkpoint ──

  async createCheckpointBeforeMutation(label: string): Promise<CheckpointInfo | null> {
    try {
      return await createWorkspaceCheckpoint({
        projectId: this.projectId,
        userId: this.userId,
        workspaceId: this.workspaceId,
        label,
      });
    } catch {
      return null;
    }
  }
}
