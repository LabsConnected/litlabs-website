// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P0 R7 — content/instruction separation (Execution Integrity
 * Contract §R7). REQUIRED regression test for the footer leakage.
 *
 * Origin: Acceptance Run 1 restart, 2026-11-26. A publish failed
 * because the deployment referenced two missing images. The user
 * sent a repair message describing the failure; the rebuild pasted
 * that message's text VERBATIM into the generated site's footer, and
 * the run reported success — internal repair instructions shipped as
 * website content.
 *
 * Pinned here:
 *   (a) the verbatim footer leak is caught — at module level and
 *       end-to-end through the agent loop (initial AND resume
 *       tails), where the run settles failed instead of success;
 *   (b) a clean page built from the same instruction passes;
 *   (c) text the user QUOTED as desired page content is not leakage;
 *   (d) known internal execution markers are leakage regardless of
 *       the instruction;
 *   (e) absent/truncated evidence is not a verdict (the evidence
 *       rules mirror the F9 requested-literal check).
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
  runAgentLoopV2,
  resumeAgentLoopV2,
  type AgentLoopConfig,
  type ResumeInput,
} from "../agent-loop-v2";
import {
  checkInstructionLeakage,
  extractInstructionChunks,
  instructionLeakageFailureMessage,
} from "../instruction-leakage";
import type { WorkspaceTransport } from "../workspace-transport";
import { buildAssistantToolCallMessage, type LLMMessage } from "../llm-tool-calling";

/** The acceptance run's repair message (2026-11-26), verbatim shape. */
const REPAIR_MESSAGE =
  "The publish failed because the deployment references 2 missing files: " +
  "index.html references assets/images/build-a-website-for-a-bakery-c-mwyatzxe.jpeg and " +
  "assets/images/build-a-website-for-a-bakery-c-mwyaybde.jpeg, which no longer exist. " +
  "Please restore those two images (or update index.html to reference images that exist), " +
  "and then publish the site.";

/** The incident page: real bakery content, with the repair message
 *  pasted verbatim into the footer. */
const LEAKED_PAGE =
  "<!doctype html><html><head><title>Crumb & Craft Bakery</title>" +
  "<style>body{font-family:Georgia,serif;margin:2rem}footer{margin-top:3rem;color:#555}</style></head>" +
  "<body><h1>Crumb & Craft Bakery</h1>" +
  "<p>Fresh sourdough, croissants, and cakes baked every morning in Grand Haven. " +
  "Visit us for warm bread, seasonal pies, and custom wedding cakes made to order.</p>" +
  `<footer><p>${REPAIR_MESSAGE}</p></footer>` +
  "</body></html>";

/** The same page with an honest footer. */
const CLEAN_PAGE = LEAKED_PAGE.replace(REPAIR_MESSAGE, "© 2026 Crumb & Craft Bakery — Grand Haven, MI.");

// ─── Module level ───────────────────────────────────────────────────

function reader(files: Record<string, string>) {
  return async (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`not found: ${path}`);
    return { content };
  };
}

