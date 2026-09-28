import { describe, it, expect } from "vitest";
import { resolveV1ToV2Reroute } from "@/app/api/studio/conversations/[conversationId]/messages/route";

/**
 * Regression tests for the 2026-09-28 #551 acceptance re-run #2 dead-end.
 *
 * Defense in depth: when the V1 text-only lane produces tool-call markup
 * naming a workspace tool while a verified, reachable workspace is in
 * context, the turn is re-routed to the V2 structured-tool lane instead
 * of hard-failing with TOOL_CALL_PARSE_FAILED. Every other case keeps
 * the honest failure.
 */
describe("resolveV1ToV2Reroute", () => {
  // Mirror of the tool-registry workspace-tool set (the real
  // isWorkspaceTool is resolved via dynamic import in the route).
  const WORKSPACE_TOOLS = new Set([
    "project.scan",
    "files.list",
    "files.read",
    "files.write",
    "files.delete",
    "files.mkdir",
    "files.rename",
    "git.status",
    "git.diff",
    "git.log",
    "git.commit",
    "terminal.execute",
    "apply_patch",
    "build.run",
  ]);
  const isWorkspaceTool = (toolId: string) => WORKSPACE_TOOLS.has(toolId);

  const HEALTHY = { hasWorkspaceTransport: true, fileOpsReachable: true, aborted: false };

  it("re-routes a files.read markup hit with a verified, reachable workspace", () => {
    expect(resolveV1ToV2Reroute("files.read", isWorkspaceTool, HEALTHY)).toBe("files.read");
  });

  it("re-routes a files.write markup hit with a verified, reachable workspace", () => {
    expect(resolveV1ToV2Reroute("files.write", isWorkspaceTool, HEALTHY)).toBe("files.write");
  });

  it("keeps the honest failure when the markup names a non-workspace tool", () => {
    expect(resolveV1ToV2Reroute("web.search", isWorkspaceTool, HEALTHY)).toBeNull();
  });

  it("keeps the honest failure when the markup has no recognizable tool id", () => {
    expect(resolveV1ToV2Reroute(null, isWorkspaceTool, HEALTHY)).toBeNull();
    expect(resolveV1ToV2Reroute(undefined, isWorkspaceTool, HEALTHY)).toBeNull();
  });

  it("keeps the honest failure with no workspace in context", () => {
    expect(
      resolveV1ToV2Reroute("files.read", isWorkspaceTool, {
        ...HEALTHY,
        hasWorkspaceTransport: false,
      }),
    ).toBeNull();
  });

  it("keeps the honest failure when the file transport probe failed", () => {
    // A dead transport means a V2 retry would fail the same way —
    // re-routing would just move the failure, not fix it.
    expect(
      resolveV1ToV2Reroute("files.read", isWorkspaceTool, {
        ...HEALTHY,
        fileOpsReachable: false,
      }),
    ).toBeNull();
  });

  it("never re-routes a cancelled run", () => {
    expect(
      resolveV1ToV2Reroute("files.read", isWorkspaceTool, { ...HEALTHY, aborted: true }),
    ).toBeNull();
  });

  it("re-routes every workspace tool, not just file tools", () => {
    for (const toolId of WORKSPACE_TOOLS) {
      expect(resolveV1ToV2Reroute(toolId, isWorkspaceTool, HEALTHY)).toBe(toolId);
    }
  });
});
