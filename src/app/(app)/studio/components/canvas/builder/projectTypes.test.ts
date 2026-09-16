import { describe, it, expect } from "vitest";

/**
 * Build-type picker alignment with the canonical creation vocabulary.
 * Labels for the same concept must match creation-types.ts exactly;
 * unavailable types (games) stay filtered, never rendered as dead ends.
 */

import { PROJECT_TYPES } from "./projectTypes";
import { getCreationType } from "@/lib/creation-types";

describe("projectTypes taxonomy", () => {
  it("selectable types use the canonical vocabulary labels", () => {
    for (const meta of PROJECT_TYPES) {
      if (meta.available === false) continue;
      const canonical = getCreationType(meta.creationTypeId);
      expect(meta.label, `${meta.id} label`).toBe(canonical.label);
    }
  });

  it("every type maps to a canonical creation type", () => {
    for (const meta of PROJECT_TYPES) {
      expect(() => getCreationType(meta.creationTypeId)).not.toThrow();
    }
  });

  it("game editors stay unavailable and filtered from the picker", () => {
    const games = PROJECT_TYPES.filter((p) => p.creationTypeId === "game");
    expect(games.length).toBeGreaterThan(0);
    for (const g of games) {
      expect(g.available).toBe(false);
    }
    const selectable = PROJECT_TYPES.filter((p) => p.available !== false);
    expect(selectable.some((p) => p.creationTypeId === "game")).toBe(false);
  });

  it("app is labeled 'App' (not 'Web App') — one vocabulary", () => {
    const app = PROJECT_TYPES.find((p) => p.id === "app")!;
    expect(app.label).toBe("App");
  });
});
