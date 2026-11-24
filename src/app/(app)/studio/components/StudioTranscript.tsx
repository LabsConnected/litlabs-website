"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { UserMessageAvatar } from "@/components/chat/MessageAvatar";
import { parseJarvisActions } from "@/lib/litt-context";
import { ActionChips } from "./canvas/ActionChips";
import {
  ExecutionBlock,
  ExecutionDetailsExpander,
  toolActivityDotColor,
  type ExecutionDetailRecord,
} from "./ExecutionBlock";
import { useVoiceSession } from "@/app/(app)/studio/context/VoiceSessionContext";
import {
  AGENT_META,
  type ChatMessage,
  type AgentId,
} from "../stores/useStudioAgentStore";
import type { StudioTool } from "../lib/studio-destinations";
import type { MutationSummary, ExecutionEvent, ExecutionPhase } from "../stores/useExecutionStore";
import { useExecutionStore } from "../stores/useExecutionStore";
import {
  requirementForMode,
  evaluateCompletion,
  workLogLabel,
} from "@/lib/studio/completion-evidence";
import {
  copyToClipboard,
  markdownToPlainText,
} from "@/lib/studio/message-copy";

/**
 * Kimi wiring item 3 — typewriter bookkeeping, module-level on purpose
 * (the pattern from Kimmy's AssistantPanel): a message that finished
 * typing once NEVER re-types, even when the transcript unmounts and
 * remounts (panel close/reopen, layout switch). Progress is kept per
 * message id so a mid-stream remount resumes instead of restarting.
 * Presentation only — the underlying message content is never altered,
 * and any control that needs the full text (copy, speak, downloads)
 * reads the message itself, not the typed prefix.
 */
const typedMessageIds = new Set<string>();
const typedProgressById = new Map<string, number>();

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Derive the work-log line from execution evidence only.
 *
 * Returns null when no work log should be shown. A conversational reply
 * carries no evidence and therefore no work log — it must never render as
 * completed work. `message.actions` are PROPOSED canvas actions the user can
 * click, so they are deliberately not counted as completed steps.
 */
function deriveWorkLog(
  message: ChatMessage,
  isFailed: boolean,
): { label: string; color: string } | null {
  const execution = message.execution;

  // A failed message still has to tell the truth about the workspace.
  //
  // This previously hardcoded "Failed — no work completed" without consulting
  // any evidence. A run that wrote bytes and then failed — or was cancelled
  // after a write landed — was labelled as having done nothing, while the
  // user's file on disk had already been rewritten. The checkpoint diff is
  // the authority, so it is consulted here too.
  if (isFailed) {
    const attempted = execution?.toolCalls.length ?? 0;
    const change = execution?.workspaceChange ?? null;

    if (change?.status === "changed") {
      const count = change.files?.length ?? 0;
      const detail = count === 1 ? change.files![0] : count > 1 ? `${count} files` : "changes";
      return {
        label: `Failed after changing ${detail} — review or roll back`,
        color: "#ef4444",
      };
    }

    // The verification label is only truthful when file verification is
    // actually what failed: either a workspace comparison was attempted
    // and came back "unknown", or the run attempted a mutation and no
    // evidence came back at all. A run that died before attempting any
    // file work (a failed model call on a first build, say) settled with
    // change === null too — blaming file verification for it sent the
    // user (and the operator) hunting a verification bug that never
    // happened (ACC-03 item 5). Those runs fall through to the plain
    // failure labels below.
    const attemptedMutation = execution?.toolCalls.some((call) => call.mutating) ?? false;
    if (change?.status === "unknown" || (change === null && attemptedMutation)) {
      return {
        label: "Failed — could not verify whether files changed",
        color: "#ef4444",
      };
    }
    // Count the steps that actually succeeded: this fallback never goes
    // through verdict evaluation, and hardcoding 0 erased successful
    // work — a run that read files fine and then failed elsewhere was
    // recorded as "0 of N steps complete" (Greptile PR #1109). The
    // transcript's own convention (workLogLabel) counts successes.
    const completed = (execution?.toolCalls ?? []).filter((call) => call.success).length;
    return {
      label: attempted > 0
        ? `${completed} of ${attempted} steps complete — failed`
        : "Failed — no work completed",
      color: "#ef4444",
    };
  }

  // No evidence attached → no work was executed → no work log.
  if (!execution) return null;

  const verdict = evaluateCompletion(requirementForMode(execution.mode), {
    toolCalls: execution.toolCalls,
    deployment: execution.deployment ?? null,
    workspaceChange: execution.workspaceChange ?? null,
  });
  const label = workLogLabel(verdict);
  if (!label) return null;

  const color = verdict.state === "complete"
    ? "var(--litt-primary)"
    : verdict.state === "failed"
      ? "#ef4444"
      : "#e3b341";
  return { label, color };
}

/* ── Per-run execution details (raw low-level records) ─────────────── */

/**
 * Raw low-level records for a completed run's Details expander.
 *
 * `toolActivity` is the recorded stream of what the run did (tool calls,
 * build checks, checkpoints — including low-level reads). These are factual
 * records only: they sit behind the collapsed expander and never pretend to
 * be the run's result. The result is the evidence-derived verdict line.
 */
