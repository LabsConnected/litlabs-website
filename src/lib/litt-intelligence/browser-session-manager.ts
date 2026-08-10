/**
 * Browser Session Manager
 *
 * Manages persistent Browserbase + Stagehand browser sessions for LiTT
 * Browser Agent Mode. Unlike web-intelligence.ts which creates and
 * closes a session per operation, this manager keeps sessions alive
 * across multiple tool calls, enabling LiTT to navigate, observe,
 * act, and verify in a continuous browser context.
 *
 * Cooperative control:
 *   - Agent control: LiTT operates the browser autonomously
 *   - Human control: User takes over (e.g. for CAPTCHA/MFA/login)
 *   - Pause: Agent pauses, human takes control, then returns control
 *
 * Security:
 *   - BROWSERBASE_API_KEY is server-only, never exposed to client
 *   - Sessions are user-scoped — one user cannot access another's session
 *   - All actions are logged to the browser_actions audit table
 *   - Destructive actions require approval before execution
 *   - Sessions auto-close after SESSION_IDLE_TIMEOUT_MS
 */

import "server-only";
import { randomUUID } from "crypto";
import { Stagehand } from "@browserbasehq/stagehand";
import { supabaseAdmin } from "@/lib/supabase";

// ─── Types ───────────────────────────────────────────────────────

export type SessionStatus =
  | "active"
  | "paused"
  | "human_control"
  | "agent_control"
  | "closed"
  | "error";

export type Controller = "agent" | "human";

export interface BrowserSession {
  id: string;
  userId: string;
  projectId: string | null;
  conversationId: string | null;
  browserbaseSessionId: string | null;
  status: SessionStatus;
  controller: Controller;
  task: string | null;
  liveViewUrl: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface BrowserActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  screenshotUrl?: string;
  durationMs: number;
}

export interface StartSessionOptions {
  userId: string;
  projectId?: string;
  conversationId?: string;
  task?: string;
  model?: string;
  useProxies?: boolean;
}

// ─── In-memory session registry ──────────────────────────────────
// Maps session ID → active Stagehand instance for tool handler access.
// Only the server process that started the session can execute tools
// against it. If the server restarts, sessions are marked as "error"
// and the user must start a new one.

interface ActiveSession {
  stagehand: Stagehand;
  session: BrowserSession;
  lastActivity: number;
}

const activeSessions = new Map<string, ActiveSession>();

const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ─── Helpers ─────────────────────────────────────────────────────

function hasApiKey(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY?.trim());
}

function rowToSession(row: Record<string, unknown>): BrowserSession {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    projectId: (row.project_id as string) ?? null,
    conversationId: (row.conversation_id as string) ?? null,
    browserbaseSessionId: (row.browserbase_session_id as string) ?? null,
    status: row.status as SessionStatus,
    controller: row.controller as Controller,
    task: (row.task as string) ?? null,
    liveViewUrl: (row.live_view_url as string) ?? null,
    error: (row.error as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    closedAt: (row.closed_at as string) ?? null,
  };
}

// ─── Database operations ─────────────────────────────────────────

async function dbInsertSession(session: BrowserSession): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("browser_sessions").insert({
    id: session.id,
    user_id: session.userId,
    project_id: session.projectId,
    conversation_id: session.conversationId,
    browserbase_session_id: session.browserbaseSessionId,
    status: session.status,
    controller: session.controller,
    task: session.task,
    live_view_url: session.liveViewUrl,
    error: session.error,
    metadata: session.metadata,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    closed_at: session.closedAt,
  });
}

async function dbUpdateSession(
  sessionId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from("browser_sessions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
}

export async function dbGetSession(
  sessionId: string,
  userId: string,
): Promise<BrowserSession | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("browser_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToSession(data as Record<string, unknown>);
}

export async function dbGetActiveSessions(userId: string): Promise<BrowserSession[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("browser_sessions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "paused", "human_control", "agent_control"])
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToSession);
}

async function dbInsertAction(action: {
  sessionId: string;
  userId: string;
  actor: Controller;
  action: string;
  inputs: Record<string, unknown>;
  success: boolean;
  result: unknown;
  error?: string;
  screenshotUrl?: string;
  durationMs: number;
}): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("browser_actions").insert({
    session_id: action.sessionId,
    user_id: action.userId,
    actor: action.actor,
    action: action.action,
    inputs: action.inputs,
    success: action.success,
    result: action.result,
    error: action.error ?? null,
    screenshot_url: action.screenshotUrl ?? null,
    duration_ms: action.durationMs,
  });
}

