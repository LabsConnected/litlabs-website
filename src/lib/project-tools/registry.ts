/**
 * Project Tool Registry — shared tool handlers for the LiTT ecosystem.
 *
 * This module is the single home for all project tool handler logic. Both
 * the Vapi tool server (/api/vapi/tools) and the LiTT Voice Runtime
 * (voice-runtime.ts) import from here, ensuring one brain, one set of
 * handlers, one audit trail.
 *
 * Architecture:
 *   - Each tool has a handler function: (userId, args) => Promise<ToolResult>
 *   - The registry maps tool names to handlers + metadata
 *   - Project-scoped tools require a project_id arg; the dispatcher extracts it
 *   - All handlers use the same ok()/fail() result shape from vapi-tools
 *
 * Security:
 *   - Path safety via isSafeWorkspacePath()
 *   - Branch name validation via isSafeBranchName()
 *   - Owner scope verification via getProject(projectId, ownerUserId)
 *   - SSRF protection in browser_test
 *   - Recipient allowlisting in send_email/send_sms
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import {
  getProject,
  verifyProjectWorkspace,
  updateProjectRuntime,
} from "@/lib/projects/project-repository";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";
import { logFileOperation } from "@/lib/file-audit";
import { getDeployments } from "@/lib/deployments";
import { getUserGitHubOctokit } from "@/lib/github-pat";
import { persistMemory } from "@/lib/studio/memory-service";
import {
  CHECK_IDS,
  isSafeWorkspacePath,
  packageManagerCommand,
  ok,
  fail,
  type ToolResult,
  type CheckId,
} from "@/lib/vapi-tools";
import { resolveRecipient } from "@/lib/vapi-recipient-policy";
import { VAPI_TOOL_DEFINITIONS } from "@/lib/vapi-tool-definitions";
import {
  createJob,
  getJob,
  cancelJob,
  approveJob,
  validateJobType,
  isSafeRiskLevel,
  isSafeRequestSource,
  type JobType,
  type RiskLevel,
  type RequestSource,
} from "@/lib/browser-jobs";
import { executeBrowserJob } from "@/lib/browser-job-executor";
import { getTerminalServerUrl } from "@/lib/terminal-url";

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Resolve the terminal server base URL.
 * Production has TERMINAL_SERVER_URL (not TERMINAL_SERVER_INTERNAL_URL).
 */
export const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  process.env.TERMINAL_SERVER_URL ??
  getTerminalServerUrl();

export function internalHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Internal-Service-Key": process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "",
  };
}

export async function runWorkspaceCommand(
  workspaceId: string,
  userId: string,
  command: string,
) {
  const response = await fetch(`${TERMINAL_BASE()}/internal/workspace/${workspaceId}/exec`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({ command, userId }),
  });
  const payload = (await response.json().catch(() => null)) as {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    durationMs?: number;
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? `Workspace command failed (${response.status})`);
  return payload ?? {};
}

