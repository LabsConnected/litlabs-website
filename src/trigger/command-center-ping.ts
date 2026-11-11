import { task } from "@trigger.dev/sdk";

// Phase Two isolated integration-test task (see
// n8n-trigger-phase2-test-package-2026-10-17.md). Deliberately inert:
// no network calls, no secrets, no side effects — it only echoes the
// probe id back (mode "ok") or throws so retry behavior is observable
// (mode "fail").
export const commandCenterPing = task({
  id: "command-center-ping",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 5000,
    factor: 2,
  },
  run: async (payload: { probeId: string; mode: "ok" | "fail" }) => {
    if (payload.mode === "fail") {
      throw new Error(
        `command-center-ping failure probe (probeId: ${payload.probeId})`,
      );
    }
    return { probeId: payload.probeId, pong: true, ts: Date.now() };
  },
});
