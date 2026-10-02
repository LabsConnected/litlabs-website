/**
 * Settings groups — verifies the P1 regrouping:
 * - Three groups exist: App Settings / LiTT Capabilities / Advanced
 * - AI & Models lives under Advanced (not a normal top-level section)
 * - Every section belongs to exactly one group
 */
import { describe, it, expect } from "vitest";
import {
  SETTINGS_SECTIONS,
  SETTINGS_GROUPS,
  type SettingsSection,
} from "@/stores/useSettingsStore";

describe("settings groups", () => {
  it("defines exactly three groups with the expected labels", () => {
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual([
      "App Settings",
      "LiTT Capabilities",
      "Advanced",
    ]);
  });

  it("assigns every section to exactly one known group", () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((g) => g.id));
    for (const s of SETTINGS_SECTIONS) {
      expect(groupIds.has(s.group), `section ${s.id} has unknown group ${s.group}`).toBe(true);
    }
    // No duplicates
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("places AI & Models under Advanced, not as a normal top-level section", () => {
    const aiModels = SETTINGS_SECTIONS.find((s) => s.id === "ai-models");
    expect(aiModels).toBeDefined();
    expect(aiModels!.group).toBe("advanced");
  });

  it("keeps provider internals out of App Settings and Capabilities", () => {
    const nonAdvanced = SETTINGS_SECTIONS.filter((s) => s.group !== "advanced");
    const ids = nonAdvanced.map((s) => s.id);
    expect(ids).not.toContain("ai-models");
  });

  it("groups sections in a stable order: app, then capabilities, then advanced", () => {
    const order: Record<SettingsSection["group"], number> = {
      app: 0,
      capabilities: 1,
      advanced: 2,
    };
    const groups = SETTINGS_SECTIONS.map((s) => order[s.group]);
    const sorted = [...groups].sort((a, b) => a - b);
    expect(groups).toEqual(sorted);
  });
});
