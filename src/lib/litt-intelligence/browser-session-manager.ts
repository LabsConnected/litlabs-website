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
// Phase 4 — BITS metering: gates consulted per action, settlement on
// close. Type-only in the other direction (browser-billing imports
// BrowserSession as a type), so there is no runtime import cycle.
import {
  checkActionGate,
  recordBrowserAction,
  billingMetadata,
  settleBrowserSession,
  settleBrowserSessionFromRow,
  seedAccumulatorFromRow,
} from "./browser-billing";

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
  /**
   * Phase 4: number of Stagehand MODEL calls (act()/extract()) this
   * action made. Only set by handlers that use the model-fallback path;
   * successful actions accrue BROWSER_MODEL_CALL_BITS each via the
   * billing accumulator. Failed actions accrue 0 (P1-3 precedent).
   */
  modelCalls?: number;
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

/**
 * Log a navigation that the URL policy blocked — before the browser ever
 * saw it. Kept in the same `browser_actions` audit table as executed
 * actions (success: false), so the audit trail records every navigation
 * host the agent attempted, not just the ones that ran.
 */
export async function logBlockedBrowserNavigation(
  sessionId: string,
  userId: string,
  url: string,
  reason: string,
): Promise<void> {
  await dbInsertAction({
    sessionId,
    userId,
    actor: "agent",
    action: "browser.navigate",
    inputs: { url, blockedByPolicy: true },
    success: false,
    result: null,
    error: `Navigation blocked by URL policy: ${reason}`,
    durationMs: 0,
  }).catch(() => {});
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
    model: options.model ?? "google/gemini-2.5-flash",
    browserbaseSessionCreateParams: {
      proxies: options.useProxies ?? false,
      browserSettings: {
        blockAds: true,
      },
    },
    // Disable pino-pretty transport — it uses worker threads that fail
    // in Vercel serverless environments. Use a no-op external logger instead.
    disablePino: true,
    logger: () => {},
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
      model: options.model ?? "google/gemini-2.5-flash",
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
 *
 * Phase 5: this is the FAST path only. Callers that can tolerate an
 * async hop should use getOrReattachStagehand() instead, which
 * transparently re-attaches to the provider session from THIS process
 * when the in-memory registry misses (multi-instance safety).
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

// ─── Phase 5 — Multi-instance-safe sessions (reconnect) ──────────
// The in-memory registry only knows sessions THIS process started.
// Railway runs multiple web-service instances and redeploys wipe the
// registry, so a session whose DB row is still active-like may have no
// live Stagehand here. getOrReattachStagehand() closes that gap: on a
// registry miss it re-attaches to the stored provider session
// (browserbaseSessionId) from the current instance via
// `new Stagehand({ env: "BROWSERBASE", browserbaseSessionID })` +
// init() — the documented @browserbasehq/stagehand@3.7.1 resume path
// (lib/v3/launch/browserbase.js: resumeSessionId → bb.sessions.retrieve
// → connectUrl → CDP; a missing/expired provider session rejects).
// The caller cannot tell a reconnect happened except via the
// `browser.reconnect` event in the browser_actions audit log.
//
// Concurrency (V1 choice, documented per the plan):
//  - In-process: an in-flight re-attach map dedupes concurrent callers
//    for the same session — one Stagehand.init(), single winner.
//  - Cross-instance: the DB row is the coordination point. Re-attach
//    only starts when the row is still active-like, and after init() a
//    second row read verifies the session wasn't closed mid-flight (a
//    lost race drops OUR connection and reports closed — never drives a
//    session the DB says is done). Two instances CAN end up with
//    separate CDP links to the same provider browser; the provider
//    tolerates that, and no DB state can corrupt because every write is
//    status-gated (dbCloseSessionIfActive) or idempotent (the
//    `browser:settle:<sessionId>` key). Full single-winner across
//    instances would need a DB claim column — deferred past V1.

/** Statuses under which a session may be re-attached (not terminal). */
const ACTIVE_LIKE_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "active",
  "paused",
  "human_control",
  "agent_control",
]);