/** List files in a workspace directory. Falls back to `ls` via exec. */
async function workspaceListFiles(
  workspaceId: string,
  userId: string,
  path: string,
): Promise<Array<{ name: string; type: "file" | "directory"; size?: number }>> {
  const resp = await fetch(
    `${TERMINAL_BASE()}/internal/workspace/${workspaceId}/files?path=${encodeURIComponent(path)}`,
    { headers: internalHeaders() },
  );
  if (resp.ok) {
    const data = await resp.json().catch(() => null);
    if (Array.isArray(data)) return data;
  }
  const safePath = path.replace(/'/g, "'\\''");
  const result = await runWorkspaceCommand(workspaceId, userId, `ls -1p -- '${safePath}'`);
  const lines = (result.stdout ?? "").split("\n").filter(Boolean);
  return lines.map((line) => {
    const isDir = line.endsWith("/");
    return { name: isDir ? line.slice(0, -1) : line, type: isDir ? "directory" : "file" };
  });
}

/** Read a file from the workspace. Falls back to `cat` via exec. */
async function workspaceReadFile(
  workspaceId: string,
  userId: string,
  path: string,
): Promise<string> {
  const resp = await fetch(
    `${TERMINAL_BASE()}/internal/workspace/${workspaceId}/files/read?path=${encodeURIComponent(path)}`,
    { headers: internalHeaders() },
  );
  if (resp.ok) {
    const data = await resp.json().catch(() => null);
    if (data && typeof data === "object" && typeof (data as { content?: unknown }).content === "string") {
      return (data as { content: string }).content;
    }
    if (typeof data === "string") return data;
  }
  const safePath = path.replace(/'/g, "'\\''");
  const result = await runWorkspaceCommand(workspaceId, userId, `cat -- '${safePath}'`);
  if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to read ${path}`);
  return result.stdout ?? "";
}

/** Write a file to the workspace. Falls back to exec with base64. */
async function workspaceWriteFile(
  workspaceId: string,
  userId: string,
  path: string,
  content: string,
): Promise<void> {
  const resp = await fetch(
    `${TERMINAL_BASE()}/internal/workspace/${workspaceId}/files/write`,
    { method: "POST", headers: internalHeaders(), body: JSON.stringify({ path, content }) },
  );
  if (resp.ok) return;
  const safePath = path.replace(/'/g, "'\\''");
  const b64 = Buffer.from(content).toString("base64");
  const result = await runWorkspaceCommand(
    workspaceId, userId, `echo '${b64}' | base64 -d > '${safePath}'`,
  );
  if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to write ${path}`);
}

/** Delete a file or directory. */
export async function workspaceDeleteFile(
  workspaceId: string, userId: string, path: string,
): Promise<void> {
  const safePath = path.replace(/'/g, "'\\''");
  const result = await runWorkspaceCommand(workspaceId, userId, `rm -rf -- '${safePath}'`);
  if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to delete ${path}`);
}

/** Create a directory (mkdir -p). */
export async function workspaceMkdir(
  workspaceId: string, userId: string, path: string,
): Promise<void> {
  const safePath = path.replace(/'/g, "'\\''");
  const result = await runWorkspaceCommand(workspaceId, userId, `mkdir -p -- '${safePath}'`);
  if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to create directory ${path}`);
}

/** Rename or move a file/directory. */
export async function workspaceRename(
  workspaceId: string, userId: string, oldPath: string, newPath: string,
): Promise<void> {
  const safeOld = oldPath.replace(/'/g, "'\\''");
  const safeNew = newPath.replace(/'/g, "'\\''");
  const result = await runWorkspaceCommand(workspaceId, userId, `mv -- '${safeOld}' '${safeNew}'`);
  if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to rename ${oldPath}`);
}

/** Apply a unified diff patch via git apply. */
export async function workspaceApplyPatch(
  workspaceId: string, userId: string, patch: string,
): Promise<{ applied: boolean; output: string }> {
  const b64 = Buffer.from(patch).toString("base64");
  const result = await runWorkspaceCommand(
    workspaceId, userId, `echo '${b64}' | base64 -d | git apply --verbose -`,
  );
  if (result.exitCode !== 0) {
    return { applied: false, output: result.stderr || result.stdout || "Patch did not apply cleanly" };
  }
  return { applied: true, output: result.stdout || "Patch applied successfully" };
}

// ─── String helpers (mirror vapi-tools str/optStr) ──────────────

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function labelFor(id: CheckId): string {
  return { typecheck: "Typecheck", lint: "Lint", test: "Tests", build: "Build" }[id];
}

// ─── Branch name validation ─────────────────────────────────────

export function isSafeBranchName(name: string): boolean {
  return /^[a-z0-9][a-z0-9\-\/]*$/.test(name) && name.length <= 200 && !name.includes("..");
}

// ─── Tool handler type ──────────────────────────────────────────

export type ToolHandler = (
  userId: string,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

export interface ToolMetadata {
  /** Whether this tool requires a project_id arg. */
  projectScoped: boolean;
  /** Whether this tool mutates state (files, git, external services). */
  mutating: boolean;
  /** Whether this tool is read-only and safe to call freely. */
  readOnly: boolean;
}

// ─── Tool handlers ──────────────────────────────────────────────

/** get_active_project — resolve the owner's active project. */
export const toolGetActiveProject: ToolHandler = async (userId, args) => {
  const explicitProjectId = optStr(args.project_id);

  if (supabaseAdmin) {
    const { data: activeRecord } = await supabaseAdmin
      .from("user_active_project")
      .select("project_id")
      .eq("user_id", userId)
      .maybeSingle();

    const candidateId = explicitProjectId ?? activeRecord?.project_id;
    if (candidateId) {
      const project = await resolveCurrentProject({ explicitProjectId: candidateId, userId });
      if (project) {
        return ok(project.projectId, `Active project is "${project.projectName}".`, {
          projectName: project.projectName,
          repository: project.repositoryFullName,
          branch: project.activeBranch ?? project.defaultBranch,
          workspaceStatus: project.workspaceStatus,
          source: project.source,
        });
      }
    }
  }

  const project = await resolveCurrentProject({ userId });
  if (project) {
    return ok(project.projectId, `Active project is "${project.projectName}".`, {
      projectName: project.projectName,
      repository: project.repositoryFullName,
      branch: project.activeBranch ?? project.defaultBranch,
      workspaceStatus: project.workspaceStatus,
      source: project.source,
    });
  }

  return fail("No active project was found for the owner.");
};

/** inspect_project_files — list a directory in the project workspace. */
export const toolInspectProjectFiles: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("inspect_project_files requires a project_id.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found or not owned by the configured owner.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  const path = str(args.path, ".");
  if (path !== "." && !isSafeWorkspacePath(path)) return fail("Invalid or blocked workspace path.");

  try {
    const entries = await workspaceListFiles(workspaceId, userId, path);
    return ok(projectId, `Listed ${entries.length} entries at "${path}".`, {
      path,
      entries,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to list files.");
  }
};

/** read_file — read a single file from the project workspace. */
export const toolReadFile: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("read_file requires a project_id.");
  const path = str(args.path);
  if (!path) return fail("read_file requires a path.");
  if (!isSafeWorkspacePath(path)) return fail("Invalid or blocked workspace path.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found or not owned by the configured owner.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    const content = await workspaceReadFile(workspaceId, userId, path);
    return ok(projectId, `Read ${content.length} characters from "${path}".`, {
      path,
      content,
      size: content.length,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to read file.");
  }
};

/** edit_file — write file content in the project workspace (audited). */
export const toolEditFile: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("edit_file requires a project_id.");
  const path = str(args.path);
  const content = str(args.content);
  const changeSummary = str(args.change_summary, "Tool edit_file call");

  if (!path) return fail("edit_file requires a path.");
  if (!isSafeWorkspacePath(path)) return fail("Invalid or blocked workspace path.");
  if (content.length === 0) return fail("edit_file requires non-empty content.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found or not owned by the configured owner.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  let wroteOk = false;
  let writeError = "";
  try {
    await workspaceWriteFile(workspaceId, userId, path, content);
    wroteOk = true;
  } catch (err) {
    writeError = err instanceof Error ? err.message : "Unknown write error";
  }

  await logFileOperation({
    userId,
    projectId,
    workspaceId,
    action: "write",
    path,
    contentLength: content.length,
    source: "system",
    ok: wroteOk,
    error: wroteOk ? undefined : writeError,
  }).catch(() => {});

  if (!wroteOk) {
    return fail(`Failed to write file: ${writeError}`);
  }

  const changeRecordId = `change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from("agent_logs").insert({
        agent_id: null,
        level: "info",
        message: `[tool:file-change] ${path} (${content.length} chars)`,
        metadata: {
          _type: "vapi_file_change_record",
          changeRecordId,
          userId,
          projectId,
          path,
          changeSummary,
          contentLength: content.length,
          diffLines: 0,
          diffPreview: null,
          requestedBy: "tool",
          createdAt: new Date().toISOString(),
        },
      });
    } catch {
      // Change record is best-effort
    }
  }

  return ok(projectId, `Wrote ${content.length} characters to "${path}".`, {
    path,
    changeSummary,
    changeRecordId,
    bytes: content.length,
    diffLines: 0,
  });
};

/** run_project_checks — run predefined checks (typecheck, lint, test, build) only. */
export const toolRunProjectChecks: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("run_project_checks requires a project_id.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found or not owned by the configured owner.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  const requested = args.checks;
  let checks: CheckId[];
  if (Array.isArray(requested) && requested.length > 0) {
    checks = requested.filter((c): c is CheckId => typeof c === "string" && (CHECK_IDS as readonly string[]).includes(c));
    if (checks.length === 0) return fail(`No valid checks requested. Valid ids: ${CHECK_IDS.join(", ")}.`);
  } else {
    checks = [...CHECK_IDS];
  }

  const now = new Date().toISOString();
  const results: Record<string, unknown>[] = [];

  for (const checkId of checks) {
    const command = packageManagerCommand(project.packageManager, checkId);
    if (!command) {
      results.push({ id: checkId, label: labelFor(checkId), status: "not_configured", output: null, error: null });
      continue;
    }
    try {
      const result = await runWorkspaceCommand(workspaceId, userId, command);
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
      const exitCode = result.exitCode ?? 1;
      results.push({
        id: checkId,
        label: labelFor(checkId),
        status: exitCode === 0 ? "passed" : "failed",
        command,
        exitCode,
        durationMs: result.durationMs ?? null,
        output: output.slice(0, 100000),
        error: exitCode === 0 ? null : `Command exited with code ${exitCode}`,
      });
    } catch (runError) {
      results.push({
        id: checkId,
        label: labelFor(checkId),
        status: "failed",
        command,
        output: null,
        error: runError instanceof Error ? runError.message : "Check failed",
      });
    }
  }

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  return ok(projectId, `Ran ${results.length} check(s): ${passed} passed, ${failed} failed.`, {
    checks: results,
    summary: { total: results.length, passed, failed },
    timestamp: now,
  });
};

/** create_preview — mark the project preview ready and return the proxy URL. */
export const toolCreatePreview: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("create_preview requires a project_id.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found or not owned by the configured owner.`);
  if (!project.workspaceId || !project.workspaceRoot) {
    return fail("Project workspace is not provisioned; cannot create a preview.");
  }

  const branch = optStr(args.branch) ?? project.githubBranch ?? project.githubDefaultBranch ?? null;
  const proxyUrl = `/api/studio-projects/${projectId}/preview/proxy`;
  const updated = await updateProjectRuntime(projectId, userId, {
    runtimeStatus: "ready",
    previewUrl: proxyUrl,
    runtimeError: null,
  });

  return ok(projectId, "Preview marked ready. The proxy URL is available now.", {
    runtimeStatus: updated?.runtimeStatus ?? "ready",
    previewUrl: proxyUrl,
    branch,
  });
};

/** get_deployment_status — read recent deployments, optionally by environment. */
export const toolGetDeploymentStatus: ToolHandler = async (_userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("get_deployment_status requires a project_id.");
  const environment = optStr(args.environment) as "preview" | "staging" | "production" | undefined;
  if (environment && !["preview", "staging", "production"].includes(environment)) {
    return fail("environment must be one of: preview, staging, production.");
  }

  let deployments;
  try {
    deployments = await getDeployments({ environment, limit: 20 });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to fetch deployments.");
  }

  const latest = deployments[0] ?? null;
  const message = latest
    ? `Latest deployment is ${latest.status} (${latest.environment}, branch ${latest.branch}).`
    : "No deployments on record.";

  return ok(projectId, message, {
    environment: environment ?? "all",
    latest,
    recent: deployments.slice(0, 10),
    count: deployments.length,
  });
};

/** request_deployment_approval — request-only; never deploys. */
export const toolRequestDeploymentApproval: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("request_deployment_approval requires a project_id.");
  const environment = optStr(args.environment);
  const changeSummary = str(args.change_summary, "No summary provided");

  if (!environment) return fail("request_deployment_approval requires an environment.");
  if (!["preview", "staging", "production"].includes(environment)) {
    return fail("environment must be one of: preview, staging, production.");
  }

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found or not owned by the configured owner.`);

  const requestId = `dep-approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const branch = project.githubBranch ?? project.githubDefaultBranch ?? null;

  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from("agent_logs").insert({
        agent_id: null,
        level: "info",
        message: `[deploy:approval-request] ${environment} for ${project.name}`,
        metadata: {
          _type: "deployment_approval_request",
          requestId,
          userId,
          projectId,
          projectName: project.name,
          environment,
          branch,
          changeSummary,
          requestedBy: "tool",
          status: "pending_approval",
          createdAt: new Date().toISOString(),
        },
      });
    } catch {
      // Logging is best-effort
    }
  }

  const note =
    environment === "production"
      ? "Production deployment requires separate explicit human approval recorded on the backend. No deployment was performed."
      : "Approval request recorded. No deployment was performed.";

  return ok(projectId, `Recorded deployment approval request (${environment}). ${note}`, {
    requestId,
    environment,
    branch,
    changeSummary,
    status: "pending_approval",
    deployed: false,
  });
};