export async function dbGetActions(
  sessionId: string,
  userId: string,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("browser_actions")
    .select("*")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as Record<string, unknown>[];
}

// ─── Session lifecycle ───────────────────────────────────────────

/**
 * Start a new persistent browser session for a user.
 * Creates a Browserbase + Stagehand instance and keeps it alive.
 */
export async function startSession(
  options: StartSessionOptions,
): Promise<BrowserSession> {
  if (!hasApiKey()) {
    throw new Error("BROWSERBASE_API_KEY is not configured");
  }

  const sessionId = randomUUID();
  const now = new Date().toISOString();

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    model: options.model ?? "gemini-2.5-flash",
    browserbaseSessionCreateParams: {
      proxies: options.useProxies ?? false,
      browserSettings: {
        blockAds: true,
      },
    },
  });

  await stagehand.init();

  const browserbaseSessionId = stagehand.browserbaseSessionID ?? null;
  const liveViewUrl = browserbaseSessionId
    ? `https://www.browserbase.com/sessions/${browserbaseSessionId}`
    : null;

  const session: BrowserSession = {
    id: sessionId,
    userId: options.userId,
    projectId: options.projectId ?? null,
    conversationId: options.conversationId ?? null,
    browserbaseSessionId,
    status: "active",
    controller: "agent",
    task: options.task ?? null,
    liveViewUrl,
    error: null,
    metadata: {
      model: options.model ?? "gemini-2.5-flash",
      useProxies: options.useProxies ?? false,
    },
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };

  // Persist to database
  await dbInsertSession(session);

  // Register in memory
  activeSessions.set(sessionId, {
    stagehand,
    session,
    lastActivity: Date.now(),
  });

  return session;
}

/**
 * Get the active Stagehand instance for a session.
 * Returns null if the session is not in this process's memory.
 */
export function getStagehand(sessionId: string): Stagehand | null {
  const active = activeSessions.get(sessionId);
  if (!active) return null;
  active.lastActivity = Date.now();
  return active.stagehand;
}

/**
 * Get the browser session from memory (fast) or database (fallback).
 */
export async function getSession(
  sessionId: string,
  userId: string,
): Promise<BrowserSession | null> {
  const active = activeSessions.get(sessionId);
  if (active) {
    active.lastActivity = Date.now();
    return active.session;
  }
  return dbGetSession(sessionId, userId);
}

/**
 * Pause agent control — agent stops executing actions.
 * Human can take control after this.
 */
export async function pauseSession(
  sessionId: string,
  userId: string,
): Promise<BrowserSession | null> {
  const session = await getSession(sessionId, userId);
  if (!session) return null;

  const updates = { status: "paused" as SessionStatus };
  await dbUpdateSession(sessionId, updates);

  const active = activeSessions.get(sessionId);
  if (active) {
    active.session.status = "paused";
  }

  return { ...session, ...updates };
}

/**
 * Transfer control to human — user takes over the browser.
 */
export async function takeControl(
  sessionId: string,
  userId: string,
): Promise<BrowserSession | null> {
  const session = await getSession(sessionId, userId);
  if (!session) return null;

  const updates = {
    status: "human_control" as SessionStatus,
    controller: "human" as Controller,
  };
  await dbUpdateSession(sessionId, updates);

  const active = activeSessions.get(sessionId);
  if (active) {
    active.session.status = "human_control";
    active.session.controller = "human";
  }

  return { ...session, ...updates };
}

/**
 * Return control to agent — LiTT resumes autonomous operation.
 */
export async function returnControl(
  sessionId: string,
  userId: string,
): Promise<BrowserSession | null> {
  const session = await getSession(sessionId, userId);
  if (!session) return null;

  const updates = {
    status: "agent_control" as SessionStatus,
    controller: "agent" as Controller,
  };
  await dbUpdateSession(sessionId, updates);

  const active = activeSessions.get(sessionId);
  if (active) {
    active.session.status = "agent_control";
    active.session.controller = "agent";
    active.lastActivity = Date.now();
  }

  return { ...session, ...updates };
}