/**
 * Plain-English outcome for a provider-side expiry. Shown to the agent
 * so it can start a fresh session — never a silent stall, never a
 * faked success.
 */
export const SESSION_EXPIRED_PLAIN_MESSAGE =
  "The browser session expired on the provider side, so it can't be resumed. " +
  "Start a new session to continue — the actions already taken are still in the audit log.";

export type ReattachOutcome = "attached" | "not_found" | "closed" | "expired";

export interface ReattachResult {
  stagehand: Stagehand | null;
  outcome: ReattachOutcome;
  /**
   * Set when outcome === "expired": the plain-English message for the
   * agent layer ("session expired on the provider — starting fresh").
   */
  message?: string;
}

/** Re-attach attempts currently in flight, keyed by session ID. */
const reattachInFlight = new Map<string, Promise<ReattachResult>>();

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const v = metadata?.[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/**
 * Build the Stagehand config for a re-attach. Mirrors startSession's
 * config (same logger/disablePino/browserSettings) but passes
 * browserbaseSessionID so Stagehand RESUMES the stored provider session
 * instead of creating a new one. Model/proxy preferences come from the
 * session's own metadata so the resumed browser behaves identically.
 */
function buildReattachConfig(session: BrowserSession): {
  env: "BROWSERBASE";
  browserbaseSessionID: string;
  model: string;
  browserbaseSessionCreateParams: {
    proxies: boolean;
    browserSettings: { blockAds: boolean };
  };
  disablePino: boolean;
  logger: () => void;
} {
  return {
    env: "BROWSERBASE",
    browserbaseSessionID: session.browserbaseSessionId as string,
    model: metadataString(session.metadata, "model", "google/gemini-2.5-flash"),
    browserbaseSessionCreateParams: {
      proxies: session.metadata?.useProxies === true,
      browserSettings: { blockAds: true },
    },
    // Disable pino-pretty transport — it uses worker threads that fail
    // in Vercel serverless environments. Use a no-op external logger instead.
    disablePino: true,
    logger: () => {},
  };
}

function isIdleExpiredMs(updatedAtIso: string): boolean {
  const t = new Date(updatedAtIso).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > SESSION_IDLE_TIMEOUT_MS;
}

/**
 * Get a drivable Stagehand for a session, re-attaching from this
 * process when the in-memory registry misses.
 *
 * Transparent on success (the only trace is the `browser.reconnect`
 * audit event). Honest on failure:
 *  - "not_found": no such session for this user (or no provider ID).
 *  - "closed": the DB row is in a terminal status.
 *  - "expired": the provider-side session is gone (or the row is past
 *    the idle TTL) — the row is marked closed and settled, and the
 *    agent gets the plain-English fresh-start message.
 */
export async function getOrReattachStagehand(
  sessionId: string,
  userId: string,
): Promise<ReattachResult> {
  // Fast path: live in this process.
  const active = activeSessions.get(sessionId);
  if (active) {
    active.lastActivity = Date.now();
    return { stagehand: active.stagehand, outcome: "attached" };
  }

  // Concurrency: share the in-flight attempt — one Stagehand.init(),
  // every concurrent caller gets the same result.
  const inFlight = reattachInFlight.get(sessionId);
  if (inFlight) return inFlight;

  const attempt = doReattachStagehand(sessionId, userId).finally(() => {
    reattachInFlight.delete(sessionId);
  });
  reattachInFlight.set(sessionId, attempt);
  return attempt;
}

async function doReattachStagehand(
  sessionId: string,
  userId: string,
): Promise<ReattachResult> {
  // The DB row is the coordination point: only re-attach while it is
  // still active-like, and only for the owning user (dbGetSession
  // scopes by user_id).
  const session = await dbGetSession(sessionId, userId).catch(() => null);
  if (!session) return { stagehand: null, outcome: "not_found" };
  if (!ACTIVE_LIKE_STATUSES.has(session.status)) {
    return { stagehand: null, outcome: "closed" };
  }
  if (!session.browserbaseSessionId) {
    return { stagehand: null, outcome: "not_found" };
  }

  // Past the idle TTL the session is honestly expired — the lifecycle
  // contract says TTL closes it. Close the row (compare-and-set, settle
  // from the persisted row) and hand the agent the fresh-start message
  // instead of resurrecting a dead browser.
  if (isIdleExpiredMs(session.updatedAt)) {
    await closeExpiredSessionRow(session).catch(() => {});
    return {
      stagehand: null,
      outcome: "expired",
      message: SESSION_EXPIRED_PLAIN_MESSAGE,
    };
  }

  let stagehand: Stagehand;
  try {
    // NOTE: construction is inside the try — any throw during
    // construction or init() lands on the honest expiry path below.
    stagehand = new Stagehand(buildReattachConfig(session));
    await stagehand.init();
  } catch {
    // Provider-side expiry (BrowserbaseSessionNotFoundError, a missing
    // connectUrl, or a network failure during resume). Do NOT fake it:
    // mark the row closed/error, settle from the persisted row, and
    // surface the clean fresh-start outcome.
    await closeExpiredSessionRow(session).catch(() => {});
    return {
      stagehand: null,
      outcome: "expired",
      message: SESSION_EXPIRED_PLAIN_MESSAGE,
    };
  }

  // Post-init race check: if another instance closed the row while we
  // were connecting, drop OUR connection and report closed — never
  // drive a session the DB says is done.
  const fresh = await dbGetSession(sessionId, userId).catch(() => null);
  if (!fresh || !ACTIVE_LIKE_STATUSES.has(fresh.status)) {
    await stagehand.close().catch(() => {});
    return { stagehand: null, outcome: "closed" };
  }

  // In-process re-check (defensive; the in-flight map normally makes
  // this unreachable): prefer the already-registered instance.
  const existing = activeSessions.get(sessionId);
  if (existing) {
    await stagehand.close().catch(() => {});
    existing.lastActivity = Date.now();
    return { stagehand: existing.stagehand, outcome: "attached" };
  }

  activeSessions.set(sessionId, {
    stagehand,
    session: fresh,
    lastActivity: Date.now(),
  });

  // Phase 5: seed this process's meter from the row's forensic billing
  // snapshot — without this the re-attach would reset the accumulator
  // to zero and the next action's metadata persist would overwrite the
  // dead owner's usage. The live burn chip and the final settle now
  // agree with what the sweeper would have settled.
  seedAccumulatorFromRow(
    sessionId,
    fresh.createdAt,
    (fresh.metadata?.billing ?? {}) as {
      actionCount?: number;
      modelCalls?: number;
    },
  );

  // Audit: the caller sees a working browser; the audit log sees the
  // truth — this action ran after a cross-process reconnect.
  await dbInsertAction({
    sessionId,
    userId,
    actor: "agent",
    action: "browser.reconnect",
    inputs: { browserbaseSessionId: session.browserbaseSessionId },
    success: true,
    result: "Re-attached to the provider browser session from a new process",
    durationMs: 0,
  }).catch(() => {});

  return { stagehand, outcome: "attached" };
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
 *
 * Phase 4: settling BITS is part of closing. The accrued burn is
 * debited ONCE (idempotency key browser:settle:<sessionId>) after the
 * provider session is torn down. Settle is best-effort and never blocks
 * the close — a settle failure is returned, never thrown.
 */
export async function closeSession(
  sessionId: string,
  userId: string,
): Promise<void> {
  const active = activeSessions.get(sessionId);
  const inMemorySession = active?.session ?? null;
  if (active) {
    await active.stagehand.close().catch(() => {});
    activeSessions.delete(sessionId);
  }

  await dbUpdateSession(sessionId, {
    status: "closed",
    closed_at: new Date().toISOString(),
  });

  const session = inMemorySession ?? (await dbGetSession(sessionId, userId));
  if (session) {
    // Phase 5: settle from the row when the live accumulator is gone
    // (this process never owned the session — the owning instance died
    // or is a different replica). The row carries the forensic billing
    // snapshot; the `browser:settle:<sessionId>` idempotency key makes a
    // double-settle a replay, never a double-charge.
    const row =
      (await dbGetSession(sessionId, userId).catch(() => null)) ?? session;
    await settleBrowserSessionFromRow(row).catch(() => {});
  }
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

  // Phase 4 — abuse gates, checked before every action:
  // per-session action cap (the 101st action is refused) and the daily
  // minute quota (quota exceeded → the session PAUSES with a
  // plain-English message, never a silent stall). Fail-open if the gate
  // itself errors: metering must never break the browser's ability to
  // run — the ledger is the billing backstop. (Fail-closed is only for
  // session START via preflightBrowserStart.)
  const gate = await checkActionGate(
    sessionId,
    userId,
    session.createdAt,
  ).catch((): { allowed: true } => ({ allowed: true }));
  if (!gate.allowed) {
    if (gate.pause) {
      await pauseSession(sessionId, userId).catch(() => {});
    }
    return {
      success: false,
      error: gate.message,
      durationMs: 0,
    };
  }

  // Phase 5 — multi-instance-safe sessions: on an in-memory miss,
  // transparently re-attach to the stored provider session from THIS
  // process. A reconnect is invisible to the caller except for the
  // `browser.reconnect` audit event; a provider-side expiry returns the
  // plain-English fresh-start message so the agent starts a new session
  // instead of stalling.
  const attach = await getOrReattachStagehand(sessionId, userId);
  if (!attach.stagehand) {
    if (attach.outcome === "expired") {
      return {
        success: false,
        error: attach.message ?? SESSION_EXPIRED_PLAIN_MESSAGE,
        durationMs: Date.now() - start,
      };
    }
    return {
      success: false,
      error: "Browser session is not active in this process. Start a new session.",
      durationMs: 0,
    };
  }
  const stagehand = attach.stagehand;

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

  // Phase 4 — accumulate burn for the session: attempts (success or
  // failure) count toward the per-session action cap; only successful
  // results accrue model-call surcharges (provider failure = 0 BITS for
  // that action — P1-3 precedent).
  recordBrowserAction(sessionId, {
    success: result.success,
    modelCalls: result.modelCalls ?? 0,
  });

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

  // Update session activity (+ persist the billing accumulator snapshot
  // into metadata in the same write — forensic backup for the meter).
  await dbUpdateSession(sessionId, {
    metadata: { ...(session.metadata ?? {}), billing: billingMetadata(sessionId) },
  });

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
// Phase 5: closeIdleSessions handles sessions live in THIS process.
// sweepIdleBrowserSessions() (below) additionally closes DB rows no
// local process owns — the multi-instance case — and is the body of the
// scheduled sweeper route (POST /api/litt/browser/sessions/sweep).

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
      // Phase 4: idle-TTL close settles BITS too (one ledger write,
      // idempotent — a later explicit close of the same session
      // settles 0 and replays nothing).
      await settleBrowserSession(active.session).catch(() => {});
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
      // Phase 4: settle BITS on close, same as closeSession.
      await settleBrowserSession(active.session).catch(() => {});
      closed++;
    }
  }

  return closed;
}

