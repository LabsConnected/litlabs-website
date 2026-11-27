// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

/**
 * P0 R8 — publishing integrity (Execution Integrity Contract §R8;
 * extends R3, no parallel system).
 *
 * Pinned here:
 *   (a) R3's boundary is closed: referenced SCRIPT and STYLESHEET
 *       (and standalone-CSS) references are verified at build
 *       completion in the same missing-assets settlement channel —
 *       not only by the deploy validator at publish time.
 *   (b) A deployment whose recorded outcome is not verified-ready
 *       (status not "ready", or live URL never verified) grounds NO
 *       completion claim — readDeploymentOutcome returns null.
 *   (c) Duplicate publishing is prevented at the operation level: a
 *       second project.deploy in the same run, with no successful
 *       mutation since the publish, replays the recorded outcome
 *       instead of executing — one authorized publish, one
 *       deployment, and no second approval gate either.
 *   (d) A successful mutation after the publish makes a later deploy
 *       a new operation (the guard stands down).
 */

vi.mock("../llm-tool-calling", async (original) => ({
  ...(await (original() as Promise<Record<string, unknown>>)),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/metering", () => ({
  emitUsageEvent: vi.fn(async () => ({})),
  getMeteringContext: vi.fn(() => null),
  runWithMeteringContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));

import { callLLMWithTools } from "../llm-tool-calling";
import {
  duplicateDeploymentReplay,
  readDeploymentOutcome,
  resumeAgentLoopV2,
  runAgentLoopV2,
  type AgentLoopConfig,
  type CompletedDeployment,
  type ResumeInput,
} from "../agent-loop-v2";
import { toolRegistry } from "../tool-registry";
import type { WorkspaceTransport } from "../workspace-transport";
import { buildAssistantToolCallMessage, type LLMMessage } from "../llm-tool-calling";

// ─── Shared fixtures ────────────────────────────────────────────────

const STABLE_URL = "https://litlabs.example/sites/project/p-test/";
const SNAPSHOT_URL = "https://litlabs.example/sites/dep-1/";

function deployPayload(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    deployment: {
      deploymentId: "dep-1",
      status: "ready",
      publicUrl: SNAPSHOT_URL,
      stablePublicUrl: STABLE_URL,
      urlVerified: true,
      target: "litt",
      projectId: "p-test",
      workspaceId: "ws-test",
      fileCount: 3,
      totalBytes: 1024,
      reused: false,
      ...overrides,
    },
    liveUrl: STABLE_URL,
    stablePublicUrl: STABLE_URL,
  };
}

function makeTransport(initialFiles: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const transport = {
    workspaceId: "ws-test",
    projectId: "p-test",
    userId: "u-test",
    workspaceRoot: "/workspace",
    fileOpsReachable: true,
    listFiles: vi.fn(async (dir: string) => {
      const prefix = dir ? `${dir}/` : "";
      const entries: { name: string; type: "file" | "directory" }[] = [];
      const seen = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        if (seen.has(head)) continue;
        seen.add(head);
        entries.push({ name: head, type: tail.length > 0 ? "directory" : "file" });
      }
      return { entries };
    }),
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`not found: ${path}`);
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return { saved: true };
    }),
    deleteFile: vi.fn(async (path: string) => {
      if (!files.delete(path)) throw new Error(`not found: ${path}`);
      return { deleted: true };
    }),
    createCheckpointBeforeMutation: vi.fn(async (label: string) => ({
      checkpointId: "cp-1",
      label,
      gitSha: "sha-1",
    })),
    exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 })),
    gitStatus: vi.fn(async () => ({
      branch: "main", ahead: 0, behind: 0, staged: [], modified: [], untracked: [], clean: true,
    })),
    gitDiff: vi.fn(async () => ({ diff: "" })),
    stat: vi.fn(async () => ({ kind: "unknown" })),
  } as unknown as WorkspaceTransport;
  return { transport, files };
}

// ─── (b) the recorded-outcome rule ──────────────────────────────────

