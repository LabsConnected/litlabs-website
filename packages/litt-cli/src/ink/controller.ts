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

import { useCallback, useEffect, useRef } from "react";
import {
  runAgentLoop,
  planMission,
  resolveStepForTool,
  attachToolToStep,
  type RuntimeEvent,
  type StreamChunk,
} from "@litt/agent-core";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { CockpitStore } from "./cockpit-store.js";
import type { ApprovalBridge } from "./approval-bridge.js";
import { OpenRouterModelProvider, hasOpenRouterKey, resolveConfiguredModel, buildModelState, modelDisplayLabel } from "../lib/model-provider.js";
import { routeModel, routingReason, brainLabel, routingModeLabel, MODEL_CATALOG, type ModelChoice } from "../lib/model-routing.js";
import { ProviderRegistry, TelemetryStore } from "../lib/provider-registry.js";
import { classifyIntent, type Intent } from "../lib/intent.js";
import { applyBranchRefresh } from "../lib/project-state.js";

const SLASH_MAP: Record<string, { toolId: string; args: (input: string[]) => { command: string; args: string[] } }> = {
  "/build": { toolId: "project.build", args: () => ({ command: "pnpm", args: ["build"] }) },
  "/check": { toolId: "project.check", args: () => ({ command: "npx", args: ["tsc", "--noEmit"] }) },
  "/test": { toolId: "project.test", args: () => ({ command: "pnpm", args: ["test"] }) },
  "/diff": { toolId: "project.diff", args: () => ({ command: "git", args: ["diff"] }) },
  "/status": { toolId: "project.status", args: () => ({ command: "git", args: ["status"] }) },
  "/run": { toolId: "project.run", args: (input) => ({ command: input[0] ?? "", args: input.slice(1) }) },
};

// classifyIntent is imported from ../lib/intent.js (extracted for testability)

/**
 * Detect if a text chunk is raw tool_call/json markup that should
 * NOT be added to the activity feed. The model streams back fenced
 * code blocks containing tool calls — these are internal protocol,
 * not user-visible content.
 */
function isToolCallMarkup(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Fenced code blocks: ```tool_call, ```json, ```tool_result
  if (trimmed.startsWith("```tool_call") || trimmed.startsWith("```json")
    || trimmed.startsWith("```tool_result") || trimmed.startsWith("```tool")
    || trimmed === "```" || trimmed.startsWith("```")) {
    return true;
  }
  // Raw JSON tool call fragments
  if (trimmed.startsWith('{"tool"') || trimmed.startsWith('{"name"')
    || trimmed.startsWith('{"command"') || trimmed.startsWith('{"type"')) {
    return true;
  }
  // Closing fence
  if (trimmed === "```") return true;
  return false;
}

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

/** Truncate text for activity feed conciseness */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
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
      setTimeout(() => store.actions.setHoloState("IDLE"), 1500);
    } else {
      store.actions.setHoloState("FAILED");
      setTimeout(() => store.actions.setHoloState("IDLE"), 2500);
    }
  } catch (err) {
    store.actions.addActivity({
      id: `act_${Date.now()}`,
      ts: Date.now(),
      type: "error",
      text: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
    });
    store.actions.setHoloState("FAILED");
    setTimeout(() => store.actions.setHoloState("IDLE"), 2000);
  }
}

export interface CockpitControllerOptions {
  session: RuntimeSession;
  store: CockpitStore;
  approvalBridge: ApprovalBridge;
  onExit?: () => void;
  /** Canonical project name (from the same detectProject() call as branch) */
  projectName?: string;
  /** Canonical git branch (from the same detectProject() call as the header) */
  branch?: string;
}

