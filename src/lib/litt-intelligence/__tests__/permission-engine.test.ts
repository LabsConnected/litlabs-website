import { describe, it, expect } from "vitest";
import { PermissionEngine } from "@/lib/litt-intelligence/permission-engine";
import type { ToolPermissionInfo } from "@/lib/litt-intelligence/permission-engine";

describe("PermissionEngine", () => {
  const engine = new PermissionEngine();

  const readTool: ToolPermissionInfo = {
    toolId: "files.read",
    permissionLevel: "read",
    isReadOnly: true,
    isMutation: false,
    enabled: true,
  };

  const writeTool: ToolPermissionInfo = {
    toolId: "files.write",
    permissionLevel: "workspace-write",
    isReadOnly: false,
    isMutation: true,
    enabled: true,
  };

  const disabledTool: ToolPermissionInfo = {
    toolId: "files.delete",
    permissionLevel: "workspace-write",
    isReadOnly: false,
    isMutation: true,
    enabled: false,
  };

  describe("PLAN mode", () => {
    it("allows read-only tools", () => {
      const result = engine.check(readTool, {}, "plan");
      expect(result.allowed).toBe(true);
    });

    it("blocks mutation tools", () => {
      const result = engine.check(writeTool, {}, "plan");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("PLAN");
    });
  });

  describe("ACT mode", () => {
    it("allows read-only tools", () => {
      const result = engine.check(readTool, {}, "act");
      expect(result.allowed).toBe(true);
    });

    it("allows mutation tools but requires approval", () => {
      const result = engine.check(writeTool, {}, "act");
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("AUTO mode", () => {
    it("allows read-only tools", () => {
      const result = engine.check(readTool, {}, "auto");
      expect(result.allowed).toBe(true);
    });

    it("auto-approves safe mutation tools", () => {
      const safeWrite: ToolPermissionInfo = {
        ...writeTool,
        toolId: "files.write",
      };
      const result = engine.check(safeWrite, {}, "auto");
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("still requires approval for sensitive tools", () => {
      const sensitiveTool: ToolPermissionInfo = {
        toolId: "terminal.execute",
        permissionLevel: "workspace-write",
        isReadOnly: false,
        isMutation: true,
        enabled: true,
      };
      const result = engine.check(sensitiveTool, { command: "rm -rf /" }, "auto");
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("disabled tools", () => {
    it("blocks disabled tools in all modes", () => {
      for (const mode of ["plan", "act", "auto"] as const) {
        const result = engine.check(disabledTool, {}, mode);
        expect(result.allowed).toBe(false);
      }
    });
  });
});
