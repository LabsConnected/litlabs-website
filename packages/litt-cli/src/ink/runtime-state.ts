/**
 * RuntimeState — the ONE authoritative runtime state for every UI surface.
 *
 * The bug this module exists to kill: the agent posts its final message
 * ("I inspected the project but couldn't finish…") while the footer still
 * says `◉ Working` and the composer still says `LiTT is working…`.
 * Mission completion and runtime UI state were desynchronized because
 * every surface derived its own status from raw inputs.
 *
 * Rule: every surface (footer, composer, working view) derives its
 * presentation from `deriveRuntimeState()` — ONE pure function with ONE
 * precedence order:
 *
 *   1. APPROVAL phase (or a live approval prompt) → waiting_for_approval.
 *      Attention is required; rendering "Working" here is invalid.
 *   2. A TERMINAL mission state (COMPLETE/FAILED/CANCELLED/TIMEOUT) wins
 *      over any non-terminal holo phase — when execution has ended, every
 *      surface transitions atomically to the final state, even if the
 *      holo phase or isProcessing flag lags behind.
 *   3. Live holo phases (PLANNING/RUNNING/VERIFYING/…) map to their
 *      runtime state.
 *   4. isProcessing without a holo phase is the chat lane → running.
 *   5. Otherwise idle.
 *
 * Pure and framework-agnostic — fully covered by runtime-state.test.ts.
 */

export type RuntimeState =
  | "idle"
  | "planning"
  | "running"
  | "waiting_for_approval"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

/** Minimal structural input — accepts the real HoloState/MissionState. */
export interface RuntimeStateInput {
  /** The canonical agent lifecycle phase (HoloState value). */
  holoState: string;
  /** Chat-lane processing flag (blocks the composer while streaming). */
  isProcessing: boolean;
  /** Canonical mission state — only `state` is inspected. */
  missionState: { state: string } | null;
  /** True while an approval prompt is pending (belt + suspenders with
   *  holoState === "APPROVAL" — either signal pins the approval state). */
  hasApproval: boolean;
}

/** Mission states that end execution. Once one of these is reached, no
 *  Working surface may render anywhere. */
const TERMINAL_MISSION_STATES: ReadonlySet<string> = new Set([
  "COMPLETE", "FAILED", "CANCELLED", "TIMEOUT",
]);

/** Holo phases that represent live agent work. */
const WORKING_PHASES: ReadonlySet<string> = new Set([
  "UNDERSTANDING", "PLANNING", "READING", "EDITING", "RUNNING", "TESTING", "VERIFYING",
]);

/** Terminal runtime states. */
const TERMINAL_RUNTIME_STATES: ReadonlySet<RuntimeState> = new Set([
  "completed", "failed", "cancelled", "timeout",
]);

/** Busy runtime states — LiTT active OR blocked on the operator. */
const BUSY_RUNTIME_STATES: ReadonlySet<RuntimeState> = new Set([
  "planning", "running", "verifying", "waiting_for_approval",
]);

function terminalMissionToRuntime(state: string): RuntimeState {
  switch (state) {
    case "COMPLETE": return "completed";
    case "FAILED": return "failed";
    case "CANCELLED": return "cancelled";
    case "TIMEOUT": return "timeout";
    default: return "idle";
  }
}

function workingPhaseToRuntime(phase: string): RuntimeState {
  switch (phase) {
    case "VERIFYING": return "verifying";
    case "PLANNING":
    case "UNDERSTANDING": return "planning";
    default: return "running";
  }
}

/**
 * Derive the ONE runtime state. Exactly one state is ever returned —
 * contradictory inputs are resolved by the documented precedence, so no
 * surface can render "Working" while the mission is finished, and no
 * surface can render "Working" while an approval is pending.
 */
export function deriveRuntimeState(input: RuntimeStateInput): RuntimeState {
  const { holoState, isProcessing, missionState, hasApproval } = input;

  // 1. Approval — the operator's attention is required NOW.
  if (hasApproval || holoState === "APPROVAL") return "waiting_for_approval";

  const missionTerminal = missionState !== null
    && TERMINAL_MISSION_STATES.has(missionState.state)
    ? terminalMissionToRuntime(missionState.state)
    : null;

  // 2. Live agent phases — BUT a terminated mission outranks a stale
  //    working phase. This is the atomic completion guarantee.
  if (WORKING_PHASES.has(holoState)) {
    return missionTerminal ?? workingPhaseToRuntime(holoState);
  }

  // 3. Terminal holo phase (no mission object, or holo beat the mission).
  if (holoState === "COMPLETE") return "completed";
  if (holoState === "FAILED") return "failed";
  if (holoState === "CANCELLED") return "cancelled";
  if (holoState === "TIMEOUT") return "timeout";

  // 4. Chat lane — isProcessing with no holo phase is real activity.
  if (isProcessing) return "running";

  // 5. Reconciled terminal mission (holo already reset to IDLE).
  if (missionTerminal) return missionTerminal;

  return "idle";
}

