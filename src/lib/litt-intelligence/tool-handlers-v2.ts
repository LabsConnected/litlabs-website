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

import { placeholderViolation } from "./patch-validation";
import { normalizeWorkspaceRelativePath, workspacePathError } from "./workspace-path";
import type { WorkspaceTransport } from "./workspace-transport";

// ─── Tool Handler Signature ───────────────────────────────────────

export interface ToolHandlerResult {
  success?: boolean;
  error?: string | null;
  [key: string]: unknown;
}

export type ToolHandler = (
  inputs: Record<string, unknown>,
  transport: WorkspaceTransport,
) => Promise<ToolHandlerResult>;

// ─── File Tools ───────────────────────────────────────────────────

export const handleFilesList: ToolHandler = async (inputs, transport) => {
  const normalized = normalizeWorkspaceRelativePath(inputs.path, { defaultToRoot: true });
  if ("error" in normalized) return { success: false, error: `path must be workspace-relative: ${normalized.error}` };
  const path = normalized.path;
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
  const pathError = workspacePathError(path);
  if (pathError) return { success: false, error: pathError };

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
  const pathError = workspacePathError(path);
  if (pathError) return { success: false, error: pathError };

  // Enforcement floor: unresolved template placeholders must never reach
  // the filesystem, no matter which entry point invoked the handler.
  const badField = placeholderViolation(path, "path") ?? placeholderViolation(content, "content");
  if (badField) return { success: false, error: badField };

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
  const pathError = workspacePathError(path);
  if (pathError) return { success: false, error: pathError };
  const badPath = placeholderViolation(path, "path");
  if (badPath) return { success: false, error: badPath };

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
  const pathError = workspacePathError(path);
  if (pathError) return { success: false, error: pathError };
  const badPath = placeholderViolation(path, "path");
  if (badPath) return { success: false, error: badPath };

  try {
    await transport.mkdir(path);
    return { success: true, path, created: true };
  } catch (err) {
    // mkdir is naturally idempotent — the caller wants the directory to
    // exist, and a 409/already-exists means it already does. Reporting a
    // hard failure aborts the whole resumed run (the acceptance run died
    // exactly here: auto-insert had already created assets/, the model's
    // defensive mkdir then 409'd and the run was marked failed).
    const msg = err instanceof Error ? err.message : "Failed to create directory";
    if (/already exists|EEXIST|\b409\b/i.test(msg)) {
      return { success: true, path, created: false, alreadyExists: true };
    }
    return { success: false, error: msg };
  }
};

