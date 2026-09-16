import { describe, expect, it } from "vitest";
import { PROJECT_TYPES } from "@/app/(app)/studio/components/canvas/builder/projectTypes";

describe("projectTypes availability", () => {
  it("marks game builders unavailable until Phase 2", () => {
    const game2d = PROJECT_TYPES.find((p) => p.id === "game2d");
    const game3d = PROJECT_TYPES.find((p) => p.id === "game3d");
    expect(game2d?.available).toBe(false);
    expect(game3d?.available).toBe(false);
  });

  it("keeps the core builders selectable", () => {
    const selectable = PROJECT_TYPES.filter((p) => p.available !== false).map(
      (p) => p.id,
    );
    expect(selectable).toEqual(
      expect.arrayContaining(["website", "html", "app", "component"]),
    );
    expect(selectable).not.toContain("game2d");
    expect(selectable).not.toContain("game3d");
  });
});
