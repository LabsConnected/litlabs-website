/**
 * CockpitController — routes user input to ExecutionGateway.
 *
 * The controller is the bridge between the CommandDock and the
 * ExecutionGateway. It translates user intent (natural language or
 * slash commands) into gateway requests.
 *
 * CRITICAL: The controller NEVER executes anything directly.
 * No exec(), spawn(), child_process, shelljs, or execa().
 * Everything goes through ExecutionGateway.
 *
 * Approval flow:
 *   gateway.execute() → require_approval → onApprovalRequired callback
 *   → ApprovalBridge.request() → Promise<boolean> pending
 *   → UI shows ApprovalUX → user presses A/D
 *   → ApprovalBridge.decide() → Promise resolves
 *   → gateway verifyApproval() → VerifiedApproval → SAME execution continues
 *
 * The controller NEVER reissues the command after approval.
 * The same runId, toolCallId, and operation digest flow through.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  runAgentLoop,
  planMission,
  resolveStepForTool,
  attachToolToStep,
  updateToolResultOnStep,
  progressMissionStepAfterTool,
  toolToEvidenceType,
  MissionPlanningError,
  type RuntimeEvent,
  type StreamChunk,
  type VerificationResult,
} from "@litt/agent-core";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { CockpitStore, ActivitySemantic, RoutingMode } from "./cockpit-store.js";
import type { ApprovalBridge } from "./approval-bridge.js";
import type { SessionEventBridge } from "./session-event-bridge.js";
import { createEscalationHook, createEscalationTracker, createModelResolver } from "../lib/escalation-adapter.js";
import { hasOpenRouterKey, resolveProviderAdapter } from "../lib/model-provider.js";
import { ModelRuntime, routingReason, routingModeLabel, type RoutedModel } from "../lib/model-runtime.js";
import { TelemetryStore } from "../lib/provider-registry.js";
import { classifyIntent } from "../lib/intent.js";
import { matchLocalFastPath } from "../lib/local-fast-lane.js";
import { matchReadTools, executeReadTools, formatReadResultsForSynthesis } from "../lib/read-lane.js";
import { shouldSkipPlanning, classifyMissionComplexity } from "../lib/mission-complexity.js";
import { PerfTrace } from "../lib/perf-trace.js";
import { applyBranchRefresh } from "../lib/project-state.js";
import { createToolCallStreamFilter } from "../lib/tool-call-stream.js";
import { porcelainPaths, computeMissionDelta } from "../lib/mission-delta.js";
import {
  MissionVerificationGate,
  createMissionEvidenceTracker,
  isShipCommitAllowed,
  markInspectionStepsComplete,
} from "../lib/mission-verification.js";
import { buildPromptWithContext } from "../lib/context-resolver.js";
import { getGitState } from "../lib/git-state.js";
import { saveSession, summarize, type SessionSnapshot } from "../lib/session-store.js";
import type { WorkspaceEntry } from "../lib/workspace-store.js";

const CLI_IDENTITY = {
  tenantId: "cli-tenant",
  userId: "cli-user",
  actorId: "cli-user",
  trusted: false,
  interaction: "interactive",
} as const;

/**
 * UI-side activity helper — one line, one semantic class.
 * id includes a random suffix so rapid events never collide.
 */
function act(store: CockpitStore, text: string, type = "info", semantic?: ActivitySemantic, tag?: string): void {
  store.actions.addActivity({
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    type,
    text,
    ...(semantic ? { semantic } : {}),
    ...(tag ? { tag } : {}),
  });
}

