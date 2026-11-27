// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * P0 R4 (execution integrity) — provider transition reasons persist
 * on the run record (audit D6).
 *
 * The defect: model_routing events carried only from/to model names
 * and were deliberately NOT persisted (stream noise); the per-attempt
 * failure reasons stayed in server logs. A finished run's record
 * could not answer "why did the model change mid-build?"
 *
 * The contract these tests pin:
 *   - when a step is served by a different model after failed
 *     attempts, the run result carries a modelTransitions entry with
 *     previous model, current model, the failure-class reason, and
 *     the sanitized failover attempts (provider/model/class/status —
 *     NEVER the raw upstream message);
 *   - a build-guard switch records its own transition with reason
 *     "no_file_write_calls";
 *   - a clean run (requested model serves, no failed attempts)
 *     records no transitions;
 *   - transitions are also emitted as model_transition progress
 *     events — the channel the persistence layer stores as action
 *     events.
 */

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));
vi.mock("@/lib/site-enrich/resolver", () => ({
  resolveSlotImage: vi.fn(async () => null),
}));

import { runAgentLoopV2, resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { buildAssistantToolCallMessage, callLLMWithTools } from "./llm-tool-calling";

const PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Sunny Crust Bakery</title>",
  "<style>body { background: #ffffff; color: #1c1917; }</style>",
  "</head><body><h1>Sunny Crust Bakery</h1><p>Fresh from the oven.</p></body></html>",
].join("\n");

function makeTransport() {
  const files = new Map<string, string>();
  for (let i = 1; i <= 40; i++) files.set(`page-${i}.html`, PAGE);
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    lastCheckpointError: null as string | null,
    createCheckpointBeforeMutation: vi.fn(async () => null),
    readFile: vi.fn(async (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`404 not found: ${p}`);
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (p: string, content: string) => {
      files.set(p, content);
      return { saved: true };
    }),
    mkdir: vi.fn(async () => ({ created: true })),
    listFiles: vi.fn(async (dir: string) => {
      const prefix = dir === "" || dir === "." ? "" : `${dir.replace(/\/$/, "")}/`;
      const entries = new Map<string, string>();
      for (const k of files.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (!rest) continue;
        const seg = rest.split("/")[0];
        entries.set(seg, rest.includes("/") ? "directory" : "file");
      }
      return { entries: [...entries].map(([name, type]) => ({ name, type })) };
    }),
    gitStatus: vi.fn(async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [],
      clean: true,
    })),
  } as unknown as WorkspaceTransport;
  return { transport, files };
}

const autoConfig = {
  model: "test-model",
  systemPrompt: "You are LiTT.",
  executionMode: "auto" as const,
  enableBuildFix: false,
  isStaticWorkspace: true,
};

