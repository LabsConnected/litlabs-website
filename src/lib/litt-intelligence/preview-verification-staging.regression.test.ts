// @vitest-environment node
/**
 * Regression: staging preview + verification failures (run 0c5b5074,
 * staging head 47824457). Diagnosis ART-20261020-007; test intent from the
 * Lane B drafted patch ART-20261020-008 (that artifact is a prose draft
 * whose T1/T1b/T2/T3 bodies are commented placeholders — it is not
 * git-applicable; this file activates the same four tests against the
 * implemented seams, with no behavior invented beyond the diagnosis).
 *
 * Environment contract being simulated (PROVEN on staging, 2026-10-20):
 *  - terminal /exec and /preview/start return 503 HOST_EXECUTION_DISABLED
 *  - /ws-files read/write/list work normally
 *  - BROWSERBASE_API_KEY is absent (not exercised here — config, not code)
 *
 * T1/T1b — Fix 1: a manifest checkpoint (path → sha256 baseline captured
 *   over the file services when git cannot run) must compare by
 *   re-enumeration: a persisted write reports "changed" naming the file;
 *   a zero-write run reports "unchanged" — never "unknown" for either.
 * T2 — Fix 1c: a failed re-checkpoint (null) before a later mutating tool
 *   must not erase the threaded baseline (`?? checkpoint`, agent-loop-v2).
 * T3 — Fix 2: for a static workspace, the agent preview path reports the
 *   static preview ready with the /api/preview/<projectId>/ URL and never
 *   calls transport.startPreview.
 *
 * No test requires network, a provider, Browserbase, or a staging call.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

import {
  computeWorkspaceChange,
  type WorkspaceChangeProbe,
} from "./workspace-change-producer";
import type { CheckpointInfo, WorkspaceTransport } from "./workspace-transport";
import { handlePreviewStart, handlePreviewStatus } from "./tool-handlers-v2";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";

const sha256Hex = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

const SCAFFOLD_HTML =
  "<!doctype html><html><body><h1>Welcome to LiTT</h1><p>Your AI workspace is ready.</p></body></html>";
const HARBOR_HTML =
  "<!doctype html><html><body><h1>Harbor Coffee</h1><p>Fresh roasts by the harbor.</p></body></html>";

const HOST_EXEC_503 = new Error(
  'exec failed (503): {"code":"HOST_EXECUTION_DISABLED"}',
);

/** A file-services probe over an in-memory workspace; git always 503s. */
function manifestProbe(files: Record<string, string>) {
  return {
    gitStatus: vi.fn(async () => {
      throw HOST_EXEC_503;
    }),
    gitDiff: vi.fn(async () => {
      throw HOST_EXEC_503;
    }),
    listFiles: vi.fn(async (path: string) => {
      if (path !== "." && path !== "") {
        throw new Error(`unexpected list path: ${path}`);
      }
      return {
        entries: Object.keys(files).map((name) => ({ name, type: "file" })),
      };
    }),
    readFile: vi.fn(async (path: string) => ({
      content: files[path] ?? "",
      size: (files[path] ?? "").length,
    })),
  } as unknown as WorkspaceChangeProbe;
}

const MANIFEST_CHECKPOINT = {
  checkpointId: "ckpt-manifest-1",
  label: "Pre-mutation: files.write",
  gitSha: "",
  kind: "manifest",
  manifest: { "index.html": sha256Hex(SCAFFOLD_HTML) },
} as unknown as CheckpointInfo;

