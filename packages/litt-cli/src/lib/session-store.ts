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
  /** Submission correlation ID — stamps both the user message and the
   *  assistant response so a single submission can be traced end-to-end.
   *  Optional: older persisted records and non-submit messages lack it.
   *  Used by mergeAppend() to dedupe replayed/reconnected pairs. */
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
 * Merge an appended pair into the prior transcript, deduping by
 * (submissionId, role). A message in `appended` is dropped when a
 * message with the same submissionId AND role already exists in
 * `prior` — this is what makes the persist idempotent whether the
 * transcript snapshot was taken before or after the pair was added
 * (the "stale" vs "fresh" capture timings in the controller).
 *
 * Messages without a submissionId are always kept (no dedup key).
 * Order is preserved: prior first, then any appended messages that
 * survived dedup.
 */
export function mergeAppend(
  prior: SessionMessage[],
  appended: SessionMessage[],
): SessionMessage[] {
  const result: SessionMessage[] = [...prior];
  for (const msg of appended) {
    if (msg.submissionId !== undefined) {
      const dup = result.some(
        (m) => m.submissionId === msg.submissionId && m.role === msg.role,
      );
      if (dup) continue;
    }
    result.push(msg);
  }
  return result;
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
