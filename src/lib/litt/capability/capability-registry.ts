/**
 * CapabilityRegistry — single source of truth for tool/capability state.
 *
 * Every visible tool state must come from the registry. No hardcoded
 * "Connected", "Online", "Nominal", "Ready", "Degraded" strings.
 *
 * The Autonomic Loop banner computes its state from real capability records.
 */

import type { CapabilityRecord, CapabilityState } from "../types";

const DEFAULT_CAPABILITIES: Array<{ id: string; permissions: string[]; dependencies: string[] }> = [
  { id: "chat", permissions: [], dependencies: [] },
  { id: "voice.input", permissions: ["microphone"], dependencies: ["voice.transport"] },
  { id: "voice.output", permissions: [], dependencies: ["voice.transport"] },
  { id: "canvas", permissions: [], dependencies: [] },
  { id: "project.create", permissions: [], dependencies: [] },
  { id: "files.read", permissions: [], dependencies: ["project.create"] },
  { id: "files.write", permissions: [], dependencies: ["project.create"] },
  { id: "terminal", permissions: [], dependencies: ["project.create"] },
  { id: "preview", permissions: [], dependencies: ["project.create"] },
  { id: "browser", permissions: [], dependencies: [] },
  { id: "image.generate", permissions: [], dependencies: [] },
  { id: "video.generate", permissions: [], dependencies: [] },
  { id: "audio.generate", permissions: [], dependencies: [] },
  { id: "camera", permissions: ["camera"], dependencies: [] },
  { id: "screen.capture", permissions: ["display-capture"], dependencies: [] },
  { id: "plugins", permissions: [], dependencies: [] },
  { id: "agents", permissions: [], dependencies: [] },
  { id: "deploy", permissions: [], dependencies: ["project.create"] },
];

export class CapabilityRegistry {
  private records = new Map<string, CapabilityRecord>();

  constructor() {
    // Initialize all capabilities as unknown
    for (const def of DEFAULT_CAPABILITIES) {
      this.records.set(def.id, {
        id: def.id,
        state: "unknown",
        verifiedAt: 0,
        permissions: def.permissions,
        dependencies: def.dependencies,
      });
    }
  }

  getRecord(id: string): CapabilityRecord | null {
    return this.records.get(id) ?? null;
  }

  getAllRecords(): CapabilityRecord[] {
    return Array.from(this.records.values());
  }

  setState(id: string, state: CapabilityState, reason?: string, provider?: string): void {
    const existing = this.records.get(id);
    if (!existing) return;
    this.records.set(id, {
      ...existing,
      state,
      reason,
      provider,
      verifiedAt: Date.now(),
    });
  }

  /** Check if a capability is available (ready or limited). */
  isAvailable(id: string): boolean {
    const record = this.records.get(id);
    return record?.state === "ready" || record?.state === "limited";
  }

  /** Get the overall system state for the Autonomic Loop banner. */
  getSystemState(): CapabilityState {
    const records = Array.from(this.records.values());
    if (records.some((r) => r.state === "unavailable" || r.state === "error" as CapabilityState)) {
      return "degraded";
    }
    if (records.every((r) => r.state === "unknown")) {
      return "unknown";
    }
    if (records.some((r) => r.state === "connecting" || r.state === "degraded")) {
      return "degraded";
    }
    return "ready";
  }

  /** Register a custom capability (for plugins). */
  register(id: string, permissions: string[] = [], dependencies: string[] = []): void {
    if (this.records.has(id)) return;
    this.records.set(id, {
      id,
      state: "unknown",
      verifiedAt: 0,
      permissions,
      dependencies,
    });
  }
}

/** Singleton capability registry. */
let globalRegistry: CapabilityRegistry | null = null;

export function getCapabilityRegistry(): CapabilityRegistry {
  if (!globalRegistry) {
    globalRegistry = new CapabilityRegistry();
  }
  return globalRegistry;
}