/** Open a file in the user's editor (UI action only — never agent execution). */
function openInEditor(absPath: string): void {
  try {
    const child = spawn("code", [absPath], { detached: true, stdio: "ignore", shell: true, windowsHide: true });
    child.unref();
  } catch {
    try {
      const child = spawn("cmd", ["/c", "start", "", absPath], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
    } catch {
      // No editor available — ignore.
    }
  }
}

const SLASH_MAP: Record<string, { toolId: string; args: (input: string[]) => { command: string; args: string[] } }> = {
  "/build": { toolId: "project.build", args: () => ({ command: "pnpm", args: ["build"] }) },
  "/check": { toolId: "project.check", args: () => ({ command: "npx", args: ["tsc", "--noEmit"] }) },
  "/test": { toolId: "project.test", args: () => ({ command: "pnpm", args: ["test"] }) },
  "/status": { toolId: "project.status", args: () => ({ command: "git", args: ["status"] }) },
  "/run": { toolId: "project.run", args: (input) => ({ command: input[0] ?? "", args: input.slice(1) }) },
};

// classifyIntent is imported from ../lib/intent.js (extracted for testability)
// Raw tool-call protocol is suppressed by createToolCallStreamFilter()
// (lib/tool-call-stream.js) — a stateful fence-aware filter that works
// across stream deltas, unlike a per-delta prefix check.

/**
 * Refresh the git branch from the same cwd the tools use.
 * Delegates to lib/project-state.ts — the single canonical branch helper.
 * The controller never calls child_process directly (spec §4/§58).
 */
function refreshBranch(cwd: string, previousBranch: string, setBranch: (b: string) => void): string {
  return applyBranchRefresh(cwd, setBranch, previousBranch);
}

/**
 * Truncate text for activity feed conciseness.
 */
function truncateActivity(text: string, max = 80): string {
  const single = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return single.slice(0, max - 1) + "…";
}

/**
 * /verify — run the VerificationGate (the runtime truth boundary).
 * COMPLETE = runtime proved it passed, not the model claiming done.
 * Runs typecheck/test/build (auto-detected from package.json) and
 * reports whether the project is honestly proven.
 */
async function runVerify(
  session: RuntimeSession,
  store: CockpitStore,
): Promise<void> {
  store.actions.setHoloState("VERIFYING");
  store.actions.addActivity({
    id: `act_${Date.now()}`,
    ts: Date.now(),
    type: "info",
    text: "Running verification gate — runtime truth, not model claims.",
  });

  try {
    const result = await session.verify();
    for (const check of result.checks) {
      const label = check.id.charAt(0).toUpperCase() + check.id.slice(1);
      store.actions.addActivity({
        id: `act_${Date.now()}_${check.id}`,
        ts: Date.now(),
        type: check.status === "success" ? "info" : check.status === "skipped" ? "info" : "error",
        text: `${label}: ${check.status.toUpperCase()} — ${check.message}`,
      });
    }
    store.actions.addActivity({
      id: `act_${Date.now()}_summary`,
      ts: Date.now(),
      type: result.proven ? "info" : "error",
      text: result.message,
    });

    if (result.proven) {
      store.actions.setHoloState("COMPLETE");
      store.actions.scheduleIdle(1500);
    } else {
      store.actions.setHoloState("FAILED");
      store.actions.scheduleIdle(2500);
    }
  } catch (err) {
    store.actions.addActivity({
      id: `act_${Date.now()}`,
      ts: Date.now(),
      type: "error",
      text: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
    });
    store.actions.setHoloState("FAILED");
    store.actions.scheduleIdle(2000);
  }
}

export interface CockpitControllerOptions {
  session: RuntimeSession;
  store: CockpitStore;
  approvalBridge: ApprovalBridge;
  /** Local runtime event bridge — used to capture terminal/error logs
   *  for @terminal:last / @error:last mentions. */
  sessionBridge: SessionEventBridge;
  onExit?: () => void;
  /** Canonical project name (from the same detectProject() call as branch) */
  projectName?: string;
  /** Canonical git branch (from the same detectProject() call as the header) */
  branch?: string;
  /**
   * Canonical ModelRuntime — the SINGLE shared instance for the whole app.
   * Owned by CockpitApp and shared with Model Center, Model Picker, and the
   * header. The controller must NOT create its own.
   */
  modelRuntime: ModelRuntime;
}

export function useCockpitController({ session, store, approvalBridge, sessionBridge, onExit, projectName, branch, modelRuntime }: CockpitControllerOptions) {
  // Telemetry store is controller-local (not model truth).
  // useState lazy initializer keeps a single stable instance for the
  // hook's lifetime without touching refs during render.
  const [telemetryStore] = useState(() => new TelemetryStore());

  // ─── @mention context logs ──────────────────────────────────────
  // Captured from the runtime event stream so @terminal:last and
  // @error:last resolve to real observed output. Bounded.
  const terminalLog = useRef<string[]>([]);
  const errorLog = useRef<string[]>([]);

  // /ship verification gate — the runtime's own truth boundary. The
  // last gate result is recorded here (by runShipVerify) so
  // runShipCommit() can refuse on defense-in-depth even if the UI is
  // bypassed: a commit is only allowed after a PROVEN verification.
  const shipVerificationRef = useRef<VerificationResult | null>(null);

  // Capture terminal stdout/stderr + error events for @mentions.
  useEffect(() => {
    return sessionBridge.subscribe((event) => {
      if (event.type === "tool.stdout" || event.type === "tool.stderr") {
        const chunk = String(event.data?.chunk ?? "");
        if (chunk.trim()) {
          terminalLog.current = [...terminalLog.current.slice(-30), chunk.trim().slice(0, 400)];
        }
      } else if (event.type === "tool.failed"
        || event.type === "mission.failed"
        || (event.type === "run.completed" && (event.data?.status as string) === "failed")) {
        const msg = String(event.data?.error ?? event.data?.message ?? event.data?.failureReason ?? "").trim();
        if (msg) {
          errorLog.current = [...errorLog.current.slice(-10), msg.slice(0, 800)];
        }
      }
    });
  }, [sessionBridge]);

  // ─── Session persistence (/resume) ──────────────────────────────
  /** Persist the current shell session (transcript + context). */
  const persistSession = useCallback(() => {
    const messages = store.state.chatTranscript;
    if (messages.length === 0) return;
    const firstUser = messages.find((m) => m.role === "user");
    saveSession({
      project: store.state.project || projectName || "unnamed",
      cwd: session.getCwd(),
      branch: store.state.branch,
      mode: store.state.mode,
      routingMode: store.state.routingMode,
      selectedModel: store.state.selectedModel,
      summary: summarize(firstUser?.content ?? "untitled"),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        status: m.status,
        ts: m.ts,
      })),
    });
  }, [store, session, projectName]);

  // Trigger background discovery on mount — populates model availability
  // from real OpenRouter /models endpoint. Non-blocking. The shared
  // ModelRuntime is owned by CockpitApp; we only kick off discovery here.
  useEffect(() => {
    modelRuntime.refreshAsync();
  }, [modelRuntime]);

  // Subscribe to approval bridge — when the gateway requests approval,
  // the bridge sets a pending approval and notifies us. Any open overlay
  // closes so the ApprovalUX can take the screen (approvals are never
  // hidden behind an overlay).
  useEffect(() => {
    return approvalBridge.subscribe((pending) => {
      if (pending) {
        store.actions.setApprovalPrompt({
          runId: pending.runId,
          toolCallId: pending.toolCallId,
          toolId: pending.toolId,
          action: pending.action,
          risk: pending.risk,
          scope: pending.scope,
        });
        store.actions.setHoloState("APPROVAL");
        store.actions.setOverlay("none");
      }
    });
  }, [approvalBridge, store]);

  // ─── Mode toggle (Tab) — live Plan/Act switch ───────────────────
  // PLAN is enforced at the ExecutionGateway: mutations are DENIED,
  // never silently allowed. We only flip the session + store flag.
  const toggleMode = useCallback(() => {
    const next = store.state.mode === "act" ? "plan" : "act";
    store.actions.setMode(next);
    session.setMode(next);
    act(
      store,
      `Mode: ${next.toUpperCase()}${next === "plan" ? " — read-only, mutations blocked" : " — full execution"}`,
      "mode",
      "decision",
      "MODE",
    );
    persistSession();
  }, [store, session, persistSession]);

  // ─── Overlay handlers ───────────────────────────────────────────
  const openPalette = useCallback((query: string) => {
    store.actions.setOverlay("command-palette");
    store.actions.setOverlayQuery(query);
  }, [store]);

  const openContext = useCallback((query: string) => {
    store.actions.setOverlay("context-picker");
    store.actions.setOverlayQuery(query);
  }, [store]);

  /** Append a @token selected from the context picker to the draft. */
  const attachToken = useCallback((token: string) => {
    const current = store.state.composerValue;
    // Strip any partial @... already being typed, then append the token.
    const base = current.replace(/@[\w./\\:@-]*$/, "").trimEnd();
    store.actions.setComposerValue(`${base ? `${base} ` : ""}${token} `);
    store.actions.setOverlay("none");
    store.actions.setOverlayQuery("");
  }, [store]);

  // ─── /diff handlers ─────────────────────────────────────────────
  const [diffRefreshKey, setDiffRefreshKey] = useState(0);
  const openDiffViewer = useCallback(() => {
    setDiffRefreshKey((k) => k + 1);
    store.actions.setOverlay("diff-viewer");
  }, [store]);

  /** Revert a file (git checkout -- <path>) through the canonical gateway. */
  const revertFile = useCallback(async (path: string) => {
    const gateway = session.getGateway();
    try {
      const result = await gateway.execute({
        toolId: "project.run",
        inputs: { command: "git", args: ["checkout", "--", path] },
        cwd: session.getCwd(),
        mode: session.getMode(),
        identity: CLI_IDENTITY,
      });
      act(
        store,
        result.result.success ? `Reverted ${path}` : `Revert failed: ${result.result.message}`,
        result.result.success ? "info" : "error",
        result.result.success ? "success" : "failed",
        "DIFF",
      );
      const gs = getGitState(session.getCwd());
      store.actions.setWorkspace({ gitModified: gs.changed, gitUntracked: gs.untracked });
      setDiffRefreshKey((k) => k + 1);
      persistSession();
    } catch (err) {
      act(store, `Revert error: ${err instanceof Error ? err.message : String(err)}`, "error", "failed", "DIFF");
    }
  }, [session, store, persistSession]);

  const openFileInEditor = useCallback((path: string) => {
    openInEditor(join(session.getCwd(), path));
    act(store, `Opened ${path}`, "info", "decision", "OPEN");
  }, [session, store]);

  const acceptDiff = useCallback(() => {
    act(store, "Diff reviewed and accepted", "info", "success", "DIFF");
    store.actions.setOverlay("none");
  }, [store]);

  // ─── /workspace ─────────────────────────────────────────────────
  const switchWorkspace = useCallback((entry: WorkspaceEntry) => {
    session.setCwd(entry.root);
    const gs = getGitState(entry.root);
    store.actions.setWorkspace({
      project: entry.name,
      cwd: entry.root,
      branch: gs.branch ?? "unknown",
      gitModified: gs.changed,
      gitUntracked: gs.untracked,
    });
    store.actions.setOverlay("none");
    act(store, `Workspace → ${entry.name}`, "info", "decision", "WS");
    persistSession();
  }, [session, store, persistSession]);

  // ─── /resume + /new ─────────────────────────────────────────────
  const restoreSession = useCallback((snapshot: SessionSnapshot) => {
    // Transcript — restore the saved conversation exactly once.
    store.actions.clearChatTranscript();
    for (const m of snapshot.messages) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      store.actions.addChatMessage({
        role: m.role,
        content: m.content,
        ts: m.ts,
        status: m.status === "error" ? "error" : "complete",
      });
    }
    // Mode + model route.
    if (snapshot.mode === "plan" || snapshot.mode === "act") {
      store.actions.setMode(snapshot.mode);
      session.setMode(snapshot.mode);
    }
    if (snapshot.routingMode) store.actions.setRoutingMode(snapshot.routingMode as RoutingMode);
    if (snapshot.selectedModel) store.actions.setSelectedModel(snapshot.selectedModel);
    // Workspace (when the dir still exists).
    try {
      if (existsSync(snapshot.cwd)) {
        session.setCwd(snapshot.cwd);
        const gs = getGitState(snapshot.cwd);
        store.actions.setWorkspace({
          project: snapshot.project,
          cwd: snapshot.cwd,
          branch: gs.branch ?? snapshot.branch,
          gitModified: gs.changed,
          gitUntracked: gs.untracked,
        });
      }
    } catch {
      // Rest of the session restores even if the workspace is gone.
    }
    store.actions.setOverlay("none");
    store.actions.setComposerValue("");
    act(store, `Session restored: ${snapshot.summary}`, "info", "decision", "RESUME");
  }, [session, store]);

  const newSession = useCallback(() => {
    store.actions.clearChatTranscript();
    store.actions.clearMission();
    store.actions.setHoloState("IDLE");
    store.actions.setIsProcessing(false);
    store.actions.setOverlay("none");
    store.actions.setComposerValue("");
    act(store, "New session", "info", "decision", "NEW");
  }, [store]);

  // ─── /ship ──────────────────────────────────────────────────────
  const runShipVerify = useCallback(async (): Promise<VerificationResult> => {
    const result = await session.verify();
    // Record the gate outcome — the commit gate below reads this ref.
    shipVerificationRef.current = result;
    return result;
  }, [session]);

  /** Commit (optionally push) through the canonical gateway. */
  const runShipCommit = useCallback(async (message: string, push: boolean): Promise<{ ok: boolean; message: string }> => {
    // Runtime gate (defense-in-depth): a commit is ONLY allowed after a
    // verification that PROVEN the work. Missing or failed verification
    // is rejected here regardless of how this function is called — the
    // UI gate in ShipFlow is a first layer, this is the second.
    if (!isShipCommitAllowed(shipVerificationRef.current)) {
      act(store, "Ship blocked: verification gate has not proven the work.", "error", "failed", "SHIP");
      return { ok: false, message: "Verification gate not proven — fix failures, then re-open /ship to re-verify before committing." };
    }
    const gateway = session.getGateway();
    const cwd = session.getCwd();
    const run = async (args: string[]) => {
      const r = await gateway.execute({
        toolId: "project.run",
        inputs: { command: "git", args },
        cwd,
        mode: session.getMode(),
        identity: CLI_IDENTITY,
      });
      if (!r.result.success) throw new Error(r.result.message || `git ${args[0]} failed`);
      return r;
    };
    try {
      await run(["add", "-A"]);
      await run(["commit", "-m", message]);
      if (push) await run(["push"]);
      const gs = getGitState(cwd);
      store.actions.setWorkspace({
        gitModified: gs.changed,
        gitUntracked: gs.untracked,
        branch: gs.branch ?? store.state.branch,
      });
      act(store, push ? `Shipped: committed + pushed` : `Shipped: committed`, "info", "success", "SHIP");
      persistSession();
      return { ok: true, message: push ? `Committed + pushed — ${message}` : `Committed — ${message}` };
    } catch (err) {
      act(store, `Ship failed: ${err instanceof Error ? err.message : String(err)}`, "error", "failed", "SHIP");
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }, [session, store, persistSession]);

  // Self-reference for nested submissions (/inspect /fix → mission goal).
  // Kept in a ref so recursion always calls the LATEST submit.
  const submitRef = useRef<(input: string, opts?: { forceMission?: boolean; promptOverride?: string }) => void>(() => {});
  const submit = useCallback(async (input: string, opts?: { forceMission?: boolean; promptOverride?: string }) => {
    store.actions.addCommand(input);
    // A new turn returns the transcript to LIVE mode (auto-follow).
    store.actions.resetTranscriptScroll();
    // Mode is authoritative on the session — /plan /act Tab all converge.
    session.setMode(store.state.mode);

    // Handle special commands
    if (input === "/clear") {
      store.actions.setHoloState("IDLE");
      store.actions.clearMission();
      store.actions.clearChatTranscript();
      return;
    }
    if (input === "/help") {
      act(store, "Commands: /new /resume /inspect /plan /act /fix /verify /diff /ship /workspace /branch /files /model /status /doctor /settings /run /route /providers /clear /help /exit", "help", "decision", "HELP");
      return;
    }
    // ─── Mode commands — real Plan/Act policy ─────────────────────
    if (input === "/plan") {
      store.actions.setMode("plan");
      session.setMode("plan");
      act(store, "Mode: PLAN — read-only. LiTT can read, inspect, search, reason, propose. Mutations are blocked.", "mode", "decision", "MODE");
      persistSession();
      return;
    }
    if (input === "/act") {
      store.actions.setMode("act");
      session.setMode("act");
      act(store, "Mode: ACT — full execution: edit files, run commands, manipulate git.", "mode", "decision", "MODE");
      persistSession();
      return;
    }
    if (input.startsWith("/mode ")) {
      const mode = input.slice(6).trim();
      if (mode === "plan" || mode === "act") {
        store.actions.setMode(mode);
        session.setMode(mode);
        act(store, `Mode: ${mode.toUpperCase()}${mode === "plan" ? " — read-only, mutations blocked" : " — full execution"}`, "mode", "decision", "MODE");
        persistSession();
      } else {
        act(store, `Mode: ${mode} (unknown — use /plan or /act)`, "info", "warning", "MODE");
      }
      return;
    }
    if (input === "/exit" || input === "/quit") {
      onExit?.();
      return;
    }
    if (input === "/verify") {
      await runVerify(session, store);
      return;
    }
    // ─── Session commands ─────────────────────────────────────────
    if (input === "/new") {
      newSession();
      return;
    }
    if (input === "/resume") {
      store.actions.setOverlay("resume-picker");
      return;
    }
    // ─── Workspace commands ───────────────────────────────────────
    if (input === "/workspace") {
      store.actions.setOverlay("workspace-picker");
      return;
    }
    if (input === "/files") {
      store.actions.setOverlay("file-picker");
      store.actions.setOverlayQuery("");
      return;
    }
    if (input === "/branch") {
      // List branches + current branch.
      const gateway = session.getGateway();
      try {
        const result = await gateway.execute({
          toolId: "project.run",
          inputs: { command: "git", args: ["branch", "--all", "--format=%(refname:short)"] },
          cwd: session.getCwd(),
          mode: session.getMode(),
          identity: CLI_IDENTITY,
        });
        const stdout = (result.result.data as { stdout?: string } | undefined)?.stdout ?? result.result.message;
        act(store, `Branch: ${store.state.branch}`, "info", "decision", "BRANCH");
        for (const line of stdout.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12)) {
          act(store, `  ${line}`, "info", undefined, "BRANCH");
        }
      } catch (err) {
        act(store, `Branch error: ${err instanceof Error ? err.message : String(err)}`, "error", "failed", "BRANCH");
      }
      return;
    }
    if (input.startsWith("/branch ")) {
      const name = input.slice(8).trim();
      const gateway = session.getGateway();
      try {
        const result = await gateway.execute({
          toolId: "project.run",
          inputs: { command: "git", args: ["switch", "-c", name] },
          cwd: session.getCwd(),
          mode: session.getMode(),
          identity: CLI_IDENTITY,
        });
        act(store, result.result.success ? `Branch created + switched: ${name}` : `Branch failed: ${result.result.message}`, result.result.success ? "info" : "error", result.result.success ? "decision" : "failed", "BRANCH");
        if (result.result.success) {
          const gs = getGitState(session.getCwd());
          store.actions.setWorkspace({ branch: gs.branch ?? name });
        }
      } catch (err) {
        act(store, `Branch error: ${err instanceof Error ? err.message : String(err)}`, "error", "failed", "BRANCH");
      }
      return;
    }
    // ─── Diff viewer ──────────────────────────────────────────────
    if (input === "/diff") {
      openDiffViewer();
      return;
    }
    // ─── Ship flow ────────────────────────────────────────────────
    if (input === "/ship") {
      store.actions.setOverlay("ship");
      return;
    }
    // ─── Runtime details ──────────────────────────────────────────
    if (input === "/status") {
      act(store, `Project: ${store.state.project}`, "info", undefined, "STATUS");
      act(store, `Branch: ${store.state.branch}`, "info", undefined, "STATUS");
      act(store, `Mode: ${store.state.mode.toUpperCase()}`, "info", undefined, "STATUS");
      act(store, `Brain: ${modelRuntime.brainLabel(store.state.routingMode, store.state.selectedModel)}`, "info", "decision", "STATUS");
      act(store, `Local: ${store.state.localRuntime} · Remote: ${store.state.remoteRuntime}`, "info", undefined, "STATUS");
      return;
    }
    if (input === "/doctor") {
      act(store, `LiTT runtime: local=${store.state.localRuntime} remote=${store.state.remoteRuntime}`, "info", undefined, "DOCTOR");
      act(store, `Git: ${store.state.branch} · +${store.state.gitModified + store.state.gitUntracked} changes`, "info", undefined, "DOCTOR");
      act(store, `Provider: ${hasOpenRouterKey() ? "OpenRouter BYOK ✓" : "no key (set OPENROUTER_API_KEY)"}`, "info", undefined, "DOCTOR");
      for (const status of modelRuntime.getProviderStatuses()) {
        act(store, `  ${status.label}: ${status.tier}${status.hasCredential ? " ✓" : " ✗ no key"}${status.latencyMs !== null ? ` ${status.latencyMs}ms` : ""}`, "info", undefined, "DOCTOR");
      }
      return;
    }
    if (input === "/settings") {
      act(store, "Settings: ~/.litt/config.json", "info", undefined, "SETTINGS");
      act(store, "Workspaces: ~/.litt/workspaces.json ({\"dirs\": [...]})", "info", undefined, "SETTINGS");
      act(store, "Sessions: ~/.litt/sessions.json", "info", undefined, "SETTINGS");
      act(store, `Mode: ${store.state.mode.toUpperCase()} (Tab toggles)`, "info", undefined, "SETTINGS");
      return;
    }
    // ─── Inspect / Fix — real agent missions ──────────────────────
    if (input === "/inspect" || input.startsWith("/inspect ")) {
      const rest = input.slice(9).trim();
      const goal = rest ? `Inspect the repository and report: ${rest}` : "Inspect this repository and report its structure, stack, and current state.";
      submitRef.current(goal, { forceMission: true });
      return;
    }
    if (input === "/fix" || input.startsWith("/fix ")) {
      const rest = input.slice(5).trim();
      const goal = rest ? `Diagnose and fix the current problem: ${rest}` : "Diagnose the current problem, fix it, and verify the fix.";
      submitRef.current(goal, { forceMission: true });
      return;
    }
    if (input === "/model") {
      store.actions.setOverlay("model-picker");
      return;
    }
    if (input === "/models") {
      store.actions.setOverlay("model-center");
      return;
    }
    if (input === "/litt") {
      // Return to main LiTT conversation mode — just clear state
      store.actions.setHoloState("IDLE");
      store.actions.addActivity({
        id: `act_${Date.now()}`,
        ts: Date.now(),
        type: "info",
        text: "LiTT conversation mode — type anything to talk to LiTT.",
      });
      return;
    }
    if (input === "/palette") {
      store.actions.setOverlay("command-palette");
      return;
    }
    if (input === "/activity") {
      // Show full (untruncated) activity log for debugging.
      // Filters out tool-call markup that was intentionally excluded
      // from the normal feed — /activity is for human-readable debug,
      // not raw model protocol internals.
      const log = store.state.activityLog;
      if (log.length === 0) {
        store.actions.addActivity({ id: `act_${Date.now()}`, ts: Date.now(), type: "info", text: "No activity recorded yet." });
      } else {
        const recent = log.slice(-20);
        for (const entry of recent) {
          // Skip stream entries (stdout/stderr/delta) — they're noisy
          // and their fullText may contain raw protocol chunks.
          if (entry.type === "tool.stdout" || entry.type === "tool.stderr" || entry.type === "agent.delta") continue;
          const time = new Date(entry.ts).toLocaleTimeString();
          const tag = entry.tag ?? entry.type;
          const full = entry.fullText ?? entry.text;
          store.actions.addActivity({
            id: `act_${Date.now()}_act_${entry.id}`,
            ts: Date.now(),
            type: "info",
            tag: "DEBUG",
            text: `${time} ${tag}: ${truncateActivity(full, 80)}`,
            fullText: `${time} [${tag}] (${entry.type})\n${full}`,
          });
        }
      }
      return;
    }

    // ─── Owner/dev mode: /route ─────────────────────────────
    if (input === "/route explain") {
      const last = telemetryStore.getLast();
      if (!last) {
        store.actions.addActivity({
          id: `act_${Date.now()}`,
          ts: Date.now(),
          type: "info",
          text: "No routing decisions yet. Run a mission first.",
        });
      } else {
        store.actions.addActivity({ id: `act_${Date.now()}_0`, ts: Date.now(), type: "info", text: `TASK        ${last.taskType}` });
        store.actions.addActivity({ id: `act_${Date.now()}_1`, ts: Date.now(), type: "info", text: `BRAIN       ${last.routingMode.toUpperCase()}` });
        store.actions.addActivity({ id: `act_${Date.now()}_2`, ts: Date.now(), type: "info", text: `CONTEXT     ~${Math.round(last.estimatedContextTokens / 1000)}K tokens` });
        store.actions.addActivity({ id: `act_${Date.now()}_3`, ts: Date.now(), type: "info", text: `REQUIRES    ${last.requiredCapabilities.join(", ") || "none"}` });
        if (last.rejected.length > 0) {
          store.actions.addActivity({ id: `act_${Date.now()}_4`, ts: Date.now(), type: "info", text: "REJECTED" });
          for (const r of last.rejected) {
            store.actions.addActivity({ id: `act_${Date.now()}_r_${r.modelId}`, ts: Date.now(), type: "info", text: `  ${r.modelId.padEnd(20)} ${r.reason}` });
          }
        }
        store.actions.addActivity({ id: `act_${Date.now()}_5`, ts: Date.now(), type: "info", text: "SELECTED" });
        store.actions.addActivity({ id: `act_${Date.now()}_6`, ts: Date.now(), type: "info", text: `  ${last.selectedModel}` });
        store.actions.addActivity({ id: `act_${Date.now()}_7`, ts: Date.now(), type: "info", text: `  via ${last.servedBy} · ${last.credentialSource}` });
        store.actions.addActivity({ id: `act_${Date.now()}_8`, ts: Date.now(), type: "info", text: `  Est. cost: $${last.estimatedCost.toFixed(4)}` });
      }
      return;
    }
    if (input.startsWith("/route force ")) {
      const modelId = input.slice(13).trim();
      store.actions.setSelectedModel(modelId);
      store.actions.setRoutingMode("fixed");
      store.actions.addActivity({
        id: `act_${Date.now()}`,
        ts: Date.now(),
        type: "info",
        text: `Route forced: ${modelId} (fixed mode)`,
      });
      return;
    }
    if (input === "/route candidates") {
      const last = telemetryStore.getLast();
      if (!last) {
        store.actions.addActivity({ id: `act_${Date.now()}`, ts: Date.now(), type: "info", text: "No routing decisions yet." });
      } else {
        store.actions.addActivity({ id: `act_${Date.now()}_0`, ts: Date.now(), type: "info", text: `Candidates (${last.candidates.length}):` });
        for (const c of last.candidates) {
          const rejected = last.rejected.find(r => r.modelId === c);
          store.actions.addActivity({
            id: `act_${Date.now()}_c_${c}`,
            ts: Date.now(),
            type: "info",
            text: `  ${c.padEnd(28)}${rejected ? " ✗ " + rejected.reason : " ✓"}`,
          });
        }
      }
      return;
    }
    if (input === "/route") {
      // Show current routing configuration using canonical @litt/models routing
      const mode = store.state.routingMode;
      const selected = store.state.selectedModel;
      let routed: RoutedModel;
      try {
        routed = modelRuntime.route(mode, selected, "general task");
      } catch (err) {
        store.actions.addActivity({
          id: `act_${Date.now()}_route_err`,
          ts: Date.now(),
          type: "error",
          tag: "ROUTE",
          text: `Routing error: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      const reason = routingReason(routed, "general task");
      const servedBy = routed.servedBy;
      const fallback = modelRuntime.getFallbackChain(routed.id, "coding");
      const fallbackLabel = fallback.length > 1 ? modelRuntime.getLabel(fallback[1].canonicalId) : "none";

      store.actions.addActivity({ id: `act_${Date.now()}_r0`, ts: Date.now(), type: "info", tag: "ROUTE", text: `BRAIN        ${routingModeLabel(mode)}` });
      store.actions.addActivity({ id: `act_${Date.now()}_r1`, ts: Date.now() + 1, type: "info", tag: "ROUTE", text: `ACTIVE       ${routed.label}` });
      store.actions.addActivity({ id: `act_${Date.now()}_r2`, ts: Date.now() + 2, type: "info", tag: "ROUTE", text: `PROVIDER     ${servedBy}` });
      store.actions.addActivity({ id: `act_${Date.now()}_r3`, ts: Date.now() + 3, type: "info", tag: "ROUTE", text: `REASON       ${reason}` });
      store.actions.addActivity({ id: `act_${Date.now()}_r4`, ts: Date.now() + 4, type: "info", tag: "ROUTE", text: `FALLBACK     ${fallbackLabel}` });
      if (routed.fallbackReason) {
        store.actions.addActivity({ id: `act_${Date.now()}_r4b`, ts: Date.now() + 5, type: "info", tag: "ROUTE", text: `FALLBACK WHY ${routed.fallbackReason}` });
      }
      store.actions.addActivity({ id: `act_${Date.now()}_r5`, ts: Date.now() + 6, type: "info", tag: "INFO", text: "Also: /route explain · /route force <model> · /route candidates" });
      return;
    }

    // ─── Owner/dev mode: /providers ─────────────────────────
    if (input === "/providers health") {
      store.actions.addActivity({ id: `act_${Date.now()}_0`, ts: Date.now(), type: "info", text: "Provider Health:" });
      for (const status of modelRuntime.getProviderStatuses()) {
        const healthLabel = status.tier.toUpperCase();
        const credLabel = status.hasCredential ? "✓" : "✗";
        const latency = status.latencyMs !== null ? ` ${status.latencyMs}ms` : "";
        const servedVia = status.servedBy !== status.providerId ? ` (via ${status.servedBy})` : "";
        const models = status.discoveredCount > 0 ? ` ${status.discoveredCount} models` : "";
        store.actions.addActivity({
          id: `act_${Date.now()}_p_${status.providerId}`,
          ts: Date.now(),
          type: "info",
          text: `  ${status.label.padEnd(12)} ${healthLabel.padEnd(16)} cred:${credLabel}${latency}${servedVia}${models}`,
        });
      }
      return;
    }
    if (input === "/providers") {
      store.actions.addActivity({
        id: `act_${Date.now()}`,
        ts: Date.now(),
        type: "info",
        text: "Provider commands: /providers health",
      });
      return;
    }

    // Slash command → gateway
    if (input.startsWith("/")) {
      const parts = input.split(/\s+/);
      const cmd = parts[0];
      const rest = parts.slice(1);
      const mapping = SLASH_MAP[cmd];

      if (!mapping) {
        store.actions.addActivity({
          id: `act_${Date.now()}`,
          ts: Date.now(),
          type: "error",
          text: `Unknown command: ${cmd}`,
        });
        return;
      }

      const { command, args } = mapping.args(rest);
      store.actions.setHoloState("RUNNING");

      try {
        const gateway = session.getGateway();
        // gateway.execute() will block on approval if needed.
        // The ApprovalBridge handles the human decision asynchronously.
        // The same runId/toolCallId/operation continues after approval.
        const result = await gateway.execute({
          toolId: mapping.toolId,
          inputs: { command, args },
          cwd: session.getCwd(),
          mode: session.getMode(),
          identity: {
            tenantId: "cli-tenant",
            userId: "cli-user",
            actorId: "cli-user",
            trusted: false,
            interaction: "interactive",
          },
        });

        // At this point, approval (if needed) has already been resolved
        // through the bridge. The result reflects the actual outcome.
        if (result.result.success) {
          // Refresh branch after git-changing commands (e.g. /run git switch)
          if (command === "git" || cmd === "/status" || cmd === "/diff") {
            refreshBranch(session.getCwd(), store.state.branch, store.actions.setBranch);
          }
          store.actions.setHoloState("COMPLETE");
          store.actions.scheduleIdle(1500);
        } else if (result.result.status === "cancelled") {
          store.actions.setHoloState("CANCELLED");
          store.actions.scheduleIdle(2000);
        } else if (result.result.status === "timeout") {
          store.actions.setHoloState("TIMEOUT");
          store.actions.scheduleIdle(2000);
        } else {
          store.actions.setHoloState("FAILED");
          store.actions.scheduleIdle(2000);
        }
      } catch (err) {
        store.actions.addActivity({
          id: `act_${Date.now()}`,
          ts: Date.now(),
          type: "error",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
        store.actions.setHoloState("FAILED");
        store.actions.scheduleIdle(2000);
      }
      return;
    }

    // Natural language → LiTT agent loop
    // Bare text (non-slash) goes directly to the agent runtime.
    // No /ask required — the cockpit IS LiTT.
    //
    // Intent boundary (three types):
    //   chat     — casual conversation, questions, greetings.
    //              Does NOT start a mission or progress bar.
    //   mission  — tasks that require tools/execution.
    //              Starts the full agent lifecycle with progress + steps.
    //   command  — slash commands (handled above)
    const projectRoot = session.getCwd();

    // ─── Local Fast Lane — deterministic local queries (no model) ───────
    // A NARROW, explicit fast-path that answers a fixed set of canonical
    // phrasings from local runtime state BEFORE model routing. No model
    // request, no provider adapter, no mission, no VerificationGate.
    // Ambiguous wording falls through to the normal chat/mission path.
    // See lib/local-fast-lane.ts for the phrase set + truthfulness rules.
    const local = matchLocalFastPath(input, {
      cwd: projectRoot,
      projectName,
      mode: store.state.mode,
    });
    if (local) {
      // Local perf trace — truthful labels only. The Local Fast Lane runs
      // BEFORE classifyIntent(), so the trace MUST NOT claim
      // "intent_classified" — that classifier is intentionally bypassed.
      // The truthful local boundaries are:
      //   submit → local_match → finalize
      // No provider/model marks are emitted because no provider or model
      // is involved.
      const localPerf = PerfTrace.start("local");
      localPerf.mark("local_match");

      // Bare exit/quit — exit locally without calling the model.
      if (local.kind === "exit") {
        localPerf.mark("finalize");
        localPerf.end("local");
        // Render the farewell into the transcript before exiting so the
        // turn is not a missing-content gap.
        store.actions.addChatMessage({
          role: "user",
          content: input,
          ts: Date.now(),
          status: "complete",
        });
        store.actions.addChatMessage({
          role: "assistant",
          content: local.text,
          ts: Date.now(),
          status: "complete",
          servedModel: "local",
        });
        store.actions.addActivity({
          id: `act_${Date.now()}_local`,
          ts: Date.now(),
          type: "info",
          tag: "LOCAL",
          text: truncateActivity(local.text, 60),
        });
        onExit?.();
        return;
      }

      // Persist the user message to the chat transcript (rendered once).
      store.actions.addChatMessage({
        role: "user",
        content: input,
        ts: Date.now(),
        status: "complete",
      });
      // Surface the local query in the operator feed.
      store.actions.addActivity({
        id: `act_${Date.now()}_chat`,
        ts: Date.now(),
        type: "agent.chat",
        tag: "LOCAL",
        text: truncateActivity(input, 40),
        fullText: input,
      });
      // Assistant answer — finalized immediately as complete. servedModel
      // is "local" so the routing footer truthfully shows no provider.
      store.actions.addChatMessage({
        role: "assistant",
        content: local.text,
        ts: Date.now(),
        status: "complete",
        servedModel: "local",
      });
      store.actions.addActivity({
        id: `act_${Date.now()}_done`,
        ts: Date.now(),
        type: "agent.complete",
        tag: "LOCAL",
        text: truncateActivity(local.text, 60),
      });
      localPerf.mark("finalize");
      localPerf.end("local");
      persistSession();
      return;
    }

    const intent = classifyIntent(input);
    const isMission = opts?.forceMission === true || intent === "mission";
    // P0 perf instrumentation — no-op unless LITT_PERF=1.
    const perf = PerfTrace.start(intent);
    perf.mark("intent_classified");

    // ─── @mention context resolution ──────────────────────────────
    // The transcript shows the original input (@tokens intact); the
    // MODEL receives the resolved context prompt. Unresolvable tokens
    // (emails, stray @s) stay in the prompt untouched.
    const contextResult = buildPromptWithContext(input, projectRoot, {
      terminalLog: terminalLog.current,
      errorLog: errorLog.current,
    });
    const modelInput = opts?.promptOverride ?? contextResult.prompt;
    // Context (@mentions, terminal/error log) resolved into the model
    // prompt. Shared by CHAT and MISSION — emitted before the path split
    // so neither path's `intent_classified → route` span silently bundles
    // context resolution into routing latency.
    perf.mark("context_resolved");

    // ─── READ lane — bounded read-only project inspection ───────────
    // Sits between LOCAL (deterministic fast lane) and MISSION (full
    // agent lifecycle). Executes canonical read-only tools through the
    // gateway, then optionally makes one synthesis model call to format
    // results. Does NOT create a Mission, invoke the planner, or run
    // VerificationGate.
    if (intent === "read") {
      const readMatch = matchReadTools(input);
      if (readMatch) {
        perf.mark("read_match");

        // Refresh branch (same as CHAT path — keeps header truthful).
        refreshBranch(projectRoot, store.state.branch, store.actions.setBranch);

        // Surface the read query in the operator feed.
        store.actions.addActivity({
          id: `act_${Date.now()}_read`,
          ts: Date.now(),
          type: "agent.chat",
          tag: "READ",
          text: truncateActivity(input, 40),
          fullText: input,
        });
        // Persist user message to the chat transcript.
        store.actions.addChatMessage({
          role: "user",
          content: input,
          ts: Date.now(),
          status: "complete",
        });
        store.actions.setIsProcessing(true);
        store.actions.startBusy();
        try {
          const gateway = session.getGateway();
          const cwd = session.getCwd();

          // Execute read tools in parallel through the canonical gateway.
          for (const call of readMatch.calls) {
            perf.mark(`tool_start:${call.toolId}`);
          }
          const readResults = await executeReadTools(
            readMatch.calls,
            async (toolId, args) => {
              const r = await gateway.execute({
                toolId,
                inputs: args,
                cwd,
                mode: session.getMode(),
                identity: CLI_IDENTITY,
              });
              return r.result;
            },
          );
          for (const r of readResults) {
            perf.mark(`tool_end:${r.toolId}`);
            // Surface truthful tool activity.
            act(
              store,
              `${r.label}: ${r.result.success ? r.result.message : r.result.message}`,
              r.result.success ? "info" : "error",
              r.result.success ? "success" : "failed",
              "READ",
            );
          }

          // ─── Optional synthesis ───
          if (readMatch.needsSynthesis && hasOpenRouterKey()) {
            perf.mark("synthesis_start");
            const synthesisPrompt = formatReadResultsForSynthesis(input, readResults);
            const routed = modelRuntime.route(
              store.state.routingMode,
              store.state.selectedModel,
              synthesisPrompt,
            );
            store.actions.setActiveModel(routed.label);
            const adapter = resolveProviderAdapter(routed);
            store.actions.setActiveProvider(adapter.providerId);
            // Start the assistant message for streaming synthesis.
            store.actions.addChatMessage({
              role: "assistant",
              content: "",
              ts: Date.now(),
              status: "streaming",
              servedModel: routed.label,
            });
            let synthesized = "";
            const modelResult = await adapter.stream(
              [{ role: "user", content: synthesisPrompt }],
              (event) => {
                if (event.type === "delta") {
                  synthesized += event.text;
                  perf.mark("first_token");
                  store.actions.appendAssistantDelta(event.text);
                }
              },
            );
            perf.mark("finalize");
            store.actions.finalizeAssistantMessage({
              content: synthesized || modelResult.content || "No synthesis produced.",
              status: "complete",
              servedModel: routed.label,
            });
          } else {
            // No synthesis — format raw tool results as the answer.
            const rawAnswer = readResults.map((r) => {
              const d = r.result.data;
              const lines = [`${r.label}:`];
              if (d && typeof d === "object") {
                for (const [k, v] of Object.entries(d)) {
                  lines.push(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
                }
              } else {
                lines.push(`  ${r.result.message}`);
              }
              return lines.join("\n");
            }).join("\n\n");
            perf.mark("finalize");
            store.actions.addChatMessage({
              role: "assistant",
              content: rawAnswer,
              ts: Date.now(),
              status: "complete",
              servedModel: "read-tools",
            });
          }

          store.actions.addActivity({
            id: `act_${Date.now()}_done`,
            ts: Date.now(),
            type: "info",
            tag: "READ",
            text: `Read complete — ${readMatch.summary}`,
          });
        } catch (err) {
          const errText = err instanceof Error ? err.message : String(err);
          perf.mark("finalize");
          store.actions.finalizeAssistantMessage({
            content: `Read failed: ${errText}`,
            status: "error",
          });
          store.actions.addActivity({
            id: `act_${Date.now()}_err`,
            ts: Date.now(),
            type: "error",
            tag: "READ",
            text: `Read error: ${errText}`,
          });
        } finally {
          store.actions.setIsProcessing(false);
          store.actions.stopBusy();
          perf.end("read");
          persistSession();
        }
        return;
      }
      // If readMatch is null, fall through to CHAT (shouldn't happen
      // if intent classification is correct, but defensive).
    }

    if (hasOpenRouterKey()) {
      // CHAT intent — casual response, no mission lifecycle.
      // CHAT uses isProcessing (not holoState) to block the composer.
      // holoState stays IDLE throughout — CHAT never enters mission
      // states like UNDERSTANDING/PLANNING/etc.
      if (!isMission) {
        // Refresh branch from the same cwd the tools use — ensures
        // the header branch matches what project.status reports.
        const freshBranch = refreshBranch(projectRoot, store.state.branch, store.actions.setBranch);

        // Surface attached context as a decision event (visible but quiet).
        if (contextResult.resolved.length > 0) {
          act(store, `Attached: ${contextResult.resolved.map((c) => c.label).join(", ")}`, "info", "decision", "CTX");
        }

        store.actions.addActivity({
          id: `act_${Date.now()}`,
          ts: Date.now(),
          type: "agent.chat",
          tag: "CHAT",
          text: truncateActivity(input, 40),
          fullText: input,
        });
        // Persist the user message to the chat transcript (rendered once).
        store.actions.addChatMessage({
          role: "user",
          content: input,
          ts: Date.now(),
          status: "complete",
        });
        // CHAT sets isProcessing, NOT holoState=UNDERSTANDING.
        // holoState stays IDLE — CHAT is not a mission.
        store.actions.setIsProcessing(true);
        store.actions.startBusy();
        try {
          // ─── CANONICAL PATH — one brain, one RuntimeStore ───
          // Reuse the session's canonical ExecutionGateway + RuntimeStore.
          // No ephemeral second store/gateway. Events flow through:
          //   RuntimeStore → SessionEventBridge → EventBridge → CockpitStore
          const gateway = session.getGateway();
          const tools = gateway.getTools();
          const agentStore = session.getStore();
          const routed = modelRuntime.route(store.state.routingMode, store.state.selectedModel, modelInput);
        perf.mark("route");
          // Routing trace — requested (brain/policy) vs resolved (route()).
          // The brain label is the configured policy identity; the resolved
          // label is what route() actually picked for this input. If they
          // differ, fallbackReason explains why (AUTO selection, escalation,
          // availability fallback, etc.).
          const requestedModel = modelRuntime.brainLabel(store.state.routingMode, store.state.selectedModel);
          store.actions.addActivity({
            id: `act_${Date.now()}_route`,
            ts: Date.now(),
            type: "info",
            tag: "ROUTE",
            text: `${routed.label}`,
          });
          // Set the CONFIGURED model label — the actual ACTIVE model is
          // confirmed after streaming sees the runtime response model.
          store.actions.setActiveModel(routed.label);
          // Resolve the provider adapter from the routing decision.
          // Configured direct (BYOK) keys take precedence over the
          // OpenRouter fallback — when servedBy === "openai" and
          // OPENAI_API_KEY is set, the native OpenAI adapter is used and
          // the request goes to api.openai.com, never openrouter.ai.
          // OpenRouter is only used when explicitly selected or when the
          // native provider cannot service the model (no direct key / no
          // native adapter). The model id is NEVER rewritten. max_tokens
          // is NEVER lowered by the resolver — the only place it steps
          // down is the OpenRouter adapter's insufficient-credits retry
          // (a confirmed credit rejection, surfaced via [litt-diag]), so
          // a low balance never kills a run with an ugly "Model error".
          // ─── DIAGNOSTIC (CHAT path) — gated by LITT_DIAG=1 ─────────
          if (process.env.LITT_DIAG === "1") {
            process.stderr.write(
              `[litt-diag][CHAT] selectedModelId=${store.state.selectedModel ?? "(null)"} ` +
              `routed.id=${routed.id} routed.servedBy=${routed.servedBy} ` +
              `routed.providerModelId=${routed.providerModelId ?? "(none)"} ` +
              `routed.openRouterModelId=${routed.openRouterModelId ?? "(none)"} ` +
              `hasOpenAIKey=${!!process.env.OPENAI_API_KEY} ` +
              `hasOpenRouterKey=${!!process.env.OPENROUTER_API_KEY}\n`,
            );
          }
          const model = resolveProviderAdapter(routed, {
            tools: tools.list(),
          });
          // Truthful label: this marks the provider adapter being READY,
          // not an outbound request. The actual request fires inside
          // runAgentLoop below; we do not claim provider latency here.
          perf.mark("provider_ready");
          if (process.env.LITT_DIAG === "1") {
            process.stderr.write(
              `[litt-diag][CHAT] adapter.providerId=${model.providerId} ` +
              `adapter.configuredModel=${model.configuredModel}\n`,
            );
          }
          // Set the ACTUAL served provider from the resolved adapter
          // BEFORE the request starts. `routed.servedBy` is routing
          // intent; `model.providerId` is execution truth — the adapter
          // that will actually carry the request. Setting it here (not
          // from servedBy) means the header never lies even if the
          // adapter fell back to OpenRouter or streaming throws early.
          store.actions.setActiveProvider(model.providerId);

          // Persist a streaming assistant message — the live preview.
          // Finalized ONCE with result.content when the loop completes.
          store.actions.addChatMessage({
            role: "assistant",
            content: "",
            ts: Date.now(),
            status: "streaming",
            requestedModel,
            resolvedModel: routed.label,
            servedModel: null,
            fallbackReason: routed.fallbackReason,
          });

          // Track tool calls for structured activity events.
          // CHAT can call tools (e.g. project.status) but does NOT
          // progress through mission lifecycle states.
          let chatToolCallCount = 0;

          // Stateful fence-aware filter: raw tool_call protocol must
          // never leak into the live chat preview, even when the fence
          // is split across many stream deltas.
          const toolCallFilter = createToolCallStreamFilter();

          const result = await runAgentLoop(modelInput, {
            model, tools, shell: session.getShell(),
            gateway,
            cwd: projectRoot, userId: "cli-user",
            mode: session.getMode(), maxRounds: 4,
            projectContext: { name: projectName ?? "chat", root: projectRoot, branch: freshBranch ?? branch ?? "unknown" },
            store: agentStore,
            onModelStream: (event) => {
              if (event.type === "delta") {
                // Suppress tool_call/json protocol markup — never dump
                // model protocol internals to the chat transcript.
                const visible = toolCallFilter.next(event.text);
                if (!visible) return;
                // First VISIBLE model prose (after tool-call filtering),
                // matching MISSION behavior. De-duplicated by PerfTrace so
                // the first occurrence wins — truthful time-to-first-token.
                perf.mark("first_token");
                // Live streaming preview — append to the pending
                // assistant message. Finalized once on completion.
                store.actions.appendAssistantDelta(visible);
              }
            },
            onToolStream: (chunk: StreamChunk) => {
              // Tool stdout/stderr — route through the canonical event bus
              // so SessionEventBridge → EventBridge → CockpitStore handles it.
              session.emitAgentEvent({
                type: "tool_stream",
                ts: chunk.ts,
                data: { stream: chunk.stream, text: chunk.text },
              });
            },
            emitter: (event: RuntimeEvent) => {
              // Route agent events through the canonical event bus.
              // SessionEventBridge maps agent_tool_call/agent_tool_result
              // to LifecycleEvents → EventBridge → CockpitStore.
              // No toolId.includes() inference — holo state comes from
              // canonical command_start/command_end events.
              session.emitAgentEvent(event);
              if (event.subtype === "agent_tool_call") {
                chatToolCallCount++;
              }
            },
          });
          if (model.activeModel) store.actions.setActiveModel(model.activeModel);
          // Re-affirm the served provider post-completion. The value was
          // already set pre-stream from model.providerId (execution truth,
          // not routed.servedBy intent); this is an idempotent no-op that
          // guards against any mid-stream state reset.
          store.actions.setActiveProvider(model.providerId);
          // ─── Finalize the assistant message ONCE ───
          // result.content is the canonical final response (tool_call
          // blocks stripped by the agent loop). Persist it exactly once.
          // An empty result.content is rendered as an explicit error —
          // never a blank completed turn.
          const finalContent = result.content.trim()
            ? result.content
            : "LiTT returned an empty response. The turn was not completed.";
          const finalStatus: "complete" | "error" =
            result.termination === "complete" ? "complete" : "error";
          perf.mark("finalize");
          store.actions.finalizeAssistantMessage({
            content: finalContent,
            status: finalStatus,
            servedModel: model.activeModel,
            durationMs: result.durationMs,
          });
          const seconds = (result.durationMs / 1000).toFixed(1);
          // Single concise DONE event — not raw response body
          store.actions.addActivity({
            id: `act_${Date.now()}_done`,
            ts: Date.now(),
            type: result.termination === "complete" ? "agent.complete" : "agent.stopped",
            tag: "CHAT",
            text: `LiTT responded · ${seconds}s${chatToolCallCount > 0 ? ` · ${chatToolCallCount} tools` : ""}`,
          });
          // CHAT complete — the tool events above pushed holoState to
          // RUNNING mid-run; a successful chat must return it to IDLE
          // (the composer/status reconcile out of Working). Cleanup in finally.
          store.actions.setHoloState("IDLE");
          persistSession();
        } catch (err) {
          const errText = `Agent error: ${err instanceof Error ? err.message : String(err)}`;
          store.actions.addActivity({
            id: `act_${Date.now()}_err`,
            ts: Date.now(), type: "error", tag: "ERROR",
            text: truncateActivity(errText, 60),
            fullText: err instanceof Error ? `${errText}\nStack: ${err.stack ?? "(no stack)"}` : errText,
          });
          // Finalize the streaming assistant message as an ERROR —
          // never leave it blank or partially streamed.
          perf.mark("finalize");
          store.actions.finalizeAssistantMessage({
            content: errText,
            status: "error",
          });
          store.actions.setHoloState("FAILED");
          store.actions.scheduleIdle(2000);
        } finally {
          // ONE canonical transition out of a run: every terminal
          // outcome (success, failed, provider error, tool error, stall)
          // re-enables the composer and stops the busy timer. The shell
          // can never stay visually Working after the run settles.
          store.actions.setIsProcessing(false);
          store.actions.stopBusy();
        }
        perf.end("chat");
        return;
      }

      // MISSION intent — full agent lifecycle with real Mission state
      // Refresh branch from the same cwd the tools use
      const freshBranch = refreshBranch(projectRoot, store.state.branch, store.actions.setBranch);
      perf.mark("branch_refreshed");

      // Surface attached context as a decision event (visible but quiet).
      if (contextResult.resolved.length > 0) {
        act(store, `Attached: ${contextResult.resolved.map((c) => c.label).join(", ")}`, "info", "decision", "CTX");
      }

      store.actions.startMission(input);
      store.actions.startBusy();
      store.actions.setHoloState("UNDERSTANDING");
      // ─── Git BASELINE at mission start (dogfood P0) ──────────────
      // The repo's pre-existing dirty files are recorded BEFORE any
      // tool runs so the DONE summary can distinguish "repository
      // state" from "mission delta". Pre-existing dirt is NEVER
      // attributed to this mission.
      {
        const gs = getGitState(projectRoot);
        store.actions.setMissionBaseline(porcelainPaths(gs.porcelain));
      }
      act(store, "Understanding request", "agent.request", "working", "THINK");
      // Persist the user message to the chat transcript (rendered once).
      store.actions.addChatMessage({
        role: "user",
        content: input,
        ts: Date.now(),
        status: "complete",
      });
      // Cockpit-side mission state initialized (holoState, baseline, user
      // message) — distinct from the canonical RuntimeStore mission below.
      perf.mark("mission_initialized");

      // Every terminal outcome must reconcile the shell out of Working
      // state. `settled` tracks whether a branch already handled the
      // terminal state; the finally is the guarantee for anything that
      // escapes (e.g. a cleanup call itself throwing).
      let settled = false;
      try {
        // ─── CANONICAL PATH — one brain, one RuntimeStore ───
        const gateway = session.getGateway();
        const tools = gateway.getTools();
        const agentStore = session.getStore();

        // ─── Track mission total duration ───
        // The mission lifecycle spans: creation → planning → execution →
        // verification. The agent loop's result.durationMs only covers
        // execution (model + tool calls). The displayed duration must
        // reflect the FULL mission lifecycle, not just the agent loop.
        const missionStartTime = Date.now();

        // ─── Create a REAL Mission in the canonical RuntimeStore ───
        const mission = await agentStore.createMission({
          goal: input,
          mode: session.getMode(),
          projectRoot,
          sessionId: null,
          workspaceId: null,
          metadata: { source: "nl-mission", branch: freshBranch ?? branch ?? "unknown" },
        });
        // Canonical RuntimeStore mission now exists — the durable record
        // tools/evidence attach to. Distinct from cockpit mission_initialized.
        perf.mark("mission_created");

        store.actions.addActivity({
          id: `act_${Date.now()}_mission`,
          ts: Date.now(),
          type: "info",
          tag: "MISSION",
          text: "Mission created",
        });

        const routed = modelRuntime.route(store.state.routingMode, store.state.selectedModel, modelInput);
        perf.mark("route");
        // Routing trace — requested (brain/policy) vs resolved (route()).
        const requestedModel = modelRuntime.brainLabel(store.state.routingMode, store.state.selectedModel);
        store.actions.addActivity({
          id: `act_${Date.now()}_route`,
          ts: Date.now(),
          type: "info",
          tag: "ROUTE",
          text: `${routed.label}`,
        });
        // Set the CONFIGURED model label — the actual ACTIVE model is
        // confirmed after streaming sees the runtime response model.
        store.actions.setActiveModel(routed.label);
        // Resolve the provider adapter from the routing decision.
        // Configured direct (BYOK) keys take precedence over the
        // OpenRouter fallback. See the CHAT path above for the full
        // contract — the same resolver serves both paths so routing
        // truth is identical across CHAT and MISSION.
        // ─── DIAGNOSTIC (MISSION path) — gated by LITT_DIAG=1 ───────
        if (process.env.LITT_DIAG === "1") {
          process.stderr.write(
            `[litt-diag][MISSION] selectedModelId=${store.state.selectedModel ?? "(null)"} ` +
            `routed.id=${routed.id} routed.servedBy=${routed.servedBy} ` +
            `routed.providerModelId=${routed.providerModelId ?? "(none)"} ` +
            `routed.openRouterModelId=${routed.openRouterModelId ?? "(none)"} ` +
            `hasOpenAIKey=${!!process.env.OPENAI_API_KEY} ` +
            `hasOpenRouterKey=${!!process.env.OPENROUTER_API_KEY}\n`,
          );
        }
        const model = resolveProviderAdapter(routed, {
          tools: tools.list(),
        });
        // Truthful label: provider adapter READY, not an outbound request.
        // The actual request fires inside runAgentLoop below.
        perf.mark("provider_ready");
        if (process.env.LITT_DIAG === "1") {
          process.stderr.write(
            `[litt-diag][MISSION] adapter.providerId=${model.providerId} ` +
            `adapter.configuredModel=${model.configuredModel}\n`,
          );
        }
        // Set the ACTUAL served provider from the resolved adapter
        // BEFORE the request starts. `routed.servedBy` is routing
        // intent; `model.providerId` is execution truth. Setting it
        // here (not from servedBy) means the header never lies even if
        // the adapter fell back to OpenRouter or streaming throws early.
        store.actions.setActiveProvider(model.providerId);

        // Persist a streaming assistant message — live preview during
        // the mission. Finalized ONCE with result.content when the loop
        // completes. The mission body is the same canonical response
        // the user sees in CHAT — one brain, one rendering.
        store.actions.addChatMessage({
          role: "assistant",
          content: "",
          ts: Date.now(),
          status: "streaming",
          requestedModel,
          resolvedModel: routed.label,
          servedModel: null,
          fallbackReason: routed.fallbackReason,
        });

        // ─── SEMANTIC PLANNING — plan BEFORE execution ───
        // The model generates a semantic execution plan. planMission()
        // persists it as MissionStep[] on the canonical RuntimeStore
        // BEFORE any tool runs. Tools then execute UNDER an existing
        // semantic step — they do NOT define the step. One step may
        // cover many tool calls; one tool may serve many steps.
        //
        // ─── Smart planning — skip for simple missions ───
        // Simple missions (single-action, bounded scope) skip the
        // ~2.1s planning round and go directly to execution with a
        // default single step. Complex missions use the full planner.
        const complexity = classifyMissionComplexity(input);
        let plan: { source: string; fallbackDomain?: string };
        let plannedSteps: Array<{ id: string; title: string; allowedActionScope: string[] }>;

        if (shouldSkipPlanning(input)) {
          // Simple mission — skip planning, create a default step.
          perf.mark("plan_skipped");
          store.actions.setHoloState("UNDERSTANDING");
          store.actions.addActivity({
            id: `act_${Date.now()}_plan`,
            ts: Date.now(),
            type: "info",
            tag: "PLAN",
            text: `Direct execution (simple mission) — skipping planning round`,
          });

          // Create a single default step on the mission.
          const missionNow = agentStore.getMission();
          if (missionNow) {
            await agentStore.addMissionStep({
              title: input.slice(0, 80),
              description: input,
              allowedActionScope: ["act"],
            });
          }
          plan = { source: "skip", fallbackDomain: undefined };
          const m = agentStore.getMission();
          plannedSteps = (m?.steps ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            allowedActionScope: s.allowedActionScope,
          }));
        } else {
          // Complex mission — use full semantic planning.
          store.actions.setHoloState("UNDERSTANDING");
          store.actions.addActivity({
            id: `act_${Date.now()}_plan`,
            ts: Date.now(),
            type: "info",
            tag: "PLAN",
            text: "Planning mission steps",
          });
          // Semantic planning boundary — planMission may call the model to
          // produce steps. Without this mark the planning round is hidden
          // inside the provider_ready → tool_start span. (plan_first_token
          // is not emitted: planMission does not stream deltas to the
          // controller, so a per-token mark would require architecture
          // changes — out of scope for this instrumentation pass.)
          perf.mark("plan_start");

          const planResult = await planMission({
            model,
            store: agentStore,
            goal: input,
            projectContext: {
              name: projectName ?? "unnamed",
              root: projectRoot,
              branch: freshBranch ?? branch ?? "unknown",
            },
          });
          plan = planResult.plan;
          plannedSteps = planResult.steps as Array<{ id: string; title: string; allowedActionScope: string[] }>;
          perf.mark("plan_end");

          store.actions.addActivity({
            id: `act_${Date.now()}_plansteps`,
            ts: Date.now(),
            type: "info",
            tag: "PLAN",
            text: `Plan (${plan.source}${plan.fallbackDomain ? ` · ${plan.fallbackDomain}` : ""}): ${plannedSteps.length} steps — ${plannedSteps.map((s) => s.title).join(" → ")}`,
          });

          // Fallback plans are unproven (the model failed to plan) — make
          // the safety posture explicit in the activity feed.
          if (plan.source === "fallback") {
            const MUTATION_SCOPES = new Set(["repair", "implement", "act"]);
            const hasMutationStep = plannedSteps.some((s) =>
              s.allowedActionScope.some((scope) => MUTATION_SCOPES.has(scope)),
            );
            store.actions.addActivity({
              id: `act_${Date.now()}_planfallback`,
              ts: Date.now(),
              type: "info",
              tag: "PLAN",
              text: hasMutationStep
                ? "Fallback plan — mutation steps are approval-gated"
                : "Fallback plan is read-only — no automatic mutations",
            });
          }
        }

        // The semantic steps now exist on the canonical mission BEFORE
        // the first tool call. Execution begins; tools attach to steps.
        let currentStepId: string | null = null;

        // ─── Escalation wiring ───
        // Repeated model failures (tool/reasoning) automatically escalate
        // to a stronger verified model and the loop continues. This is the
        // Autopilot reliability path: a weak model that keeps failing gets
        // replaced mid-mission, preserving the same conversation/context.
        const escalationTracker = createEscalationTracker();
        const escalationHook = createEscalationHook(escalationTracker, modelRuntime, "coding");
        // Escalation-swapped models get the SAME native tool schemas —
        // a stronger model must never lose the project tools mid-mission.
        const modelResolver = createModelResolver(modelRuntime, tools.list());

        // ─── Evidence tracker + read-only verification ──────────
        // Read-only inspection missions (no mutation tools called) are
        // verified by their EVIDENCE — a successful project tool result —
        // not by running the full typecheck/test/build gate. Running the
        // full gate for an inspection would hold the mission in RUNNING
        // for minutes and proves nothing about the inspection. Mutating
        // missions keep the full gate.
        const evidenceTracker = createMissionEvidenceTracker(
          new Set(["project.edit_file", "project.write_file", "project.run"]),
        );
        // Stateful fence-aware filter: raw tool_call protocol must never
        // leak into the live chat preview, even split across deltas.
        const toolCallFilter = createToolCallStreamFilter();

        // Agent execution loop boundary — the first outbound provider
        // request and all tool rounds happen inside runAgentLoop. This
        // separates planning (plan_start → plan_end) from execution.
        perf.mark("agent_loop_start");

        const result = await runAgentLoop(modelInput, {
          model, tools, shell: session.getShell(),
          gateway,
          cwd: projectRoot, userId: "cli-user",
          mode: session.getMode(), maxRounds: 10,
          projectContext: {
            name: projectName ?? "unnamed",
            root: projectRoot,
            branch: freshBranch ?? branch ?? "unknown",
          },
          store: agentStore,
          // ─── Wire the VerificationGate into the agent loop ───
          // This is the REAL repair/revalidation path: when the model
          // says "done", the loop runs the gate. If the gate fails,
          // the failures are fed back to the model as a repair request
          // and the loop continues. The model must actually fix the
          // failures and reach a state the runtime can prove.
          // Without this, the loop terminates on model "done" and the
          // controller runs the gate separately — no repair loop.
          // For read-only missions the gate proves EVIDENCE (fast);
          // for mutating missions it delegates to the full gate.
          verificationGate: new MissionVerificationGate({
            fullGate: session.getVerificationGate(),
            store: agentStore,
            emitter: (event) => session.emitAgentEvent(event),
            isReadOnly: evidenceTracker.isReadOnly,
            hasSuccessfulEvidence: evidenceTracker.hasSuccessfulEvidence,
            hasFailedEvidence: evidenceTracker.hasFailedEvidence,
            evidenceSummary: evidenceTracker.summary,
            failedSummary: evidenceTracker.failedSummary,
          }),
          // ─── Wire the EscalationHook into the agent loop ───
          // The mission id + model id + resolver let the loop track
          // per-mission failures and swap to a stronger model when
          // the threshold is reached. The loop continues with the
          // new model — no mission restart, no context loss.
          escalation: escalationHook,
          missionId: mission.id,
          modelId: routed.id,
          modelResolver,
          taskKind: "coding",
          onModelStream: (event) => {
            // Model prose (deltas) do NOT go into the activity feed,
            // but DO stream into the chat transcript as a live preview.
            // Suppress tool_call/json protocol markup — never dump
            // model protocol internals to the transcript.
            if (event.type === "delta") {
              const visible = toolCallFilter.next(event.text);
              if (!visible) return;
              perf.mark("first_token");
              store.actions.appendAssistantDelta(visible);
            }
          },
          onToolStream: (chunk: StreamChunk) => {
            session.emitAgentEvent({
              type: "tool_stream",
              ts: chunk.ts,
              data: { stream: chunk.stream, text: chunk.text },
            });
          },
          emitter: (event: RuntimeEvent) => {
            // Route agent events through the canonical event bus.
            session.emitAgentEvent(event);

            if (event.subtype === "agent_tool_call") {
              const toolId = (event.data as { toolId?: string }).toolId ?? "unknown";
              perf.mark(`tool_start:${toolId}`);
              // The loop emits toolCallId at the event's top level.
              const toolCallId = (event as { toolCallId?: string }).toolCallId
                ?? (event.data as { toolCallId?: string }).toolCallId
                ?? "";
              // Record the tool invocation for honest summaries
              // (e.g. "2 tools used" for read-only missions).
              store.actions.addMissionTool(toolId);

              // Track mutation/evidence state synchronously — the
              // verification gate reads it when the loop calls verify().
              evidenceTracker.recordToolCall(toolId);

              // Attach this tool call to an existing semantic step.
              // resolveStepForTool picks the current working step, or
              // the first pending step whose scope matches the tool,
              // or the first pending step (sequential progression).
              const missionNow = agentStore.getMission();
              if (missionNow) {
                const stepId = resolveStepForTool(missionNow.steps, toolId, currentStepId);
                if (stepId && stepId !== currentStepId) {
                  currentStepId = stepId;
                  agentStore.setCurrentStep(stepId).catch(() => {});
                }
                // Record the tool call against the step's toolHistory.
                // Status is "pending" — the result arrives in
                // agent_tool_result and updates the record truthfully.
                if (stepId && toolCallId) {
                  attachToolToStep(agentStore, stepId, {
                    toolId,
                    toolName: (event.data as { tool?: string }).tool ?? toolId,
                    toolCallId,
                    toolRunId: `agent_${toolCallId}`,
                  }).catch(() => {});
                }
              }

              // Track UI artifacts — projection only, not lifecycle inference.
              const MUTATION_TOOLS = new Set(["project.edit_file", "project.write_file", "project.run"]);
              const EXECUTION_TOOLS = new Set(["project.build", "project.test", "project.typecheck", "project.run"]);
              if (MUTATION_TOOLS.has(toolId)) {
                // Record the REAL file path (inputs.file/path), never the
                // tool id — filesTouched is a file list, not a tool list.
                const inputs = (event.data as { inputs?: Record<string, unknown> }).inputs ?? {};
                const file = typeof inputs.file === "string" ? inputs.file
                  : typeof inputs.path === "string" ? inputs.path
                    : null;
                if (file) {
                  store.actions.addMissionFile(file);
                } else {
                  store.actions.addMissionFile(toolId);
                }
              } else if (EXECUTION_TOOLS.has(toolId)) {
                store.actions.addMissionCommand(toolId);
              }
            } else if (event.subtype === "agent_tool_result") {
              const success = (event.data as { success?: boolean }).success ?? true;
              const toolName = (event.data as { tool?: string }).tool ?? "unknown";
              const toolId = (event.data as { toolId?: string }).toolId ?? "";
              perf.mark(`tool_end:${toolId}`);
              const message = (event.data as { message?: string }).message ?? "";
              const durationMs = (event.data as { durationMs?: number }).durationMs;

              // Record the truthful outcome for the evidence gate.
              evidenceTracker.recordToolResult(toolId, success, message);

              // Record evidence on the current step — tools contribute
              // evidence to the step, they do NOT define the step.
              // Use the canonical evidence type for this tool so step
              // requiredEvidence can be checked.
              if (currentStepId) {
                const evidenceType = toolToEvidenceType(toolId);
                agentStore.addMissionEvidence({
                  stepId: currentStepId,
                  type: evidenceType,
                  source: toolName,
                  summary: message.slice(0, 200),
                  success,
                  metadata: { durationMs, toolName, toolId },
                }).catch(() => {});

                // Update the action record with the truthful result.
                // This transitions the record from "pending" to
                // "success" or "failed". A failed record stays failed.
                const toolCallIdFromCall = (event as { toolCallId?: string }).toolCallId
                  ?? (event.data as { toolCallId?: string }).toolCallId
                  ?? "";
                if (toolCallIdFromCall) {
                  updateToolResultOnStep(agentStore, currentStepId, toolCallIdFromCall, {
                    success,
                    message,
                    durationMs,
                  }).catch(() => {});
                }

                // A failed tool marks the current step as failed.
                if (!success) {
                  agentStore.updateMissionStepStatus(
                    currentStepId,
                    "failed",
                    {
                      failureReason: message.slice(0, 300),
                      verificationPassed: false,
                      verificationEvidence: message.slice(0, 500),
                    },
                  ).catch(() => {});
                } else {
                  // Successful tool — check if the current step's
                  // requiredEvidence is now satisfied. If so, advance
                  // the step (working → passed, open next step).
                  // This is the REAL semantic progression: steps
                  // advance when their evidence contract is met, not
                  // on every tool success.
                  progressMissionStepAfterTool(agentStore, {
                    success: true,
                    toolId,
                  }).then((advanced) => {
                    if (advanced?.openedStepId) {
                      currentStepId = advanced.openedStepId;
                    }
                  }).catch(() => {});
                }
              }
            } else if (event.subtype === "model_escalated") {
              // Escalation event — surface it in the activity feed and
              // update the active model label to the new (stronger) model.
              const fromModelId = (event.data as { fromModelId?: string }).fromModelId ?? "unknown";
              const toModelId = (event.data as { toModelId?: string }).toModelId ?? "unknown";
              const reason = (event.data as { reason?: string }).reason ?? "";
              store.actions.addActivity({
                id: `act_${Date.now()}_escalate`,
                ts: Date.now(),
                type: "info",
                tag: "ESCALATE",
                text: `${fromModelId} → ${toModelId}`,
              });
              store.actions.setActiveModel(toModelId);
              // Log the full reason for audit.
              store.actions.addActivity({
                id: `act_${Date.now()}_escalate_reason`,
                ts: Date.now(),
                type: "info",
                tag: "ESCALATE",
                text: reason.slice(0, 120),
              });
            }
          },
        });

        // When the agent loop finishes, mark the current step passed
        // (the model moved past it) and let the VerificationGate own
        // the final mission COMPLETE/FAILED truth.
        if (currentStepId) {
          const m = agentStore.getMission();
          const step = m?.steps.find((s) => s.id === currentStepId);
          if (step && step.status === "working") {
            await agentStore.updateMissionStepStatus(currentStepId, "passed", {
              verificationPassed: true,
              verificationEvidence: "Agent loop completed this step",
            }).catch(() => {});
          }
        }

        if (model.activeModel) store.actions.setActiveModel(model.activeModel);
        // Re-affirm the served provider post-completion (idempotent —
        // already set pre-stream from model.providerId execution truth).
        store.actions.setActiveProvider(model.providerId);

        // ─── Finalize the assistant message ONCE ───
        // result.content is the canonical final response (tool_call
        // blocks stripped by the agent loop). Persist it exactly once.
        // An empty result.content is rendered as an explicit error —
        // never a blank completed turn.
        {
          const finalContent = result.content.trim()
            ? result.content
            : "LiTT returned an empty response. The mission turn was not completed.";
          const finalStatus: "complete" | "error" =
            result.termination === "complete" ? "complete" : "error";
          perf.mark("finalize");
          store.actions.finalizeAssistantMessage({
            content: finalContent,
            status: finalStatus,
            servedModel: model.activeModel,
            durationMs: result.durationMs,
          });
        }

        // ─── VerificationGate owns completion ───
        // The agent loop already ran the gate (if configured). Use the
        // loop's verification result if available — it contains the
        // repair/revalidation outcome. Only run the gate separately if
        // the loop didn't (e.g. no gate was configured).
        store.actions.setHoloState("VERIFYING");
        store.actions.updateMissionState("VERIFYING");
        store.actions.addActivity({
          id: `act_${Date.now()}_verify`,
          ts: Date.now(),
          type: "info",
          tag: "VERIFY",
          text: "Running verification gate",
        });

        await agentStore.setMissionVerifying();

        let verificationSummary = "Verification not run";
        let missionComplete = false;

        try {
          // Use the loop's verification result if it ran the gate.
          // When the loop terminated WITHOUT running the gate (honest
          // failure report, max rounds) a read-only inspection mission
          // must fail honestly — never fall back to the full build/test
          // gate, which would spend minutes and could "prove" the
          // mission complete via an unrelated passing build.
          const verification: VerificationResult = result.verification
            ? { ...result.verification, message: result.verification.message }
            : evidenceTracker.isReadOnly()
              ? {
                  proven: false,
                  status: "failed",
                  checks: [],
                  totalDurationMs: 0,
                  message: `Repository inspection did not complete (${result.termination}) — no successful tool evidence was collected.`,
                  runId: "verify_not_run",
                  ranChecks: [],
                  skippedChecks: [],
                }
              : await session.verify();
          verificationSummary = verification.message;
          missionComplete = verification.proven;

          await agentStore.addMissionEvidence({
            stepId: null,
            type: "verification_result",
            source: "VerificationGate",
            summary: verification.message,
            success: verification.proven,
            metadata: {
              proven: verification.proven,
              ranChecks: verification.ranChecks,
              skippedChecks: verification.skippedChecks,
              totalDurationMs: verification.totalDurationMs,
              checks: verification.checks.map((c) => ({
                id: c.id,
                status: c.status,
                exitCode: c.exitCode,
                message: c.message,
              })),
            },
          });

          store.actions.addActivity({
            id: `act_${Date.now()}_vresult`,
            ts: Date.now(),
            type: verification.proven ? "verification.passed" : "verification.failed",
            tag: verification.proven ? "PASS" : "FAIL",
            text: verification.proven
              ? `Verification PROVEN — ${verification.ranChecks.join(", ")}`
              : `Verification FAILED — ${verification.checks.filter((c) => c.status !== "skipped" && c.status !== "success").map((c) => c.id).join(", ")}`,
            fullText: verification.message,
          });
        } catch (verifyErr) {
          verificationSummary = `Verification error: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`;
          missionComplete = false;
          store.actions.addActivity({
            id: `act_${Date.now()}_verr`,
            ts: Date.now(),
            type: "error",
            tag: "ERROR",
            text: "Verification gate error",
            fullText: verificationSummary,
          });
        }

        // ─── Mission delta + read-only classification (dogfood P0) ──
        // Compare the terminal git snapshot against the baseline captured
        // at mission start. Pre-existing dirty files are NEVER attributed
        // to this mission. Read-only missions never claim a verification
        // gate ran on code changes.
        {
          const gs = getGitState(projectRoot);
          const delta = computeMissionDelta(
            store.state.missionState?.baselineGitFiles ?? [],
            porcelainPaths(gs.porcelain),
          );
          store.actions.setMissionDelta(delta.changed);
          store.actions.setMissionReadOnly(evidenceTracker.isReadOnly());
        }

        // ─── Mission completion — driven by VerificationGate, not model ───
        // Display the FULL mission duration (creation → verification),
        // not just the agent loop duration. The agent loop's
        // result.durationMs only covers model+tool execution; the
        // mission total includes planning, mission creation, and
        // verification gate time.
        const missionTotalMs = Date.now() - missionStartTime;
        const agentLoopMs = result.durationMs;
        const seconds = (missionTotalMs / 1000).toFixed(1);
        const agentSeconds = (agentLoopMs / 1000).toFixed(1);
        if (missionComplete) {
          // Read-only inspection missions: the plan steps (inspect →
          // verify → report) are satisfied by the collected evidence +
          // the delivered answer. Mark them passed so the canonical
          // mission can honestly reach "complete" instead of stalling
          // at "verifying" (which would resurrect on restart).
          //
          // IMPORTANT: only mark steps complete when there are NO failed
          // objectives. If any tool failed (e.g., weather lookup failed
          // while repo inspection succeeded), the gate returns
          // proven=false and this branch is not reached — the mission
          // fails honestly with a truthful partial-success message.
          if (evidenceTracker.isReadOnly()) {
            await markInspectionStepsComplete(
              agentStore,
              `Inspection verified: ${verificationSummary.slice(0, 120)}`,
            );
          }
          await agentStore.completeMission(
            `Verified by VerificationGate: ${verificationSummary.slice(0, 200)}`,
            verificationSummary,
          );
          store.actions.setHoloState("COMPLETE");
          store.actions.updateMissionState("COMPLETE");
          store.actions.setMissionRuntimeProven(true);
          settled = true;
          store.actions.stopBusy();
          store.actions.addActivity({
            id: `act_${Date.now()}_done`,
            ts: Date.now(),
            type: "agent.complete",
            tag: "DONE",
            text: `Mission verified · ${seconds}s${agentSeconds !== seconds ? ` (agent ${agentSeconds}s)` : ""}`,
            fullText: `Mission ${mission.id} completed with runtime verification.\n${verificationSummary}`,
          });
        } else {
          await agentStore.failMission(
            `Verification not proven: ${verificationSummary.slice(0, 200)}`,
            verificationSummary,
          );
          store.actions.setHoloState("FAILED");
          store.actions.updateMissionState("FAILED");
          store.actions.setMissionRuntimeProven(false);
          settled = true;
          store.actions.stopBusy();
          store.actions.addActivity({
            id: `act_${Date.now()}_done`,
            ts: Date.now(),
            type: "agent.stopped",
            tag: "FAIL",
            text: `Mission not verified · ${seconds}s${agentSeconds !== seconds ? ` (agent ${agentSeconds}s)` : ""}`,
            fullText: `Mission ${mission.id} could not be verified.\nAgent termination: ${result.termination}\n${verificationSummary}`,
          });
        }
        persistSession();
      } catch (err) {
        // Fail-closed planning (MissionPlanningError) is already an
        // honest, user-facing message — surface it verbatim so the
        // planning failure is unmistakable instead of a blank SERVED.
        const errText = err instanceof MissionPlanningError
          ? err.message
          : `Agent error: ${err instanceof Error ? err.message : String(err)}`;
        store.actions.addActivity({
          id: `act_${Date.now()}_err`,
          ts: Date.now(), type: "error", tag: "ERROR",
          text: truncateActivity(errText, 60),
          fullText: err instanceof Error ? `${errText}\nStack: ${err.stack ?? "(no stack)"}` : errText,
        });
        // Finalize the streaming assistant message as an ERROR —
        // never leave it blank or partially streamed.
        perf.mark("finalize");
        store.actions.finalizeAssistantMessage({
          content: errText,
          status: "error",
        });
        store.actions.setHoloState("FAILED");
        store.actions.updateMissionState("FAILED");
        settled = true;
        store.actions.stopBusy();
        // Fail the canonical mission if one was created
        const agentStore = session.getStore();
        const m = agentStore.getMission();
        if (m) {
          await agentStore.failMission(errText).catch(() => {});
        }
      } finally {
        // The canonical transition out of a run — no terminal outcome
        // (success, failed, cancelled, timeout, provider/tool/planning
        // error, transport stall) may leave the shell visually Working.
        if (!settled) {
          store.actions.setIsProcessing(false);
          store.actions.stopBusy();
          store.actions.setHoloState("FAILED");
          store.actions.updateMissionState("FAILED");
        }
      }
      perf.end("mission");
      return;
    }

    // No API key — show heuristic hint
    store.actions.addActivity({
      id: `act_${Date.now()}`,
      ts: Date.now(),
      type: "info",
      text: "Set OPENROUTER_API_KEY to talk to LiTT. Use /commands for direct execution.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, store, onExit, approvalBridge, persistSession, openDiffViewer, newSession, runShipCommit, toggleMode]);

  // Keep submitRef pointing at the latest submit (self-recursion).
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  const handleApproval = useCallback(async (approved: boolean) => {
    const prompt = store.state.approvalPrompt;
    if (!prompt) return;

    store.actions.clearApproval();

    if (approved) {
      store.actions.addActivity({
        id: `act_${Date.now()}`,
        ts: Date.now(),
        type: "approval.granted",
        runId: prompt.runId,
        toolCallId: prompt.toolCallId,
        text: `approved: ${prompt.action}`,
      });
    } else {
      store.actions.addActivity({
        id: `act_${Date.now()}`,
        ts: Date.now(),
        type: "approval.denied",
        runId: prompt.runId,
        toolCallId: prompt.toolCallId,
        text: `denied: ${prompt.action}`,
      });
    }

    // Resolve the gateway's pending approval promise.
    // The gateway will then verifyApproval() → VerifiedApproval → continue.
    // The UI only provides the boolean — never the VerifiedApproval itself.
    approvalBridge.decide(approved);

    // Don't set IDLE here — the gateway execution is still in flight.
    // The submit() callback will set the final holo state when
    // gateway.execute() returns with the actual result.
  }, [store, approvalBridge]);

  return {
    submit,
    handleApproval,
    toggleMode,
    openPalette,
    openContext,
    attachToken,
    openDiffViewer,
    diffRefreshKey,
    revertFile,
    openFileInEditor,
    acceptDiff,
    switchWorkspace,
    restoreSession,
    newSession,
    runShipVerify,
    runShipCommit,
  };
}