// ─── Phase 5 — scheduled sweeper (multi-instance) ─────────────────

/**
 * Compare-and-set close of a DB row: marks the session closed ONLY if
 * it is still in an active-like status. Returns true when THIS caller
 * won the race (exactly one closer wins); losers get false and must
 * not write further state for the session. The in-memory mirror is
 * untouched — callers of this helper own no live Stagehand (that's why
 * the row is being closed from the DB side).
 */
async function dbCloseSessionIfActive(sessionId: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("browser_sessions")
    .update({ status: "closed", closed_at: now, updated_at: now })
    .eq("id", sessionId)
    .in("status", ["active", "paused", "human_control", "agent_control"])
    .select("id");
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

/**
 * DB rows in an active-like status whose last activity is past the
 * idle TTL — sessions no local process will ever drive again (the
 * owning instance is gone or never heartbeats here). Bounded to 100
 * per sweep so a backlog can't wedge the job.
 */
async function dbGetIdleActiveSessions(): Promise<BrowserSession[]> {
  if (!supabaseAdmin) return [];
  const cutoff = new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("browser_sessions")
    .select("*")
    .in("status", ["active", "paused", "human_control", "agent_control"])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(100);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToSession);
}

/**
 * Close a session whose row is stale (idle TTL passed or the provider
 * session is gone) from a process that owns no live Stagehand for it.
 *
 * 1. Conditional DB close (compare-and-set — one winner).
 * 2. Best-effort provider cleanup: re-attach + close the Browserbase
 *    session so nothing leaks on the vendor side. If the provider
 *    session is already gone, that IS the goal — skip quietly.
 * 3. Settle BITS from the persisted row snapshot (the live accumulator
 *    died with the owning process); the `browser:settle:<sessionId>`
 *    idempotency key makes a double-settle a replay, never a
 *    double-charge.
 *
 * Returns true when this caller closed the row.
 */