export const handleFilesRename: ToolHandler = async (inputs, transport) => {
  const path = inputs.path as string;
  const newPath = inputs.newPath as string;
  if (!path || !newPath) {
    return { success: false, error: "path and newPath are required" };
  }
  const pathError = workspacePathError(path, "path") ?? workspacePathError(newPath, "newPath");
  if (pathError) return { success: false, error: pathError };
  const badPath = placeholderViolation(path, "path") ?? placeholderViolation(newPath, "newPath");
  if (badPath) return { success: false, error: badPath };

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
    // Compat fields consumed by the V1 auto-inspection formatter
    // (agent-loop.ts formatToolResultsBlock / summarizeResult).
    const changeCount = status.staged.length + status.modified.length + status.untracked.length;
    let recentCommits = "";
    try {
      const { commits } = await transport.gitLog({ maxCount: 10 });
      recentCommits = commits
        .map((c) => `${c.sha.slice(0, 7)} ${c.message}`)
        .join("\n");
    } catch { /* git log unavailable — leave empty */ }
    return {
      success: true,
      ...status,
      hasChanges: !status.clean,
      status: status.clean ? "Clean working tree" : `${changeCount} uncommitted change(s)`,
      recentCommits,
    };
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
  const badMessage = placeholderViolation(message, "message");
  if (badMessage) return { success: false, error: badMessage };

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
  // Enforcement floor: a shell command can write files too (heredoc,
  // `cat >`, `tee`), so placeholder tokens are rejected here as well —
  // the files.write guard alone does not close that bypass.
  const badCommand = placeholderViolation(command, "command");
  if (badCommand) return { success: false, error: badCommand };

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

  // Enforcement floor: placeholders in either direction are corruption —
  // a search token can never match, and a replace token would persist the
  // slot verbatim into the file.
  const badPath = placeholderViolation(path, "path");
  if (badPath) return { success: false, error: badPath };
  for (let i = 0; i < rawPatches.length; i++) {
    const p = rawPatches[i];
    const bad =
      placeholderViolation(p?.search, `patch ${i + 1} search`) ??
      placeholderViolation(p?.replace, `patch ${i + 1} replace`);
    if (bad) return { success: false, error: bad };
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

// ─── Preview Tools ────────────────────────────────────────────────

export const handlePreviewStart: ToolHandler = async (_inputs, transport) => {
  try {
    const result = await transport.startPreview();
    return {
      success: result.status !== "failed",
      workspaceId: result.workspaceId,
      status: result.status,
      port: result.port,
      framework: result.framework,
      command: result.command,
      error: result.error ?? null,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export const handlePreviewStatus: ToolHandler = async (_inputs, transport) => {
  try {
    const result = await transport.getPreviewStatus();
    return {
      success: result.status !== "failed",
      status: result.status,
      port: result.port,
      framework: result.framework,
      command: result.command,
      error: result.error,
      errorCode: result.errorCode,
      logs: result.logs.slice(-50),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export const handlePreviewStop: ToolHandler = async (_inputs, transport) => {
  try {
    const result = await transport.stopPreview();
    return { success: true, workspaceId: result.workspaceId, status: result.status };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// ─── Deploy Tools ───────────────────────────────────────────────────

import { resolveDeployConfig, runDeployFlow, verifyProductionUrl } from "./deploy";

export const handleDeployExecute: ToolHandler = async () => {
  try {
    const envConfig = resolveDeployConfig();
    if (!envConfig.ok) {
      return { success: false, error: envConfig.error };
    }
    const result = await runDeployFlow({ config: envConfig.config });
    return {
      success: result.success,
      provider: result.provider,
      deploymentId: result.deploymentId,
      status: result.status,
      productionUrl: result.productionUrl,
      error: result.error,
      verification: result.verification,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export const handleDeployVerify: ToolHandler = async (inputs) => {
  const url = inputs.url as string;
  if (!url || typeof url !== "string") {
    return { success: false, error: "url is required" };
  }
  const result = await verifyProductionUrl(url);
  return { success: result.success, detail: result.detail };
};

// ─── Deployment ───────────────────────────────────────────────────

/**
 * project.deploy — publish the USER'S project to a public URL.
 *
 * Identity is taken from the transport, never from `inputs`. The transport
 * was built by createWorkspaceTransport(projectId, userId), which ran
 * verifyProjectWorkspace() (project exists, owned by this user, workspace
 * ready). So the model cannot name a different tenant, project, workspace,
 * hosting provider, or Railway service — there are no such inputs, and
 * nothing here reads them.
 *
 * The result is structured for the model's next turn: on success it carries
 * the verified live URL; on failure it says the deployment failed and never
 * reports a URL.
 */
export const handleProjectDeploy: ToolHandler = async (_inputs, transport) => {
  const { deployUserProject } = await import("@/lib/deployments/deploy-service");
  const { supabaseDeploymentStore } = await import("@/lib/deployments/deployment-store");

  const publicBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://litlabs.net";

  const result = await deployUserProject(
    {
      userId: transport.userId,
      projectId: transport.projectId,
      transport,
      publicBaseUrl,
    },
    { store: supabaseDeploymentStore },
  );

  if (!result.ok) {
    return {
      success: false,
      deployment: {
        deploymentId: result.deploymentId,
        status: result.status,
        publicUrl: null,
      },
      errorClass: result.errorClass,
      error: result.message,
      retryable: result.retryable,
    };
  }

  return {
    success: true,
    deployment: {
      deploymentId: result.deploymentId,
      status: result.status,
      publicUrl: result.publicUrl,
      urlVerified: result.urlVerified,
      target: result.target,
      projectId: result.projectId,
      workspaceId: result.workspaceId,
      fileCount: result.fileCount,
      totalBytes: result.totalBytes,
      reused: result.reused,
    },
    // Stated explicitly so the model's closing answer can cite it.
    liveUrl: result.publicUrl,
  };
};

// ─── Project Asset Insert ──────────────────────────────────────────

/**
 * Downloads an image/asset from a URL and saves it into the project
 * workspace as a binary file. This closes the "generate → site" loop:
 * after image.generate returns a downloadUrl, the agent calls this tool
 * to place the image into public/assets/ and then references the
 * returned sitePath in the site's HTML — instead of leaving the image
 * as a chat-only render.
 *
 * Mirrors the guards of POST /api/studio-projects/[projectId]/assets/insert:
 * https or data:image/* URLs only, 30s download timeout, 50MB cap,
 * image/* content types.
 */
const MAX_INSERT_ASSET_BYTES = 50 * 1024 * 1024;
const DEFAULT_INSERT_DIR = "public/assets/images";
const STATIC_INSERT_DIR = "assets/images";

function sanitizeAssetName(raw: string | undefined, contentType: string | null): string {
  const ext = contentType?.split("/")[1]?.split("+")[0]?.replace(/[^a-z0-9]/gi, "") || "png";
  const base = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "asset";
  const stamped = `${base}-${Date.now().toString(36)}`;
  return stamped.endsWith(`.${ext}`) ? stamped : `${stamped}.${ext}`;
}

function isSafeInsertDir(dir: string): boolean {
  const normalized = dir.replace(/\\/g, "/");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !normalized.split("/").some((seg) => seg === ".." || seg.includes("\0"))
  );
}

export interface InsertAssetOptions {
  nameHint?: string;
  directory?: string;
}

export interface InsertAssetResult {
  success: boolean;
  path?: string;
  sitePath?: string;
  contentType?: string;
  sizeBytes?: number;
  error?: string;
}

/**
 * Structural completeness check for a binary image payload. A truncated
 * data URL (e.g. a model re-emitting a clipped base64 blob it only saw a
 * fragment of) still decodes "successfully" into a corrupt file that then
 * ships as a broken site asset — the 2026-09-18 acceptance run produced a
 * 1KB JPEG stub with no EOI marker. Verify the format's required head and
 * tail markers for the formats we accept; unknown image types pass
 * through rather than being over-rejected.
 */
function imagePayloadLooksComplete(buffer: Buffer, contentType: string): boolean {
  const mime = contentType.toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return (
      buffer.length > 4 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 &&
      buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9
    );
  }
  if (mime === "image/png") {
    return (
      buffer.length > 16 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 &&
      buffer.subarray(-8).equals(
        Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
      )
    );
  }
  if (mime === "image/gif") {
    return (
      buffer.length > 7 &&
      buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 &&
      buffer[buffer.length - 1] === 0x3b
    );
  }
  if (mime === "image/webp") {
    return (
      buffer.length > 20 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP" &&
      buffer.readUInt32LE(4) + 8 <= buffer.length
    );
  }
  return true;
}

/**
 * Decode a data:image/* URL into bytes + MIME without a network fetch.
 * The free image providers (pollinations, cloudflare) return generated
 * images inline as data URLs — the bytes are already server-side, so
 * rejecting them for not being https:// dead-ended the default free
 * generation path: auto-insert failed and "Use in project" could never
 * write the asset.
 */
function decodeDataImageUrl(
  url: string,
): { buffer: Buffer; contentType: string } | { error: string } {
  const match = /^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i.exec(url);
  if (!match) return { error: "Malformed data:image URL" };
  try {
    const buffer = match[2]
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8");
    return { buffer, contentType: match[1].toLowerCase() };
  } catch {
    return { error: "Malformed data:image URL" };
  }
}

/**
 * Resolve the workspace directory an inserted asset is written to. The
 * sitePath convention (/assets/images/x) only resolves if the file lands
 * under the directory the preview/deploy server treats as the web root —
 * and that root differs by project shape:
 *   - Framework projects (package.json with a next/vite toolchain) serve
 *     public/ at /, so assets belong in public/assets/images.
 *   - Static sites are served from the WORKSPACE ROOT (`serve -s .` in
 *     PreviewManager) — public/ is not special there, so the same sitePath
 *     only resolves when the file lives at root-level assets/images.
 * The 2026-09-18 acceptance run proved the mismatch: a generated image
 * saved under public/ produced an <img> that got serve's SPA HTML
 * fallback instead of the bytes. Detection mirrors PreviewManager's
 * framework rules; an explicit opts.directory always wins.
 */
async function resolveInsertDirectory(
  opts: InsertAssetOptions,
  transport: WorkspaceTransport,
): Promise<string> {
  if (opts.directory) return opts.directory;
  try {
    const { entries } = await transport.listFiles(".");
    const names = new Set(entries.map((e) => e.name));
    if (!names.has("package.json")) return STATIC_INSERT_DIR;
    const hasFrameworkConfig = [
      "next.config.js", "next.config.mjs", "next.config.ts",
      "vite.config.js", "vite.config.mjs", "vite.config.ts",
    ].some((n) => names.has(n));
    if (hasFrameworkConfig) return DEFAULT_INSERT_DIR;
    const { content } = await transport.readFile("package.json");
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> };
    const dev = String(pkg?.scripts?.dev ?? "");
    if (dev.includes("next") || dev.includes("vite")) return DEFAULT_INSERT_DIR;
    // package.json with no framework dev script + a root index.html still
    // falls back to `serve -s .` in PreviewManager — workspace-root serve.
    if (!dev && names.has("index.html")) return STATIC_INSERT_DIR;
    return DEFAULT_INSERT_DIR;
  } catch {
    return DEFAULT_INSERT_DIR;
  }
}

/**
 * Download an image URL and save it into the project workspace as a binary
 * file. Shared core behind the project.insert_asset tool AND the automatic
 * post-generation save in the tool registry: after image.generate succeeds
 * in a project context, the registry calls this directly, so the
 * generate → site loop closes in code instead of depending on the model
 * remembering to call the tool (the 2026-09-17 acceptance run proved the
 * model skips it and ships a broken <img> reference).
 */
export async function insertAssetFromUrl(
  url: string,
  opts: InsertAssetOptions,
  transport: WorkspaceTransport,
): Promise<InsertAssetResult> {
  const directory = await resolveInsertDirectory(opts, transport);
  const isDataImage = /^data:image\//i.test(url);
  if (!isDataImage && !url.startsWith("https://")) {
    return { success: false, error: "Asset URL must be a public HTTPS URL or a data:image/* URL" };
  }
  if (!isSafeInsertDir(directory)) {
    return { success: false, error: "Invalid directory: must be a safe relative path" };
  }

  try {
    let buffer: Buffer;
    let contentType: string;
    if (isDataImage) {
      const decoded = decodeDataImageUrl(url);
      if ("error" in decoded) {
        return { success: false, error: decoded.error };
      }
      buffer = decoded.buffer;
      contentType = decoded.contentType;
    } else {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) {
        return { success: false, error: `Failed to download asset: HTTP ${resp.status}` };
      }
      contentType = resp.headers.get("content-type") || "application/octet-stream";
      buffer = Buffer.from(await resp.arrayBuffer());
    }
    if (!contentType.startsWith("image/")) {
      return { success: false, error: `Not an image (content-type: ${contentType})` };
    }
    if (buffer.length === 0) {
      return { success: false, error: "Downloaded asset is empty" };
    }
    if (!imagePayloadLooksComplete(buffer, contentType)) {
      return { success: false, error: "Image data is truncated or corrupt" };
    }
    if (buffer.length > MAX_INSERT_ASSET_BYTES) {
      return { success: false, error: `Asset exceeds max size (${MAX_INSERT_ASSET_BYTES} bytes)` };
    }

    const filename = sanitizeAssetName(opts.nameHint, contentType);
    const path = `${directory}/${filename}`;
    // Transient workspace errors (a volume blip or mid-prepare window can
    // briefly ENOENT the workspace root) must not lose the generated
    // asset — retry the write once before reporting saveError.
    const base64 = buffer.toString("base64");
    try {
      await transport.writeBinaryFile(path, base64);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await transport.writeBinaryFile(path, base64);
    }

    // Site path the model embeds in HTML. Framework projects serve
    // public/ at the site root, so a root-relative "/assets/x" is right.
    // Static sites are served from the workspace root — but under a
    // path mount (/preview/ws-id/, /sites/{deploymentId}/) a leading
    // slash escapes the mount and 404s, so static assets must be
    // RELATIVE ("assets/images/x"), which resolves correctly from a
    // root index.html at any mount depth.
    const sitePath = path.startsWith("public/")
      ? `/${path.slice("public/".length)}`
      : path;
    return { success: true, path, sitePath, contentType, sizeBytes: buffer.length };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to insert asset",
    };
  }
}

export const handleProjectInsertAsset: ToolHandler = async (inputs, transport) => {
  const url = inputs.url as string | undefined;
  const nameHint = inputs.name as string | undefined;
  const directory = inputs.directory as string | undefined;

  if (!url || typeof url !== "string") {
    return { success: false, error: "url is required" };
  }

  const result = await insertAssetFromUrl(url, { nameHint, directory }, transport);
  if (!result.success) {
    return { success: false, error: result.error ?? "Failed to insert asset" };
  }
  return {
    success: true,
    path: result.path,
    sitePath: result.sitePath,
    contentType: result.contentType,
    sizeBytes: result.sizeBytes,
    hint: `Reference this image in the site's HTML as <img src="${result.sitePath}" />.`,
  };
};
