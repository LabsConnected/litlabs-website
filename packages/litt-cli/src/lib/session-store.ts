/**
 * SessionStore — persisted LiTT shell sessions (/resume, /new).
 *
 * A session is a snapshot of the shell's conversational state:
 * transcript, workspace, branch, mode, model route. Persisted to
 * ~/.litt/sessions.json (last 12 sessions). Pure + testable — no
 * React, no Ink.
 *
 * Session identity: the most recent saved session for the SAME
 * project + summary (i.e. the same ongoing conversation) is updated
 * in place for 10 minutes; otherwise a new session is created. This
 * gives `/resume` "recent conversations" semantics instead of one
 * giant blob per project.
 */

import {
  closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync,
  renameSync, statSync, unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  status: string;
  ts: number;
  /** Submission correlation ID, when the message originated from a
   *  submit() call. Persisted so append-idempotency survives a reload —
   *  see mergeAppend(). Absent on restored/historical messages. */
  submissionId?: string;
}

export interface SessionSnapshot {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Project display name (repo dir name). */
  project: string;
  /** Workspace root. */
  cwd: string;
  branch: string;
  mode: "plan" | "act";
  routingMode: string;
  selectedModel: string | null;
  /** First user message — the resume list label. */
  summary: string;
  messages: SessionMessage[];
}

const MAX_SAVED_MESSAGES = 30;
const MAX_SAVED_CHARS = 6000;
const MAX_SESSIONS = 12;
/** Same conversation if resumed within this window. */
const SAME_CONVERSATION_MS = 10 * 60_000;

export function newSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sessionsFile(): string {
  // LITT_SESSIONS_FILE overrides the location (tests use a temp file).
  const override = process.env.LITT_SESSIONS_FILE;
  if (override) return override;
  // LITT_HOME overrides the LiTT home directory (see config.ts, desktop.ts,
  // provider-registry.ts — sessions must resolve the same way or session
  // storage silently splits from the rest of LiTT's state.
  const littHome = process.env.LITT_HOME ?? join(homedir(), ".litt");
  return join(littHome, "sessions.json");
}

export function readAllSessions(): SessionSnapshot[] {
  try {
    const raw = readFileSync(sessionsFile(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionSnapshot[]) : [];
  } catch {
    return [];
  }
}

// ─── Cross-process coordination ───────────────────────────────────
//
// saveSession()/deleteSession() are read-modify-write: read the whole
// file, compute a new array in memory, write it back. Two separate LiTT
// processes doing this against the SAME sessions.json at nearly the
// same moment can both read the same old state, then both write — the
// second write wins and silently discards whatever the first one added
// (a lost update, not a corruption: writeAllSessions()'s temp+rename
// still guarantees the file itself is never left truncated).
//
// Fixed with a plain exclusive-create lockfile (no new dependency,
// consistent with this file's existing style): acquire by creating
// `sessions.json.lock` with the "wx" flag, which fails with EEXIST if
// another process already holds it. A lock left behind by a process
// that crashed or was killed WHILE holding it (see acc703cc's SIGTERM/
// SIGHUP findings — Windows delivers no signal to clean it up) would
// otherwise block every future save forever, so a lock older than
// LOCK_STALE_MS is treated as abandoned and stolen.
const LOCK_STALE_MS = 5_000;
const LOCK_WAIT_TIMEOUT_MS = 2_000;
const LOCK_POLL_MS = 5;

/**
 * Thrown when the sessions lock can't be acquired within
 * LOCK_WAIT_TIMEOUT_MS. Fail-CLOSED by design: proceeding without the
 * lock would re-open the read-modify-write race this lock exists to
 * close — a silently lost update is worse than a loud failed save.
 * Callers that can't tolerate a throw (UI persist paths) must catch
 * this and surface the failure, not swallow it.
 */
export class SessionLockTimeoutError extends Error {
  constructor(lockPath: string) {
    super(`Timed out after ${LOCK_WAIT_TIMEOUT_MS}ms waiting for the sessions lock: ${lockPath}`);
    this.name = "SessionLockTimeoutError";
  }
}

function lockFilePath(): string {
  return `${sessionsFile()}.lock`;
}

/** Test-only: widen the critical section deterministically so a real
 *  concurrent-process test can reproduce the race without relying on
 *  natural timing. No-op unless LITT_SESSIONS_LOCK_HOLD_MS is set. */
function testHoldDelay(): void {
  const ms = Number(process.env.LITT_SESSIONS_LOCK_HOLD_MS ?? "");
  if (!ms) return;
  const until = Date.now() + ms;
  while (Date.now() < until) { /* deliberate synchronous hold */ }
}

/**
 * Acquire the cross-process sessions lock. Blocking and synchronous —
 * matches this module's existing synchronous API (saveSession() has
 * always been a plain function call, not a Promise, and changing that
 * would ripple into every caller). Lock hold times here are a JSON
 * read+write of a small file — microseconds in practice — so a bounded
 * busy-wait is an acceptable trade for not introducing async into a
 * synchronous API used from React effects and key handlers.
 *
 * Fails CLOSED after LOCK_WAIT_TIMEOUT_MS by throwing
 * SessionLockTimeoutError: an unprotected write is a silent lost-update
 * machine, which is worse than a bounded wait followed by a loud error.
 * By that point either the other process is almost certainly gone
 * (stale-lock theft already tried first) or something is seriously
 * wrong that proceeding unlocked would only make worse.
 */
function acquireSessionsLock(): () => void {
  const lockPath = lockFilePath();
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (true) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => { try { unlinkSync(lockPath); } catch { /* already released or stolen */ } };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          try { unlinkSync(lockPath); } catch { /* another process already stole it */ }
          continue;
        }
      } catch { continue; } // lock vanished between the EEXIST and the stat — retry now
      if (Date.now() > deadline) throw new SessionLockTimeoutError(lockPath);
      const until = Date.now() + LOCK_POLL_MS;
      while (Date.now() < until) { /* bounded poll wait */ }
    }
  }
}

