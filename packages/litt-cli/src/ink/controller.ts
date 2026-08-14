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
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { CockpitStore } from "./cockpit-store.js";
import type { ApprovalBridge } from "./approval-bridge.js";
import { hasOpenRouterKey } from "../lib/model-provider.js";

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

    // Natural language → agent loop (if API key available)
    if (hasOpenRouterKey()) {
      store.actions.setHoloState("THINKING");
      // The agent loop is invoked by the caller — we just set state
      // The actual agent invocation happens in app.tsx via onAgentRequest
      return;
    }

    // No API key — show heuristic hint
    store.actions.addActivity({
      id: `act_${Date.now()}`,
      ts: Date.now(),
      type: "info",
      text: "Set OPENROUTER_API_KEY for agent mode. Use /commands for direct execution.",
    });
  }, [session, store, onExit]);

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
