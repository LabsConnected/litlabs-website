import { describe, expect, it } from "vitest";
import { canonicalShellTool, initialStageFromTool, shellStageForTool } from "./stage-surfaces";

describe("shell stage defaults", () => {
  it("lands bare studio, chat, and home on the workspace", () => {
    expect(initialStageFromTool(null)).toBe("workspace");
    expect(initialStageFromTool("chat")).toBe("workspace");
    expect(initialStageFromTool("home")).toBe("workspace");
    expect(shellStageForTool(null, "preview")).toBe("workspace");
    expect(shellStageForTool("chat", "preview")).toBe("workspace");
    expect(shellStageForTool("home", "preview")).toBe("workspace");
  });

  it("keeps an explicit preview or design deep link", () => {
    expect(initialStageFromTool("preview")).toBe("preview");
    expect(initialStageFromTool("design")).toBe("design");
    expect(shellStageForTool("preview", "preview")).toBe("preview");
    expect(shellStageForTool("design", "design")).toBe("design");
  });

  it("does not publish the legacy preview mode as ?tool=preview", () => {
    expect(canonicalShellTool("preview", "workspace", null)).toBe("chat");
    expect(canonicalShellTool("preview", "workspace", "chat")).toBe("chat");
    expect(canonicalShellTool("preview", "workspace", "home")).toBe("home");
    expect(canonicalShellTool("preview", "preview", "preview")).toBe("preview");
    expect(canonicalShellTool("preview", "design", "design")).toBe("design");
    expect(canonicalShellTool("canvas", "design", "canvas")).toBe("canvas");
  });
});
