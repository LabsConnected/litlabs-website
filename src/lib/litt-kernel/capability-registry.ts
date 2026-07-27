/**
 * LiTT Capability Registry
 *
 * Maintains a verified capability graph. Capabilities are NEVER inferred
 * from env vars, component renders, or LLM claims — they must be probed
 * from real server or browser state.
 *
 * This registry merges:
 *   - server-side capabilities (from /api/capabilities — DB lookups)
 *   - client-side capabilities (from useTerminalStore — real PTY state)
 *
 * See docs/litt/17-capability-graph/ (scaffolded) and
 * docs/litt/00-constitution/principles.md (Principle 1 & 6).
 */

import type { CapabilityRecord, CapabilityState } from "./types";
import { getCapabilityState, isCapabilityReady, verifyRequiredCapabilities } from "./principles";

// ─── Registry ───────────────────────────────────────────────────

/**
 * The capability registry holds the current verified state of all
 * capabilities. It is updated by probes (server or client) and read
 * by the Kernel before execution.
 *
 * In Phase 1, this is an in-memory singleton. In later phases, it
 * becomes a DB-backed store with TTLs and background refresh.
 */
class CapabilityRegistry {
  private records = new Map<string, CapabilityRecord>();
  private listeners = new Set<(id: string, newState: CapabilityState) => void>();

  /**
   * Registers or updates a capability record.
   * The verifiedAt timestamp is set to now.
   */
  register(record: Omit<CapabilityRecord, "verifiedAt"> & { verifiedAt?: string }): void {
    const full: CapabilityRecord = {
      ...record,
      verifiedAt: record.verifiedAt ?? new Date().toISOString(),
    };
    const previous = this.records.get(record.id);
    this.records.set(record.id, full);
    if (previous && previous.state !== full.state) {
      this.notify(record.id, full.state);
    }
  }

  /**
   * Bulk-sets capabilities from a probe result.
   * Capabilities not in the list are NOT removed (they may be probed
   * by a different source). Use expireAll() to mark stale.
   */
  registerMany(records: CapabilityRecord[]): void {
    for (const r of records) this.register(r);
  }

  /**
   * Returns all registered capability records.
   */
  getAll(): CapabilityRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Returns a single capability by ID, or undefined.
   */
  get(id: string): CapabilityRecord | undefined {
    return this.records.get(id);
  }

  /**
   * Returns the verified state of a capability.
   * Falls back to "unknown" — NEVER to "ready" — when not found.
   */
  state(id: string): CapabilityState {
    return getCapabilityState(this.getAll(), id);
  }

  /**
   * Returns true only if the capability is verified-ready.
   */
  ready(id: string): boolean {
    return isCapabilityReady(this.get(id));
  }

  /**
   * Verifies that all required capabilities are ready.
   * Returns the first missing/unverified capability, or null if all OK.
   */
  verify(requiredIds: string[]) {
    return verifyRequiredCapabilities(this.getAll(), requiredIds);
  }

  /**
   * Marks all capabilities as "unknown" — used when probes are stale.
   * Does NOT remove them; they can be re-verified.
   */
  expireAll(): void {
    for (const [id, record] of this.records) {
      if (record.state === "ready") {
        this.records.set(id, { ...record, state: "unknown", reason: "Probe data expired" });
        this.notify(id, "unknown");
      }
    }
  }

  /**
   * Subscribes to capability state changes.
   */
  onChange(listener: (id: string, newState: CapabilityState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(id: string, newState: CapabilityState): void {
    for (const listener of this.listeners) {
      try {
        listener(id, newState);
      } catch {
        // Listener errors are non-fatal
      }
    }
  }

  /**
   * Clears all records — used in tests.
   */
  clear(): void {
    this.records.clear();
    this.listeners.clear();
  }
}

// ─── Singleton ──────────────────────────────────────────────────

/**
 * Server-side singleton. On the client, a separate instance is created
 * (since the client probes different capabilities — PTY, mic, camera).
 *
 * In the API route, import this to read server-side capabilities.
 * On the client, use the client-side registry (Phase 2).
 */
export const serverCapabilityRegistry = new CapabilityRegistry();

// ─── Capability ID constants ────────────────────────────────────

/**
 * Canonical capability IDs. Use these instead of string literals to
 * avoid typos and enable refactoring.
 */
export const CAP = {
  VOICE: "voice",
  MICROPHONE: "microphone",
  TTS: "tts",
  CAMERA: "camera",
  SCREEN_CAPTURE: "screen_capture",
  BROWSER: "browser",
  WEB_SEARCH: "web_search",
  MEMORY: "memory",
  GITHUB: "github",
  FILESYSTEM: "filesystem",
  PROJECT_WORKSPACE: "project_workspace",
  PTY: "pty",
  DOCKER: "docker",
  SUPABASE: "supabase",
  STRIPE: "stripe",
  CLOUDFLARE: "cloudflare",
  VERCEL: "vercel",
  IMAGE_GENERATION: "image_generation",
  VIDEO_GENERATION: "video_generation",
  AUDIO_GENERATION: "audio_generation",
  DEPLOYMENT: "deployment",
} as const;

// ─── Adapter: from /api/capabilities response ───────────────────

/**
 * Converts the legacy /api/capabilities response (flat array of
 * { id, name, status, accountName, lastVerifiedAt }) into
 * CapabilityRecord objects for the registry.
 *
 * Legacy statuses: "not_configured", "ready", "unavailable", "running"
 * Kernel states:   "unknown",    "ready", "unavailable", "connecting"
 */
export function adaptLegacyCapability(raw: {
  id: string;
  name?: string;
  status: string;
  accountName?: string;
  lastVerifiedAt?: string;
}): CapabilityRecord {
  const stateMap: Record<string, CapabilityState> = {
    ready: "ready",
    running: "connecting",
    unavailable: "unavailable",
    not_configured: "unknown",
    degraded: "degraded",
    limited: "limited",
  };
  return {
    id: raw.id,
    category: raw.name ?? raw.id,
    state: stateMap[raw.status] ?? "unknown",
    verifiedAt: raw.lastVerifiedAt ?? new Date().toISOString(),
    provider: raw.accountName,
    permissions: [],
    dependencies: [],
  };
}
