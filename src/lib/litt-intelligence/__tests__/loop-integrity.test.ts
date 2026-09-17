import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Mock the LLM transport layer: the repair callback's model turns are
// scripted per-test via this mock. Everything else in llm-tool-calling
// (message builders) stays real.
vi.mock("@/lib/litt-intelligence/llm-tool-calling", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/lib/litt-intelligence/llm-tool-calling")>();
  return { ...mod, callLLMWithTools: vi.fn() };
});

import { callLLMWithTools } from "@/lib/litt-intelligence/llm-tool-calling";
import {
  createAutonomousRepairCallback,
  handlerFailureError,
} from "@/lib/litt-intelligence/agent-loop-v2";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";

const callLLMMock = callLLMWithTools as unknown as ReturnType<typeof vi.fn>;

const AGENT_LOOP_SRC = fs.readFileSync(
  path.join(__dirname, "..", "agent-loop-v2.ts"),
  "utf-8",
);

const mockTransport = {
  readFile: vi.fn().mockResolvedValue("file content"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  listFiles: vi.fn().mockResolvedValue([]),
  exists: vi.fn().mockResolvedValue(true),
  runCommand: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
};

function scriptedModelTurns(toolCalls: Array<Record<string, unknown>>) {
  // The repair callback runs up to 5 rounds; every round the model emits
  // the same tool call, then the callback exhausts rounds and returns true.
  callLLMMock.mockImplementation(async () => ({
    toolCalls,
    text: "",
    rawParts: [],
  }));
}

describe("loop-integrity: repair callback permission gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ACT mode: repair callback does NOT execute a mutating tool that requires approval", async () => {
    scriptedModelTurns([
      {
        toolCallId: "repair-1",
        toolId: "files.write",
        inputs: { projectId: "p1", path: "index.html", content: "<h1>x</h1>" },
      },
    ]);

    const executeSpy = vi.spyOn(toolRegistry, "execute");

    const repair = createAutonomousRepairCallback(
      mockTransport as never,
      "You are LiTT.",
      [],
      Date.now() + 300_000,
      undefined,
      "act",
    );
    await repair(1, "Build error: syntax error");

    // files.write requires approval in ACT mode (approval-resume.test.ts
    // pins that contract). The repair callback has no one to approve, so
    // it must fail closed — execute must never be called for it.
    expect(
      executeSpy.mock.calls.some((c) => c[0] === "files.write"),
    ).toBe(false);
    executeSpy.mockRestore();
  });

  it("aborted signal: repair callback never starts a tool call", async () => {
    scriptedModelTurns([
      {
        toolCallId: "repair-1",
        toolId: "files.write",
        inputs: { projectId: "p1", path: "index.html", content: "<h1>x</h1>" },
      },
    ]);
    const executeSpy = vi.spyOn(toolRegistry, "execute");
    const controller = new AbortController();
    controller.abort();

    const repair = createAutonomousRepairCallback(
      mockTransport as never,
      "You are LiTT.",
      [],
      Date.now() + 300_000,
      controller.signal,
      "act",
    );
    const result = await repair(1, "Build error: syntax error");

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result).toBe(false);
    executeSpy.mockRestore();
  });
});

describe("loop-integrity: domain-failure normalization", () => {
  it("handlerFailureError returns the error for { success: false } payloads", () => {
    expect(handlerFailureError({ success: false, error: "boom" })).toBe("boom");
    expect(handlerFailureError({ success: false })).toContain("success");
    expect(handlerFailureError({ success: true })).toBeNull();
    expect(handlerFailureError(null)).toBeNull();
    expect(handlerFailureError("text")).toBeNull();
  });

  it("resume-continuation execute site normalizes handler failures", () => {
    // The :1366 site previously recorded { ok: true, payload: { success: false } }
    // as success:true (phantom mutation → false "completed").
    expect(
      AGENT_LOOP_SRC.match(
        /resumeAgentLoopV2[\s\S]{0,4000}const handlerError = handlerFailureError\(execResult\.result\)/,
      ),
    ).not.toBeNull();
  });

  it("repair-callback execute site normalizes handler failures", () => {
    expect(
      AGENT_LOOP_SRC.match(
        /createAutonomousRepairCallback[\s\S]{0,6000}const handlerError = execResult\.ok \? handlerFailureError\(execResult\.result\) : null/,
      ),
    ).not.toBeNull();
  });
});

describe("loop-integrity: stop stops in-flight tools", () => {
  it("every toolRegistry.execute site is guarded by a cfg.signal.aborted check", () => {
    const guardCount = (AGENT_LOOP_SRC.match(/if \((?:cfg\.signal|signal)\?\.aborted\)/g) ?? []).length;
    // initial loop, resume approved-tool, resume continuation loop, repair callback
    expect(guardCount).toBeGreaterThanOrEqual(4);
  });

  it("resume continuation loop exits when cancelled", () => {
    expect(AGENT_LOOP_SRC).toMatch(
      /while \(stepsUsed < cfg\.maxSteps && !cancelled\)/,
    );
  });
});
