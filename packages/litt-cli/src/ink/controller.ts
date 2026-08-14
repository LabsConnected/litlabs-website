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
 */

import { useCallback } from "react";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { CockpitStore, HoloState } from "./cockpit-store.js";
import { hasOpenRouterKey } from "../lib/model-provider.js";

const SLASH_MAP: Record<string, { toolId: string; args: (input: string[]) => { command: string; args: string[] } }> = {
  "/build": { toolId: "project.build", args: () => ({ command: "pnpm", args: ["build"] }) },
  "/check": { toolId: "project.check", args: () => ({ command: "npx", args: ["tsc", "--noEmit"] }) },
  "/test": { toolId: "project.test", args: () => ({ command: "pnpm", args: ["test"] }) },
  "/diff": { toolId: "project.diff", args: () => ({ command: "git", args: ["diff"] }) },
  "/status": { toolId: "project.status", args: () => ({ command: "git", args: ["status"] }) },
  "/run": { toolId: "project.run", args: (input) => ({ command: input[0] ?? "", args: input.slice(1) }) },
};

export interface CockpitControllerOptions {
  session: RuntimeSession;
  store: CockpitStore;
  onExit?: () => void;
}

export function useCockpitController({ session, store, onExit }: CockpitControllerOptions) {
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
        text: "Commands: /build /check /test /diff /status /run /ask /clear /help",
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
        const result = await gateway.execute({
          toolId: mapping.toolId,
          inputs: { command, args },
          cwd: process.cwd(),
          mode: session.getMode(),
          identity: {
            tenantId: "cli-tenant",
            userId: "cli-user",
            actorId: "cli-user",
            trusted: false,
            interaction: "interactive",
          },
        });

        if (result.policyEffect === "require_approval" && !result.result.success) {
          // Approval was required but not granted — show approval prompt
          store.actions.setApprovalPrompt({
            runId: result.runId,
            toolCallId: result.toolCallId,
            toolId: mapping.toolId,
            action: `${command} ${args.join(" ")}`,
            risk: "elevated",
            scope: "project",
          });
          store.actions.setHoloState("APPROVAL");
        } else if (result.result.success) {
          store.actions.setHoloState("SUCCESS");
          setTimeout(() => store.actions.setHoloState("IDLE"), 1500);
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
      // The gateway will verifyApproval() and create the VerifiedApproval
      // The UI only provides the human decision — never the VerifiedApproval itself
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

    store.actions.setHoloState("IDLE");
  }, [store]);

  return { submit, handleApproval };
}