function executionDetailsFor(message: ChatMessage): ExecutionDetailRecord[] {
  const activity = message.toolActivity ?? [];
  return activity.map((record, index) => ({
    id: `${message.id ?? "msg"}-activity-${index}`,
    summary: record.summary?.trim() ? record.summary : record.toolId.replace(/_/g, " "),
    dotColor: toolActivityDotColor(record.success),
  }));
}

/* ── Live run progress shown inline in the streaming assistant bubble ── */

/** Concise headline labels for the chat surface — no low-level noise. */
function phaseHeadline(phase: ExecutionPhase): string {
  switch (phase) {
    case "planning": return "Understanding request";
    case "researching": return "Researching";
    case "inspecting": return "Looking at the project";
    case "creating": return "Creating";
    case "editing": return "Building";
    case "browsing": return "Browsing";
    case "running": return "Running commands";
    case "testing": return "Checking the build";
    case "verifying": return "Verifying";
    case "deploying": return "Deploying";
    case "awaiting_approval": return "Waiting for your approval";
    case "awaiting_input": return "Waiting for your answer";
    default: return "Working";
  }
}

/** Event types too low-level for the compact chat progress list. */
const PROGRESS_HIDDEN_TYPES = new Set(["reasoning", "status", "model_routing"]);

function eventDotColor(event: ExecutionEvent): string {
  if (event.type === "tool_error" || (event.type === "build_result" && event.success === false)) return "#ef4444";
  if (event.type === "tool_result" || event.type === "build_result" || event.type === "finished") {
    return event.success === false ? "#ef4444" : "#4ade80";
  }
  if (event.type === "checkpoint" || event.type === "preview" || event.type === "deploy") return "var(--litt-primary)";
  return "#e3b341";
}

/**
 * StreamingProgress — the concise, live progress block at the top of the
 * streaming assistant bubble. Reads the existing execution store (the same
 * state that feeds the LiTT Live tab), so no new plumbing was needed.
 * Shows a headline ("Understanding request" → "Building" →
 * "Starting preview" → "Preview ready") plus the last few meaningful
 * steps, never low-level file reads or model-routing chatter.
 */
function StreamingProgress() {
  const phase = useExecutionStore((s) => s.phase);
  const events = useExecutionStore((s) => s.events);
  const isRunning = useExecutionStore((s) => s.isRunning);
  if (!isRunning) return null;

  const lastPreview = [...events].reverse().find((e) => e.type === "preview");
  const lastDeploy = [...events].reverse().find((e) => e.type === "deploy");
  let headline: string;
  if (lastPreview) {
    headline = lastPreview.success === true
      ? "Preview ready"
      : lastPreview.success === false ? "Preview needs attention" : "Starting preview";
  } else if (lastDeploy) {
    headline = lastDeploy.success === true
      ? "Deploy complete"
      : lastDeploy.success === false ? "Deploy needs attention" : "Deploying";
  } else {
    headline = phaseHeadline(phase);
  }

  const steps = events
    .filter((e) => !e.lowLevel && !PROGRESS_HIDDEN_TYPES.has(e.type) && e.summary?.trim())
    .slice(-4);

  // The full raw event firehose — tool calls, step ticks, retries, internal
  // status transitions — stays behind the collapsed Details expander. These
  // are factual records of what happened; they never claim to be the result.
  const rawDetails: ExecutionDetailRecord[] = events
    .filter((e) => e.summary?.trim())
    .map((e) => ({ id: e.id, summary: e.summary, dotColor: eventDotColor(e) }));

  return (
    <div data-testid="studio-live-progress" className="mb-2 border-b pb-2" style={{ borderColor: "color-mix(in srgb, var(--color-accent) 18%, transparent)" }} aria-live="polite">
      <div className="flex items-center gap-2 text-[11px] font-bold" style={{ color: "var(--text-main)" }}>
        <span className="studio-anim-blink inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--litt-primary)" }} aria-hidden />
        {headline}
      </div>
      {steps.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {steps.map((event) => (
            <li key={event.id} className="flex items-start gap-1.5 text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>
              <span
                className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: eventDotColor(event) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{event.summary}</span>
            </li>
          ))}
        </ul>
      )}
      <ExecutionDetailsExpander details={rawDetails} />
    </div>
  );
}

/* ── Quality verdict checklist — collapsed rendering ────────────────
   The agent loop appends the quality verdict as a ```quality-checklist
   fenced block (see formatQualityVerdictBlock in
   @/lib/litt-intelligence/quality-loop-flow). react-markdown strips raw
   <details> HTML, so the fence is the collapse vehicle: it renders here
   as a collapsed per-stage checklist instead of a code block. */
const QUALITY_CHECKLIST_LINE_RE = /^([✓✗○])\s+(.+?)\s+—\s+(\S.*)$/;

export interface QualityCheckItem {
  mark: "✓" | "✗" | "○";
  label: string;
  status: string;
}

/** Parse the ```quality-checklist body into per-stage check items. */
export function parseQualityChecklist(raw: string): QualityCheckItem[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = QUALITY_CHECKLIST_LINE_RE.exec(line);
      if (!m) return null;
      return {
        mark: m[1] as QualityCheckItem["mark"],
        label: m[2],
        status: m[3],
      };
    })
    .filter((item): item is QualityCheckItem => item !== null);
}

