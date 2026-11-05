import { describe, it, expect } from "vitest";
import { PermissionEngine } from "@/lib/litt-intelligence/permission-engine";
import type { ToolPermissionInfo } from "@/lib/litt-intelligence/permission-engine";
import { setDelegateToolId } from "@/lib/litt-intelligence/tool-delegates";

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
      // Risky (mutation) commands still require approval in AUTO.
      const result = engine.check(sensitiveTool, { command: "git push" }, "auto");
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      // Deny-classified commands are refused outright — they never reach
      // approval at all.
      const denied = engine.check(sensitiveTool, { command: "rm -rf /" }, "auto");
      expect(denied.allowed).toBe(false);
      expect(denied.requiresApproval).toBe(false);
    });

    it("project.deploy ALWAYS requires human approval, even in AUTO", () => {
      const deployTool: ToolPermissionInfo = {
        toolId: "project.deploy",
        permissionLevel: "workspace-write",
        isReadOnly: false,
        isMutation: true,
        enabled: true,
      };
      for (const mode of ["plan", "act", "auto"] as const) {
        const result = engine.check(deployTool, {}, mode);
        // PLAN blocks it outright; ACT/AUTO allow it only with approval.
        // The quality loop must never auto-approve a deploy.
        if (mode === "plan") {
          expect(result.allowed).toBe(false);
        } else {
          expect(result.allowed).toBe(true);
          expect(result.requiresApproval).toBe(true);
        }
      }
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

  describe("station-action delegates (canonical-id resolution)", () => {
    // Station actions like code.writeFile execute the canonical tool they
    // are registered against (files.write). The permission gate classifies
    // the CANONICAL id: the alias inherits exactly the delegate's
    // privilege — never more, never less. Golden 41962554092: a follow-up
    // edit through code.writeFile parked on "Mutation requires approval"
    // in AUTO mode even though the same write via files.write is
    // auto-approved — identical privilege, different gate outcome.
    const engine = new PermissionEngine();

    const aliasOf = (toolId: string): ToolPermissionInfo => ({
      toolId,
      permissionLevel: "workspace-write",
      isReadOnly: false,
      isMutation: true,
      enabled: true,
    });

    it("code.writeFile (delegate of files.write) auto-approves in AUTO like files.write", () => {
      setDelegateToolId("test.code.writeFile", "files.write");
      const alias = engine.check(aliasOf("test.code.writeFile"), {}, "auto");
      const canonical = engine.check(aliasOf("files.write"), {}, "auto");
      expect(alias.allowed).toBe(canonical.allowed);
      expect(alias.requiresApproval).toBe(canonical.requiresApproval);
      expect(alias.requiresApproval).toBe(false);
    });

    it("ACT mode still requires approval for delegate mutations", () => {
      setDelegateToolId("test.code.writeFile", "files.write");
      const result = engine.check(aliasOf("test.code.writeFile"), {}, "act");
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });

    it("deploy.preview (delegate of project.deploy) stays a sensitive gate in AUTO", () => {
      setDelegateToolId("test.deploy.preview", "project.deploy");
      const result = engine.check(aliasOf("test.deploy.preview"), {}, "auto");
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain("Sensitive");
    });

    it("a literal sensitive id stays sensitive even when its delegate is not", () => {
      // Delegate registration can never LOWER a literal sensitive id's
      // gate — the OR check keeps git.push sensitive even if a (broken)
      // registration pointed it at an auto-safe canonical.
      setDelegateToolId("git.push", "files.write");
      const result = engine.check(aliasOf("git.push"), {}, "auto");
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain("Sensitive");
    });

    it("a delegate of a non-safe canonical tool still requires approval in AUTO", () => {
      setDelegateToolId("test.image.saveAsset", "project.insert_asset");
      const result = engine.check(aliasOf("test.image.saveAsset"), {}, "auto");
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).not.toContain("Sensitive");
    });

    it("PLAN mode still blocks delegate mutations outright", () => {
      setDelegateToolId("test.code.writeFile", "files.write");
      const result = engine.check(aliasOf("test.code.writeFile"), {}, "plan");
      expect(result.allowed).toBe(false);
    });
  });
});