describe("readDeploymentOutcome — completion rests on the recorded outcome (R8)", () => {
  it("a verified-ready deployment is a completed publish, with its outcome carried", () => {
    const outcome = readDeploymentOutcome("project.deploy", deployPayload());
    expect(outcome).not.toBeNull();
    expect(outcome!.deploymentId).toBe("dep-1");
    expect(outcome!.publicUrl).toBe(STABLE_URL);
    expect(outcome!.status).toBe("ready");
    expect(outcome!.urlVerified).toBe(true);
    expect(outcome!.reused).toBe(false);
  });

  it("an unverified live URL grounds no completion claim", () => {
    expect(readDeploymentOutcome("project.deploy", deployPayload({ urlVerified: false }))).toBeNull();
  });

  it("a non-ready deployment record grounds no completion claim", () => {
    expect(readDeploymentOutcome("project.deploy", deployPayload({ status: "building" }))).toBeNull();
    expect(readDeploymentOutcome("project.deploy", deployPayload({ status: "failed" }))).toBeNull();
  });

  it("failed or record-less results stay null; a record-less success keeps the legacy acceptance", () => {
    expect(readDeploymentOutcome("project.deploy", { success: false })).toBeNull();
    expect(readDeploymentOutcome("files.write", deployPayload())).toBeNull();
    const legacy = readDeploymentOutcome("project.deploy", { success: true, liveUrl: STABLE_URL });
    expect(legacy).not.toBeNull();
    expect(legacy!.status).toBeNull();
    expect(legacy!.urlVerified).toBeNull();
  });
});

// ─── (c)/(d) the duplicate guard, unit level ────────────────────────

describe("duplicateDeploymentReplay", () => {
  const completed: CompletedDeployment = {
    deploymentId: "dep-1",
    publicUrl: STABLE_URL,
    stablePublicUrl: STABLE_URL,
    status: "ready",
    urlVerified: true,
    reused: false,
  };
  const deployOk = { toolId: "project.deploy", success: true, mutating: true };
  const writeOk = { toolId: "files.write", success: true, mutating: true };
  const writeFail = { toolId: "files.write", success: false, mutating: true };

  it("(c) replays the recorded outcome when nothing changed since the publish", () => {
    const replay = duplicateDeploymentReplay(completed, [deployOk]);
    expect(replay).not.toBeNull();
    expect(replay!.duplicatePrevented).toBe(true);
    expect((replay!.deployment as { deploymentId: string }).deploymentId).toBe("dep-1");
    expect(replay!.liveUrl).toBe(STABLE_URL);
  });

  it("(d) stands down after a successful mutation — a new publish is a new operation", () => {
    expect(duplicateDeploymentReplay(completed, [deployOk, writeOk])).toBeNull();
  });

  it("a FAILED mutation changes nothing — the replay still applies", () => {
    expect(duplicateDeploymentReplay(completed, [deployOk, writeFail])).not.toBeNull();
  });

  it("no completed deployment — no replay", () => {
    expect(duplicateDeploymentReplay(null, [deployOk])).toBeNull();
    expect(duplicateDeploymentReplay(completed, [])).toBeNull();
  });
});

// ─── (a) completion-time verification of script/stylesheet refs ─────

describe("build completion verifies script/stylesheet references (R8 closes R3's boundary)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  const PAGE =
    "<!doctype html><html><head><title>Bakery</title>" +
    '<link rel="stylesheet" href="styles.css">' +
    '<script src="app.js"></script></head>' +
    "<body><h1>Crumb & Craft</h1><p>Fresh bread daily.</p></body></html>";
  const CSS = "body { background-image: url(assets/bg.png); }";

  function makeConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
    return {
      maxSteps: 8,
      maxRuntimeMs: 600_000,
      maxOutputChars: 40_000,
      maxRetries: 0,
      executionMode: "auto",
      systemPrompt: "test system prompt",
      enableBuildFix: false,
      userId: "u-test",
      isStaticWorkspace: true,
      ...overrides,
    };
  }

  async function runBuild(files: Record<string, string>) {
    const { transport } = makeTransport(files);
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "Writing the page.",
      model: "test-model",
      finishReason: "tool_calls",
      toolCalls: [
        {
          toolId: "files.write",
          toolCallId: "tc-write-1",
          inputs: { projectId: "p-test", path: "index.html", content: PAGE },
        },
      ],
    } as never);
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Done.",
      model: "test-model",
      finishReason: "stop",
      toolCalls: [],
    } as never);
    return runAgentLoopV2("Build the bakery page", transport, makeConfig());
  }

  it("a missing script and a missing CSS-referenced asset settle the run failed at completion", async () => {
    const result = await runBuild({ "styles.css": CSS });
    const missing = result.failureContributors?.find((c) => c.kind === "missing_assets");
    expect(missing).toBeDefined();
    expect(missing!.detail).toContain("app.js");
    expect(missing!.detail).toContain("assets/bg.png");
  });

  it("the same build with every referenced file present has no missing-assets contributor", async () => {
    const result = await runBuild({
      "styles.css": CSS,
      "app.js": "console.log('bakery');",
      "assets/bg.png": "png-bytes",
    });
    const missing = result.failureContributors?.find((c) => c.kind === "missing_assets");
    expect(missing).toBeUndefined();
  });
});

