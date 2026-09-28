// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isWorkspaceTool } from "./tool-registry";

/**
 * Discriminator for the messages route's V1→V2 re-route: a V1 markup hit
 * naming a workspace tool with a verified workspace in context is an
 * execution request the router misclassified — re-route it to the V2
 * structured-tool lane instead of failing with TOOL_CALL_PARSE_FAILED.
 */
describe("isWorkspaceTool", () => {
  const WORKSPACE_TOOLS = [
    "project.scan",
    "files.list",
    "files.read",
    "files.write",
    "files.delete",
    "files.mkdir",
    "files.rename",
    "search_code",
    "git.status",
    "git.diff",
    "git.log",
    "git.commit",
    "terminal.execute",
    "project.health",
    "project.insert_asset",
    "apply_patch",
    "build.run",
    "test.run",
    "typecheck.run",
    "lint.run",
    "package.info",
    "preview.start",
    "preview.status",
    "preview.stop",
    "project.deploy",
  ];

  it("recognizes every workspace tool", () => {
    for (const toolId of WORKSPACE_TOOLS) {
      expect(isWorkspaceTool(toolId)).toBe(true);
    }
  });

  it("rejects non-workspace tools", () => {
    expect(isWorkspaceTool("web.search")).toBe(false);
    expect(isWorkspaceTool("browser.start_session")).toBe(false);
    expect(isWorkspaceTool("image.generate")).toBe(false);
  });

  it("rejects unknown tool ids", () => {
    expect(isWorkspaceTool("nope.notreal")).toBe(false);
    expect(isWorkspaceTool("")).toBe(false);
  });
});
