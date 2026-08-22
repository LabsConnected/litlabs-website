/**
 * PLAN Mode Enforcement Tests
 *
 * These tests prove that PLAN mode produces ZERO mutation — not just at the
 * agent loop level (which filters tools before presenting to the LLM), but
 * at the ToolRegistry level (defense-in-depth for direct callers).
 *
 * The gate: "tests prove PLAN produces zero mutation."
 *
 * Phase 5 — Studio Control Plane V1
 */

import { describe, it, expect, beforeAll } from "vitest";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import { PermissionEngine } from "@/lib/litt-intelligence/permission-engine";
import type { ToolPermissionInfo } from "@/lib/litt-intelligence/permission-engine";

describe("PLAN mode enforcement — zero mutation", () => {
  const engine = new PermissionEngine();

  // ─── PermissionEngine level ──────────────────────────────────

  describe("PermissionEngine.check()", () => {
    it("blocks all mutation tools in PLAN mode", () => {
      const mutationTools: Array<{ id: string; level: ToolPermissionInfo["permissionLevel"] }> = [
        { id: "files.write", level: "workspace-write" },
        { id: "files.delete", level: "workspace-write" },
        { id: "files.mkdir", level: "workspace-write" },
        { id: "files.rename", level: "workspace-write" },
        { id: "apply_patch", level: "workspace-write" },
        { id: "git.commit", level: "workspace-write" },
        { id: "git.push", level: "workspace-write" },
        { id: "terminal.execute", level: "workspace-write" },
      ];

      for (const { id, level } of mutationTools) {
        const result = engine.check(
          {
            toolId: id,
            permissionLevel: level,
            isReadOnly: false,
            isMutation: true,
            enabled: true,
          },
          {},
          "plan",
        );
        expect(result.allowed, `PLAN mode must block ${id}`).toBe(false);
        expect(result.reason, `${id} block reason should mention PLAN`).toContain("PLAN");
      }
    });

    it("allows all read-only tools in PLAN mode", () => {
      const readTools: Array<{ id: string; level: ToolPermissionInfo["permissionLevel"] }> = [
        { id: "files.list", level: "read" },
        { id: "files.read", level: "read" },
        { id: "search_code", level: "read" },
        { id: "git.status", level: "read" },
        { id: "git.diff", level: "read" },
        { id: "git.log", level: "read" },
        { id: "project.scan", level: "read" },
        { id: "project.health", level: "read" },
        { id: "build.run", level: "read" },
        { id: "typecheck.run", level: "read" },
        { id: "lint.run", level: "read" },
        { id: "test.run", level: "read" },
        { id: "package.info", level: "read" },
      ];

      for (const { id, level } of readTools) {
        const result = engine.check(
          {
            toolId: id,
            permissionLevel: level,
            isReadOnly: true,
            isMutation: false,
            enabled: true,
          },
          {},
          "plan",
        );
        expect(result.allowed, `PLAN mode must allow ${id}`).toBe(true);
        expect(result.requiresApproval, `${id} should not require approval in PLAN`).toBe(false);
      }
    });

    it("blocks terminal.execute in PLAN mode even with approval flag set", () => {
      // Even if a caller passes hasApproval=true, PLAN mode must block
      // terminal.execute because it's not read-only.
      const result = engine.check(
        {
          toolId: "terminal.execute",
          permissionLevel: "workspace-write",
          isReadOnly: false,
          isMutation: true,
          enabled: true,
        },
        { command: "git status", hasApproval: true },
        "plan",
      );
      expect(result.allowed).toBe(false);
    });
  });

  // ─── ToolRegistry level (defense-in-depth) ───────────────────

  describe("ToolRegistry.execute() with executionMode: 'plan'", () => {
    // Use a mock project ID — the registry should block before reaching the handler
    const mockProjectId = "test-project-id";
    const mockInputs = { projectId: mockProjectId, path: "test.txt", content: "test" };

    it("blocks files.write in PLAN mode", async () => {
      const result = await toolRegistry.execute("files.write", mockInputs, {
        executionMode: "plan",
        hasApproval: true, // even with approval, PLAN blocks
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("blocked");
      }
    });

    it("blocks apply_patch in PLAN mode", async () => {
      const result = await toolRegistry.execute(
        "apply_patch",
        { projectId: mockProjectId, patch: "test patch" },
        { executionMode: "plan", hasApproval: true },
      );
      expect(result.ok).toBe(false);
    });

    it("blocks git.commit in PLAN mode", async () => {
      const result = await toolRegistry.execute(
        "git.commit",
        { projectId: mockProjectId, message: "test" },
        { executionMode: "plan", hasApproval: true },
      );
      expect(result.ok).toBe(false);
    });

    it("blocks terminal.execute in PLAN mode", async () => {
      const result = await toolRegistry.execute(
        "terminal.execute",
        { projectId: mockProjectId, command: "ls" },
        { executionMode: "plan", hasApproval: true },
      );
      expect(result.ok).toBe(false);
    });

    it("allows files.read in PLAN mode", async () => {
      // files.read is read-only and should pass the mode check.
      // It may fail later due to missing workspace, but the mode check
      // should NOT be the reason for failure.
      const result = await toolRegistry.execute(
        "files.read",
        { projectId: mockProjectId, path: "test.txt" },
        { executionMode: "plan" },
      );
      // The result may fail due to missing workspace, but it should NOT
      // contain "blocked" or "PLAN" in the error — that would mean the
      // mode check blocked it, which is wrong for a read-only tool.
      if (!result.ok) {
        expect(result.error).not.toContain("blocked");
        expect(result.error).not.toContain("PLAN");
      }
    });

    it("allows git.status in PLAN mode", async () => {
      const result = await toolRegistry.execute(
        "git.status",
        { projectId: mockProjectId },
        { executionMode: "plan" },
      );
      if (!result.ok) {
        expect(result.error).not.toContain("blocked");
        expect(result.error).not.toContain("PLAN");
      }
    });
  });

  // ─── ToolRegistry.canExecute() ───────────────────────────────

  describe("ToolRegistry.canExecute() with executionMode: 'plan'", () => {
    it("reports cannot execute for mutation tools in PLAN mode", () => {
      const mutationToolIds = [
        "files.write",
        "files.delete",
        "apply_patch",
        "git.commit",
        "terminal.execute",
      ];

      for (const id of mutationToolIds) {
        const result = toolRegistry.canExecute(id, {
          executionMode: "plan",
          hasApproval: true,
        });
        expect(result.can, `canExecute must return false for ${id} in PLAN`).toBe(false);
      }
    });

    it("reports can execute for read-only tools in PLAN mode", () => {
      const readToolIds = [
        "files.list",
        "files.read",
        "search_code",
        "git.status",
        "git.diff",
        "git.log",
        "project.scan",
        "project.health",
        "build.run",
        "typecheck.run",
        "lint.run",
        "test.run",
        "package.info",
      ];

      for (const id of readToolIds) {
        const result = toolRegistry.canExecute(id, {
          executionMode: "plan",
        });
        expect(result.can, `canExecute must return true for ${id} in PLAN`).toBe(true);
      }
    });
  });

  // ─── Exhaustive: every registered mutation tool is blocked ───

  describe("exhaustive: every registered mutation tool is blocked in PLAN", () => {
    it("no registered non-read-only tool can execute in PLAN mode", () => {
      const allTools = toolRegistry.listEnabled();
      const mutationTools = allTools.filter((t) => !t.readOnly);

      for (const tool of mutationTools) {
        const result = toolRegistry.canExecute(tool.id, {
          executionMode: "plan",
          hasApproval: true, // even with approval
        });
        expect(
          result.can,
          `PLAN mode must block mutation tool "${tool.id}" (readOnly=${tool.readOnly})`,
        ).toBe(false);
      }
    });

    it("every registered read-only tool can execute in PLAN mode", () => {
      const allTools = toolRegistry.listEnabled();
      const readTools = allTools.filter((t) => t.readOnly);

      for (const tool of readTools) {
        const result = toolRegistry.canExecute(tool.id, {
          executionMode: "plan",
        });
        expect(
          result.can,
          `PLAN mode must allow read-only tool "${tool.id}"`,
        ).toBe(true);
      }
    });
  });
});