async function closeExpiredSessionRow(
  session: BrowserSession,
): Promise<{ closed: boolean; bits: number }> {
  const won = await dbCloseSessionIfActive(session.id);
  if (!won) return { closed: false, bits: 0 };

  if (session.browserbaseSessionId && hasApiKey()) {
    try {
      const cleanup = new Stagehand({
        env: "BROWSERBASE",
        browserbaseSessionID: session.browserbaseSessionId,
        disablePino: true,
        logger: () => {},
      });
      await cleanup.init();
      await cleanup.close().catch(() => {});
    } catch {
      // Provider session already gone — nothing to clean up.
    }
  }

  const settled = await settleBrowserSessionFromRow(session).catch(() => null);
  return { closed: true, bits: settled && !settled.replayed ? settled.bits : 0 };
}

export interface SweepIdleResult {
  /** In-memory sessions closed on this instance (accumulator settle). */
  localClosed: number;
  /** DB-side rows closed (no local process owned them). */
  dbClosed: number;
  /** BITS newly settled by the DB-side closes (0 on idempotent replays). */
  settledBits: number;
}

/**
 * Phase 5 scheduled sweeper — the body of
 * POST /api/litt/browser/sessions/sweep (external scheduler +
 * CRON_SECRET; see that route). Closes every idle-expired session and
 * settles its BITS so nothing leaks:
 *
 *  - in-memory idle sessions on this instance (existing
 *    closeIdleSessions, accumulator-based settle);
 *  - DB rows in an active-like status past the idle TTL that NO local
 *    process owns (the owning instance died or is a different Railway
 *    replica): conditional close + best-effort provider cleanup +
 *    row-snapshot settle.
 *
 * Idempotent and safe to run often: conditional closes elect a single
 * winner and settle carries the session-scoped idempotency key.
 */
