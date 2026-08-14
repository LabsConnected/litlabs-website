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

import { useCallback, useEffect } from "react";
import {
  runAgentLoop,
  ToolRegistry,
  createShellExecutor,
  CommandExecutor,
  RuntimeStore,
  ExecutionGateway,
  type RuntimeEvent,
  type StreamChunk,
} from "@litt/agent-core";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { CockpitStore } from "./cockpit-store.js";
import type { ApprovalBridge } from "./approval-bridge.js";
import { OpenRouterModelProvider, hasOpenRouterKey, resolveConfiguredModel, buildModelState, modelDisplayLabel } from "../lib/model-provider.js";
import { detectProject } from "../lib/utils.js";

const SLASH_MAP: Record<string, { toolId: string; args: (input: string[]) => { command: string; args: string[] } }> = {
  "/build": { toolId: "project.build", args: () => ({ command: "pnpm", args: ["build"] }) },
  "/check": { toolId: "project.check", args: () => ({ command: "npx", args: ["tsc", "--noEmit"] }) },
  "/test": { toolId: "project.test", args: () => ({ command: "pnpm", args: ["test"] }) },
  "/diff": { toolId: "project.diff", args: () => ({ command: "git", args: ["diff"] }) },
  "/status": { toolId: "project.status", args: () => ({ command: "git", args: ["status"] }) },
  "/run": { toolId: "project.run", args: (input) => ({ command: input[0] ?? "", args: input.slice(1) }) },
};

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
      store.actions.setHoloState("SUCCESS");
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
}

export function useCockpitController({ session, store, approvalBridge, onExit }: CockpitControllerOptions) {
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
      return;
    }
    if (input === "/help") {
      store.actions.addActivity({
        id: `act_${Date.now()}`,
        ts: Date.now(),
        type: "help",
        text: "Commands: /build /check /test /verify /diff /status /run /ask /clear /help",
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
          store.actions.setHoloState("SUCCESS");
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
    if (hasOpenRouterKey()) {
      store.actions.setHoloState("THINKING");
      store.actions.setMission(input);
      store.actions.addActivity({
        id: `act_${Date.now()}`,
        ts: Date.now(),
        type: "agent.request",
        text: `LiTT ❯ ${input}`,
      });

      try {
        // Build the agent loop with the session's gateway and tools
        const project = detectProject();
        const projectRoot = session.getCwd();
        const tools = new ToolRegistry();
        const shell = createShellExecutor(projectRoot);
        const agentStore = new RuntimeStore();
        const executor = new CommandExecutor(shell, agentStore);
        const gateway = new ExecutionGateway({
          tools,
          shell,
          executor,
          store: agentStore,
          projectId: projectRoot,
          onApprovalRequired: (req, risk) => approvalBridge.request(req, risk),
        });

        // Use selected model if set, otherwise resolve from config
        const modelId = store.state.selectedModel ?? undefined;
        const model = new OpenRouterModelProvider({ model: modelId });

        const result = await runAgentLoop(input, {
          model,
          tools,
          shell,
          gateway,
          cwd: projectRoot,
          userId: "cli-user",
          mode: session.getMode(),
          maxRounds: 10,
          projectContext: {
            name: String(project.packageJson?.name ?? "unnamed"),
            root: project.rootDir,
            branch: project.gitBranch ?? "unknown",
          },
          store: agentStore,
          onModelStream: (event) => {
            if (event.type === "delta") {
              store.actions.addActivity({
                id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                ts: Date.now(),
                type: "agent.delta",
                text: event.text,
              });
            }
          },
          onToolStream: (chunk: StreamChunk) => {
            store.actions.addActivity({
              id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              ts: chunk.ts,
              type: chunk.stream === "stderr" ? "tool.stderr" : "tool.stdout",
              text: chunk.text,
              stream: chunk.stream,
            });
          },
          emitter: (event: RuntimeEvent) => {
            if (event.subtype === "agent_tool_call") {
              const toolId = (event.data as { toolId?: string }).toolId ?? "unknown";
              store.actions.addActivity({
                id: `act_${Date.now()}`,
                ts: Date.now(),
                type: "tool.started",
                text: `○ Tool call: ${toolId}`,
              });
            } else if (event.subtype === "agent_tool_result") {
              const success = (event.data as { success?: boolean }).success;
              store.actions.addActivity({
                id: `act_${Date.now()}`,
                ts: Date.now(),
                type: success ? "tool.completed" : "tool.failed",
                text: success ? "✓ Tool result" : "✗ Tool failed",
              });
            }
          },
        });

        // Update model state with the actually-used model
        if (model.activeModel) {
          store.actions.setSelectedModel(model.activeModel);
        }

        store.actions.addActivity({
          id: `act_${Date.now()}`,
          ts: Date.now(),
          type: result.termination === "complete" ? "agent.complete" : "agent.stopped",
          text: `LiTT ■ completed (${result.rounds} rounds, ${result.toolCalls.length} tool calls, ${result.durationMs}ms)`,
        });

        store.actions.setHoloState(result.termination === "complete" ? "SUCCESS" : "IDLE");
        setTimeout(() => {
          store.actions.setHoloState("IDLE");
          store.actions.setMission(null);
        }, 1500);
      } catch (err) {
        store.actions.addActivity({
          id: `act_${Date.now()}`,
          ts: Date.now(),
          type: "error",
          text: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
        });
        store.actions.setHoloState("FAILED");
        setTimeout(() => store.actions.setHoloState("IDLE"), 2000);
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
