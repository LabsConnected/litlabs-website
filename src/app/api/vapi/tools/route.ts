import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  getProject,
  verifyProjectWorkspace,
  updateProjectRuntime,
} from "@/lib/projects/project-repository";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";
import { createTerminalToken } from "@/lib/terminal-auth";
import { logFileOperation } from "@/lib/file-audit";
import { getDeployments } from "@/lib/deployments";
import { rateLimit } from "@/lib/rate-limiter";
import {
  TOOL_NAMES,
  CHECK_IDS,
  isSafeToolName,
  isSafeWorkspacePath,
  parseVapiPayload,
  argsOf,
  str,
  optStr,
  ok,
  fail,
  serializeToolResult,
  authorizeVapiRequest,
  ownerClerkId,
  auditToolCall,
  packageManagerCommand,
  labelFor,
  type ToolCall,
  type ToolResult,
  type CheckId,
} from "@/lib/vapi-tools";
import {
  createJob,
  getJob,
  cancelJob,
  approveJob,
  serializeJob,
  validateJobType,
  isSafeRiskLevel,
  isSafeRequestSource,
  type JobType,
  type RiskLevel,
  type RequestSource,
} from "@/lib/browser-jobs";
import { executeBrowserJob } from "@/lib/browser-job-executor";

/**
 * Vapi project-tools endpoint.
 *
 *   POST https://litlabs.net/api/vapi/tools
 *
 * A single server-to-server endpoint that dispatches by tool name for the
 * eight LiTT project tools. Call lifecycle events are intentionally NOT
 * handled here — those belong on /api/vapi/events.
 *
 * Authentication:
 *   Authorization: Bearer <LITTLABS_VAPI_TOOL_TOKEN>
 *
 * The token is a shared secret stored in Vapi's secure credential flow and
 * in the deployment environment as LITTLABS_VAPI_TOOL_TOKEN. It is never
 * read from prompts, frontend code, or client requests.
 *
 * Authorization:
 *   Vapi calls do not carry a Clerk user identity. All operations are scoped
 *   to the site owner configured via LITTLABS_VAPI_OWNER_CLERK_ID. Every
 *   project-scoped tool re-verifies ownership through getProject(projectId,
 *   ownerUserId), so the token alone cannot touch projects the owner does not
 *   own.
 *
 * Production safety:
 *   No tool performs a production deployment. request_deployment_approval is
 *   request-only — it records a pending approval request and returns. A
 *   separate backend deployment endpoint must reject production requests
 *   unless explicit human approval has been recorded out-of-band.
 *
 * Response (Vapi format):
 *   { "results": [{ "toolCallId": "<id>", "result": "<single-line JSON string>" }] }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ─── Helpers ────────────────────────────────────────────────────

const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
  "https://litlabs-terminal-server-production-0be1.up.railway.app";

async function runWorkspaceCommand(workspaceId: string, userId: string, command: string) {
  const response = await fetch(`${TERMINAL_BASE()}/internal/workspace/${workspaceId}/exec`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "",
    },
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

async function workspaceFileRequest(
  workspaceId: string,
  userId: string,
  projectId: string,
  action: "read" | "write",
  path: string,
  content?: string,
) {
  const { token } = createTerminalToken(userId, { workspaceId, projectId });
  const resp = await fetch(`${TERMINAL_BASE()}/ws-files/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    },
    body: JSON.stringify({ path, content }),
  });
  return resp;
}

// ─── Tool handlers ──────────────────────────────────────────────

/** get_active_project — resolve the owner's active project. */
async function toolGetActiveProject(userId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const explicitProjectId = optStr(args.project_id);

  // 1. Explicitly set active project (user_active_project table)
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

  // 2. Fallback: most recently updated project
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
}