function withSessionsLock<T>(fn: () => T): T {
  const release = acquireSessionsLock();
  try {
    return fn();
  } finally {
    release();
  }
}

let tmpSeq = 0;

function writeAllSessions(sessions: SessionSnapshot[]): void {
  const file = sessionsFile();
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Write to a per-process, per-call UNIQUE temp file and rename over
  // the live one — a crash or kill mid-write must never leave
  // sessions.json truncated. The unique name also means two writers that
  // somehow reach this point concurrently (the fail-closed lock should
  // prevent it, but defence-in-depth costs nothing here) can't share a
  // single tmp path and interleave each other's payloads before rename.
  const tmpFile = `${file}.tmp.${process.pid}.${tmpSeq++}`;
  try {
    writeFileSync(tmpFile, JSON.stringify(sessions, null, 2), "utf8");
    renameSync(tmpFile, file);
  } catch (err) {
    try { unlinkSync(tmpFile); } catch { /* tmp may not exist yet */ }
    throw err;
  }
  sweepStaleTmpFiles(file);
}

/**
 * Best-effort removal of `*.tmp.*` files left by writers that were
 * killed between writeFileSync and renameSync. Runs inside the sessions
 * lock — cheap and race-free. Only files older than TMP_ORPHAN_MS are
 * touched, so a genuinely in-flight write is never removed.
 */
const TMP_ORPHAN_MS = 60_000;
function sweepStaleTmpFiles(file: string): void {
  try {
    const prefix = `${basename(file)}.tmp.`;
    const dir = dirname(file);
    const cutoff = Date.now() - TMP_ORPHAN_MS;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      try {
        const p = join(dir, name);
        if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
      } catch { /* vanished or unreadable — fine */ }
    }
  } catch { /* housekeeping must never fail a save */ }
}

/**
 * Mark any message still `"streaming"` — never finalized before the
 * process ended (a crash, a forced kill, a closed terminal) — as
 * interrupted. Restoring it as a normal "complete" turn (the old
 * behavior) would silently claim the response finished when it never
 * did. Pure — used by the controller's restore path.
 */
export function markInterrupted(messages: SessionMessage[]): SessionMessage[] {
  return messages.map((m) => {
    if (m.status !== "streaming") return m;
    const note = "[Interrupted — LiTT exited before this response finished.]";
    return {
      ...m,
      status: "error",
      content: m.content.length > 0 ? `${m.content}\n\n${note}` : note,
    };
  });
}

/** Build a compact summary from the first user message. */
export function summarize(firstUserText: string): string {
  const single = firstUserText.replace(/\s+/g, " ").trim();
  if (!single) return "(untitled)";
  return single.length > 90 ? single.slice(0, 89) + "…" : single;
}

/** Bound a message body before persisting. */
export function boundMessage(msg: SessionMessage): SessionMessage {
  return {
    ...msg,
    content: msg.content.length > MAX_SAVED_CHARS
      ? msg.content.slice(0, MAX_SAVED_CHARS) + "\n…[truncated]"
      : msg.content,
  };
}