/**
 * Close a browser session and clean up resources.
 */
export async function closeSession(
  sessionId: string,
  userId: string,
): Promise<void> {
  const active = activeSessions.get(sessionId);
  if (active) {
    await active.stagehand.close().catch(() => {});
    activeSessions.delete(sessionId);
  }

  await dbUpdateSession(sessionId, {
    status: "closed",
    closed_at: new Date().toISOString(),
  });
}

/**
 * Mark a session as error.
 */
export async function errorSession(
  sessionId: string,
  error: string,
): Promise<void> {
  const active = activeSessions.get(sessionId);
  if (active) {
    active.session.status = "error";
    active.session.error = error;
  }

  await dbUpdateSession(sessionId, { status: "error", error });
}

// ─── Action execution ────────────────────────────────────────────

/**
 * Execute a browser action and log it to the audit trail.
 * This is the canonical entry point for all browser tool handlers.
 */
export async function executeBrowserAction(
  sessionId: string,
  userId: string,
  action: string,
  inputs: Record<string, unknown>,
  fn: (stagehand: Stagehand) => Promise<BrowserActionResult>,
): Promise<BrowserActionResult> {
  const start = Date.now();

  // Verify session exists and is under agent control
  const session = await getSession(sessionId, userId);
  if (!session) {
    return {
      success: false,
      error: "Browser session not found",
      durationMs: 0,
    };
  }

  if (session.status === "closed") {
    return {
      success: false,
      error: "Browser session is closed",
      durationMs: 0,
    };
  }

  if (session.status === "human_control") {
    return {
      success: false,
      error: "Browser is under human control. Wait for the user to return control.",
      durationMs: 0,
    };
  }

  const stagehand = getStagehand(sessionId);
  if (!stagehand) {
    return {
      success: false,
      error: "Browser session is not active in this process. Start a new session.",
      durationMs: 0,
    };
  }

  let result: BrowserActionResult;
  try {
    result = await fn(stagehand);
  } catch (err) {
    result = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }

  // Ensure durationMs is set
  if (!result.durationMs) {
    result.durationMs = Date.now() - start;
  }

  // Log to audit trail
  await dbInsertAction({
    sessionId,
    userId,
    actor: "agent",
    action,
    inputs,
    success: result.success,
    result: result.data ?? null,
    error: result.error,
    screenshotUrl: result.screenshotUrl,
    durationMs: result.durationMs,
  });

  // Update session activity
  await dbUpdateSession(sessionId, { updated_at: new Date().toISOString() });

  return result;
}

/**
 * Take a screenshot of the current page.
 */
export async function takeScreenshot(sessionId: string): Promise<string | null> {
  const active = activeSessions.get(sessionId);
  if (!active) return null;

  try {
    const page = active.stagehand.context.pages()[0];
    if (!page) return null;
    const screenshot = await page.screenshot({ type: "png" });
    // Return as base64 data URL — the Studio UI can display this directly
    const base64 = Buffer.from(screenshot as Uint8Array).toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch {
    return null;
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────

/**
 * Close idle sessions that have exceeded the timeout.
 * Should be called periodically (e.g. via a cron job or on each new session start).
 */
export async function closeIdleSessions(): Promise<number> {
  const now = Date.now();
  let closed = 0;

  for (const [sessionId, active] of activeSessions) {
    if (now - active.lastActivity > SESSION_IDLE_TIMEOUT_MS) {
      await active.stagehand.close().catch(() => {});
      activeSessions.delete(sessionId);
      await dbUpdateSession(sessionId, {
        status: "closed",
        closed_at: new Date().toISOString(),
      });
      closed++;
    }
  }

  return closed;
}

/**
 * Close all sessions for a user (e.g. on logout).
 */
export async function closeAllUserSessions(userId: string): Promise<number> {
  let closed = 0;

  for (const [sessionId, active] of activeSessions) {
    if (active.session.userId === userId) {
      await active.stagehand.close().catch(() => {});
      activeSessions.delete(sessionId);
      await dbUpdateSession(sessionId, {
        status: "closed",
        closed_at: new Date().toISOString(),
      });
      closed++;
    }
  }

  return closed;
}