describe("Lane B regression — change verification without git (staging shape)", () => {
  it("T1: reports 'changed' naming the written file when git is 503 but a manifest baseline exists", async () => {
    const probe = manifestProbe({ "index.html": HARBOR_HTML });
    const result = await computeWorkspaceChange(probe, MANIFEST_CHECKPOINT);
    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["index.html"]);
  });

  it("T1b: a zero-write run under the same 503 reports 'unchanged', not 'unknown' (run 32e3a25f control)", async () => {
    const probe = manifestProbe({ "index.html": SCAFFOLD_HTML });
    const result = await computeWorkspaceChange(probe, MANIFEST_CHECKPOINT);
    expect(result.status).toBe("unchanged");
    expect(result.files).toEqual([]);
  });

  it("T1c: a manifest checkpoint whose file services are unreachable still reports 'unknown', never a guess", async () => {
    const probe = {
      gitStatus: vi.fn(async () => {
        throw HOST_EXEC_503;
      }),
    } as unknown as WorkspaceChangeProbe;
    const result = await computeWorkspaceChange(probe, MANIFEST_CHECKPOINT);
    expect(result.status).toBe("unknown");
  });
});

describe("Lane B regression — baseline preservation across a failed re-checkpoint (Fix 1c)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "Building.",
        toolCalls: [
          { toolId: "files.mkdir", toolCallId: "tc-1", inputs: { path: "site" } },
          {
            toolId: "files.write",
            toolCallId: "tc-2",
            inputs: { projectId: "p-test", path: "site/index.html", content: HARBOR_HTML },
          },
        ],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });
  });

  it("T2: a failed checkpoint creation before a later mutating tool must not erase the threaded baseline", async () => {
    let n = 0;
    const transport = {
      workspaceId: "ws-test",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "p-test",
      mkdir: vi.fn(async () => ({ created: true })),
      writeFile: vi.fn(async () => ({ written: true })),
      readFile: vi.fn(async () => ({ content: HARBOR_HTML, size: HARBOR_HTML.length })),
      gitStatus: vi.fn(async () => ({
        branch: "main",
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [{ path: "index.html", status: "M" }],
        untracked: [],
        clean: false,
      })),
      // First mutation gets a valid baseline; every later re-checkpoint
      // fails the way a 503ing createWorkspaceCheckpoint does (null).
      createCheckpointBeforeMutation: vi.fn(async (label: string) => {
        n += 1;
        return n === 1
          ? { checkpointId: "cp-1", label, gitSha: "a".repeat(40) }
          : null;
      }),
    } as unknown as WorkspaceTransport;

    const result = await runAgentLoopV2("Build me a site", transport, {
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
      maxSteps: 5,
    });

    expect(result.toolCalls.every((c) => c.success)).toBe(true);
    // The finale still compares against the threaded baseline…
    expect(result.workspaceChange?.status).toBe("changed");
    expect(result.workspaceChange?.files).toContain("index.html");
    // …and the run's recorded checkpoint is that baseline, not undefined.
    expect(result.checkpoint?.checkpointId).toBe("cp-1");
  });
});

describe("Lane B regression — static preview must not need the dev server (Fix 2)", () => {
  it("T3: preview start for a static workspace reports ready with the static URL and never calls transport.startPreview", async () => {
    const startPreview = vi.fn(async () => {
      throw new Error("Preview start failed (503): HOST_EXECUTION_DISABLED");
    });
    const getPreviewStatus = vi.fn(async () => {
      throw new Error("Preview status failed (503): HOST_EXECUTION_DISABLED");
    });
    const transport = {
      workspaceId: "ws-6090dad2",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "6090dad2-0eba-4c6d-892e-0fa9d57adb05",
      isStaticWorkspace: true,
      startPreview,
      getPreviewStatus,
    } as unknown as WorkspaceTransport;

    const started = await handlePreviewStart({}, transport);
    expect(startPreview).not.toHaveBeenCalled();
    expect(started.success).toBe(true);
    expect(started.status).toBe("ready");
    expect(String(started.previewUrl)).toContain(
      "/api/preview/6090dad2-0eba-4c6d-892e-0fa9d57adb05/",
    );

    const status = await handlePreviewStatus({}, transport);
    expect(getPreviewStatus).not.toHaveBeenCalled();
    expect(status.success).toBe(true);
    expect(status.status).toBe("ready");
    expect(String(status.previewUrl)).toContain("/api/preview/");
  });
});