/**
 * Append-identity for a message. Two messages are the SAME message iff
 * they came from the same submission and play the same role.
 *
 * Content is deliberately not part of the key: an assistant message can
 * be persisted mid-stream and again at finalize with different content,
 * and both are the same message. Conversely, identical content from two
 * different turns ("yes" twice) has different submission IDs and must
 * stay two messages.
 *
 * Messages with no submissionId (restored from disk, or historical) are
 * unidentifiable and are therefore never treated as duplicates.
 */
function appendKey(msg: SessionMessage): string | null {
  return msg.submissionId ? `${msg.submissionId}::${msg.role}` : null;
}

/**
 * Append `appended` to `prior`, skipping any message `prior` already
 * contains. Idempotent: appending the same pair twice yields it once.
 *
 * This makes the caller's capture timing irrelevant — passing a live
 * transcript that ALREADY contains the new pair and passing a stale one
 * that does not both produce the same, correct result.
 */
export function mergeAppend(
  prior: SessionMessage[],
  appended: SessionMessage[],
): SessionMessage[] {
  const seen = new Set<string>();
  for (const msg of prior) {
    const key = appendKey(msg);
    if (key) seen.add(key);
  }

  const merged = [...prior];
  for (const msg of appended) {
    const key = appendKey(msg);
    if (key !== null && seen.has(key)) continue; // already present — never twice
    if (key !== null) seen.add(key);
    merged.push(msg);
  }
  return merged;
}

/** Workspace + routing context for a conversation. Same shape as
 *  SaveSessionInput minus the derived summary/messages — what the
 *  controller already has in hand when it needs to persist. */
export interface ConversationContext {
  project: string;
  cwd: string;
  branch: string;
  mode: "plan" | "act";
  routingMode: string;
  selectedModel: string | null;
}

export interface SaveSessionInput extends ConversationContext {
  summary: string;
  messages: SessionMessage[];
}

/**
 * Build a SaveSessionInput from the live transcript + an appended pair.
 *
 * - Merges the pair into the transcript via mergeAppend() (dedupes
 *   replayed pairs by submissionId+role), so the persist is idempotent
 *   regardless of when the transcript snapshot was captured.
 * - Derives the summary from the FIRST user message of the merged
 *   conversation — NOT the current input. This anchors the session
 *   label to the conversation's opening turn so a mid-conversation
 *   no-key/remote submit does not relabel (and thus fork) the session.
 *
 * The returned object is a complete SaveSessionInput; pass it straight
 * to saveSession().
 */
export function buildConversationSave(
  ctx: ConversationContext,
  transcript: SessionMessage[],
  appended: SessionMessage[],
): SaveSessionInput {
  const merged = mergeAppend(transcript, appended);
  const firstUser = merged.find((m) => m.role === "user");
  const summary = summarize(firstUser?.content ?? "untitled");
  return {
    project: ctx.project,
    cwd: ctx.cwd,
    branch: ctx.branch,
    mode: ctx.mode,
    routingMode: ctx.routingMode,
    selectedModel: ctx.selectedModel,
    summary,
    messages: merged,
  };
}

/**
 * Save (or update) a session. Returns the persisted snapshot.
 * The most recent session with the same project + summary is updated
 * in place within SAME_CONVERSATION_MS; otherwise a new one is added.
 */
export function saveSession(input: SaveSessionInput): SessionSnapshot {
  return withSessionsLock(() => {
    const all = readAllSessions();
    testHoldDelay(); // test-only — see acquireSessionsLock() doc comment
    const now = Date.now();
    const recent = all[0] ?? null;
    const sameConversation = Boolean(
      recent
      && recent.project === input.project
      && recent.summary === input.summary
      && now - recent.updatedAt < SAME_CONVERSATION_MS,
    );

    const snapshot: SessionSnapshot = {
      ...input,
      id: sameConversation && recent ? recent.id : newSessionId(),
      createdAt: sameConversation && recent ? recent.createdAt : now,
      updatedAt: now,
      messages: input.messages.slice(-MAX_SAVED_MESSAGES).map(boundMessage),
    };

    const rest = sameConversation ? all.slice(1) : all;
    writeAllSessions([snapshot, ...rest].slice(0, MAX_SESSIONS));
    return snapshot;
  });
}

/** All sessions, most recent first. */
export function listSessions(): SessionSnapshot[] {
  return readAllSessions().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(id: string): SessionSnapshot | null {
  return readAllSessions().find((s) => s.id === id) ?? null;
}

export function deleteSession(id: string): void {
  withSessionsLock(() => {
    writeAllSessions(readAllSessions().filter((s) => s.id !== id));
  });
}

/** Relative "time ago" label for the resume list. */
export function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}
