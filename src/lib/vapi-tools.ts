/**
 * Vapi project-tools — pure logic and helpers.
 *
 * Extracted from the route so it is unit-testable without spinning up
 * Next.js or external services. The route handler in
 * src/app/api/vapi/tools/route.ts wires auth, rate limiting, and I/O
 * around these functions.
 */

import { timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

// ─── Constants ──────────────────────────────────────────────────

export const TOOL_NAMES = [
  "get_active_project",
  "inspect_project_files",
  "read_file",
  "edit_file",
  "run_project_checks",
  "create_preview",
  "get_deployment_status",
  "request_deployment_approval",
  // Browser Operator queue-control tools (lightweight — no browser execution
  // in the Vapi request lifecycle; they enqueue/status/cancel/approve jobs
  // that execute asynchronously via the browser job executor).
  "browser_start_job",
  "browser_job_status",
  "browser_cancel_job",
  "browser_approve_job",
  // Owner notification tools — send SMS or email to the site owner.
  // These use the owner's contact info configured in the environment.
  "send_sms",
  "send_email",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Only these checks may be run via run_project_checks. */
export const CHECK_IDS = ["typecheck", "lint", "test", "build"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

// ─── Types ──────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  message: string;
  projectId: string | null;
  data: Record<string, unknown>;
}

// ─── Path safety ────────────────────────────────────────────────

/**
 * File/directory names that must never be read or written through
 * the Vapi tools. Blocks access to secrets, credentials, build
 * artifacts, and VCS internals.
 */
const BLOCKED_PATH_PATTERNS: readonly RegExp[] = [
  /^\.env(\.|$)/i, // .env, .env.local, .env.production, ...
  /(^|\/)\.env(\.|$)/i, // nested .env files
  /(^|\/)node_modules(\/|$)/i, // dependencies
  /(^|\/)\.git(\/|$)/i, // git internals
  /(^|\/)\.ssh(\/|$)/i, // SSH keys
  /(^|\/)\.aws(\/|$)/i, // AWS credentials
  /(^|\/)\.npmrc$/i, // npm tokens
  /(^|\/)\.pypirc$/i, // PyPI credentials
  /(^|\/)credentials(\.json)?$/i, // credential files
  /(^|\/)id_rsa($|\.)/i, // private keys
  /(^|\/)\.htpasswd$/i, // HTTP auth
  /(^|\/)secrets?(\.json|\.yaml|\.yml|\.toml)?$/i, // secret stores
];

/**
 * Validate that a relative path is safe for workspace file operations.
 *
 * Blocks:
 * - Absolute paths (leading /)
 * - Path traversal (.. segments)
 * - Null bytes
 * - .env files, credentials, node_modules, .git internals, SSH keys, etc.
 */
export function isSafeWorkspacePath(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const normalized = value.replace(/\\/g, "/");

  // Reject "." and empty
  if (normalized === "." || normalized === "") return false;

  // Reject absolute paths
  if (normalized.startsWith("/")) return false;

  // Reject path traversal and null bytes
  if (normalized.split("/").some((segment) => segment === ".." || segment.includes("\u0000"))) {
    return false;
  }

  // Reject blocked patterns
  if (BLOCKED_PATH_PATTERNS.some((re) => re.test(normalized))) return false;

  return true;
}

// ─── Tool allowlisting ──────────────────────────────────────────

export function isSafeToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

// ─── Payload parsing ────────────────────────────────────────────

/**
 * Parse the Vapi tool-call payload and extract the tool call list.
 * Returns null if the payload is malformed.
 */
export function parseVapiPayload(body: unknown): ToolCall[] | null {
  if (!body || typeof body !== "object") return null;
  const message = (body as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const toolCallList = (message as { toolCallList?: unknown }).toolCallList;
  if (!Array.isArray(toolCallList) || toolCallList.length === 0) return null;

  const calls: ToolCall[] = [];
  for (const raw of toolCallList) {
    if (!raw || typeof raw !== "object") continue;
    const id = (raw as { id?: unknown }).id;
    const name = (raw as { name?: unknown }).name;
    if (typeof id !== "string" || typeof name !== "string") continue;
    const arguments_ = (raw as { arguments?: unknown }).arguments;
    const parameters = (raw as { parameters?: unknown }).parameters;
    calls.push({
      id,
      name,
      arguments: arguments_ && typeof arguments_ === "object" ? (arguments_ as Record<string, unknown>) : undefined,
      parameters: parameters && typeof parameters === "object" ? (parameters as Record<string, unknown>) : undefined,
    });
  }

  return calls.length > 0 ? calls : null;
}

// ─── Result helpers ─────────────────────────────────────────────

export function argsOf(call: ToolCall): Record<string, unknown> {
  return call.arguments ?? call.parameters ?? {};
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function optStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function ok(projectId: string | null, message: string, data: Record<string, unknown> = {}): ToolResult {
  return { success: true, message, projectId, data };
}

export function fail(message: string, data: Record<string, unknown> = {}): ToolResult {
  return { success: false, message, projectId: null, data };
}

/**
 * Serialize a ToolResult into a single-line JSON string for Vapi.
 * Vapi requires `result` to be a string; the assistant reads it as text.
 */
export function serializeToolResult(result: ToolResult): string {
  return JSON.stringify(result);
}

// ─── Auth ───────────────────────────────────────────────────────

/**
 * Verify the Authorization header against LITTLABS_VAPI_TOOL_TOKEN using a
 * timing-safe comparison. Accepts both `Bearer <token>` and raw `<token>`
 * formats so Vapi's credential system works regardless of whether it
 * prepends the Bearer prefix.
 *
 * Returns false if the token is missing, too short, or does not match.
 */
export function authorizeVapiRequest(authHeader: string): boolean {
  const expected = process.env.LITTLABS_VAPI_TOOL_TOKEN;
  if (!expected || expected.length < 16) return false;
  if (!authHeader) return false;

  let presented: string;
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    presented = authHeader.slice(7).trim();
  } else {
    presented = authHeader.trim();
  }

  if (!presented || presented.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Diagnostic info for auth failures — never includes the secret itself.
 * Used for safe logging in the route handler when authorization fails.
 */
export interface AuthDiagnostic {
  authHeaderPresent: boolean;
  bearerPrefixPresent: boolean;
  credentialMatched: boolean;
  expectedTokenConfigured: boolean;
}

/**
 * Produce safe diagnostic info about an auth attempt without exposing the
 * secret. The route handler logs this on 401 responses.
 */
export function authDiagnostic(authHeader: string): AuthDiagnostic {
  const expected = process.env.LITTLABS_VAPI_TOOL_TOKEN;
  const headerPresent = !!authHeader;
  const bearerPrefix = headerPresent && authHeader.toLowerCase().startsWith("bearer ");
  return {
    authHeaderPresent: headerPresent,
    bearerPrefixPresent: bearerPrefix,
    credentialMatched: authorizeVapiRequest(authHeader),
    expectedTokenConfigured: !!expected && expected.length >= 16,
  };
}

export function ownerClerkId(): string | null {
  const id = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
  return id && id.length > 0 ? id : null;
}

// ─── Audit logging ──────────────────────────────────────────────

export interface ToolCallAuditEntry {
  callId: string;
  toolName: string;
  projectId: string | null;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Write an audit entry for a Vapi tool call to agent_logs.
 *
 * Records: call ID, tool name, project ID, success state, duration.
 * NEVER logs file contents, tokens, or argument values.
 * Silent fail — logging never blocks the operation.
 */
export async function auditToolCall(entry: ToolCallAuditEntry): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;

    await admin.from("agent_logs").insert({
      agent_id: null,
      level: entry.success ? "info" : "error",
      message: `[vapi:tool] ${entry.toolName} (${entry.success ? "ok" : "failed"})`,
      metadata: {
        _type: "vapi_tool_call",
        callId: entry.callId,
        toolName: entry.toolName,
        projectId: entry.projectId,
        success: entry.success,
        durationMs: entry.durationMs,
        error: entry.error ?? null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Silent fail — audit logging must never break the request
  }
}

// ─── Check command builder ──────────────────────────────────────

/**
 * Build the shell command for a predefined check. Returns null if the
 * package manager is unsupported or the check has no command mapping.
 * Only typecheck, lint, test, build are allowed.
 */
export function packageManagerCommand(packageManager: string | null, action: CheckId): string | null {
  const manager = packageManager === "pnpm" || packageManager === "npm" || packageManager === "yarn" ? packageManager : null;
  if (!manager) return null;
  if (action === "typecheck") return manager === "pnpm" ? "pnpm exec tsc --noEmit" : `${manager} exec tsc --noEmit`;
  if (action === "test") return `${manager} test -- --run`;
  if (action === "lint") return `${manager} run lint`;
  if (action === "build") return `${manager} run build`;
  return null;
}

export function labelFor(id: CheckId): string {
  return id === "typecheck" ? "TypeScript" : id[0].toUpperCase() + id.slice(1);
}