function qualityCheckMarkColor(mark: QualityCheckItem["mark"]): string {
  if (mark === "✓") return "var(--litt-primary)";
  if (mark === "✗") return "#f87171";
  return "var(--text-muted)";
}

function QualityChecklistBlock({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const items = parseQualityChecklist(raw);
  if (items.length === 0) return null;
  const failed = items.filter((item) => item.mark === "✗").length;
  return (
    <div className="mt-1.5" data-testid="quality-checklist-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        data-testid="quality-checklist-toggle"
        className="flex items-center gap-1.5 text-[10px] font-bold transition hover:opacity-80"
        style={{ color: "var(--text-muted)" }}
      >
        <span
          className="inline-block h-0 w-0 border-y-[3px] border-l-[5px] border-y-transparent transition-transform"
          style={{ borderLeftColor: "var(--text-muted)", transform: open ? "rotate(90deg)" : "none" }}
          aria-hidden
        />
        Quality checklist
        <span className="font-normal opacity-70">
          · {items.length} check{items.length === 1 ? "" : "s"}
          {failed > 0 ? `, ${failed} failed` : ""}
        </span>
      </button>
      {open && (
        <ul
          id={listId}
          data-testid="quality-checklist"
          className="mt-1.5 flex max-h-48 flex-col gap-1 overflow-y-auto"
        >
          {items.map((item, idx) => (
            <li
              key={`${item.label}-${idx}`}
              className="flex items-start gap-1.5 text-[10px] leading-4"
              style={{ color: "var(--text-secondary)" }}
            >
              <span
                className="shrink-0 font-bold"
                style={{ color: qualityCheckMarkColor(item.mark) }}
                aria-hidden
              >
                {item.mark}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{item.label}</span>
                {" — "}
                {item.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Inline SVG icons for hover actions (lucide-react is pinned to ^1.24) ── */
function IconReply({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  );
}
function IconPin({ size = 12, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14l-1.5-3h-11z" /><path d="M8 14V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v9" />
    </svg>
  );
}
function IconBranch({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}
function IconCopy({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function IconCheck({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function IconRefresh({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
function IconSpeaker({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

/** Hover actions toolbar — appears on message hover with Copy, Reply, Pin, Regenerate, Branch. */
function MessageHoverActions({
  message,
  isUser,
  isFailed,
  isLastAssistant,
  isCopied,
  copiedKind,
  onCopyText,
  onCopyMarkdown,
  onSpeak,
  onRegenerate,
  onReply,
  onPin,
  onBranch,
  isPinned,
}: {
  message: ChatMessage;
  isUser: boolean;
  isFailed: boolean;
  isLastAssistant: boolean;
  isCopied: boolean;
  copiedKind: "text" | "markdown" | null;
  onCopyText: () => void;
  onCopyMarkdown: () => void;
  onSpeak: () => void;
  /** Optional assistant message id lets Retry target the exact failed turn. */
  onRegenerate?: (assistantMessageId?: string) => void;
  onReply?: () => void;
  onPin?: () => void;
  onBranch?: () => void;
  isPinned: boolean;
}) {
  if (isUser) return null;
  // Failed turns can legitimately have no provider response text. Keep the
  // recovery action visible so Retry can re-send the parent user turn.
  if (!message.content?.trim() && !isFailed) return null;
  const actions: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; testId?: string }[] = [
    {
      icon: isCopied && copiedKind === "text" ? <IconCheck /> : <IconCopy />,
      label: isCopied && copiedKind === "text" ? "Copied" : "Copy",
      onClick: onCopyText,
      active: isCopied && copiedKind === "text",
      testId: `hover-copy-${message.id}`,
    },
    { icon: <IconReply />, label: "Reply", onClick: () => onReply?.() },
    { icon: <IconPin filled={isPinned} />, label: isPinned ? "Unpin" : "Pin", onClick: () => onPin?.(), active: isPinned },
    { icon: <IconSpeaker />, label: "Read", onClick: onSpeak },
  ];
  if (isCopied && copiedKind === "markdown") {
    actions[0] = { icon: <IconCheck />, label: "Copied", onClick: onCopyMarkdown, active: true };
  } else {
    actions.push({ icon: <IconCopy />, label: "MD", onClick: onCopyMarkdown, testId: `hover-md-${message.id}` });
  }
  if (isLastAssistant && !isFailed && onRegenerate) {
    actions.push({ icon: <IconRefresh />, label: "Regenerate", onClick: () => onRegenerate() });
  }
  if (onBranch) {
    actions.push({ icon: <IconBranch />, label: "Branch", onClick: onBranch });
  }
  if (isFailed && onRegenerate) {
    // Retry re-runs THIS failed turn, not the last completed response.
    actions.push({ icon: <IconRefresh />, label: "Retry", onClick: () => onRegenerate(message.id) });
  }
  return (
    <div
      className="pointer-events-none absolute top-0 z-20 flex items-center gap-0.5 rounded-lg border p-0.5 opacity-0 shadow-xl transition-all duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
      style={{
        right: 0,
        transform: "translateY(-100%)",
        backgroundColor: "var(--studio-elevated, #1a1530)",
        borderColor: "var(--studio-border-strong, rgba(255,255,255,0.12))",
      }}
    >
      {actions.map((action, i) => (
        <button
          key={i}
          type="button"
          onClick={action.onClick}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold transition hover:bg-white/10"
          style={{ color: action.active ? "#a3e635" : "var(--text-muted, rgba(255,255,255,0.5))" }}
          title={action.label}
          aria-label={action.label}
          data-testid={action.testId}
        >
          {action.icon}
          <span className="hidden sm:inline">{action.label}</span>
        </button>
      ))}
    </div>
  );
}

function ReasoningBlock({ reasoning, color, streaming }: { reasoning: string; color: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  return (
    <div className="mb-1 w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.14em] transition hover:opacity-80"
        style={{ color: `${color}cc` }}
        aria-expanded={Boolean(open)}
      >
        <span
          className="inline-block h-0 w-0 border-y-[3px] border-l-[5px] border-y-transparent transition-transform"
          style={{ borderLeftColor: color, transform: open ? "rotate(90deg)" : "none" }}
        />
        {streaming ? "Thinking…" : "Thought process"}
      </button>
      {open && (
        <div
          className="mt-1 max-h-60 overflow-y-auto rounded-xl border px-3 py-2 text-[11px] leading-5 italic"
          style={{
            borderColor: `${color}1f`,
            background: `${color}08`,
            color: "var(--text-muted)",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          {reasoning}
        </div>
      )}
    </div>
  );
}

/** Small "Copied" confirmation that fades after 2 seconds. */
function CopiedBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      className="select-none rounded px-1.5 py-0.5 text-[8px] font-bold transition-opacity"
      style={{ color: "#a3e635", backgroundColor: "rgba(114,242,56,0.1)" }}
      aria-live="polite"
    >
      Copied
    </span>
  );
}

/** A code block with a copy button in the top-right corner. */
function CodeBlockWithCopy({ code, children }: { code: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-1.5 top-1.5 z-10 rounded border px-1.5 py-0.5 text-[8px] font-bold opacity-0 transition group-hover:opacity-100 focus:opacity-100"
        style={{
          borderColor: "var(--studio-border)",
          backgroundColor: "var(--studio-surface)",
          color: copied ? "var(--color-accent)" : "var(--text-muted)",
        }}
        aria-label={copied ? "Code copied" : "Copy code"}
        title={copied ? "Copied!" : "Copy code"}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre
        className="overflow-x-auto rounded-lg border p-2 text-[11px]"
        style={{ backgroundColor: "var(--studio-bg)", borderColor: "var(--studio-border)" }}
      >
        {children}
      </pre>
    </div>
  );
}

/**
 * Render order for the transcript: chronological by createdAt, stable
 * for ties. The store's array order is insertion order, and persisted
 * replacement swaps a message's id/createdAt IN PLACE (see
 * useCanonicalConversation's updateMessage calls) without repositioning
 * it — so array order can invert causality, e.g. a run's failure card
 * rendering before an earlier progress message from the same run.
 * Messages without a usable timestamp keep their relative position.
 */
export function orderMessagesChronologically(
  messages: ChatMessage[],
): ChatMessage[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const ta = a.message.createdAt ?? NaN;
      const tb = b.message.createdAt ?? NaN;
      const va = Number.isNaN(ta) ? null : ta;
      const vb = Number.isNaN(tb) ? null : tb;
      if (va === null || vb === null || va === vb) return a.index - b.index;
      return va - vb;
    })
    .map(({ message }) => message);
}

export default function StudioTranscript({
  messages: rawMessages,
  busy,
  activeAgentId,
  onRouteToolAction,
  onRegenerateAction,
  completion,
  onDismissCompletion,
  onUndoCompletion,
  onContinueCompletion,
  onOpenPreview,
  ptyUsable = false,
}: {
  messages: ChatMessage[];
  busy: boolean;
  activeAgentId: AgentId;
  onRouteToolAction?: (tool: StudioTool, command?: string) => void;
  onRegenerateAction?: (assistantMessageId?: string) => void;
  completion?: { changes: MutationSummary; previewUpdated: boolean; repaired: boolean } | null;
  onDismissCompletion?: () => void;
  onUndoCompletion?: () => void;
  onContinueCompletion?: () => void;
  /** Completion card "Open Preview" (Kimi wiring item 3): summons the
   *  board's Preview panel. Absent outside the board shell — the card
   *  then renders without the button rather than a dead control. */
  onOpenPreview?: () => void;
  /**
   * True when the interactive PTY is usable right now. Sourced from the
   * canonical runtime truth (useProjectRuntime's terminal.usable) by the
   * parent — this component never reads useTerminalStore directly.
   */
  ptyUsable?: boolean;
}) {
  const messages = useMemo(
    () => orderMessagesChronologically(rawMessages),
    [rawMessages],
  );
  const { speakText } = useVoiceSession();
  // ptyUsable comes from the canonical runtime truth via props (the parent
  // passes runtime.terminal.usable). The "Run in terminal" button genuinely
  // needs the PTY drawer — this is NOT the conflated executionAvailable.
  const agentMeta = AGENT_META[activeAgentId];
  const agentColor = agentMeta.color;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<"text" | "markdown" | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  // Tap-revealed timestamp (Kimi wiring item 3): hover reveals via the
  // group class; touch has no hover, so a tap pins one message's time.
  const [revealedTimestampId, setRevealedTimestampId] = useState<string | null>(null);
  // Long assistant messages collapse behind "Show more" across the whole
  // mobile tier (max-lg: clamp + lg:hidden button, <1024px matches
  // useViewportTier) — desktop rendering is unchanged.
  const [expandedLongIds, setExpandedLongIds] = useState<Set<string>>(new Set());

  // ── Scroll-pin (Kimi wiring item 3) ────────────────────────────────
  // Auto-scroll follows the stream ONLY while the user is at (or near)
  // the bottom. Scrolling up to read unpins; new arrivals then raise
  // the "New messages" pill instead of yanking the view down.
  const scrollPinnedRef = useRef(true);
  const [hasUnseenMessages, setHasUnseenMessages] = useState(false);
  const messageCountRef = useRef(messages.length);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    scrollPinnedRef.current = true;
    setHasUnseenMessages(false);
  }, []);

  useEffect(() => {
    const grew = messages.length !== messageCountRef.current;
    messageCountRef.current = messages.length;
    if (scrollPinnedRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else if (grew) {
      setHasUnseenMessages(true);
    }
  }, [messages, busy]);

  const handleTranscriptScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distance <= 80;
    scrollPinnedRef.current = pinned;
    if (pinned) setHasUnseenMessages(false);
  }, []);

  // ── Typewriter (Kimi wiring item 3) ────────────────────────────────
  // Smooths the REAL stream's chunk arrivals for the latest streaming
  // assistant message: the rendered prefix chases the message's actual
  // content at ~16ms ticks with a catch-up step, so chunks read as a
  // flow instead of jumps. Only the latest streaming message types;
  // every other message renders its full text. When the stream ends,
  // the id is retired into typedMessageIds and never types again.
  const streamingMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const candidate = messages[i];
      if (candidate.role !== "user" && candidate.status === "streaming") return candidate;
    }
    return null;
  }, [messages]);
  const streamingId = streamingMessage?.id ?? null;
  const streamingContent = streamingMessage?.content ?? "";
  const [typedLength, setTypedLength] = useState(0);

  useEffect(() => {
    if (!streamingId || !streamingMessage) return;
    if (typedMessageIds.has(streamingId) || prefersReducedMotion()) {
      typedMessageIds.add(streamingId);
      setTypedLength(streamingContent.length);
      return;
    }
    setTypedLength(typedProgressById.get(streamingId) ?? 0);
    const timer = window.setInterval(() => {
      setTypedLength((current) => {
        const full = streamingContent.length;
        if (current >= full) return current;
        const next = Math.min(full, current + Math.max(3, Math.ceil((full - current) / 5)));
        typedProgressById.set(streamingId, next);
        if (next >= full) typedMessageIds.add(streamingId);
        return next;
      });
    }, 16);
    return () => window.clearInterval(timer);
    // streamingContent is a dep so the chase target tracks new chunks.
  }, [streamingId, streamingContent, streamingMessage]);

  // A message that stops streaming is done typing forever.
  useEffect(() => {
    for (const message of messages) {
      if (message.id && message.status !== "streaming" && typedProgressById.has(message.id)) {
        typedMessageIds.add(message.id);
        typedProgressById.delete(message.id);
      }
    }
  }, [messages]);

  const handleCopyText = useCallback(async (message: ChatMessage) => {
    const ok = await copyToClipboard(markdownToPlainText(message.content));
    if (ok) {
      setCopiedId(message.id ?? null);
      setCopiedKind("text");
      setTimeout(() => { setCopiedId(null); setCopiedKind(null); }, 2000);
    }
  }, []);

  const handleCopyMarkdown = useCallback(async (message: ChatMessage) => {
    const ok = await copyToClipboard(message.content);
    if (ok) {
      setCopiedId(message.id ?? null);
      setCopiedKind("markdown");
      setTimeout(() => { setCopiedId(null); setCopiedKind(null); }, 2000);
    }
  }, []);

  const handlePin = useCallback((message: ChatMessage) => {
    const id = message.id ?? "";
    if (!id) return;
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleReply = useCallback((message: ChatMessage) => {
    setReplyTarget(message);
    // Dispatch event so the composer can quote this message
    window.dispatchEvent(new CustomEvent("studio:reply-to", { detail: { id: message.id, content: message.content } }));
    // Focus the composer
    const composer = document.querySelector<HTMLTextAreaElement>("[data-testid='studio-command-composer'] textarea");
    if (composer) {
      composer.focus();
      const quote = message.content.slice(0, 200).trim();
      const current = composer.value;
      if (!current.startsWith(">")) {
        composer.value = `> ${quote.replace(/\n/g, "\n> ")}\n\n`;
        composer.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }, []);

  const handleBranch = useCallback((message: ChatMessage) => {
    window.dispatchEvent(new CustomEvent("studio:branch-from", { detail: { id: message.id, content: message.content } }));
  }, []);

  const completedMutationCount = completion
    ? completion.changes.added + completion.changes.modified + completion.changes.deleted + completion.changes.renamed
    : 0;

  return (
    <div
      ref={scrollRef}
      onScroll={handleTranscriptScroll}
      data-testid="studio-transcript"
      className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      style={{ color: "var(--text-main)" }}
    >
      <div className="mx-auto flex w-full min-w-0 flex-col gap-5 pb-4" style={{ maxWidth: "var(--studio-composer-max-w)" }}>
        {messages.map((message, index) => {
          const isUser = message.role === "user";
          const isStreaming = message.status === "streaming";
          const hasContent = Boolean(message.content?.trim());
          const isFailed = !isUser && message.status === "failed";
          if (!isUser && !hasContent && !isStreaming && !isFailed) {
            return null;
          }
          const isLastAssistant = !isUser && index === messages.length - 1 && !busy;
          const showThinkingPlaceholder = !isUser && isStreaming && !hasContent;
          const command = !isUser ? parseJarvisActions(message.content).find((a) => a.command)?.command : undefined;
          const key = message.id || `msg_${index}`;
          // Typewriter display text (Kimi wiring item 3): only the
          // latest streaming message renders its typed prefix; every
          // other message — and every action taken on this one — uses
          // the full real content.
          const isTypingTarget =
            !isUser &&
            isStreaming &&
            message.id != null &&
            message.id === streamingId &&
            !typedMessageIds.has(message.id);
          // Collapsible only for settled assistant messages — never while
          // streaming or mid-typewriter, so live output is never clipped.
          const isCollapsible =
            !isUser &&
            !isStreaming &&
            !isTypingTarget &&
            (message.content ?? "").length > 600;
          const longExpanded = expandedLongIds.has(key);
          const displayContent = isTypingTarget
            ? (message.content ?? "").slice(0, typedLength)
            : message.content;
          const isCopied = copiedId === message.id;
          const isPinned = pinnedIds.has(message.id ?? "");
          const workLog = deriveWorkLog(message, isFailed);
          return (
            <div
              key={key}
              className={`group flex gap-3 studio-anim-in ${isUser ? "flex-row-reverse" : "flex-row"} ${isPinned ? "relative" : ""}`}
              data-testid={isUser ? "user-message" : "assistant-message"}
            >
              {/* Assistant rows carry NO avatar/logo image (Larry,
                  2026-11-20): the old LiTT robot logo hanging over the
                  left edge of the message row is removed entirely — the
                  "LITT" text label below is the only identifier. The
                  user's own avatar on their messages stays. */}
              {isUser ? <UserMessageAvatar size={30} /> : null}
              <div
                className={`flex max-w-[88%] min-w-0 flex-col sm:max-w-[78%] ${isUser ? "items-end" : "items-start"}`}
              >
                <div
                  className={`mb-1 flex items-center gap-2 px-1 text-[9px] font-black uppercase tracking-[.14em] ${isUser ? "flex-row-reverse" : ""}`}
                  style={{ color: isUser ? "var(--color-accent)" : agentColor }}
                >
                  <span>{isUser ? "You" : agentMeta.displayName}</span>
                  {!isUser && (
                    <span
                      className="rounded-full border px-1.5 py-0.5 text-[7px]"
                      style={{ borderColor: `${agentColor}20`, backgroundColor: `${agentColor}08`, color: `${agentColor}99` }}
                    >
                      AI
                    </span>
                  )}
                </div>
                {!isUser && command && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
                    <button
                      type="button"
                      onClick={() => onRouteToolAction?.("terminal", command)}
                      disabled={!ptyUsable}
                      className="rounded-lg border px-2.5 py-1.5 text-[9px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35"
                      style={{ borderColor: "color-mix(in srgb, var(--color-accent) 30%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, transparent)", color: "var(--color-accent)" }}
                      aria-label={`Run ${command} in terminal`}
                      title={`Run ${command} in terminal`}
                    >
                      Run in terminal
                    </button>
                    {!ptyUsable && <span className="text-[8px]" style={{ color: "#e3b341" }}>Terminal not connected</span>}
                  </div>
                )}
                {!isUser && message.reasoning && message.reasoning.trim() && (
                  <ReasoningBlock
                    reasoning={message.reasoning}
                    color={agentColor}
                    streaming={busy && index === messages.length - 1}
                  />
                )}
                <div
                  className={`relative min-w-0 max-w-full rounded-2xl border px-4 py-3 text-[13px] leading-6 ${isCollapsible && !longExpanded ? "max-lg:max-h-80 max-lg:overflow-hidden" : ""}`}
                  style={{
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    // Chat beauty (2026-11-11): bubbles wear the Studio
                    // shell's Signature tokens (white worked into green)
                    // like every other shell surface. They used to be
                    // hard-coded dark-purple glass (rgba(20,15,31,*))
                    // with prose-invert markdown, whatever theme was
                    // applied.
                    borderColor: isFailed
                      ? "rgba(239,68,68,0.3)"
                      : isUser
                        ? "color-mix(in srgb, var(--color-accent) 35%, transparent)"
                        : "var(--studio-border)",
                    ...(isFailed
                      ? {
                          background:
                            "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))",
                        }
                      : {
                          backgroundColor: isUser
                            ? "color-mix(in srgb, var(--color-accent) 14%, var(--studio-card))"
                            : "var(--studio-card)",
                        }),
                    color: "var(--text-main)",
                    boxShadow: isFailed
                      ? "0 4px 16px rgba(239,68,68,0.1)"
                      : "0 4px 16px rgba(14,60,26,0.10), 0 0 12px rgba(23,122,54,0.05)",
                  }}
                  aria-busy={showThinkingPlaceholder}
                >
                  {!isUser && isStreaming && <StreamingProgress />}
                  {isUser ? (
                    <span className="select-text">{message.content}</span>
                  ) : showThinkingPlaceholder ? (
                    <div
                      className="flex min-h-[2.25rem] items-center gap-2 text-[12px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span className="flex gap-1" aria-hidden>
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[color:var(--litt-primary)] [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[color:var(--litt-primary)] [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[color:var(--litt-primary)]" />
                      </span>
                      <span>LiTT is thinking…</span>
                    </div>
                  ) : isFailed ? (
                    // Mobile layout card (2026-11-19): chat errors say
                    // "We hit a snag, try again" — never raw error text or
                    // codes anywhere in the chat surface.
                    <p className="text-[13px] leading-6" style={{ color: "var(--text-main)" }}>
                      We hit a snag, try again.
                    </p>
                  ) : (
                    <div className="prose prose-sm max-w-none select-text prose-p:my-1 prose-pre:my-1">
                      <ReactMarkdown
                        components={{
                          img: ({ src, alt }) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            // No lazy: unsized lazy images inside the scroll
                            // container stay 0×0, never intersect, and never
                            // fetch — chat images must render directly.
                            <img src={src} alt={alt} className="h-auto max-w-full rounded-lg object-contain" decoding="async" />
                          ),
                          pre: ({ children }) => {
                            // Extract raw text from the code element for copying
                            let raw = "";
                            let language = "";
                            if (typeof children === "string") {
                              raw = children;
                            } else if (children && typeof children === "object" && "props" in children) {
                              const childProps = (children as React.ReactElement).props as { children?: React.ReactNode; className?: string };
                              language = childProps.className ?? "";
                              raw = typeof childProps.children === "string" ? childProps.children : "";
                            }
                            // Quality verdict checklist: render collapsed, not as code.
                            if (/\blanguage-quality-checklist\b/.test(language)) {
                              return <QualityChecklistBlock raw={raw} />;
                            }
                            return <CodeBlockWithCopy code={raw}>{children}</CodeBlockWithCopy>;
                          },
                        }}
                      >
                        {displayContent}
                      </ReactMarkdown>
                      {isStreaming && hasContent && (
                        <span
                          className="studio-anim-blink ml-0.5 inline-block align-middle"
                          style={{ width: "2px", height: "14px", background: "var(--litt-primary)" }}
                          aria-hidden
                        />
                      )}
                    </div>
                  )}
                  {isCollapsible && !longExpanded && (
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-2xl lg:hidden"
                      style={{
                        background:
                          "linear-gradient(to bottom, transparent, var(--studio-card))",
                      }}
                      aria-hidden
                    />
                  )}
                </div>
                {isCollapsible && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedLongIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    className="inline-flex min-h-11 items-center px-1 text-[11px] font-bold transition hover:opacity-80 lg:hidden"
                    style={{ color: "var(--litt-primary)" }}
                    aria-expanded={longExpanded}
                  >
                    {longExpanded ? "Show less" : "Show more"}
                  </button>
                )}
                {/* Failed turns get a persistent, always-visible Retry —
                    the hover toolbar is unreachable on touch devices. */}
                {isFailed && onRegenerateAction && (
                  <button
                    type="button"
                    onClick={() => onRegenerateAction(message.id)}
                    className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg border px-4 text-[12px] font-bold transition hover:opacity-80"
                    style={{
                      borderColor: "color-mix(in srgb, var(--litt-primary) 45%, transparent)",
                      backgroundColor: "color-mix(in srgb, var(--litt-primary) 10%, transparent)",
                      color: "var(--litt-primary)",
                    }}
                    data-testid={`retry-${message.id}`}
                  >
                    <IconRefresh /> Retry
                  </button>
                )}
                {message.actions && message.actions.length > 0 && (
                  <ActionChips
                    actions={message.actions}
                    onExecute={(action) => {
                      window.dispatchEvent(new CustomEvent("canvas:execute-action", { detail: action }));
                    }}
                  />
                )}
                {/*
                  Execution lane — visually distinct from the conversation
                  bubble above. The verdict line is derived ONLY from execution
                  evidence (see deriveWorkLog); the raw low-level events sit
                  collapsed behind the Details expander and never claim to be
                  the run's result. A message with no execution evidence
                  renders no execution lane at all: a conversational reply is
                  not completed work, and `actions` are proposals the user can
                  click, not work that happened.
                */}
                {!isUser && !isStreaming && hasContent && workLog && (
                  <ExecutionBlock
                    verdict={workLog}
                    details={executionDetailsFor(message)}
                  />
                )}
                {/* Pinned indicator badge */}
                {isPinned && (
                  <div
                    className="flex items-center gap-1 px-1 text-[8px] font-bold uppercase tracking-wider"
                    style={{ color: "#e3b341" }}
                  >
                    <IconPin size={8} filled /> Pinned
                  </div>
                )}
                {/* Reply quote indicator */}
                {replyTarget?.id === message.id && (
                  <div
                    className="px-1 text-[8px] font-bold uppercase tracking-wider"
                    style={{ color: agentColor }}
                  >
                    ↩ Replying to this message
                  </div>
                )}
                {/* Hover actions toolbar — replaces always-visible buttons */}
                <div className="relative">
                  <MessageHoverActions
                    message={message}
                    isUser={isUser}
                    isFailed={isFailed}
                    isLastAssistant={isLastAssistant}
                    isCopied={isCopied}
                    copiedKind={copiedKind}
                    onCopyText={() => void handleCopyText(message)}
                    onCopyMarkdown={() => void handleCopyMarkdown(message)}
                    onSpeak={() => speakText(message.content)}
                    onRegenerate={onRegenerateAction}
                    onReply={() => handleReply(message)}
                    onPin={() => handlePin(message)}
                    onBranch={() => handleBranch(message)}
                    isPinned={isPinned}
                  />
                  {/* Timestamp (Kimi wiring item 3): revealed on hover,
                      or pinned open by a tap for touch. */}
                  <div className="mt-0.5 flex items-center gap-1.5 px-1">
                    <span
                      className={`cursor-pointer text-[9px] transition-opacity duration-150 ${revealedTimestampId === key ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => setRevealedTimestampId(revealedTimestampId === key ? null : key)}
                      title="Message time"
                    >
                      {message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                    </span>
                    {isCopied && <CopiedBadge show={isCopied} />}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {busy && !messages.some((m) => m.status === "streaming") && (
          <div className="flex gap-3">
            {/* No avatar/logo on the typing row either — same removal
                as the settled message rows (Larry, 2026-11-20). */}
            <div className="flex items-center gap-1.5 rounded-2xl border px-4 py-3" style={{ borderColor: `${agentColor}26` }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ backgroundColor: agentColor, animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        {completion && !busy && (
          <div
            className="mx-auto w-full max-w-[88%] rounded-xl border px-3 py-2.5"
            style={{ borderColor: "rgba(114,242,56,0.22)", backgroundColor: "rgba(114,242,56,0.05)" }}
            data-testid="studio-completion"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 text-[11px] font-bold" style={{ color: "var(--litt-primary)" }}>
              <IconCheck size={13} />
              Done
              {completion.repaired && <span className="font-normal" style={{ color: "#e3b341" }}>· recovered automatically</span>}
            </div>
            <div className="mt-1 text-[10px]" style={{ color: "var(--text-secondary)" }}>
              {completedMutationCount > 0 ? `${completedMutationCount} file${completedMutationCount === 1 ? "" : "s"} changed` : "No files changed"}
              {completion.previewUpdated ? " · Preview updated" : " · Ready for the next request"}
            </div>
            {completedMutationCount > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]" style={{ color: "var(--text-muted)" }}>
                {completion.changes.added > 0 && <span>{completion.changes.added} created</span>}
                {completion.changes.modified > 0 && <span>{completion.changes.modified} modified</span>}
                {completion.changes.deleted > 0 && <span>{completion.changes.deleted} deleted</span>}
                {completion.changes.renamed > 0 && <span>{completion.changes.renamed} renamed</span>}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={onDismissCompletion} className="rounded-md px-2 py-1 text-[10px] font-bold hover:bg-white/8" style={{ color: "var(--text-secondary)" }}>Keep</button>
              {onUndoCompletion && completedMutationCount > 0 && (
                <button type="button" onClick={onUndoCompletion} className="rounded-md px-2 py-1 text-[10px] font-bold hover:bg-white/8" style={{ color: "#fca5a5" }}>Undo</button>
              )}
              {/* Open Preview (Kimi wiring item 3): the completion
                  card's artifact action — summons the board's Preview
                  panel. Only when the run actually updated the preview
                  and a summon handler exists. No thumbnail: the real
                  system has no preview-capture image to show, and a
                  fabricated one would be fake data. */}
              {onOpenPreview && completion.previewUpdated && (
                <button
                  type="button"
                  onClick={onOpenPreview}
                  className="rounded-md px-2 py-1 text-[10px] font-bold hover:bg-white/8"
                  style={{ color: "var(--text-secondary)" }}
                  data-testid="studio-completion-open-preview"
                >
                  Open Preview
                </button>
              )}
              <button type="button" onClick={onContinueCompletion} className="rounded-md px-2 py-1 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--color-accent) 14%, transparent)", color: "var(--color-accent)" }}>Continue</button>
            </div>
          </div>
        )}
        {/* REMOVED (chat-bar cleanup, Larry 2026-11-20): the floating
            "⋯" conversation-options button (and its desktop Download
            .txt / .md pills) that sat at the end of the transcript,
            hovering over the chat on the phone. The chat view holds
            nothing extra — conversation export stays reachable from
            the chat header menu (Conversation menu → Export) and the
            mobile Tools sheet (Export chat). */}
      </div>
      {/* "New messages" pill (Kimi wiring item 3): sticky to the
          scroll viewport's bottom while the user is reading history
          and new messages land below. */}
      {hasUnseenMessages && (
        <div className="sticky bottom-2 z-10 flex justify-center">
          <button
            type="button"
            onClick={scrollToBottom}
            className="rounded-full px-3 py-1.5 text-[10px] font-bold shadow-lg transition hover:opacity-90"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "#fff",
              boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
            }}
            data-testid="transcript-new-messages"
          >
            New messages ↓
          </button>
        </div>
      )}
    </div>
  );
}
