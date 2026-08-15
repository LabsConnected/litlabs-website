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
  accumulateStreamChunks,
  processStreamChunk,
  ToolRegistry,
  createShellExecutor,
  CommandExecutor,
  RuntimeStore,
  ExecutionGateway,
  type RuntimeEvent,
  type StreamChunk,
  type StreamParserState,
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
  if (providerRegistryRef.current == null) providerRegistryRef.current = new ProviderRegistry(MODEL_CATALOG);
  if (telemetryStoreRef.current == null) telemetryStoreRef.current = new TelemetryStore();
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

        store.actions.setAssistantResponse("", true);

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
          const tools = new ToolRegistry();
          const shell = createShellExecutor(projectRoot);
          const agentStore = new RuntimeStore();
          const executor = new CommandExecutor(shell, agentStore);
          const gateway = new ExecutionGateway({
            tools, shell, executor, store: agentStore,
            projectId: projectRoot,
            onApprovalRequired: (req, risk) => approvalBridge.request(req, risk),
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

          // Track tool calls for structured activity events.
          // CHAT can call tools (e.g. project.status) but does NOT
          // progress through mission lifecycle states.
          let chatToolCallCount = 0;
          let chatResponseText = "";

          const result = await runAgentLoop(input, {
            model, tools, shell, gateway,
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
                store.actions.setAssistantResponse(chatResponseText, true);
              }
            },
            onToolStream: (chunk: StreamChunk) => {
              // Only show stderr in activity — stdout is too noisy
              if (chunk.stream === "stderr") {
                store.actions.addActivity({
                  id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  ts: chunk.ts,
                  type: "tool.stderr",
                  text: truncateActivity(chunk.text, 60),
                  fullText: chunk.text,
                  stream: chunk.stream,
                });
              }
            },
            emitter: (event: RuntimeEvent) => {
              // CHAT tool calls get structured events but NO mission state changes
              if (event.subtype === "agent_tool_call") {
                chatToolCallCount++;
                const toolId = (event.data as { toolId?: string }).toolId ?? "unknown";
                const toolCallId = (event.data as { toolCallId?: string }).toolCallId ?? `tc_${chatToolCallCount}`;
                store.actions.addActivity({
                  id: `act_${Date.now()}_tc`,
                  ts: Date.now(),
                  type: "tool.started",
                  tag: toolId.includes("read") ? "READ" : toolId.includes("edit") ? "EDIT" : toolId.includes("status") ? "STATUS" : "RUN",
                  text: toolId,
                  toolCallId,
                });
              } else if (event.subtype === "agent_tool_result") {
                const success = (event.data as { success?: boolean }).success;
                const toolCallId = (event.data as { toolCallId?: string }).toolCallId;
                store.actions.addActivity({
                  id: `act_${Date.now()}_tr`,
                  ts: Date.now(),
                  type: success ? "tool.completed" : "tool.failed",
                  tag: success ? "PASS" : "FAIL",
                  text: success ? "Tool completed" : "Tool failed",
                  toolCallId,
                });
              }
            },
          });
          if (model.activeModel) store.actions.setActiveModel(model.activeModel);
          store.actions.setAssistantResponse(
            chatResponseText.trim() || "LiTT completed without a text response.",
            false,
          );

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
          store.actions.setAssistantResponse(errText, false);

          // Clear processing on failure too — composer must return to editable
          store.actions.setIsProcessing(false);
          store.actions.setHoloState("FAILED");
          setTimeout(() => store.actions.setHoloState("IDLE"), 2000);
        }
        return;
      }

      // MISSION intent — full agent lifecycle with progress + steps
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
        const tools = new ToolRegistry();
        const shell = createShellExecutor(projectRoot);
        const agentStore = new RuntimeStore();
        const executor = new CommandExecutor(shell, agentStore);
        const gateway = new ExecutionGateway({
          tools, shell, executor, store: agentStore,
          projectId: projectRoot,
          onApprovalRequired: (req, risk) => approvalBridge.request(req, risk),
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

        let missionToolCallCount = 0;
        let missionResponseText = "";
        // Chunks accumulated from the model stream, processed through the
        // stateful parser to filter raw protocol from presentation-safe text.
        const currentChunks: string[] = [];
        // Tool calls parsed from the model stream — dispatched internally,
        // never visible in the assistant response.
        const parsedToolCalls: any[] = [];

        store.actions.setAssistantResponse("", true);

        const result = await runAgentLoop(input, {
          model, tools, shell, gateway,
          cwd: projectRoot, userId: "cli-user",
          mode: session.getMode(), maxRounds: 10,
          projectContext: {
            name: projectName ?? "unnamed",
            root: projectRoot,
            branch: freshBranch ?? branch ?? "unknown",
          },
          store: agentStore,
          onModelStream: (event) => {
            if (event.type === "delta") {
              // Accumulate chunks through the stateful parser for protocol filtering.
              // Raw model protocol is never exposed to the presentation surface.
              currentChunks.push(event.text);
              const accumulated = accumulateStreamChunks(currentChunks);
              missionResponseText = accumulated.finalSafeText;
              // Dispatch any parsed tool calls internally (not visible in UI)
              parsedToolCalls.push(...accumulated.allToolCalls);
              store.actions.setAssistantResponse(
                missionResponseText,
                true,
              );
            }
          },
          onToolStream: (chunk: StreamChunk) => {
            // Tool stdout/stderr — only show stderr lines (errors are
            // operationally relevant). stdout is too noisy for the feed.
            if (chunk.stream === "stderr") {
              store.actions.addActivity({
                id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                ts: chunk.ts,
                type: "tool.stderr",
                text: truncateActivity(chunk.text, 60),
                fullText: chunk.text,
                stream: chunk.stream,
              });
            }
          },
          emitter: (event: RuntimeEvent) => {
            if (event.subtype === "agent_tool_call") {
              missionToolCallCount++;
              const toolId = (event.data as { toolId?: string }).toolId ?? "unknown";
              const toolCallId = (event.data as { toolCallId?: string }).toolCallId ?? `tc_${missionToolCallCount}`;
              // Track mission lifecycle based on tool type
              if (toolId.includes("read") || toolId.includes("inspect")) {
                store.actions.setHoloState("READING");
                store.actions.updateMissionState("READING");
              } else if (toolId.includes("edit") || toolId.includes("write")) {
                store.actions.setHoloState("EDITING");
                store.actions.updateMissionState("EDITING");
                store.actions.addMissionFile(toolId);
              } else if (toolId.includes("build") || toolId.includes("run")) {
                store.actions.setHoloState("RUNNING");
                store.actions.updateMissionState("RUNNING");
                store.actions.addMissionCommand(toolId);
              } else if (toolId.includes("test")) {
                store.actions.setHoloState("TESTING");
                store.actions.updateMissionState("TESTING");
                store.actions.addMissionCommand(toolId);
              } else if (toolId.includes("verify") || toolId.includes("check")) {
                store.actions.setHoloState("VERIFYING");
                store.actions.updateMissionState("VERIFYING");
              }
              store.actions.addActivity({
                id: `act_${Date.now()}_tc`,
                ts: Date.now(),
                type: "tool.started",
                tag: toolId.includes("read") ? "READ" : toolId.includes("edit") ? "EDIT" : toolId.includes("status") ? "STATUS" : toolId.includes("verify") || toolId.includes("check") ? "VERIFY" : "RUN",
                text: toolId,
                toolCallId,
              });
            } else if (event.subtype === "agent_tool_result") {
              const success = (event.data as { success?: boolean }).success;
              const toolCallId = (event.data as { toolCallId?: string }).toolCallId;
              store.actions.addActivity({
                id: `act_${Date.now()}_tr`,
                ts: Date.now(),
                type: success ? "tool.completed" : "tool.failed",
                tag: success ? "PASS" : "FAIL",
                text: success ? "Tool completed" : "Tool failed",
                toolCallId,
              });
            }
          },
        });

        if (model.activeModel) store.actions.setActiveModel(model.activeModel);

        const seconds = (result.durationMs / 1000).toFixed(1);
        store.actions.setAssistantResponse(
          missionResponseText.trim() ||
            (result.termination === "complete"
              ? "Mission complete."
              : "Mission stopped."),
          false,
        );

        const doneText = `Mission ${result.termination === "complete" ? "complete" : "stopped"} · ${result.rounds}r · ${result.toolCalls.length}t · ${seconds}s`;
        store.actions.addActivity({
          id: `act_${Date.now()}_done`,
          ts: Date.now(),
          type: result.termination === "complete" ? "agent.complete" : "agent.stopped",
          tag: result.termination === "complete" ? "DONE" : "STOP",
          text: doneText,
          fullText: `${doneText}\nRounds: ${result.rounds}\nTool calls: ${result.toolCalls.length}\nDuration: ${result.durationMs}ms\nTermination: ${result.termination}`,
        });

        // Mission complete — set COMPLETE state (retained for display)
        if (result.termination === "complete") {
          store.actions.setHoloState("COMPLETE");
          store.actions.updateMissionState("COMPLETE");
        } else {
          store.actions.setHoloState("IDLE");
          store.actions.clearMission();
        }
      } catch (err) {
        const errText = `Agent error: ${err instanceof Error ? err.message : String(err)}`;
        store.actions.addActivity({
          id: `act_${Date.now()}_err`,
          ts: Date.now(), type: "error", tag: "ERROR",
          text: truncateActivity(errText, 60),
          fullText: err instanceof Error ? `${errText}\nStack: ${err.stack ?? "(no stack)"}` : errText,
        });
        store.actions.setAssistantResponse(errText, false);
        store.actions.setHoloState("FAILED");
        store.actions.updateMissionState("FAILED");
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