// ─── (c)/(b) loop level: one publish per operation; unverified ≠ done ──

describe("agent loop publishing integrity (R8)", () => {
  let executeSpy: MockInstance<typeof toolRegistry.execute>;

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    executeSpy = vi.spyOn(toolRegistry, "execute");
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  function pausedDeployInput(inputs: Record<string, unknown>): ResumeInput {
    const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
      [{ toolId: "project.deploy", toolCallId: "tc-deploy-1", inputs }],
      "Publishing the site.",
      undefined,
    );
    return {
      pausedMessages: [
        { role: "user", content: "Build the bakery site and publish it" },
        assistantMsg,
      ],
      toolId: "project.deploy",
      toolCallId: "tc-deploy-1",
      inputs,
      decision: "approved",
      config: {
        systemPrompt: "test system prompt",
        executionMode: "act",
        enableBuildFix: false,
      },
      stepsUsedBeforePause: 2,
      hadInterveningMutation: true,
    };
  }

  it("(c) a retried publish in the same run replays — the deploy executes exactly once, no second gate", async () => {
    executeSpy.mockImplementation(async (toolId: string) => {
      expect(toolId).toBe("project.deploy");
      return { ok: true, result: deployPayload() } as never;
    });
    // The model re-emits project.deploy after the approved publish —
    // with different inputs, so the exact-input dedupe cannot catch
    // it; the operation-level guard must.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "Publishing again to be sure.",
      model: "test-model",
      finishReason: "tool_calls",
      toolCalls: [{ toolId: "project.deploy", toolCallId: "tc-deploy-2", inputs: { target: "litt" } }],
    } as never);
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Your site is live.",
      model: "test-model",
      finishReason: "stop",
      toolCalls: [],
    } as never);

    const { transport } = makeTransport();
    const result = await resumeAgentLoopV2(pausedDeployInput({}), transport);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(result.pendingApproval).toBeUndefined();
    const replayed = result.toolCalls.find(
      (c) => c.toolId === "project.deploy" && c.summary.includes("publish already completed"),
    );
    expect(replayed).toBeDefined();
    // The recorded outcome rides the result beside the logical run ID.
    expect(result.deployment).toBeDefined();
    expect(result.deployment!.deploymentId).toBe("dep-1");
    expect(result.deployment!.publicUrl).toBe(STABLE_URL);
    expect(result.logicalRunId).toBeDefined();
  });

  it("(b) an unverified deploy outcome does not ground the run's completion claim", async () => {
    executeSpy.mockImplementation(async (toolId: string) => {
      expect(toolId).toBe("project.deploy");
      return { ok: true, result: deployPayload({ urlVerified: false }) } as never;
    });
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Your site is live.",
      model: "test-model",
      finishReason: "stop",
      toolCalls: [],
    } as never);

    const { transport } = makeTransport();
    const result = await resumeAgentLoopV2(pausedDeployInput({}), transport);

    // The deploy executed (it was approved) — but the run records no
    // completed deployment and guarantees no live URL in its text.
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(result.deployment ?? null).toBeNull();
    expect(result.finalText).not.toContain(STABLE_URL);
  });
});