describe("P0 R4 — model transitions persist with their reasons", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("records previous model, current model, and the failure-class reason after a failover", async () => {
    const { transport } = makeTransport();
    vi.mocked(callLLMWithTools)
      .mockImplementationOnce(async (_sp, _msgs, _tools, opts) => {
        // The router's first route rate-limited; a fallback served.
        (opts as { onRouteAttempts?: (a: unknown[]) => void }).onRouteAttempts?.([
          {
            provider: "openrouter",
            model: "cohere/north-mini-code:free",
            class: "rate_limited",
            httpStatus: 429,
            latencyMs: 120,
            message: "upstream echoed secret-ish-diagnostic-text",
          },
        ]);
        return {
          text: "",
          toolCalls: [
            { toolCallId: "tc-1", toolId: "files.write", inputs: { projectId: "p-test", path: "index.html", content: PAGE } },
          ],
          finishReason: "tool_calls",
          model: "gemini-2.5-flash",
          provider: "gemini",
        };
      })
      .mockResolvedValueOnce({
        text: "Your bakery site is ready.",
        toolCalls: [],
        finishReason: "stop",
        model: "gemini-2.5-flash",
        provider: "gemini",
      });

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      autoConfig,
    );

    expect(result.modelTransitions).toHaveLength(1);
    const t = result.modelTransitions![0];
    expect(t.from).toBe("test-model");
    expect(t.to).toBe("gemini-2.5-flash");
    expect(t.provider).toBe("gemini");
    expect(t.reason).toBe("rate_limited");
    expect(t.failover).toEqual([
      { provider: "openrouter", model: "cohere/north-mini-code:free", class: "rate_limited", httpStatus: 429 },
    ]);
    // The raw upstream message never reaches the persisted record.
    expect(JSON.stringify(result.modelTransitions)).not.toContain("secret-ish-diagnostic-text");
    // The transition was also emitted for the persistence layer.
    const ev = result.events.find((e) => e.type === "model_transition");
    expect(ev).toMatchObject({ from: "test-model", to: "gemini-2.5-flash", reason: "rate_limited" });
    // …and the routing event itself carries the failover evidence.
    const routing = result.events.find((e) => e.type === "model_routing");
    expect(routing && "failover" in routing ? routing.failover : undefined).toHaveLength(1);
  });

  it("records no transitions on a clean run", async () => {
    const { transport } = makeTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { toolCallId: "tc-1", toolId: "files.write", inputs: { projectId: "p-test", path: "index.html", content: PAGE } },
        ],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "Your bakery site is ready.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      autoConfig,
    );

    expect(result.modelTransitions).toBeUndefined();
    expect(result.events.some((e) => e.type === "model_transition")).toBe(false);
  });

  it("records a build-guard switch as a transition with its reason (resumed segment)", async () => {
    const { transport } = makeTransport();
    const readStep = (n: number) => ({
      text: "",
      toolCalls: [
        { toolCallId: `tc-read-${n}`, toolId: "files.read", inputs: { projectId: "p-test", path: `page-${n}.html` } },
      ],
      finishReason: "tool_calls",
      model: "cohere/north-mini-code:free",
      provider: "openrouter",
    });
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(readStep(1))
      .mockResolvedValueOnce(readStep(2))
      .mockResolvedValueOnce(readStep(3))
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { toolCallId: "tc-write-1", toolId: "files.write", inputs: { projectId: "p-test", path: "index.html", content: PAGE } },
        ],
        finishReason: "tool_calls",
        model: "gemini-2.5-flash",
        provider: "gemini",
      })
      .mockResolvedValueOnce({
        text: "Your bakery site is ready.",
        toolCalls: [],
        finishReason: "stop",
        model: "gemini-2.5-flash",
        provider: "gemini",
      });

    const assistantMsg = buildAssistantToolCallMessage(
      [{ toolId: "files.mkdir", toolCallId: "tc-0", inputs: { path: "assets" } }],
      "Building the bakery site.",
      undefined,
    );
    const resume: ResumeInput = {
      pausedMessages: [
        { role: "user", content: "Build a one-page website for a bakery called Sunny Crust Bakery" },
        assistantMsg,
      ],
      toolId: "files.mkdir",
      toolCallId: "tc-0",
      inputs: { path: "assets" },
      decision: "approved",
      config: {
        ...autoConfig,
        userId: "u-test",
        maxSteps: 40,
        buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
      },
      stepsUsedBeforePause: 1,
      hadInterveningMutation: false,
    };

    const result = await resumeAgentLoopV2(resume, transport);

    const guardTransition = (result.modelTransitions ?? []).find(
      (t) => t.reason === "no_file_write_calls",
    );
    expect(guardTransition).toBeDefined();
    expect(guardTransition?.from).toBe("openrouter-north-mini-code");
    expect(guardTransition?.to).not.toBe(guardTransition?.from);
    expect(
      result.events.some((e) => e.type === "model_transition" && e.reason === "no_file_write_calls"),
    ).toBe(true);
  });
});
