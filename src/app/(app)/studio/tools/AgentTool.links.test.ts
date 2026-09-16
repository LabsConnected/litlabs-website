import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SETTINGS_SECTIONS } from "@/stores/useSettingsStore";

// Guards the Tier 1 fix: AgentTool's "Settings" buttons linked to
// /settings/memory, /settings/models, /settings/agents — routes that never
// existed (404). Valid settings destinations are /settings?section=<id>.
// A future edit re-adding a path-style /settings/<word> link fails here.
describe("AgentTool settings links", () => {
  const source = readFileSync(
    resolve(__dirname, "AgentTool.tsx"),
    "utf-8",
  );

  it("has no path-style /settings/<word> links (they 404)", () => {
    const deadLinks = [...source.matchAll(/href="\/settings\/[a-z-]+"/g)].map(
      (m) => m[0],
    );
    expect(deadLinks, "dead settings links").toEqual([]);
  });

  it("points ?section= links at real settings sections", () => {
    const sectionIds = new Set(SETTINGS_SECTIONS.map((s) => s.id));
    const refs = [...source.matchAll(/href="\/settings\?section=([a-z-]+)"/g)].map(
      (m) => m[1],
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const id of refs) {
      expect(sectionIds, `section "${id}"`).toContain(id);
    }
  });
});