describe("checkInstructionLeakage", () => {
  it("(a) catches the acceptance footer leak verbatim", async () => {
    const check = await checkInstructionLeakage({
      instructions: [REPAIR_MESSAGE],
      candidatePaths: ["index.html"],
      readFile: reader({ "index.html": LEAKED_PAGE }),
    });
    expect(check.applies).toBe(true);
    expect(check.leaked).toHaveLength(1);
    expect(check.leaked[0].path).toBe("index.html");
    expect(check.leaked[0].excerpt.length).toBeGreaterThanOrEqual(40);
  });

  it("(b) a clean page built from the same instruction passes", async () => {
    const check = await checkInstructionLeakage({
      instructions: [REPAIR_MESSAGE],
      candidatePaths: ["index.html"],
      readFile: reader({ "index.html": CLEAN_PAGE }),
    });
    expect(check.applies).toBe(true);
    expect(check.leaked).toEqual([]);
  });

  it("(c) text the user quoted as page content is not leakage", async () => {
    const instruction =
      'Set the homepage headline to "Fresh from the oven every morning, baked with love for Grand Haven"';
    const page =
      "<!doctype html><html><body><h1>Fresh from the oven every morning, baked with love for Grand Haven</h1></body></html>";
    const check = await checkInstructionLeakage({
      instructions: [instruction],
      candidatePaths: ["index.html"],
      readFile: reader({ "index.html": page }),
    });
    expect(check.leaked).toEqual([]);
  });

  it("(c2) loop-injected internal text in a page is leakage (coordination fix c)", async () => {
    // A quality/repair prompt the loop injected as role "user"
    // (origin: "internal") is execution text, not a customer
    // instruction: finding its sentences in a generated page is a
    // leak through the internalInstructions channel.
    const internal =
      "The visual quality inspection scored this page below the threshold, so redesign the hero section with stronger contrast and larger type.";
    const page =
      "<!doctype html><html><body><h1>Sunny Crust</h1>" +
      "<footer>The visual quality inspection scored this page below the threshold, so redesign the hero section with stronger contrast and larger type.</footer></body></html>";
    const check = await checkInstructionLeakage({
      instructions: ["Build a bakery homepage"],
      internalInstructions: [internal],
      candidatePaths: ["index.html"],
      readFile: reader({ "index.html": page }),
    });
    expect(check.applies).toBe(true);
    expect(check.leaked).toHaveLength(1);
    expect(check.leaked[0].path).toBe("index.html");
  });

  it("(c3) internal text gets NO quoted-content exemption (coordination fix c)", async () => {
    // The same long span, two provenances: quoted by the CUSTOMER
    // as desired page content it is exempt (test (c)); carried in
    // an INTERNAL message it is never customer content, so its
    // appearance on the page is leakage even though it is "quoted"
    // inside the internal text.
    const span = "Fresh from the oven every morning, baked with love for Grand Haven";
    // The span appears in the internal message twice: quoted (the
    // shape that WOULD earn the customer-path exemption — the
    // quoted span contains the chunk) and bare as its own sentence
    // (the chunk that matches the page). Internal text is processed
    // without the exemption, so the match stands as leakage.
    const internal = `The approved headline is "${span}". ${span}`;
    const page = `<!doctype html><html><body><h1>${span}</h1></body></html>`;
    const check = await checkInstructionLeakage({
      instructions: ["Build a bakery homepage"],
      internalInstructions: [internal],
      candidatePaths: ["index.html"],
      readFile: reader({ "index.html": page }),
    });
    expect(check.leaked).toHaveLength(1);
  });

  it("(d) an internal execution marker is leakage whatever the instruction was", async () => {
    const page =
      "<!doctype html><html><body><p>Welcome.</p>" +
      "<footer>Deployment references 2 missing file(s): assets/images/hero.jpeg</footer></body></html>";
    const check = await checkInstructionLeakage({
      instructions: ["Build a bakery homepage"],
      candidatePaths: ["index.html"],
      readFile: reader({ "index.html": page }),
    });
    expect(check.applies).toBe(true);
    expect(check.leaked).toHaveLength(1);
    expect(check.leaked[0].excerpt).toBe("missing file(s):");
  });

  it("(e) no mutated HTML pages — the check does not apply", async () => {
    const check = await checkInstructionLeakage({
      instructions: [REPAIR_MESSAGE],
      candidatePaths: ["notes.md", "app.js"],
      readFile: reader({ "notes.md": REPAIR_MESSAGE, "app.js": REPAIR_MESSAGE }),
    });
    expect(check.applies).toBe(false);
    expect(check.leaked).toEqual([]);
  });

  it("(e) a truncated candidate set with no find is unknown, never a pass verdict", async () => {
    const files: Record<string, string> = {};
    const paths: string[] = [];
    for (let i = 0; i < 9; i++) {
      const p = `page-${i}.html`;
      paths.push(p);
      files[p] = CLEAN_PAGE;
    }
    // The leak sits in the ninth page — outside the read budget.
    files["page-8.html"] = LEAKED_PAGE;
    const check = await checkInstructionLeakage({
      instructions: [REPAIR_MESSAGE],
      candidatePaths: paths,
      readFile: reader(files),
    });
    expect(check.applies).toBe(false);
    expect(check.leaked).toEqual([]);
  });

  it("chunk extraction keeps substantial sentences and drops short phrasing", () => {
    const chunks = extractInstructionChunks(REPAIR_MESSAGE);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.length >= 40)).toBe(true);
    expect(extractInstructionChunks("Fix it.")).toEqual([]);
  });

  it("the failure message names the page and the leak honestly", () => {
    const msg = instructionLeakageFailureMessage([{ path: "index.html", excerpt: "x" }]);
    expect(msg).toContain("index.html");
    expect(msg).toContain("never appear in a generated site");
  });
});

