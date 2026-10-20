// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression tests — checkpoint creation is audible (Repair R3,
 * Diagnosis E4-S7/R2).
 *
 * The defect: createWorkspaceCheckpoint and its manifest fallback logged
 * nothing, and the git→manifest fallback chain was invisible — a run
 * whose baseline silently became a manifest (or silently failed to
 * exist at all) left no trace in deployment stdout. Every successful
 * creation now emits ONE structured line naming the checkpoint id, the
 * kind (git | manifest), and — for manifests — the baseline file count.
 * Ids and outcomes only; never file contents.
 */

vi.mock("@/lib/missions/mission-repository", () => ({
  createCheckpoint: vi.fn(),
}));

vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: () => "http://terminal.test",
}));

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: () => ({ token: "test-token" }),
}));

import { createWorkspaceCheckpoint } from "./workspace-checkpoint";
import { createCheckpoint } from "@/lib/missions/mission-repository";

const GIT_SHA = "a".repeat(40);
const FILES: Record<string, string> = {
  "index.html": "<html><body>Welcome</body></html>",
  "styles.css": "body { color: #333; }",
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

/** Terminal-server stub. gitAvailable=false makes every /exec fail (503),
 *  which is exactly the staging shape that forces the manifest fallback. */
function stubFetch(gitAvailable: boolean) {
  return vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as { command?: string; path?: string }) : {};
    if (url.includes("/exec")) {
      if (!gitAvailable) return jsonResponse("HOST_EXECUTION_DISABLED", false, 503);
      const command = body.command ?? "";
      if (command === "git add -A") return jsonResponse({ exitCode: 0, stdout: "", stderr: "" });
      if (command.startsWith("git commit")) return jsonResponse({ exitCode: 0, stdout: "", stderr: "" });
      if (command === "git rev-parse HEAD") return jsonResponse({ exitCode: 0, stdout: `${GIT_SHA}\n`, stderr: "" });
      return jsonResponse({ exitCode: 1, stdout: "", stderr: `unexpected command ${command}` });
    }
    if (url.includes("/ws-files/read")) {
      const content = FILES[body.path ?? ""];
      if (content === undefined) return jsonResponse("not found", false, 404);
      return jsonResponse({ content, size: content.length });
    }
    if (url.includes("/ws-files")) {
      return jsonResponse({
        entries: Object.keys(FILES).map((name) => ({ name, type: "file" })),
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function loggedEntries(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
}

describe("createWorkspaceCheckpoint — audit log (R3/E4-R2)", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createCheckpoint).mockResolvedValue({ id: "chk-new-1" } as never);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("logs kind=git with the checkpoint id when the git path succeeds", async () => {
    vi.stubGlobal("fetch", stubFetch(true));

    const result = await createWorkspaceCheckpoint({
      projectId: "proj-1",
      userId: "user-1",
      workspaceId: "ws-1",
      label: "pre-mutation",
    });

    expect(result.kind).toBe("git");
    const entry = loggedEntries(consoleSpy).find((e) => e.message === "workspace:checkpoint_created");
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ checkpointId: "chk-new-1", kind: "git" });
  });

  it("logs kind=manifest with the baseline file count when git is unavailable", async () => {
    vi.stubGlobal("fetch", stubFetch(false));

    const result = await createWorkspaceCheckpoint({
      projectId: "proj-1",
      userId: "user-1",
      workspaceId: "ws-1",
      label: "pre-mutation",
    });

    expect(result.kind).toBe("manifest");
    const entry = loggedEntries(consoleSpy).find((e) => e.message === "workspace:checkpoint_created");
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      checkpointId: "chk-new-1",
      kind: "manifest",
      fileCount: 2,
    });
  });
});
