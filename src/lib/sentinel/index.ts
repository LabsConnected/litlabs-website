/**
 * Sentinel — public surface.
 *
 * startSentinel() is called once from instrumentation register() on
 * server boot (nodejs runtime). The interval is unref'd so it never
 * keeps a process alive, and it is idempotent per process.
 */

export { runSentinelPass, getSentinelSnapshot, planRemediation } from "./run";
export { evaluateTransition, mapAiProviderProbe, SENTINEL_SERVICE_IDS } from "./state";
export {
  proposeRepairCandidate,
  transitionRepairCandidate,
  loadRepairCandidates,
  repairSignature,
  sanitizeDiagnosticText,
  REPAIR_COOLDOWN_MS,
} from "./repairs";
export type { RepairCandidate, RepairCandidateState } from "./repairs";
export { acquireLeaderLease, sentinelHolderId } from "./leader";
export type {
  ProbeResult,
  SentinelEvent,
  SentinelIncident,
  SentinelLevel,
  SentinelRemediation,
  SentinelServiceId,
  SentinelSnapshot,
  ServiceState,
} from "./types";

import { runSentinelPass } from "./run";

const DEFAULT_INTERVAL_MS = 60_000;

const sentinelGlobal = globalThis as unknown as {
  __littSentinel?: ReturnType<typeof setInterval>;
  __littSentinelRunning?: boolean;
};

function intervalMs(): number {
  const raw = Number(process.env.SENTINEL_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 5_000 ? raw : DEFAULT_INTERVAL_MS;
}

/**
 * Start the periodic Sentinel pass (idempotent per process).
 * Runs one pass immediately, then every SENTINEL_INTERVAL_MS
 * (default 60s, min 5s). Returns true when this call started it.
 */
export function startSentinel(): boolean {
  if (process.env.SENTINEL_DISABLED === "1") return false;
  if (sentinelGlobal.__littSentinel) return false;
  sentinelGlobal.__littSentinelRunning = true;

  const tick = () => {
    if (sentinelGlobal.__littSentinelRunning === false) return;
    void runSentinelPass().catch((err) => {
      console.error("[sentinel] pass failed:", err);
    });
  };

  tick();
  const timer = setInterval(tick, intervalMs());
  (timer as { unref?: () => void }).unref?.();
  sentinelGlobal.__littSentinel = timer;
  return true;
}

/** Stop the Sentinel loop (tests / graceful shutdown). */
export function stopSentinel(): void {
  sentinelGlobal.__littSentinelRunning = false;
  if (sentinelGlobal.__littSentinel) {
    clearInterval(sentinelGlobal.__littSentinel);
    sentinelGlobal.__littSentinel = undefined;
  }
}
