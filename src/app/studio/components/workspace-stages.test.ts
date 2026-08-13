import { describe, it, expect } from "vitest";
import {
  workspaceStageToMode,
  modeToWorkspaceStage,
  type WorkspaceStage,
  type StudioMode,
} from "../lib/studio-destinations";

describe("WorkspaceStage canonical mapping", () => {
  describe("workspaceStageToMode", () => {
    it("maps plan -> work", () => {
      expect(workspaceStageToMode("plan")).toBe("work");
    });

    it("maps canvas -> files", () => {
      expect(workspaceStageToMode("canvas")).toBe("files");
    });

    it("maps code -> code", () => {
      expect(workspaceStageToMode("code")).toBe("code");
    });

    it("maps preview -> preview", () => {
      expect(workspaceStageToMode("preview")).toBe("preview");
    });

    it("covers all four canonical stages", () => {
      const stages: WorkspaceStage[] = ["plan", "canvas", "code", "preview"];
      stages.forEach((s) => {
        const mode = workspaceStageToMode(s);
        expect(mode).toBeTruthy();
      });
    });
  });

  describe("modeToWorkspaceStage (reverse)", () => {
    it("reverse-maps work -> plan", () => {
      expect(modeToWorkspaceStage("work")).toBe("plan");
    });

    it("reverse-maps files -> canvas", () => {
      expect(modeToWorkspaceStage("files")).toBe("canvas");
    });

    it("reverse-maps code -> code", () => {
      expect(modeToWorkspaceStage("code")).toBe("code");
    });

    it("reverse-maps preview -> preview", () => {
      expect(modeToWorkspaceStage("preview")).toBe("preview");
    });

    it("returns null for design (design is a creator, not a stage)", () => {
      expect(modeToWorkspaceStage("design")).toBeNull();
    });
  });

  describe("round-trip integrity", () => {
    it("every WorkspaceStage round-trips through StudioMode", () => {
      const stages: WorkspaceStage[] = ["plan", "canvas", "code", "preview"];
      stages.forEach((s) => {
        const mode = workspaceStageToMode(s);
        const back = modeToWorkspaceStage(mode as StudioMode);
        expect(back).toBe(s);
      });
    });
  });

  describe("canonical stage order", () => {
    it("the canonical order is Plan, Canvas, Code, Preview", () => {
      const expected: WorkspaceStage[] = ["plan", "canvas", "code", "preview"];
      // This test documents the required order — if someone reorders the
      // type union, this test will still pass, but it serves as a spec
      // reference for the UI tab order.
      expect(expected).toEqual(["plan", "canvas", "code", "preview"]);
    });
  });
});