// ─── Loop level: the regression, end to end ─────────────────────────

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
    ...overrides,
  };
}

describe("agent loop instruction-leakage guard (R7 regression)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("(a) initial loop: a rebuild that pastes the repair message into the footer settles FAILED", async () => {
    const { transport } = makeTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "Rebuilding the page with the restored images.",
      model: "test-model",
      finishReason: "tool_calls",
      toolCalls: [
        {
          toolId: "files.write",
          toolCallId: "tc-write-1",
          inputs: { projectId: "p-test", path: "index.html", content: LEAKED_PAGE },
        },
      ],
    } as never);
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "The site is rebuilt and ready.",
      model: "test-model",
      finishReason: "stop",
      toolCalls: [],
    } as never);

    const result = await runAgentLoopV2(REPAIR_MESSAGE, transport, makeConfig());

    expect(result.failedHonestly).toBeDefined();
    expect(result.failedHonestly).toContain("own instructions");
    expect(result.failedHonestly).toContain("index.html");
    expect(result.finalText).toBe(result.failedHonestly);
  });

  it("(b) initial loop: the same rebuild with an honest footer is NOT failed by the guard", async () => {
    const { transport } = makeTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "Rebuilding the page with the restored images.",
      model: "test-model",
      finishReason: "tool_calls",
      toolCalls: [
        {
          toolId: "files.write",
          toolCallId: "tc-write-1",
          inputs: { projectId: "p-test", path: "index.html", content: CLEAN_PAGE },
        },
      ],
    } as never);
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "The site is rebuilt and ready.",
      model: "test-model",
      finishReason: "stop",
      toolCalls: [],
    } as never);

    const result = await runAgentLoopV2(REPAIR_MESSAGE, transport, makeConfig());

    expect(result.failedHonestly ?? "").not.toContain("own instructions");
  });

  it("(a2) resume loop: an approved rebuild carrying the leak settles FAILED", async () => {
    const { transport } = makeTransport();
    const inputs = { projectId: "p-test", path: "index.html", content: LEAKED_PAGE };
    const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
      [{ toolId: "files.write", toolCallId: "tc-write-1", inputs }],
      "Rebuilding the page.",
      undefined,
    );
    const resumeInput: ResumeInput = {
      pausedMessages: [{ role: "user", content: REPAIR_MESSAGE }, assistantMsg],
      toolId: "files.write",
      toolCallId: "tc-write-1",
      inputs,
      decision: "approved",
      config: {
        systemPrompt: "test system prompt",
        executionMode: "auto",
        enableBuildFix: false,
      },
      stepsUsedBeforePause: 1,
      hadInterveningMutation: false,
    };
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "The site is rebuilt and ready.",
      model: "test-model",
      finishReason: "stop",
      toolCalls: [],
    } as never);

    const result = await resumeAgentLoopV2(resumeInput, transport);

    expect(result.failedHonestly).toBeDefined();
    expect(result.failedHonestly).toContain("own instructions");
  });
});