/** inspect_project_files — list a directory in the project workspace. */
async function toolInspectProjectFiles(
  userId: string,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const project = await getProject(projectId, userId);
  if (!project) return fail(`Project ${projectId} not found or not owned by the configured owner.`);

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Project workspace is unavailable.");
  }

  const path = str(args.path, ".");
  // "." is allowed for listing the root; any other path must pass safety checks
  if (path !== "." && !isSafeWorkspacePath(path)) return fail("Invalid or blocked workspace path.");

  const { token } = createTerminalToken(userId, { workspaceId, projectId });
  const resp = await fetch(`${TERMINAL_BASE()}/ws-files?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Workspace-Id": workspaceId },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    return fail(`Failed to list files: ${text}`);
  }
  const entries = await resp.json();
  return ok(projectId, `Listed ${Array.isArray(entries) ? entries.length : 0} entries at "${path}".`, {
    path,
    entries,
  });
}

/** read_file — read a single file from the project workspace. */
async function toolReadFile(
  userId: string,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
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

  const resp = await workspaceFileRequest(workspaceId, userId, projectId, "read", path);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    return fail(`Failed to read file: ${text}`);
  }
  const payload = await resp.json();
  const content = typeof payload === "string" ? payload : str(payload?.content);
  return ok(projectId, `Read ${content.length} characters from "${path}".`, {
    path,
    content,
    size: content.length,
  });
}

/** edit_file — write file content in the project workspace (audited + git diff). */
async function toolEditFile(
  userId: string,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const path = str(args.path);
  const content = str(args.content);
  const changeSummary = str(args.change_summary, "Vapi edit_file call");

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

  const resp = await workspaceFileRequest(workspaceId, userId, projectId, "write", path, content);

  const wroteOk = resp.ok;
  await logFileOperation({
    userId,
    projectId,
    workspaceId,
    action: "write",
    path,
    contentLength: content.length,
    source: "system",
    ok: wroteOk,
    error: wroteOk ? undefined : `HTTP ${resp.status}`,
  }).catch(() => {});

  if (!wroteOk) {
    const text = await resp.text().catch(() => "Unknown error");
    return fail(`Failed to write file: ${text}`);
  }

  // Capture a git diff for the change record
  let gitDiff: string | null = null;
  try {
    const diffResult = await runWorkspaceCommand(workspaceId, userId, `git diff -- ${path}`);
    gitDiff = String(diffResult.stdout ?? "").trim() || null;
  } catch {
    // Diff is best-effort; the write still succeeded
  }

  // Record a structured change record (never logs file contents)
  const changeRecordId = `change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from("agent_logs").insert({
        agent_id: null,
        level: "info",
        message: `[vapi:file-change] ${path} (${content.length} chars)`,
        metadata: {
          _type: "vapi_file_change_record",
          changeRecordId,
          userId,
          projectId,
          path,
          changeSummary,
          contentLength: content.length,
          diffLines: gitDiff ? gitDiff.split("\n").length : 0,
          diffPreview: gitDiff ? gitDiff.slice(0, 500) : null,
          requestedBy: "vapi",
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
    diffLines: gitDiff ? gitDiff.split("\n").length : 0,
  });
}

/** run_project_checks — run predefined checks (typecheck, lint, test, build) only. */
async function toolRunProjectChecks(
  userId: string,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
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
}

/** create_preview — mark the project preview ready and return the proxy URL. */
async function toolCreatePreview(
  userId: string,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
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
}

/** get_deployment_status — read recent deployments, optionally by environment. */
async function toolGetDeploymentStatus(
  _userId: string,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
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
}

/** request_deployment_approval — request-only; never deploys. */
async function toolRequestDeploymentApproval(
  userId: string,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
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

  // Record a persistent, queryable approval request. This is request-only —
  // no deployment is triggered. A separate backend deployment endpoint must
  // verify explicit human approval before any production deploy proceeds.
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
          requestedBy: "vapi",
          status: "pending_approval",
          createdAt: new Date().toISOString(),
        },
      });
    } catch {
      // Logging is best-effort; the request is still reported to the caller.
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
}

// ─── Browser job tools (queue-control, no browser execution) ────