export async function sweepIdleBrowserSessions(): Promise<SweepIdleResult> {
  const localClosed = await closeIdleSessions().catch(() => 0);

  const rows = await dbGetIdleActiveSessions().catch(() => []);
  let dbClosed = 0;
  let settledBits = 0;
  for (const row of rows) {
    // A local Stagehand may have been registered since the query ran —
    // this instance's closeIdleSessions owns that case.
    if (activeSessions.has(row.id)) continue;
    const { closed, bits } = await closeExpiredSessionRow(row).catch(() => ({
      closed: false,
      bits: 0,
    }));
    if (closed) {
      dbClosed++;
      settledBits += bits;
    }
  }

  return { localClosed, dbClosed, settledBits };
}

// ─── Live status (Phase 2: backs the Studio status chip) ──────────

export type BrowserLiveState = "live" | "idle" | "disconnected";

export interface BrowserLiveStatus {
  /** "live": a Stagehand is driving in this process. "idle": a session
   *  exists but is not currently drivable (paused, human-controlled, or
   *  recorded active without a live Stagehand here). "disconnected": none. */
  state: BrowserLiveState;
  sessionId: string | null;
  controller: Controller | null;
  sessionStatus: SessionStatus | null;
  /** ISO timestamp of the last known activity, if any. */
  lastActivityAt: string | null;
}