/** True while LiTT is active or blocked on the operator (composer locked). */
export function isBusyState(state: RuntimeState): boolean {
  return BUSY_RUNTIME_STATES.has(state);
}

// ─── Approval-wait clock ──────────────────────────────────────────────
// Time blocked on a human is approval-wait time, NOT agent execution
// time. The footer's working duration subtracts open + accumulated
// approval windows; the approval duration counts ONLY the wait.

/** m:ss for the first hour, then H:MM:SS — e.g. 134s → "2:14". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Compact duration for the footer: seconds under a minute, else Xm. */
export function formatDurationCompact(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

/** Seconds the current approval has been pending (0 when none). */
export function approvalWaitSeconds(approvalSince: number | null, now: number): number {
  if (approvalSince === null) return 0;
  return Math.max(0, Math.floor((now - approvalSince) / 1000));
}

/**
 * Agent execution seconds, EXCLUDING approval-wait windows.
 *
 * Invariant: constant in approval-wait time — pausing longer for a
 * human decision never inflates "Working · Ns".
 *
 * @param busyStartedAt   epoch ms when the run went busy (or null)
 * @param approvalSince   epoch ms when the CURRENT approval window opened (or null)
 * @param approvalAccumMs total ms already spent waiting on RESOLVED approvals
 * @param now             epoch ms
 */
export function busySecondsExcludingApproval(
  busyStartedAt: number | null,
  approvalSince: number | null,
  approvalAccumMs: number,
  now: number,
): number {
  if (busyStartedAt === null) return 0;
  const openWaitMs = approvalSince !== null ? Math.max(0, now - approvalSince) : 0;
  const activeMs = Math.max(0, now - busyStartedAt) - openWaitMs - approvalAccumMs;
  return Math.max(0, Math.floor(activeMs / 1000));
}

/** True when execution has ended. */
export function isTerminalState(state: RuntimeState): boolean {
  return TERMINAL_RUNTIME_STATES.has(state);
}

/** Status icon vocabulary — one glyph per state, everywhere. */
export function runtimeGlyph(state: RuntimeState): string {
  switch (state) {
    case "waiting_for_approval": return "⚠";
    case "planning":
    case "running":
    case "verifying": return "◆";
    case "completed": return "✓";
    case "failed": return "×";
    case "cancelled": return "○";
    case "timeout": return "⏱";
    default: return "○";
  }
}

/** Semantic color role (colors.ts key) per runtime state. */
export function runtimeColorRole(
  state: RuntimeState,
): "gold" | "brand" | "success" | "error" | "warning" | "secondary" {
  switch (state) {
    case "waiting_for_approval": return "gold";
    case "planning":
    case "running":
    case "verifying": return "brand";
    case "completed": return "success";
    case "failed": return "error";
    case "cancelled":
    case "timeout": return "warning";
    default: return "secondary";
  }
}

/** Footer label per runtime state. */
export function runtimeLabel(state: RuntimeState): string {
  switch (state) {
    case "waiting_for_approval": return "APPROVAL";
    case "planning": return "Planning";
    case "running": return "Running";
    case "verifying": return "Verifying";
    case "completed": return "Complete";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    case "timeout": return "Timeout";
    default: return "Idle";
  }
}

/** Composer copy per runtime state. Non-null replaces the input line
 *  while busy; `null` means the composer is editable (idle/terminal). */
export function composerCopy(
  state: RuntimeState,
): { text: string; hint: string | null; gold: boolean } | null {
  switch (state) {
    case "waiting_for_approval":
      return { text: "Approval required above", hint: null, gold: true };
    case "planning":
    case "running":
    case "verifying":
      return { text: "LiTT is working…", hint: "Esc to stop", gold: false };
    default:
      return null;
  }
}

/**
 * Compact risk badge vocabulary for approvals and tool rows.
 * Harmless read-only discovery is READ — never dressed up as elevated.
 *
 *   level safe                 → READ
 *   level elevated             → WRITE
 *   capability destructive     → DELETE
 *   capability external_action → DEPLOY
 *   level dangerous (other)    → SYSTEM
 */
export function riskBadge(
  riskLevel: string,
  capability?: string | null,
): "READ" | "WRITE" | "DELETE" | "DEPLOY" | "SYSTEM" {
  switch (riskLevel) {
    case "safe":
      return "READ";
    case "elevated":
      return "WRITE";
    case "dangerous":
      if (capability === "destructive") return "DELETE";
      if (capability === "external_action") return "DEPLOY";
      return "SYSTEM";
    default:
      return "SYSTEM";
  }
}