export function useCockpitController({ session, store, approvalBridge, onExit, projectName, branch }: CockpitControllerOptions) {
  // Owner/dev mode: persistent registry + telemetry for /route and /providers
  const providerRegistryRef = useRef<ProviderRegistry | null>(null);
  const telemetryStoreRef = useRef<TelemetryStore | null>(null);
  if (!providerRegistryRef.current) providerRegistryRef.current = new ProviderRegistry(MODEL_CATALOG);
  if (!telemetryStoreRef.current) telemetryStoreRef.current = new TelemetryStore();
  const providerRegistry = providerRegistryRef.current;
  const telemetryStore = telemetryStoreRef.current;

  // Subscribe to approval bridge — when the gateway requests approval,
  // the bridge sets a pending approval and notifies us.
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
      }
    });
  }, [approvalBridge, store]);

  const submit = useCallback(async (input: string) => {
    store.actions.addCommand(input);

    // Handle special commands
    if (input === "/clear") {
      store.actions.setHoloState("IDLE");
      store.actions.clearMission();
      return;
    }
    if (input === "/help") {
      store.actions.addActivity({
        id: `act_${Date.now()}`,
        ts: Date.now(),
        type: "help",
        text: "Commands: /build /check /test /verify /diff /status /run /model /models /litt /palette /activity /route /providers /clear /help",
      });
      return;
    }
    if (input.startsWith("/mode ")) {
      const mode = input.slice(6).trim();
      store.actions.addActivity({
        id: `act_${Date.now()}`,
        ts: Date.now(),
        type: "mode",
        text: `Mode: ${mode}`,
      });
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
      // Show current routing configuration (not just telemetry)
      const mode = store.state.routingMode;
      const selected = store.state.selectedModel;
      const routed = routeModel(mode, selected, "general task");
      const reason = routingReason(routed, "general task");
      const servedBy = providerRegistry.getModelServedBy(routed.id) ?? "unknown";
      const fallback = providerRegistry.getFallbackChain(routed.id, "coding");
      const fallbackLabel = fallback.length > 1 ? fallback[1].label : "none";

      store.actions.addActivity({ id: `act_${Date.now()}_r0`, ts: Date.now(), type: "info", tag: "ROUTE", text: `BRAIN        ${routingModeLabel(mode)}` });
      store.actions.addActivity({ id: `act_${Date.now()}_r1`, ts: Date.now() + 1, type: "info", tag: "ROUTE", text: `ACTIVE       ${routed.label}` });
      store.actions.addActivity({ id: `act_${Date.now()}_r2`, ts: Date.now() + 2, type: "info", tag: "ROUTE", text: `PROVIDER     ${servedBy}` });
      store.actions.addActivity({ id: `act_${Date.now()}_r3`, ts: Date.now() + 3, type: "info", tag: "ROUTE", text: `REASON       ${reason}` });
      store.actions.addActivity({ id: `act_${Date.now()}_r4`, ts: Date.now() + 4, type: "info", tag: "ROUTE", text: `FALLBACK     ${fallbackLabel}` });
      store.actions.addActivity({ id: `act_${Date.now()}_r5`, ts: Date.now() + 5, type: "info", tag: "INFO", text: "Also: /route explain · /route force <model> · /route candidates" });
      return;
    }

    // ─── Owner/dev mode: /providers ─────────────────────────
    if (input === "/providers health") {
      store.actions.addActivity({ id: `act_${Date.now()}_0`, ts: Date.now(), type: "info", text: "Provider Health:" });
      for (const status of providerRegistry.getProviderStatuses()) {
        const healthLabel = status.health.toUpperCase();
        const credLabel = status.hasCredential ? "✓" : "✗";
        const latency = status.latencyMs !== null ? ` ${status.latencyMs}ms` : "";
        const servedVia = status.servedBy !== status.provider.id ? ` (via ${status.servedBy})` : "";
        store.actions.addActivity({
          id: `act_${Date.now()}_p_${status.provider.id}`,
          ts: Date.now(),
          type: "info",
          text: `  ${status.provider.label.padEnd(12)} ${healthLabel.padEnd(14)} cred:${credLabel}${latency}${servedVia}`,
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
          setTimeout(() => store.actions.setHoloState("IDLE"), 1500);
        } else if (result.result.status === "cancelled") {
          store.actions.setHoloState("CANCELLED");
          setTimeout(() => store.actions.setHoloState("IDLE"), 2000);
        } else if (result.result.status === "timeout") {
          store.actions.setHoloState("TIMEOUT");
          setTimeout(() => store.actions.setHoloState("IDLE"), 2000);
        } else {
          store.actions.setHoloState("FAILED");
          setTimeout(() => store.actions.setHoloState("IDLE"), 2000);
        }
      } catch (err) {
        store.actions.addActivity({
          id: `act_${Date.now()}`,
          ts: Date.now(),
          type: "error",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
        store.actions.setHoloState("FAILED");
        setTimeout(() => store.actions.setHoloState("IDLE"), 2000);
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
    const intent = classifyIntent(input);
    const isMission = intent === "mission";

    if (hasOpenRouterKey()) {
      // CHAT intent — casual response, no mission lifecycle.
      // CHAT uses isProcessing (not holoState) to block the composer.
      // holoState stays IDLE throughout — CHAT never enters mission
      // states like UNDERSTANDING/PLANNING/etc.
      if (!isMission) {
        // Refresh branch from the same cwd the tools use — ensures
        // the header branch matches what project.status reports.
        const projectRoot = session.getCwd();
        const freshBranch = refreshBranch(projectRoot, store.state.branch, store.actions.setBranch);

        store.actions.addActivity({
          id: `act_${Date.now()}`,
          ts: Date.now(),
          type: "agent.chat",
          tag: "CHAT",
          text: truncateActivity(input, 40),
          fullText: input,
        });
        // CHAT sets isProcessing, NOT holoState=UNDERSTANDING.
        // holoState stays IDLE — CHAT is not a mission.
        store.actions.setIsProcessing(true);
        try {
          // ─── CANONICAL PATH — one brain, one RuntimeStore ───
          // Reuse the session's canonical ExecutionGateway + RuntimeStore.
          // No ephemeral second store/gateway. Events flow through:
          //   RuntimeStore → SessionEventBridge → EventBridge → CockpitStore
          const gateway = session.getGateway();
          const tools = gateway.getTools();
          const agentStore = session.getStore();
          const routed = routeModel(store.state.routingMode, store.state.selectedModel, input);
          store.actions.addActivity({
            id: `act_${Date.now()}_route`,
            ts: Date.now(),
            type: "info",
            tag: "ROUTE",
            text: `${routed.label}`,
          });
          store.actions.setActiveModel(routed.label);
          const model = new OpenRouterModelProvider({ model: routed.id });

          // Track tool calls for structured activity events.
          // CHAT can call tools (e.g. project.status) but does NOT
          // progress through mission lifecycle states.
          let chatToolCallCount = 0;
          let chatResponseText = "";

          const result = await runAgentLoop(input, {
            model, tools, shell: session.getShell(),
            gateway,
            cwd: projectRoot, userId: "cli-user",
            mode: session.getMode(), maxRounds: 4,
            projectContext: { name: projectName ?? "chat", root: projectRoot, branch: freshBranch ?? branch ?? "unknown" },
            store: agentStore,
            onModelStream: (event) => {
              if (event.type === "delta") {
                // Filter out raw tool_call/json markup — never dump
                // model protocol internals to the activity feed.
                if (isToolCallMarkup(event.text)) return;
                // Accumulate clean response text for a single summary event
                chatResponseText += event.text;
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
          const seconds = (result.durationMs / 1000).toFixed(1);
          // Single concise DONE event — not raw response body
          store.actions.addActivity({
            id: `act_${Date.now()}_done`,
            ts: Date.now(),
            type: result.termination === "complete" ? "agent.complete" : "agent.stopped",
            tag: "CHAT",
            text: `LiTT responded · ${seconds}s${chatToolCallCount > 0 ? ` · ${chatToolCallCount} tools` : ""}`,
          });
          // CHAT complete — clear isProcessing, holoState stays IDLE
          store.actions.setIsProcessing(false);
        } catch (err) {
          const errText = `Agent error: ${err instanceof Error ? err.message : String(err)}`;
          store.actions.addActivity({
            id: `act_${Date.now()}_err`,
            ts: Date.now(), type: "error", tag: "ERROR",
            text: truncateActivity(errText, 60),
            fullText: err instanceof Error ? `${errText}\nStack: ${err.stack ?? "(no stack)"}` : errText,
          });
          // Clear processing on failure too — composer must return to editable
          store.actions.setIsProcessing(false);
          store.actions.setHoloState("FAILED");
          setTimeout(() => store.actions.setHoloState("IDLE"), 2000);
        }
        return;
      }

      // MISSION intent — full agent lifecycle with real Mission state
      // Refresh branch from the same cwd the tools use
      const projectRoot = session.getCwd();
      const freshBranch = refreshBranch(projectRoot, store.state.branch, store.actions.setBranch);

      store.actions.startMission(input);
      store.actions.setHoloState("UNDERSTANDING");
      store.actions.addActivity({
        id: `act_${Date.now()}`,
        ts: Date.now(),
        type: "agent.request",
        tag: "THINK",
        text: "Understanding request",
      });

      try {
        // ─── CANONICAL PATH — one brain, one RuntimeStore ───
        const gateway = session.getGateway();
        const tools = gateway.getTools();
        const agentStore = session.getStore();

        // ─── Create a REAL Mission in the canonical RuntimeStore ───
        const mission = await agentStore.createMission({
          goal: input,
          mode: session.getMode(),
          projectRoot,
          sessionId: null,
          workspaceId: null,
          metadata: { source: "nl-mission", branch: freshBranch ?? branch ?? "unknown" },
        });

        store.actions.addActivity({
          id: `act_${Date.now()}_mission`,
          ts: Date.now(),
          type: "info",
          tag: "MISSION",
          text: `Mission created: ${mission.id}`,
        });

        const routed = routeModel(store.state.routingMode, store.state.selectedModel, input);
        store.actions.addActivity({
          id: `act_${Date.now()}_route`,
          ts: Date.now(),
          type: "info",
          tag: "ROUTE",
          text: `${routed.label}`,
        });
        store.actions.setActiveModel(routed.label);
        const model = new OpenRouterModelProvider({ model: routed.id });

        // ─── SEMANTIC PLANNING — plan BEFORE execution ───
        // The model generates a semantic execution plan. planMission()
        // persists it as MissionStep[] on the canonical RuntimeStore
        // BEFORE any tool runs. Tools then execute UNDER an existing
        // semantic step — they do NOT define the step. One step may
        // cover many tool calls; one tool may serve many steps.
        store.actions.setHoloState("UNDERSTANDING");
        store.actions.addActivity({
          id: `act_${Date.now()}_plan`,
          ts: Date.now(),
          type: "info",
          tag: "PLAN",
          text: "Planning mission steps",
        });

        const { plan, steps: plannedSteps } = await planMission({
          model,
          store: agentStore,
          goal: input,
          projectContext: {
            name: projectName ?? "unnamed",
            root: projectRoot,
            branch: freshBranch ?? branch ?? "unknown",
          },
        });

        store.actions.addActivity({
          id: `act_${Date.now()}_plansteps`,
          ts: Date.now(),
          type: "info",
          tag: "PLAN",
          text: `Plan (${plan.source}): ${plannedSteps.length} steps — ${plannedSteps.map((s) => s.title).join(" → ")}`,
        });

        // The semantic steps now exist on the canonical mission BEFORE
        // the first tool call. Execution begins; tools attach to steps.
        let currentStepId: string | null = null;

        const result = await runAgentLoop(input, {
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
          onModelStream: (event) => {
            // Model prose (deltas) do NOT go into the activity feed.
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
              const toolCallId = (event.data as { toolCallId?: string }).toolCallId ?? "";

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
                if (stepId && toolCallId) {
                  attachToolToStep(agentStore, stepId, {
                    toolId,
                    toolName: (event.data as { tool?: string }).tool ?? toolId,
                    toolCallId,
                    success: true, // updated on result
                    message: "",
                  }).catch(() => {});
                }
              }

              // Track UI artifacts — projection only, not lifecycle inference.
              const MUTATION_TOOLS = new Set(["project.edit_file", "project.write_file", "project.run"]);
              const EXECUTION_TOOLS = new Set(["project.build", "project.test", "project.typecheck", "project.run"]);
              if (MUTATION_TOOLS.has(toolId)) {
                store.actions.addMissionFile(toolId);
              } else if (EXECUTION_TOOLS.has(toolId)) {
                store.actions.addMissionCommand(toolId);
              }
            } else if (event.subtype === "agent_tool_result") {
              const success = (event.data as { success?: boolean }).success ?? true;
              const toolName = (event.data as { tool?: string }).tool ?? "unknown";
              const message = (event.data as { message?: string }).message ?? "";
              const durationMs = (event.data as { durationMs?: number }).durationMs;

              // Record evidence on the current step — tools contribute
              // evidence to the step, they do NOT define the step.
              if (currentStepId) {
                agentStore.addMissionEvidence({
                  stepId: currentStepId,
                  type: "command_result",
                  source: toolName,
                  summary: message.slice(0, 200),
                  success,
                  metadata: { durationMs, toolName },
                }).catch(() => {});

                // A step transitions to passed/failed only when the
                // model advances past it (next step starts) or when a
                // clear pass/fail signal arrives. We do NOT mark a
                // step passed on every successful tool — a step may
                // require several tools. Instead, when a tool FAILS,
                // we record the failure on the step. The step is
                // marked passed when the NEXT step starts (the model
                // moved on) or when verification proves it.
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
                }
              }
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

        // ─── VerificationGate owns completion ───
        store.actions.setHoloState("VERIFYING");
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
          const verification = await session.verify();
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

        // ─── Mission completion — driven by VerificationGate, not model ───
        const seconds = (result.durationMs / 1000).toFixed(1);
        if (missionComplete) {
          await agentStore.completeMission(
            `Verified by VerificationGate: ${verificationSummary.slice(0, 200)}`,
            verificationSummary,
          );
          store.actions.setHoloState("COMPLETE");
          store.actions.updateMissionState("COMPLETE");
          store.actions.setMissionRuntimeProven(true);
          store.actions.addActivity({
            id: `act_${Date.now()}_done`,
            ts: Date.now(),
            type: "agent.complete",
            tag: "DONE",
            text: `Mission COMPLETE (verified) · ${result.rounds}r · ${result.toolCalls.length}t · ${seconds}s`,
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
          store.actions.addActivity({
            id: `act_${Date.now()}_done`,
            ts: Date.now(),
            type: "agent.stopped",
            tag: "FAIL",
            text: `Mission NOT verified · ${result.rounds}r · ${result.toolCalls.length}t · ${seconds}s`,
            fullText: `Mission ${mission.id} could not be verified.\nAgent termination: ${result.termination}\n${verificationSummary}`,
          });
        }
      } catch (err) {
        const errText = `Agent error: ${err instanceof Error ? err.message : String(err)}`;
        store.actions.addActivity({
          id: `act_${Date.now()}_err`,
          ts: Date.now(), type: "error", tag: "ERROR",
          text: truncateActivity(errText, 60),
          fullText: err instanceof Error ? `${errText}\nStack: ${err.stack ?? "(no stack)"}` : errText,
        });
        store.actions.setHoloState("FAILED");
        store.actions.updateMissionState("FAILED");
        // Fail the canonical mission if one was created
        const agentStore = session.getStore();
        const m = agentStore.getMission();
        if (m) {
          await agentStore.failMission(errText).catch(() => {});
        }
      }
      return;
    }

    // No API key — show heuristic hint
    store.actions.addActivity({
      id: `act_${Date.now()}`,
      ts: Date.now(),
      type: "info",
      text: "Set OPENROUTER_API_KEY to talk to LiTT. Use /commands for direct execution.",
    });
  }, [session, store, onExit, approvalBridge]);

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

  return { submit, handleApproval };
}