/**
 * Honest liveness check for the Studio status chip.
 *
 * Never assumes: "live" requires a Stagehand instance present in THIS
 * process's registry with fresh activity inside the idle TTL. The check
 * reads the in-memory registry directly (without refreshing heartbeats —
 * a status poll must not resurrect an idle session) and falls back to
 * the DB row for "idle" (a session exists but isn't drivable here).
 * Sessions whose last activity is past the TTL are reported as
 * "disconnected", not "idle".
 */
export async function getLiveSessionStatus(
  userId: string,
  conversationId?: string,
): Promise<BrowserLiveStatus> {
  const now = Date.now();

  const inProcess = [...activeSessions.values()]
    .filter((a) => a.session.userId === userId)
    .filter((a) =>
      conversationId ? a.session.conversationId === conversationId : true,
    )
    .filter((a) => now - a.lastActivity <= SESSION_IDLE_TIMEOUT_MS)
    .sort((a, b) => b.lastActivity - a.lastActivity)[0];

  if (inProcess) {
    const { session } = inProcess;
    if (session.status === "active" || session.status === "agent_control") {
      return {
        state: "live",
        sessionId: session.id,
        controller: session.controller,
        sessionStatus: session.status,
        lastActivityAt: new Date(inProcess.lastActivity).toISOString(),
      };
    }
    // Paused or human-controlled: a session exists, but the agent is not
    // driving it right now.
    return {
      state: "idle",
      sessionId: session.id,
      controller: session.controller,
      sessionStatus: session.status,
      lastActivityAt: new Date(inProcess.lastActivity).toISOString(),
    };
  }

  // DB fallback: a recorded-active session with no live Stagehand in this
  // process. Report "idle" (it exists; the agent can re-acquire it) unless
  // it is past the idle TTL, in which case it is honestly "disconnected".
  const dbSessions = await dbGetActiveSessions(userId).catch(() => []);
  const dbCandidate = dbSessions
    .filter((s) =>
      conversationId ? s.conversationId === conversationId : true,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (dbCandidate) {
    const lastActivityMs = new Date(dbCandidate.updatedAt).getTime();
    const lastActivityAt = Number.isNaN(lastActivityMs)
      ? null
      : new Date(lastActivityMs).toISOString();
    if (!Number.isNaN(lastActivityMs) && now - lastActivityMs <= SESSION_IDLE_TIMEOUT_MS) {
      return {
        state: "idle",
        sessionId: dbCandidate.id,
        controller: dbCandidate.controller,
        sessionStatus: dbCandidate.status,
        lastActivityAt,
      };
    }
  }

  return {
    state: "disconnected",
    sessionId: null,
    controller: null,
    sessionStatus: null,
    lastActivityAt: null,
  };
}

// ─── Test seams ───────────────────────────────────────────────────
// The in-memory registry is module-private by design; these helpers exist
// so TTL-expiry and liveness behavior can be tested without a live
// Browserbase account. Never used in production code paths.

export interface TestActiveSessionEntry {
  stagehand: Stagehand;
  session: BrowserSession;
  lastActivity: number;
}

/** Register a session directly in the in-memory registry (tests only). */
export function __registerActiveSessionForTest(
  entry: TestActiveSessionEntry,
): void {
  activeSessions.set(entry.session.id, entry);
}

/** Number of sessions currently in the in-memory registry (tests only). */
export function __activeSessionCountForTest(): number {
  return activeSessions.size;
}

/** Clear the in-memory registry without touching the provider (tests only). */
export function __resetActiveSessionsForTest(): void {
  activeSessions.clear();
}