// ─── Browser job tools ──────────────────────────────────────────

export const toolBrowserStartJob: ToolHandler = async (userId, args) => {
  const jobType = str(args.job_type);
  const typeError = validateJobType(jobType);
  if (typeError) return fail(typeError);

  const params = (args.params as Record<string, unknown>) ?? {};
  if (typeof params !== "object" || Array.isArray(params)) {
    return fail("params must be an object.");
  }

  const goal = optStr(args.goal);
  const idempotencyKey = optStr(args.idempotency_key);
  const riskLevelRaw = optStr(args.risk_level);
  const requestedByRaw = optStr(args.requested_by) ?? "vapi";

  if (riskLevelRaw && !isSafeRiskLevel(riskLevelRaw)) {
    return fail("Invalid risk_level. Valid: low, medium, high.");
  }
  if (!isSafeRequestSource(requestedByRaw)) {
    return fail("Invalid requested_by. Valid: vapi, studio, cron, admin.");
  }

  try {
    const { job, created } = await createJob({
      userId,
      jobType: jobType as JobType,
      goal,
      riskLevel: riskLevelRaw as RiskLevel | undefined,
      requestedBy: requestedByRaw as RequestSource,
      idempotencyKey,
      params,
    });

    if (created && job.status === "queued") {
      // Async execution — fire and forget
      void executeBrowserJob(job.id, userId).catch(() => {});
    }

    const status = created ? "queued" : job.status;
    return ok(null, `Browser job ${created ? "started" : "already exists"} (status: ${status}).`, {
      jobId: job.id,
      jobType: job.jobType,
      status: job.status,
      created,
      liveViewUrl: job.liveViewUrl,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to create browser job.");
  }
};

export const toolBrowserJobStatus: ToolHandler = async (userId, args) => {
  const jobId = str(args.job_id);
  if (!jobId) return fail("browser_job_status requires a job_id.");

  const job = await getJob(jobId, userId);
  if (!job) return fail(`Job ${jobId} not found.`);

  const progressText = job.progress.totalSteps > 0
    ? `Step ${job.progress.step + 1}/${job.progress.totalSteps}.`
    : "";

  const statusMessage = {
    queued: "The job is queued and waiting to start.",
    running: `The job is running. ${progressText}`,
    awaiting_approval: `The job is waiting for your approval. ${job.error ?? ""}`,
    approved: "The job was approved and will resume shortly.",
    completed: "The job completed successfully.",
    failed: `The job failed: ${job.error ?? "unknown error"}`,
    cancelled: "The job was cancelled.",
  }[job.status];

  return ok(null, statusMessage, {
    jobId: job.id,
    jobType: job.jobType,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    liveViewUrl: job.liveViewUrl,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  });
};

export const toolBrowserCancelJob: ToolHandler = async (userId, args) => {
  const jobId = str(args.job_id);
  if (!jobId) return fail("browser_cancel_job requires a job_id.");

  const job = await cancelJob(jobId, userId);
  if (!job) {
    const existing = await getJob(jobId, userId);
    if (!existing) return fail(`Job ${jobId} not found.`);
    return fail(`Cannot cancel job in status "${existing.status}". Only queued or awaiting_approval jobs can be cancelled.`);
  }

  return ok(null, `Job ${jobId} has been cancelled.`, {
    jobId: job.id,
    status: job.status,
  });
};

export const toolBrowserApproveJob: ToolHandler = async (userId, args) => {
  const jobId = str(args.job_id);
  if (!jobId) return fail("browser_approve_job requires a job_id.");

  const job = await approveJob(jobId, userId);
  if (!job) {
    const existing = await getJob(jobId, userId);
    if (!existing) return fail(`Job ${jobId} not found.`);
    return fail(`Cannot approve job in status "${existing.status}". Only awaiting_approval jobs can be approved.`);
  }

  return ok(null, `Job ${jobId} has been approved. The high-risk action will proceed.`, {
    jobId: job.id,
    status: job.status,
    approvedBy: job.approvedBy,
    approvedAt: job.approvedAt,
  });
};

// ─── Owner notification tools ───────────────────────────────────

export const toolSendSms: ToolHandler = async (_userId, args) => {
  const message = str(args.message);
  if (!message) return fail("send_sms requires a message.");

  const ownerPhone = process.env.LITTLABS_OWNER_PHONE ?? "";
  const requestedDest = str(args.to_number) || ownerPhone;
  const policy = resolveRecipient(requestedDest, {
    ownerDestination: ownerPhone,
    allowedRecipientsRaw: process.env.LITTLABS_ALLOWED_RECIPIENTS,
  });
  if (!policy.allowed) {
    return fail(policy.reason);
  }

  return fail(
    "SMS sending is not available yet — the LiTT phone number doesn't support text messaging. " +
    "A Twilio number with SMS capability needs to be imported into Vapi. " +
    "Tell the caller honestly that texting is not available yet."
  );
};

export const toolSendEmail: ToolHandler = async (_userId, args) => {
  const subject = str(args.subject) || "Message from LiTT";
  const body = str(args.body);
  if (!body) return fail("send_email requires a body.");

  const ownerEmail = process.env.LITTLABS_OWNER_EMAIL ?? "";
  const requestedDest = str(args.to_email) || ownerEmail;
  const policy = resolveRecipient(requestedDest, {
    ownerDestination: ownerEmail,
    allowedRecipientsRaw: process.env.LITTLABS_ALLOWED_RECIPIENTS,
  });
  if (!policy.allowed) {
    return fail(policy.reason);
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return fail("Email sending is not configured (RESEND_API_KEY missing). Tell the caller email is not available yet.");
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "LiTT <noreply@litlabs.net>",
        to: requestedDest,
        subject,
        text: body,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error");
      return fail(`Email send failed (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const data = await resp.json().catch(() => ({}));
    return ok(null, `Email sent to ${requestedDest}.`, { to: requestedDest, subject, messageId: data.id ?? null });
  } catch (err) {
    return fail(`Email send error: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ─── Git operations ─────────────────────────────────────────────

export const toolGitStatus: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("git_status requires a project_id.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    const result = await runWorkspaceCommand(workspaceId, userId, "git status --porcelain");
    const status = (result.stdout ?? "").trim();
    const files = status ? status.split("\n").filter(Boolean) : [];
    return ok(projectId, `Git status: ${files.length} file(s) changed.`, {
      clean: files.length === 0,
      files: files.slice(0, 50),
    });
  } catch (err) {
    return fail(`git status failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const toolCreateBranch: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("create_branch requires a project_id.");
  const branchName = str(args.branch_name);
  if (!branchName) return fail("create_branch requires a branch_name.");
  if (!isSafeBranchName(branchName)) {
    return fail("Invalid branch name. Use lowercase with hyphens (e.g. 'fix/mobile-nav').");
  }

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    const result = await runWorkspaceCommand(workspaceId, userId, `git checkout -b ${branchName}`);
    if (result.exitCode !== 0) {
      return fail(`Failed to create branch: ${result.stderr ?? result.stdout ?? "unknown error"}`);
    }
    return ok(projectId, `Created and switched to branch '${branchName}'.`, { branch: branchName });
  } catch (err) {
    return fail(`create_branch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const toolCommitChanges: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("commit_changes requires a project_id.");
  const message = str(args.message);
  if (!message) return fail("commit_changes requires a message.");

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  try {
    const addResult = await runWorkspaceCommand(workspaceId, userId, "git add -A");
    if (addResult.exitCode !== 0) {
      return fail(`git add failed: ${addResult.stderr ?? "unknown error"}`);
    }

    const safeMessage = message.replace(/'/g, "'\\''");
    const commitResult = await runWorkspaceCommand(workspaceId, userId, `git commit -m '${safeMessage}'`);

    if (commitResult.exitCode !== 0) {
      const stderr = commitResult.stderr ?? "";
      if (stderr.includes("nothing to commit")) {
        return fail("Nothing to commit — the working tree is clean.");
      }
      return fail(`git commit failed: ${stderr || commitResult.stdout || "unknown error"}`);
    }

    const shaResult = await runWorkspaceCommand(workspaceId, userId, "git rev-parse HEAD");
    const sha = (shaResult.stdout ?? "").trim();

    return ok(projectId, `Committed: ${message.slice(0, 80)}`, { sha: sha || null, message });
  } catch (err) {
    return fail(`commit_changes failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const toolPushBranch: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("push_branch requires a project_id.");
  const branchName = str(args.branch_name);

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  const branch = branchName || project.githubBranch || project.githubDefaultBranch || "HEAD";
  if (!isSafeBranchName(branch)) {
    return fail("Invalid branch name.");
  }

  try {
    const result = await runWorkspaceCommand(workspaceId, userId, `git push -u origin ${branch}`);
    if (result.exitCode !== 0) {
      return fail(`git push failed: ${result.stderr ?? result.stdout ?? "unknown error"}`);
    }
    return ok(projectId, `Pushed branch '${branch}' to remote.`, { branch });
  } catch (err) {
    return fail(`push_branch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const toolCreatePullRequest: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("create_pull_request requires a project_id.");
  const title = str(args.title);
  if (!title) return fail("create_pull_request requires a title.");
  const body = str(args.body) || "";
  const headBranch = str(args.branch_name);
  const baseBranch = str(args.base_branch);

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);
  if (!project.githubOwner || !project.githubRepo) {
    return fail("This project is not connected to a GitHub repository.");
  }

  const gh = await getUserGitHubOctokit(userId, project.githubInstallationId ?? undefined);
  if (!gh) {
    return fail("GitHub connection not found. Connect a GitHub App or PAT in Settings → Connections.");
  }

  const head = headBranch || project.githubBranch || project.githubDefaultBranch;
  const base = baseBranch || project.githubDefaultBranch || "main";
  if (!head) return fail("Could not determine the head branch. Specify branch_name.");

  try {
    const { data: pr } = await gh.octokit.rest.pulls.create({
      owner: project.githubOwner,
      repo: project.githubRepo,
      title,
      body,
      head,
      base,
    });

    return ok(projectId, `Created PR #${pr.number}: ${title}`, {
      prNumber: pr.number,
      prUrl: pr.html_url,
      head,
      base,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Failed to create PR: ${msg.slice(0, 300)}`);
  }
};

// ─── Code search + memory ───────────────────────────────────────

export const toolSearchCode: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("search_code requires a project_id.");
  const pattern = str(args.pattern);
  if (!pattern) return fail("search_code requires a pattern.");
  const fileGlob = str(args.file_glob);
  const maxResults = Math.min(Math.max(parseInt(String(args.max_results ?? "20"), 10) || 20, 1), 100);

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  const safePattern = pattern.replace(/'/g, "'\\''");
  let cmd = `rg --max-count ${maxResults} --line-number --no-heading --color never '${safePattern}'`;
  if (fileGlob) {
    const safeGlob = fileGlob.replace(/'/g, "'\\''");
    cmd += ` -g '${safeGlob}'`;
  }
  cmd += " .";

  try {
    const result = await runWorkspaceCommand(workspaceId, userId, cmd);
    const output = (result.stdout ?? "").trim();
    if (!output) {
      return ok(projectId, `No matches found for pattern '${pattern}'.`, { matches: [], count: 0 });
    }

    const lines = output.split("\n").slice(0, maxResults);
    const matches = lines.map((line) => {
      const colonIdx = line.indexOf(":");
      const secondColon = line.indexOf(":", colonIdx + 1);
      if (colonIdx === -1 || secondColon === -1) return { file: line, line: 0, content: "" };
      return {
        file: line.slice(0, colonIdx),
        line: parseInt(line.slice(colonIdx + 1, secondColon), 10) || 0,
        content: line.slice(secondColon + 1).slice(0, 200),
      };
    });

    return ok(projectId, `Found ${matches.length} match(es) for '${pattern}'.`, {
      matches,
      count: matches.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("exit code 1") || msg.includes("no matches")) {
      return ok(projectId, `No matches found for pattern '${pattern}'.`, { matches: [], count: 0 });
    }
    return fail(`search_code failed: ${msg.slice(0, 300)}`);
  }
};

export const toolRememberProjectContext: ToolHandler = async (userId, args) => {
  const projectId = str(args.project_id);
  if (!projectId) return fail("remember_project_context requires a project_id.");
  const content = str(args.content);
  if (!content) return fail("remember_project_context requires content.");
  if (content.length > 5000) return fail("Content too long (max 5000 characters).");

  const memoryType = str(args.memory_type) || "project_fact";
  const validTypes = ["project_fact", "project_decision", "architecture", "workflow", "constraint", "user_preference"];
  if (!validTypes.includes(memoryType)) {
    return fail(`Invalid memory_type. Valid: ${validTypes.join(", ")}.`);
  }

  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found.`);

  try {
    const result = await persistMemory(content, userId, projectId, {
      memoryType: memoryType as "project_fact" | "project_decision" | "architecture" | "workflow" | "constraint" | "user_preference",
      metadata: { source: "tool", toolName: "remember_project_context" },
    });

    if (result.blocked) {
      return fail("Content was blocked — it appears to contain secrets or credentials.");
    }
    if (result.error) {
      return fail(`Failed to save context: ${result.error}`);
    }

    return ok(projectId, "Context saved for future conversations.", {
      memoryId: result.id,
      memoryType,
    });
  } catch (err) {
    return fail(`remember_project_context failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ─── General approval gate ──────────────────────────────────────

export const toolRequestApproval: ToolHandler = async (userId, args) => {
  const action = str(args.action);
  const description = str(args.description);
  const riskLevel = str(args.risk_level);
  const projectId = str(args.project_id) || null;
  if (!action) return fail("request_approval requires an action.");
  if (!description) return fail("request_approval requires a description.");
  if (!["medium", "high", "critical"].includes(riskLevel)) {
    return fail("request_approval requires risk_level: medium, high, or critical.");
  }

  try {
    if (supabaseAdmin) {
      await supabaseAdmin.from("agent_logs").insert({
        user_id: userId,
        _type: "approval_request",
        project_id: projectId,
        payload: {
          action,
          description,
          risk_level: riskLevel,
          status: "pending_approval",
          requested_at: new Date().toISOString(),
        },
      });
    }

    return ok(projectId, `Approval request recorded for '${action}'. This is request-only — the operation will not proceed until explicit approval is confirmed.`, {
      action,
      riskLevel,
      status: "pending_approval",
    });
  } catch (err) {
    return fail(`Failed to record approval request: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ─── Synchronous browser test ───────────────────────────────────

export const toolBrowserTest: ToolHandler = async (_userId, args) => {
  const url = str(args.url);
  if (!url) return fail("browser_test requires a url.");

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return fail("URL must use http or https protocol.");
    }
  } catch {
    return fail("Invalid URL format.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local")
  ) {
    return fail("URLs pointing to internal/private addresses are blocked.");
  }

  const viewportWidth = Math.min(Math.max(parseInt(String(args.viewport_width ?? "1280"), 10) || 1280, 320), 1920);
  const viewportHeight = Math.min(Math.max(parseInt(String(args.viewport_height ?? "720"), 10) || 720, 240), 1080);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": `LiTT-BrowserTest/1.0 (${viewportWidth}x${viewportHeight})`,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    const contentType = resp.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text/html");

    let title: string | null = null;
    let bodySnippet = "";
    if (isHtml) {
      const html = await resp.text();
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      title = titleMatch ? titleMatch[1].trim().slice(0, 200) : null;
      bodySnippet = html.slice(0, 500);
    }

    const hasServerError = resp.status >= 500;
    const hasClientError = resp.status >= 400;

    const summary = hasServerError
      ? `Server error ${resp.status}`
      : hasClientError
        ? `Client error ${resp.status}`
        : `Page loaded successfully (${resp.status})`;

    return ok(null, `${summary}. Title: "${title ?? "unknown"}".`, {
      url,
      finalUrl: resp.url,
      statusCode: resp.status,
      contentType,
      title,
      hasServerError,
      hasClientError,
      viewport: { width: viewportWidth, height: viewportHeight },
      bodySnippet: bodySnippet.slice(0, 200),
      consoleErrors: [] as string[],
      screenshotUrl: null,
      note: "HTTP-level test. Full browser rendering requires terminal server browser service.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return fail(`Browser test timed out after 30 seconds loading ${url}.`);
    }
    return fail(`browser_test failed: ${msg.slice(0, 300)}`);
  }
};

// ─── Extended tool handlers (imported from separate file) ───────
import {
  toolGitDiff, toolGitLog, toolCreateCheckpoint, toolRestoreCheckpoint,
  toolDeleteFile, toolCreateDirectory, toolRenameFile, toolApplyPatch,
  toolStartPreviewServer, toolListProjects, toolCreateProject, toolSwitchProject,
  toolMemorySearch, toolRunCommand, toolWebSearch, toolWebFetch,
  toolGithubSearchCode, toolGithubListPullRequests, toolGithubReadFile,
} from "@/lib/project-tools/extended-handlers";

// ─── Growth Engine tool handlers (imported from separate file) ──
import {
  toolGrowthCreateCampaign,
  toolGrowthGenerateContent,
  toolGrowthListDrafts,
  toolGrowthRewritePost,
  toolGrowthApprovePost,
  toolGrowthMarkPublished,
} from "@/lib/project-tools/growth-handlers";

// ─── Registry ───────────────────────────────────────────────────

/**
 * The canonical registry of all project tool handlers.
 * Maps tool name → handler + metadata.
 *
 * Both /api/vapi/tools and the LiTT Voice Runtime dispatch through this
 * registry, ensuring one brain, one set of handlers, one audit trail.
 */
export const PROJECT_TOOLS: Record<string, {
  handler: ToolHandler;
  metadata: ToolMetadata;
}> = {
  get_active_project: { handler: toolGetActiveProject, metadata: { projectScoped: false, mutating: false, readOnly: true } },
  inspect_project_files: { handler: toolInspectProjectFiles, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  read_file: { handler: toolReadFile, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  edit_file: { handler: toolEditFile, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  run_project_checks: { handler: toolRunProjectChecks, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  create_preview: { handler: toolCreatePreview, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  get_deployment_status: { handler: toolGetDeploymentStatus, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  request_deployment_approval: { handler: toolRequestDeploymentApproval, metadata: { projectScoped: true, mutating: false, readOnly: false } },
  browser_start_job: { handler: toolBrowserStartJob, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  browser_job_status: { handler: toolBrowserJobStatus, metadata: { projectScoped: false, mutating: false, readOnly: true } },
  browser_cancel_job: { handler: toolBrowserCancelJob, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  browser_approve_job: { handler: toolBrowserApproveJob, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  send_sms: { handler: toolSendSms, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  send_email: { handler: toolSendEmail, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  git_status: { handler: toolGitStatus, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  create_branch: { handler: toolCreateBranch, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  commit_changes: { handler: toolCommitChanges, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  push_branch: { handler: toolPushBranch, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  create_pull_request: { handler: toolCreatePullRequest, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  search_code: { handler: toolSearchCode, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  remember_project_context: { handler: toolRememberProjectContext, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  request_approval: { handler: toolRequestApproval, metadata: { projectScoped: false, mutating: false, readOnly: false } },
  browser_test: { handler: toolBrowserTest, metadata: { projectScoped: false, mutating: false, readOnly: true } },
  // Extended tools
  git_diff: { handler: toolGitDiff, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  git_log: { handler: toolGitLog, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  create_checkpoint: { handler: toolCreateCheckpoint, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  restore_checkpoint: { handler: toolRestoreCheckpoint, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  delete_file: { handler: toolDeleteFile, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  create_directory: { handler: toolCreateDirectory, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  rename_file: { handler: toolRenameFile, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  apply_patch: { handler: toolApplyPatch, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  start_preview_server: { handler: toolStartPreviewServer, metadata: { projectScoped: true, mutating: true, readOnly: false } },
  list_projects: { handler: toolListProjects, metadata: { projectScoped: false, mutating: false, readOnly: true } },
  create_project: { handler: toolCreateProject, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  switch_project: { handler: toolSwitchProject, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  memory_search: { handler: toolMemorySearch, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  run_command: { handler: toolRunCommand, metadata: { projectScoped: true, mutating: false, readOnly: false } },
  web_search: { handler: toolWebSearch, metadata: { projectScoped: false, mutating: false, readOnly: true } },
  web_fetch: { handler: toolWebFetch, metadata: { projectScoped: false, mutating: false, readOnly: true } },
  github_search_code: { handler: toolGithubSearchCode, metadata: { projectScoped: false, mutating: false, readOnly: true } },
  github_list_pull_requests: { handler: toolGithubListPullRequests, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  github_read_file: { handler: toolGithubReadFile, metadata: { projectScoped: true, mutating: false, readOnly: true } },
  // Growth Engine — Phase 1a (manual mode, no paid API calls)
  growth_create_campaign: { handler: toolGrowthCreateCampaign, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  growth_generate_content: { handler: toolGrowthGenerateContent, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  growth_list_drafts: { handler: toolGrowthListDrafts, metadata: { projectScoped: false, mutating: false, readOnly: true } },
  growth_rewrite_post: { handler: toolGrowthRewritePost, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  growth_approve_post: { handler: toolGrowthApprovePost, metadata: { projectScoped: false, mutating: true, readOnly: false } },
  growth_mark_published: { handler: toolGrowthMarkPublished, metadata: { projectScoped: false, mutating: true, readOnly: false } },
};

/**
 * Execute a tool by name. Returns the ToolResult.
 * Throws if the tool name is unknown.
 */
export async function executeProjectTool(
  toolName: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const entry = PROJECT_TOOLS[toolName];
  if (!entry) {
    return fail(`Unknown tool "${toolName}". Valid: ${Object.keys(PROJECT_TOOLS).join(", ")}.`);
  }
  return entry.handler(userId, args);
}

/**
 * List all tool names in the registry.
 */
export function listProjectToolNames(): string[] {
  return Object.keys(PROJECT_TOOLS);
}

/**
 * Get tool definitions in the format expected by llm-tool-calling.ts.
 * Only includes tools that are safe to advertise to the LLM.
 */
export function getProjectToolDefinitions(): Array<{
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return Object.keys(PROJECT_TOOLS).map((name) => {
    const def = VAPI_TOOL_DEFINITIONS[name as keyof typeof VAPI_TOOL_DEFINITIONS];
    return {
      id: name,
      description: def?.description ?? name,
      inputSchema: (def?.parameters as unknown as Record<string, unknown>) ?? { type: "object", properties: {} },
    };
  });
}

/**
 * Build a concise, dynamically-generated summary of available tool
 * capabilities for inclusion in system prompts. Groups tools by
 * category (read-only, mutating, approval-only) using registry
 * metadata so the prompt stays in sync as tools are added.
 */
export function buildToolCapabilitySummary(): string {
  const entries = Object.entries(PROJECT_TOOLS);
  const readOnly = entries.filter(([, m]) => m.metadata.readOnly && !m.metadata.mutating).map(([name]) => name);
  const mutating = entries.filter(([, m]) => m.metadata.mutating).map(([name]) => name);
  const approvalOnly = entries.filter(([, m]) => !m.metadata.readOnly && !m.metadata.mutating).map(([name]) => name);

  const lines: string[] = ["AVAILABLE TOOLS (grouped by risk):"];
  if (readOnly.length > 0) {
    lines.push(`  Read-only (safe to call freely): ${readOnly.join(", ")}`);
  }
  if (mutating.length > 0) {
    lines.push(`  Mutating (call when user requests): ${mutating.join(", ")}`);
  }
  if (approvalOnly.length > 0) {
    lines.push(`  Approval-only (never execute directly): ${approvalOnly.join(", ")}`);
  }
  return lines.join("\n");
}
