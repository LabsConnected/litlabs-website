/**
 * LiTT Tool Handlers — workspace-aware execution handlers.
 *
 * All handlers route through WorkspaceTransport, which calls the
 * existing authenticated, workspace-scoped terminal-server endpoints.
 * No local fs / execSync / process.cwd().
 *
 * Security model:
 * - Terminal server's isBlockedCommand() + workspace isolation are
 *   authoritative. This module does NOT duplicate command security.
 * - Permission engine handles mode/approval policy.
 * - Read-only tools auto-execute; mutations follow permission engine.
 */

import "server-only";

import type { WorkspaceTransport } from "./workspace-transport";

// ─── Tool Handler Signature ───────────────────────────────────────

export type ToolHandler = (
  inputs: Record<string, unknown>,
  transport: WorkspaceTransport,
) => Promise<unknown>;

// ─── File Tools ───────────────────────────────────────────────────

export const handleFilesList: ToolHandler = async (inputs, transport) => {
  const path = (inputs.path as string) || ".";
  try {
    const { entries } = await transport.listFiles(path);
    return {
      success: true,
      path,
      items: entries.map((e) => ({
        name: e.name,
        type: e.type === "folder" ? "directory" : "file",
      })),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to list files" };
  }
};

export const handleFilesRead: ToolHandler = async (inputs, transport) => {
  const path = inputs.path as string;
  if (!path) return { success: false, error: "path is required" };

  try {
    const { content, size } = await transport.readFile(path);
    return {
      success: true,
      path,
      size,
      content,
      lines: content.split("\n").length,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : `Failed to read file: ${path}` };
  }
};

export const handleFilesWrite: ToolHandler = async (inputs, transport) => {
  const path = inputs.path as string;
  const content = inputs.content as string;
  if (!path || content === undefined) {
    return { success: false, error: "path and content are required" };
  }

  try {
    await transport.writeFile(path, content);
    return {
      success: true,
      path,
      bytesWritten: Buffer.byteLength(content, "utf-8"),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to write file" };
  }
};

export const handleFilesDelete: ToolHandler = async (inputs, transport) => {
  const path = inputs.path as string;
  if (!path) return { success: false, error: "path is required" };

  try {
    await transport.deleteFile(path);
    return { success: true, path, deleted: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete file" };
  }
};

export const handleFilesMkdir: ToolHandler = async (inputs, transport) => {
  const path = inputs.path as string;
  if (!path) return { success: false, error: "path is required" };

  try {
    await transport.mkdir(path);
    return { success: true, path, created: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create directory" };
  }
};

export const handleFilesRename: ToolHandler = async (inputs, transport) => {
  const path = inputs.path as string;
  const newPath = inputs.newPath as string;
  if (!path || !newPath) {
    return { success: false, error: "path and newPath are required" };
  }

  try {
    await transport.rename(path, newPath);
    return { success: true, path, newPath, renamed: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to rename" };
  }
};

// ─── Search Tool ──────────────────────────────────────────────────

export const handleSearchCode: ToolHandler = async (inputs, transport) => {
  const query = inputs.query as string;
  if (!query) return { success: false, error: "query is required" };

  try {
    const { results } = await transport.searchCode(query, {
      glob: inputs.glob as string | undefined,
      maxResults: (inputs.maxResults as number) ?? 50,
    });
    return { success: true, query, results, count: results.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Search failed" };
  }
};

// ─── Git Tools ────────────────────────────────────────────────────

export const handleGitStatus: ToolHandler = async (_inputs, transport) => {
  try {
    const status = await transport.gitStatus();
    return { success: true, ...status };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Git status failed" };
  }
};

export const handleGitDiff: ToolHandler = async (inputs, transport) => {
  try {
    const { diff } = await transport.gitDiff({
      staged: inputs.staged as boolean | undefined,
      path: inputs.path as string | undefined,
    });
    return { success: true, diff };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Git diff failed" };
  }
};

export const handleGitLog: ToolHandler = async (inputs, transport) => {
  try {
    const { commits } = await transport.gitLog({
      maxCount: (inputs.maxCount as number) ?? 10,
    });
    return { success: true, commits };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Git log failed" };
  }
};

export const handleGitCommit: ToolHandler = async (inputs, transport) => {
  const message = inputs.message as string;
  if (!message) return { success: false, error: "message is required" };

  try {
    const result = await transport.gitCommit(message, inputs.files as string[] | undefined);
    return { success: result.committed, ...result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Git commit failed" };
  }
};

// ─── Terminal Execute ─────────────────────────────────────────────

export const handleTerminalExecute: ToolHandler = async (inputs, transport) => {
  const command = inputs.command as string;
  if (!command) return { success: false, error: "command is required" };

  try {
    const result = await transport.exec(command, 30_000);
    return {
      success: result.exitCode === 0,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Command execution failed" };
  }
};

// ─── Project Scan ─────────────────────────────────────────────────

export const handleProjectScan: ToolHandler = async (inputs, transport) => {
  try {
    // Use workspace transport to list root files and read package.json
    const { entries } = await transport.listFiles(".");
    const packageInfo = await transport.discoverPackageInfo();

    // Read key files for a lightweight scan
    let readme: string | null = null;
    try {
      const { content } = await transport.readFile("README.md");
      readme = content.slice(0, 2000);
    } catch { /* no README */ }

    const gitStatus = await transport.gitStatus();

    return {
      success: true,
      snapshot: {
        rootFiles: entries.map((e) => ({ name: e.name, type: e.type })),
        packageManager: packageInfo.packageManager,
        scripts: packageInfo.scripts,
        hasTypecheck: packageInfo.hasTypecheck,
        hasLint: packageInfo.hasLint,
        hasBuild: packageInfo.hasBuild,
        hasTest: packageInfo.hasTest,
        readme: readme?.slice(0, 500),
        gitBranch: gitStatus.branch,
        gitClean: gitStatus.clean,
        untrackedCount: gitStatus.untracked.length,
        modifiedCount: gitStatus.modified.length + gitStatus.staged.length,
      },
      summary: {
        packageManager: packageInfo.packageManager,
        scripts: Object.keys(packageInfo.scripts),
        gitBranch: gitStatus.branch,
        gitClean: gitStatus.clean,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Scan failed" };
  }
};

// ─── Project Health ───────────────────────────────────────────────

export const handleProjectHealth: ToolHandler = async (_inputs, transport) => {
  const results: Array<{ check: string; status: "pass" | "fail" | "warn" | "skip"; output: string }> = [];

  const packageInfo = await transport.discoverPackageInfo();

  // TypeScript check
  const tsc = await transport.runCheck("typecheck", packageInfo);
  results.push({
    check: "TypeScript",
    status: tsc.exitCode === 0 ? "pass" : "fail",
    output: (tsc.stdout || tsc.stderr || "No output").slice(0, 2000),
  });

  // Lint check
  const lint = await transport.runCheck("lint", packageInfo);
  results.push({
    check: "ESLint",
    status: lint.exitCode === 0 ? "pass" : lint.exitCode === 1 ? "fail" : "warn",
    output: (lint.stdout || lint.stderr || "No output").slice(0, 2000),
  });

  // Test check
  const test = await transport.runCheck("test", packageInfo);
  results.push({
    check: "Tests",
    status: test.exitCode === 0 ? "pass" : "fail",
    output: (test.stdout || test.stderr || "No output").slice(0, 2000),
  });

  // Git status
  const gitStatus = await transport.gitStatus();
  results.push({
    check: "Git Status",
    status: "pass",
    output: gitStatus.clean ? "Clean working tree" : `${gitStatus.modified.length + gitStatus.untracked.length} changes`,
  });

  const overallStatus = results.some((r) => r.status === "fail")
    ? "fail"
    : results.some((r) => r.status === "warn")
      ? "warn"
      : "pass";

  return { success: true, overallStatus, results };
};

// ─── Build / Test / Typecheck / Lint ──────────────────────────────

export const handleBuildRun: ToolHandler = async (_inputs, transport) => {
  const packageInfo = await transport.discoverPackageInfo();
  const result = await transport.runCheck("build", packageInfo);
  return {
    success: result.exitCode === 0,
    check: "build",
    exitCode: result.exitCode,
    stdout: result.stdout.slice(0, 5000),
    stderr: result.stderr.slice(0, 5000),
  };
};

export const handleTestRun: ToolHandler = async (_inputs, transport) => {
  const packageInfo = await transport.discoverPackageInfo();
  const result = await transport.runCheck("test", packageInfo);
  return {
    success: result.exitCode === 0,
    check: "test",
    exitCode: result.exitCode,
    stdout: result.stdout.slice(0, 5000),
    stderr: result.stderr.slice(0, 5000),
  };
};

export const handleTypecheckRun: ToolHandler = async (_inputs, transport) => {
  const packageInfo = await transport.discoverPackageInfo();
  const result = await transport.runCheck("typecheck", packageInfo);
  return {
    success: result.exitCode === 0,
    check: "typecheck",
    exitCode: result.exitCode,
    stdout: result.stdout.slice(0, 5000),
    stderr: result.stderr.slice(0, 5000),
  };
};

export const handleLintRun: ToolHandler = async (_inputs, transport) => {
  const packageInfo = await transport.discoverPackageInfo();
  const result = await transport.runCheck("lint", packageInfo);
  return {
    success: result.exitCode === 0,
    check: "lint",
    exitCode: result.exitCode,
    stdout: result.stdout.slice(0, 5000),
    stderr: result.stderr.slice(0, 5000),
  };
};

// ─── Apply Patch ──────────────────────────────────────────────────

export const handleApplyPatch: ToolHandler = async (inputs, transport) => {
  const path = inputs.path as string;
  const rawPatches = inputs.patches as Array<{ search: string; replace: string }>;
  if (!path || !rawPatches || !Array.isArray(rawPatches)) {
    return { success: false, error: "path and patches[] are required" };
  }

  const patches = rawPatches.map((p) => ({ type: "search_replace" as const, search: p.search, replace: p.replace }));

  try {
    await transport.applyPatch(path, patches);
    return { success: true, path, applied: true, patchCount: patches.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to apply patch" };
  }
};

// ─── Package Info ─────────────────────────────────────────────────

export const handlePackageInfo: ToolHandler = async (_inputs, transport) => {
  const info = await transport.discoverPackageInfo();
  return { success: true, ...info };
};
