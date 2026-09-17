/**
 * PR-1 (creation honesty pass): registries must never advertise tool IDs
 * that have no implementation behind them.
 *
 * Regression test for the audit findings:
 * - Spark's allowedToolIds advertised video.generate / audio.generate / music.generate
 * - CapabilityRegistry advertised video.generate / audio.generate
 */
import { describe, it, expect } from "vitest";
import { AGENT_PROFILES } from "@/lib/litt-intelligence/agent-profiles";
import { CapabilityRegistry } from "@/lib/litt/capability/capability-registry";

// Tool IDs that were advertised but never implemented. If any of these ever
// become real, delete them from this list AND wire the implementation.
const UNIMPLEMENTED_TOOL_IDS = [
  "video.generate",
  "audio.generate",
  "music.generate",
];

describe("creation honesty — no phantom tool IDs", () => {
  it("Spark's allowedToolIds contains no unimplemented tools", () => {
    const spark = AGENT_PROFILES.spark;
    expect(spark).toBeDefined();
    for (const phantom of UNIMPLEMENTED_TOOL_IDS) {
      expect(spark.allowedToolIds).not.toContain(phantom);
    }
  });

  it("no agent profile advertises unimplemented tools", () => {
    for (const [mode, profile] of Object.entries(AGENT_PROFILES)) {
      for (const phantom of UNIMPLEMENTED_TOOL_IDS) {
        expect(
          profile.allowedToolIds,
          `${mode}.allowedToolIds advertises phantom tool ${phantom}`,
        ).not.toContain(phantom);
      }
    }
  });

  it("CapabilityRegistry has no records for unimplemented tools", () => {
    const registry = new CapabilityRegistry();
    for (const phantom of UNIMPLEMENTED_TOOL_IDS) {
      expect(
        registry.getRecord(phantom),
        `registry advertises phantom tool ${phantom}`,
      ).toBeNull();
    }
  });
});