/** browser_start_job — enqueue a browser automation job. */
async function toolBrowserStartJob(userId: string, args: Record<string, unknown>): Promise<ToolResult> {
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

    // Trigger async execution only for newly created jobs
    if (created && job.status === "queued") {
      after(() => executeBrowserJob(job.id, userId).catch(() => {}));
    }

    const status = created ? "queued" : job.status;
    return ok(null, `Browser job ${created ? "started" : "already exists"} (status: ${status}).`, {
      jobId: job.id,
      jobType: job.jobType,
      status: job.status,
      created,
      liveViewUrl: job.liveViewUrl,
      message: created
        ? `I've started the browser job. It's now ${status}. I'll check on it in a moment.`
        : `This job was already queued (idempotency key matched). Current status: ${status}.`,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to create browser job.");
  }
}

/** browser_job_status — check the status of a browser job. */
async function toolBrowserJobStatus(userId: string, args: Record<string, unknown>): Promise<ToolResult> {
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
    awaiting_approval: `The job is waiting for your approval before proceeding with a high-risk action. ${job.error ?? ""}`,
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
}

/** browser_cancel_job — cancel a queued or awaiting_approval job. */
async function toolBrowserCancelJob(userId: string, args: Record<string, unknown>): Promise<ToolResult> {
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
}

/** browser_approve_job — approve an awaiting_approval job. */
async function toolBrowserApproveJob(userId: string, args: Record<string, unknown>): Promise<ToolResult> {
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
}

// ─── Owner notification tools ───────────────────────────────────

/**
 * send_sms — send an SMS to the site owner via Vapi's SMS API.
 *
 * Uses the Vapi phone number (+13239165462) as the from number.
 * The to number defaults to the owner's configured phone but can be
 * overridden by the caller (e.g. if a different user asks to be texted).
 */
async function toolSendSms(_userId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const message = str(args.message);
  if (!message) return fail("send_sms requires a message.");
  if (message.length > 1600) return fail("Message too long (1600 char max).");

  const toNumber = str(args.to_number) || process.env.LITTLABS_OWNER_PHONE || "";
  if (!toNumber) return fail("No destination phone number configured. Set LITTLABS_OWNER_PHONE or pass to_number.");

  const vapiKey = process.env.VAPI_API_KEY;
  if (!vapiKey) return fail("VAPI_API_KEY not configured — cannot send SMS.");

  const fromNumber = process.env.LITTLABS_VAPI_PHONE_NUMBER || "+13239165462";
  const phoneNumberId = process.env.LITTLABS_VAPI_PHONE_NUMBER_ID || "25d47ca0-40a9-40c8-b348-f6afc9c4f5ab";

  try {
    const resp = await fetch("https://api.vapi.ai/sms", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${vapiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          to: toNumber,
          from: fromNumber,
          content: message,
        },
        phoneNumberId,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error");
      return fail(`SMS send failed (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const data = await resp.json().catch(() => ({}));
    return ok(null, `SMS sent to ${toNumber}.`, { to: toNumber, from: fromNumber, messageId: data.id ?? null });
  } catch (err) {
    return fail(`SMS send error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * send_email — send an email to the site owner.
 *
 * Uses Resend if RESEND_API_KEY is configured, otherwise returns a
 * clear failure (never claims to have sent when it hasn't).
 */
async function toolSendEmail(_userId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const subject = str(args.subject) || "Message from LiTT";
  const body = str(args.body);
  if (!body) return fail("send_email requires a body.");

  const toEmail = str(args.to_email) || process.env.LITTLABS_OWNER_EMAIL || "";
  if (!toEmail) return fail("No destination email configured. Set LITTLABS_OWNER_EMAIL or pass to_email.");

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
        to: toEmail,
        subject,
        text: body,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error");
      return fail(`Email send failed (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const data = await resp.json().catch(() => ({}));
    return ok(null, `Email sent to ${toEmail}.`, { to: toEmail, subject, messageId: data.id ?? null });
  } catch (err) {
    return fail(`Email send error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Dispatch ───────────────────────────────────────────────────

async function dispatch(call: ToolCall, userId: string): Promise<ToolResult> {
  const args = argsOf(call);

  if (!isSafeToolName(call.name)) {
    return fail(`Unknown tool "${call.name}". Valid tools: ${TOOL_NAMES.join(", ")}.`);
  }

  switch (call.name) {
    case "get_active_project":
      return toolGetActiveProject(userId, args);

    case "inspect_project_files": {
      const projectId = str(args.project_id);
      if (!projectId) return fail("inspect_project_files requires a project_id.");
      return toolInspectProjectFiles(userId, projectId, args);
    }

    case "read_file": {
      const projectId = str(args.project_id);
      if (!projectId) return fail("read_file requires a project_id.");
      return toolReadFile(userId, projectId, args);
    }

    case "edit_file": {
      const projectId = str(args.project_id);
      if (!projectId) return fail("edit_file requires a project_id.");
      return toolEditFile(userId, projectId, args);
    }

    case "run_project_checks": {
      const projectId = str(args.project_id);
      if (!projectId) return fail("run_project_checks requires a project_id.");
      return toolRunProjectChecks(userId, projectId, args);
    }

    case "create_preview": {
      const projectId = str(args.project_id);
      if (!projectId) return fail("create_preview requires a project_id.");
      return toolCreatePreview(userId, projectId, args);
    }

    case "get_deployment_status": {
      const projectId = str(args.project_id);
      if (!projectId) return fail("get_deployment_status requires a project_id.");
      return toolGetDeploymentStatus(userId, projectId, args);
    }

    case "request_deployment_approval": {
      const projectId = str(args.project_id);
      if (!projectId) return fail("request_deployment_approval requires a project_id.");
      return toolRequestDeploymentApproval(userId, projectId, args);
    }

    // ── Browser Operator queue-control tools ───────────────────
    case "browser_start_job":
      return toolBrowserStartJob(userId, args);

    case "browser_job_status":
      return toolBrowserJobStatus(userId, args);

    case "browser_cancel_job":
      return toolBrowserCancelJob(userId, args);

    case "browser_approve_job":
      return toolBrowserApproveJob(userId, args);

    // ── Owner notification tools ───────────────────────────────
    case "send_sms":
      return toolSendSms(userId, args);

    case "send_email":
      return toolSendEmail(userId, args);

    default:
      return fail(`Unknown tool "${call.name}". Valid tools: ${TOOL_NAMES.join(", ")}.`);
  }
}

// ─── Route ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Auth ──
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authorizeVapiRequest(authHeader)) {
    // Auth diagnostic data is intentionally not logged here to avoid
    // leaking auth-attempt metadata into server output. The 401 response
    // is the observable signal; Vapi retries with the configured credential.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Owner identity ──
  const userId = ownerClerkId();
  if (!userId) {
    return NextResponse.json({ error: "Owner identity not configured" }, { status: 503 });
  }

  // ── Rate limiting (fail-open) ──
  const rateLimitResult = await rateLimit(req, 60, 60);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter: rateLimitResult.resetTime },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.resetTime),
          "X-RateLimit-Remaining": String(rateLimitResult.remaining),
        },
      },
    );
  }

  // ── Parse payload ──
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const calls = parseVapiPayload(body);
  if (!calls) {
    return NextResponse.json({ error: "Malformed payload: expected message.toolCallList[]" }, { status: 400 });
  }

  // ── Execute + audit each tool call ──
  const results = await Promise.all(
    calls.map(async (call) => {
      const start = Date.now();
      let result: ToolResult;
      try {
        result = await dispatch(call, userId);
      } catch (err) {
        result = fail(err instanceof Error ? err.message : "Tool execution failed");
      }
      const durationMs = Date.now() - start;

      // Audit log — never logs file contents or tokens
      await auditToolCall({
        callId: call.id,
        toolName: call.name,
        projectId: result.projectId,
        success: result.success,
        durationMs,
        error: result.success ? undefined : result.message,
      });

      // Vapi requires result as a single-line string
      return { toolCallId: call.id, result: serializeToolResult(result) };
    }),
  );

  // Always return 200 for handled tool failures (Vapi recommendation)
  return NextResponse.json({ results });
}
