/**
 * Extended tool handlers for the LiTT project tool registry.
 *
 * These handlers are imported by registry.ts and registered in PROJECT_TOOLS.
 * They are kept in a separate file for maintainability.
 *
 * All handlers use the same ToolHandler type and ToolResult shape as the
 * core handlers in registry.ts.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { getProject, verifyProjectWorkspace, listProjects } from "@/lib/projects/project-repository";
import { logFileOperation } from "@/lib/file-audit";
import { getUserGitHubOctokit } from "@/lib/github-pat";
import { recallMemories } from "@/lib/studio/memory-service";
import {
  isSafeWorkspacePath,
  ok,
  fail,
} from "@/lib/vapi-tools";
import {
  runWorkspaceCommand,
  workspaceDeleteFile,
  workspaceMkdir,
  workspaceRename,
  workspaceApplyPatch,
  type ToolHandler,
} from "@/lib/project-tools/registry";

// ─── String helpers ─────────────────────────────────────────────

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

// ─── Group 1: Git diff, log, checkpoint, restore ────────────────

export const toolGitDiff: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("git_diff requires a project_id.");
  const staged = args.staged === true;

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    const cmd = staged ? "git diff --cached" : "git diff";
    const result = await runWorkspaceCommand(workspaceId, userId, cmd);
    const diff = (result.stdout ?? "").trim();
    if (!diff) return ok(projectId, "No uncommitted changes.", { diff: "", fileCount: 0 });
    const fileCount = (diff.match(/^diff --git/gm) || []).length;
    return ok(projectId, `${fileCount} file(s) with uncommitted changes.`, {
      diff: diff.slice(0, 8000), fileCount, truncated: diff.length > 8000,
    });
  } catch (err) {
    return fail(`git_diff failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const toolGitLog: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("git_log requires a project_id.");
  const maxCount = Math.min(Math.max(parseInt(String(args.max_count ?? "10"), 10) || 10, 1), 50);

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    const result = await runWorkspaceCommand(workspaceId, userId, `git log --oneline --no-decorate -${maxCount}`);
    const log = (result.stdout ?? "").trim();
    if (!log) return ok(projectId, "No commits yet.", { commits: [], count: 0 });
    const commits = log.split("\n").map((line) => {
      const idx = line.indexOf(" ");
      return { sha: line.slice(0, idx), message: line.slice(idx + 1).slice(0, 200) };
    });
    return ok(projectId, `${commits.length} recent commit(s).`, { commits, count: commits.length });
  } catch (err) {
    return fail(`git_log failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const toolCreateCheckpoint: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("create_checkpoint requires a project_id.");
  const label = str(args.label);
  if (!label || label.trim().length < 2) return fail("create_checkpoint requires a label (min 2 chars).");
  const description = str(args.description);

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    await runWorkspaceCommand(workspaceId, userId, "git add -A");
    const msg = description ? `checkpoint: ${label}\n\n${description}` : `checkpoint: ${label}`;
    const b64 = Buffer.from(msg).toString("base64");
    const r = await runWorkspaceCommand(workspaceId, userId, `git commit --allow-empty -m "$(echo '${b64}' | base64 -d)"`);
    if (r.exitCode !== 0) {
      if ((r.stderr ?? "").includes("nothing to commit")) return fail("Nothing to checkpoint — working tree is clean.");
      return fail(`Checkpoint failed: ${r.stderr || r.stdout || "unknown error"}`);
    }
    const shaR = await runWorkspaceCommand(workspaceId, userId, "git rev-parse HEAD");
    return ok(projectId, `Checkpoint created: ${label}`, { sha: (shaR.stdout ?? "").trim() || null, label });
  } catch (err) {
    return fail(`create_checkpoint failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const toolRestoreCheckpoint: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("restore_checkpoint requires a project_id.");
  const sha = str(args.sha);
  if (!sha) return fail("restore_checkpoint requires a sha.");
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return fail("Invalid commit hash (7-40 hex chars).");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    const r = await runWorkspaceCommand(workspaceId, userId, `git reset --hard ${sha}`);
    if (r.exitCode !== 0) return fail(`Restore failed: ${r.stderr ?? r.stdout ?? "unknown error"}`);
    return ok(projectId, `Restored to checkpoint ${sha.slice(0, 8)}.`, { sha });
  } catch (err) {
    return fail(`restore_checkpoint failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ─── Group 2: delete_file, create_directory, rename_file, apply_patch ──

export const toolDeleteFile: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("delete_file requires a project_id.");
  const path = str(args.path);
  if (!path) return fail("delete_file requires a path.");
  if (!isSafeWorkspacePath(path)) return fail("Invalid or blocked workspace path.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    await workspaceDeleteFile(workspaceId, userId, path);
    await logFileOperation({ userId, projectId, workspaceId, action: "delete", path, contentLength: 0, source: "system", ok: true }).catch(() => {});
    return ok(projectId, `Deleted ${path}.`, { path });
  } catch (err) {
    return fail(err instanceof Error ? err.message : `Failed to delete ${path}.`);
  }
};

export const toolCreateDirectory: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("create_directory requires a project_id.");
  const path = str(args.path);
  if (!path) return fail("create_directory requires a path.");
  if (!isSafeWorkspacePath(path)) return fail("Invalid or blocked workspace path.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    await workspaceMkdir(workspaceId, userId, path);
    return ok(projectId, `Created directory ${path}.`, { path });
  } catch (err) {
    return fail(err instanceof Error ? err.message : `Failed to create directory ${path}.`);
  }
};

export const toolRenameFile: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("rename_file requires a project_id.");
  const oldPath = str(args.old_path);
  const newPath = str(args.new_path);
  if (!oldPath || !newPath) return fail("rename_file requires old_path and new_path.");
  if (!isSafeWorkspacePath(oldPath) || !isSafeWorkspacePath(newPath)) return fail("Invalid or blocked workspace path.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    await workspaceRename(workspaceId, userId, oldPath, newPath);
    return ok(projectId, `Renamed ${oldPath} to ${newPath}.`, { oldPath, newPath });
  } catch (err) {
    return fail(err instanceof Error ? err.message : `Failed to rename ${oldPath}.`);
  }
};

export const toolApplyPatch: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("apply_patch requires a project_id.");
  const patch = str(args.patch);
  if (!patch) return fail("apply_patch requires a patch.");
  if (patch.length > 50000) return fail("Patch too large (max 50000 characters).");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    const result = await workspaceApplyPatch(workspaceId, userId, patch);
    if (!result.applied) return fail(`Patch did not apply cleanly: ${result.output.slice(0, 500)}`);
    return ok(projectId, "Patch applied successfully.", { output: result.output.slice(0, 500) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to apply patch.");
  }
};

// ─── Group 3: start_preview_server ──────────────────────────────

export const toolStartPreviewServer: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("start_preview_server requires a project_id.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);
  if (!project.workspaceId) return fail("Workspace not provisioned.");

  let workspaceId = project.workspaceId;
  try {
    const { ensureWorkspaceAlive } = await import("@/lib/studio/workspace-recovery");
    const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
    workspaceId = recovered.workspaceId;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Workspace recovery failed.");
  }

  try {
    const pkgManager = project.packageManager ?? "pnpm";
    await runWorkspaceCommand(workspaceId, userId, `cd "${project.workspaceRoot ?? "."}" && ${pkgManager} dev --port 3000 &`);
    await new Promise((r) => setTimeout(r, 3000));
    const probe = await runWorkspaceCommand(workspaceId, userId, `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || echo "not_ready"`);
    const httpStatus = (probe.stdout ?? "").trim();
    return ok(projectId, `Preview server started. HTTP status: ${httpStatus}`, {
      workspaceId, port: 3000, httpStatus, running: httpStatus !== "not_ready" && httpStatus !== "000",
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to start preview server.");
  }
};

// ─── Group 4: list_projects, create_project, switch_project ─────

export const toolListProjects: ToolHandler = async (userId, _args) => {
  try {
    const { projects, legacyOnly } = await listProjects(userId);
    const all = [...projects, ...legacyOnly];
    return ok(null, `Found ${all.length} project(s).`, {
      projects: all.slice(0, 20).map((p) => ({
        id: p.id, name: p.name,
        repository: p.githubFullName ?? null,
        branch: p.githubBranch ?? p.githubDefaultBranch ?? null,
        workspaceStatus: p.workspaceStatus,
      })),
      count: all.length,
    });
  } catch (err) {
    return fail(`list_projects failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const toolCreateProject: ToolHandler = async (userId, args) => {
  const name = str(args.name);
  if (!name || name.trim().length < 2) return fail("create_project requires a name (min 2 chars).");
  const templateId = str(args.template_id, "nextjs");

  try {
    const { createBlankProject, PROJECT_TEMPLATES } = await import("@/lib/projects/project-repository");
    if (!PROJECT_TEMPLATES[templateId as keyof typeof PROJECT_TEMPLATES]) {
      return fail(`Invalid template_id. Valid: ${Object.keys(PROJECT_TEMPLATES).join(", ")}`);
    }
    const project = await createBlankProject({
      userId, name: name.trim(),
      templateId: templateId as "blank-static" | "nextjs" | "react-vite" | "expo-react-native",
      accessMode: "private",
    });
    return ok(project.id, `Created project "${project.name}".`, {
      projectId: project.id, name: project.name,
    });
  } catch (err) {
    return fail(`create_project failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const toolSwitchProject: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("switch_project requires a project_id.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found or not owned by you.`);

  try {
    if (supabaseAdmin) {
      const { error } = await supabaseAdmin
        .from("user_active_project")
        .upsert({ user_id: userId, project_id: projectId }, { onConflict: "user_id" });
      if (error) throw error;
    }
    return ok(projectId, `Switched active project to "${project.name}".`, {
      projectId, name: project.name,
    });
  } catch (err) {
    return fail(`switch_project failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ─── Group 5: memory_search ─────────────────────────────────────

export const toolMemorySearch: ToolHandler = async (userId, args) => {
  const query = str(args.query);
  if (!query) return fail("memory_search requires a query.");
  const projectId = str(args.project_id);
  if (!projectId) return fail("memory_search requires a project_id.");
  const limit = Math.min(Math.max(parseInt(String(args.limit ?? "5"), 10) || 5, 1), 20);

  try {
    const memories = await recallMemories(query, userId, projectId, {
      agentSlug: "litt", limit,
    });
    if (memories.length === 0) return ok(projectId, "No memories found.", { memories: [], count: 0 });
    return ok(projectId, `Found ${memories.length} memory match(es).`, {
      memories: memories.map((m) => ({
        id: m.id, content: m.content.slice(0, 500),
        memoryType: m.memory_type, createdAt: m.created_at,
      })),
      count: memories.length,
    });
  } catch (err) {
    return fail(`memory_search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ─── Group 6: run_command (strict allowlist) ────────────────────

const SAFE_COMMAND_PREFIXES = [
  "pnpm install", "pnpm add ", "pnpm remove ", "pnpm list", "pnpm why", "pnpm outdated",
  "pnpm run ", "pnpm test", "pnpm typecheck", "pnpm lint", "pnpm build", "pnpm dev",
  "npm install", "npm run ", "npm test",
  "npx tsc", "npx eslint", "npx prettier", "npx vitest",
  "node --version", "node -v", "pnpm --version",
  "git status", "git branch", "git log", "git diff", "git show", "git remote -v",
  "ls ", "ls -", "cat ", "head ", "tail ", "wc ", "grep ", "rg ", "find .",
  "echo ", "pwd", "which ", "env | grep",
];

const REQUIRES_APPROVAL_PATTERNS = [
  /--force/i, /-f\b/i, /git push/i, /git reset\s+--hard/i, /git clean/i,
  /rm\s+/i, /rmdir/i, /chmod/i, /chown/i, /sudo/i,
  /curl.*\|.*sh/i, /wget.*\|.*sh/i, /eval/i, /export\s+[A-Z]/i,
];

function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const trimmed = command.trim();
  if (!trimmed) return { safe: false, reason: "Empty command." };
  if (trimmed.length > 500) return { safe: false, reason: "Command too long (max 500 chars)." };
  if (/[;`$()|&<>]/.test(trimmed) && !trimmed.startsWith("echo ")) {
    if (!/^(ls|cat|head|tail|wc|grep|rg|find)\s/.test(trimmed)) {
      return { safe: false, reason: "Shell metacharacters not allowed." };
    }
  }
  for (const p of REQUIRES_APPROVAL_PATTERNS) {
    if (p.test(trimmed)) return { safe: false, reason: `Command requires approval: ${p.source}` };
  }
  if (!SAFE_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return { safe: false, reason: "Command not in allowlist." };
  }
  return { safe: true };
}

export const toolRunCommand: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("run_command requires a project_id.");
  const command = str(args.command);
  if (!command) return fail("run_command requires a command.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  const safety = isCommandSafe(command);
  if (!safety.safe) {
    return fail(`Command rejected: ${safety.reason}. Use request_approval for commands outside the allowlist.`);
  }

  try {
    const result = await runWorkspaceCommand(workspaceId, userId, command);
    return ok(projectId, `Command finished (exit ${result.exitCode ?? 0}).`, {
      command, exitCode: result.exitCode ?? 0,
      stdout: (result.stdout ?? "").slice(0, 4000),
      stderr: (result.stderr ?? "").slice(0, 2000),
      durationMs: result.durationMs ?? null,
    });
  } catch (err) {
    return fail(`run_command failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ─── Group 7: web_search, web_fetch ─────────────────────────────

export const toolWebSearch: ToolHandler = async (_userId, args) => {
  const query = str(args.query);
  if (!query) return fail("web_search requires a query.");
  const maxResults = Math.min(Math.max(parseInt(String(args.max_results ?? "5"), 10) || 5, 1), 10);

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const resp = await fetch(searchUrl, { signal: controller.signal, headers: { "User-Agent": "LiTT-Search/1.0" } });
    clearTimeout(timeout);
    if (!resp.ok) return fail(`Web search failed (${resp.status}).`);

    const html = await resp.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const linkRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/g;
    const links = [...html.matchAll(linkRegex)];
    const snippets = [...html.matchAll(snippetRegex)];

    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      const title = (links[i][2] || "").replace(/&amp;/g, "&").trim();
      const url = links[i][1] || "";
      const snippet = (snippets[i]?.[1] || "").replace(/&amp;/g, "&").trim();
      if (title && url) results.push({ title: title.slice(0, 200), url: url.slice(0, 500), snippet: snippet.slice(0, 300) });
    }
    return ok(null, `Found ${results.length} result(s) for "${query}".`, { results, count: results.length });
  } catch (err) {
    return fail(`web_search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const toolWebFetch: ToolHandler = async (_userId, args) => {
  const url = str(args.url);
  if (!url) return fail("web_fetch requires a url.");

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return fail("URL must use http or https.");
  } catch {
    return fail("Invalid URL format.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" ||
      hostname.startsWith("10.") || hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") || hostname.endsWith(".internal") || hostname.endsWith(".local")) {
    return fail("URLs pointing to internal/private addresses are blocked.");
  }

  const maxChars = Math.min(Math.max(parseInt(String(args.max_chars ?? "4000"), 10) || 4000, 500), 20000);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "LiTT-Fetch/1.0", Accept: "text/html,application/json,text/plain" },
      redirect: "follow",
    });
    clearTimeout(timeout);

    const contentType = resp.headers.get("content-type") ?? "";
    const text = await resp.text();
    let content = text;
    if (contentType.includes("text/html")) {
      content = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return ok(null, `Fetched ${url} (${resp.status}, ${content.length} chars).`, {
      url, finalUrl: resp.url, statusCode: resp.status, contentType,
      content: content.slice(0, maxChars), truncated: content.length > maxChars,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) return fail(`web_fetch timed out after 20 seconds fetching ${url}.`);
    return fail(`web_fetch failed: ${msg.slice(0, 300)}`);
  }
};

// ─── Group 8: GitHub read/search/PR-list ────────────────────────

export const toolGithubSearchCode: ToolHandler = async (userId, args) => {
  const query = str(args.query);
  if (!query) return fail("github_search_code requires a query.");
  const projectId = str(args.project_id) || null;

  let owner: string | null = null;
  let repo: string | null = null;
  if (projectId) {
    const project = await getProject(projectId, userId);
    if (project?.githubOwner && project?.githubRepo) { owner = project.githubOwner; repo = project.githubRepo; }
  }

  const gh = await getUserGitHubOctokit(userId);
  if (!gh) return fail("GitHub connection not found. Connect GitHub in Settings → Connections.");

  try {
    const fullQuery = owner && repo ? `${query} repo:${owner}/${repo}` : query;
    const { data } = await gh.octokit.rest.search.code({ q: fullQuery, per_page: 10 });
    const results = (data.items || []).map((item) => ({
      file: item.path, repository: item.repository?.full_name ?? null,
      url: item.html_url, score: item.score,
    }));
    return ok(projectId, `Found ${results.length} GitHub code result(s).`, { results, count: results.length, total: data.total_count });
  } catch (err) {
    return fail(`github_search_code failed: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
  }
};

export const toolGithubListPullRequests: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("github_list_pull_requests requires a project_id.");
  const state = str(args.state, "open") as "open" | "closed" | "all";
  if (!["open", "closed", "all"].includes(state)) return fail("state must be open, closed, or all.");
  const maxResults = Math.min(Math.max(parseInt(String(args.max_results ?? "10"), 10) || 10, 1), 30);

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);
  if (!project.githubOwner || !project.githubRepo) return fail("Project not connected to GitHub.");

  const gh = await getUserGitHubOctokit(userId, project.githubInstallationId ?? undefined);
  if (!gh) return fail("GitHub connection not found.");

  try {
    const { data } = await gh.octokit.rest.pulls.list({
      owner: project.githubOwner, repo: project.githubRepo,
      state, per_page: maxResults, sort: "updated", direction: "desc",
    });
    const prs = data.map((pr) => ({
      number: pr.number, title: pr.title, state: pr.state,
      head: pr.head.ref, base: pr.base.ref, url: pr.html_url,
      draft: pr.draft, updatedAt: pr.updated_at,
    }));
    return ok(projectId, `Found ${prs.length} PR(s) (state: ${state}).`, { prs, count: prs.length });
  } catch (err) {
    return fail(`github_list_pull_requests failed: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
  }
};

export const toolGithubReadFile: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("github_read_file requires a project_id.");
  const path = str(args.path);
  if (!path) return fail("github_read_file requires a path.");
  const branch = str(args.branch) || undefined;

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);
  if (!project.githubOwner || !project.githubRepo) return fail("Project not connected to GitHub.");

  const gh = await getUserGitHubOctokit(userId, project.githubInstallationId ?? undefined);
  if (!gh) return fail("GitHub connection not found.");

  try {
    const { data } = await gh.octokit.rest.repos.getContent({
      owner: project.githubOwner, repo: project.githubRepo, path, ref: branch,
    });
    if (Array.isArray(data)) {
      return ok(projectId, `Listed ${data.length} items at ${path}.`, {
        path, type: "directory",
        entries: data.map((item) => ({ name: item.name, type: item.type, path: item.path })),
      });
    }
    if (data.type === "file" && data.content) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return ok(projectId, `Read ${content.length} chars from ${path} on GitHub.`, {
        path, type: "file", content: content.slice(0, 8000),
        size: content.length, truncated: content.length > 8000, sha: data.sha,
      });
    }
    return fail(`Unexpected content type: ${data.type}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404")) return fail(`File ${path} not found on GitHub.`);
    return fail(`github_read_file failed: ${msg.slice(0, 300)}`);
  }
};
