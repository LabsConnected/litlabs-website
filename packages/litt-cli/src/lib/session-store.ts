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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  return join(homedir(), ".litt", "sessions.json");
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

function writeAllSessions(sessions: SessionSnapshot[]): void {
  const dir = join(homedir(), ".litt");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(sessionsFile(), JSON.stringify(sessions, null, 2), "utf8");
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

export interface SaveSessionInput {
  project: string;
  cwd: string;
  branch: string;
  mode: "plan" | "act";
  routingMode: string;
  selectedModel: string | null;
  summary: string;
  messages: SessionMessage[];
}

/**
 * Save (or update) a session. Returns the persisted snapshot.
 * The most recent session with the same project + summary is updated
 * in place within SAME_CONVERSATION_MS; otherwise a new one is added.
 */
export function saveSession(input: SaveSessionInput): SessionSnapshot {
  const all = readAllSessions();
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
}

/**
 * Build a SaveSessionInput for an ongoing conversation.
 *
 * The summary is always derived from the first user message of the
 * COMPLETE resulting conversation, so a mid-conversation turn never
 * relabels the session — which would otherwise defeat saveSession's
 * sameConversation check and fork a duplicate row.
 */
export function buildConversationSave(
  ctx: Omit<SaveSessionInput, "summary" | "messages">,
  prior: SessionMessage[],
  appended: SessionMessage[],
): SaveSessionInput {
  const messages = mergeAppend(prior, appended);
  const firstUser = messages.find((m) => m.role === "user");
  return {
    ...ctx,
    summary: summarize(firstUser?.content ?? "untitled"),
    messages,
  };
}

/** All sessions, most recent first. */
export function listSessions(): SessionSnapshot[] {
  return readAllSessions().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(id: string): SessionSnapshot | null {
  return readAllSessions().find((s) => s.id === id) ?? null;
}

export function deleteSession(id: string): void {
  writeAllSessions(readAllSessions().filter((s) => s.id !== id));
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
