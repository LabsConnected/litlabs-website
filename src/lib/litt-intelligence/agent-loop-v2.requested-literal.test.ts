import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";

/**
 * ACC-01 F9 (staging, 2026-11-23): "Change the tagline under the bakery
 * name to Fresh from the oven every morning" landed in index.html as
 * "Fresh from1 the oven every morning." — and the run reported success,
 * quoting the corrupted text. The F1 read-back proved a file changed;
 * nothing checked the change against the requested text.
 *
 * These tests reproduce that shape end-to-end through the loop: when
 * the model's edit misses the literal it was asked for, the mismatch
 * is fed back ONCE for a repair attempt, and if the text still isn't
 * there the run settles failedHonestly — never a false "Done".
 */
describe("runAgentLoopV2 — requested-literal verification (ACC-01 F9)", () => {
  function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
    return {
      text: "",
      toolCalls: [{ toolCallId, toolId, inputs }],
      finishReason: "tool_calls",
      model: "test-model",
    };
  }
  const doneReply = {
    text: 'The tagline has been updated to "Fresh from the oven every morning."',
    toolCalls: [],
    finishReason: "stop",
    model: "test-model",
  };

  const ORIGINAL = [
    "<!DOCTYPE html>",
    "<html>",
    "<head><title>Sunny Crust Bakery</title></head>",
    "<body>",
    "<h1>Sunny Crust Bakery</h1>",
    '<p class="tagline">Freshly baked, with love and sunshine.</p>',
    "<p>Welcome to Sunny Crust.</p>",
    "</body>",
    "</html>",
  ].join("\n");

  const CORRUPTED = ORIGINAL.replace(
    "Freshly baked, with love and sunshine.",
    "Fresh from1 the oven every morning.",
  );
  const CORRECTED = ORIGINAL.replace(
    "Freshly baked, with love and sunshine.",
    "Fresh from the oven every morning.",
  );

  function memoryTransport() {
    const files = new Map<string, string>([["index.html", ORIGINAL]]);
    const transport = {
      workspaceId: "ws-test",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "p-test",
      createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
      readFile: vi.fn(async (p: string) => {
        const content = files.get(p);
        if (content === undefined) throw new Error(`404 not found: ${p}`);
        return { content, size: content.length };
      }),
      writeFile: vi.fn(async (p: string, content: string) => {
        files.set(p, content);
        return { saved: true };
      }),
      listFiles: vi.fn(async (dir: string) => ({
        entries: [...files.keys()]
          .filter((k) => (dir === "." ? !k.includes("/") : k.startsWith(`${dir}/`)))
          .map((k) => ({ name: k.split("/").pop() as string, type: "file" })),
      })),
    } as unknown as WorkspaceTransport;
    return { transport, files };
  }

  const INSTRUCTION =
    "Change the tagline under the bakery name to Fresh from the oven every morning";
  const config = {
    model: "test-model",
    systemPrompt: "You are LiTT.",
    executionMode: "auto" as const,
    enableBuildFix: false,
  };

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("settles failedHonestly when the edit lands corrupted and the repair chance is not taken", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: CORRUPTED }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(INSTRUCTION, transport, config);

    // The corrupted bytes really are what landed on disk.
    expect(files.get("index.html")).toContain("Fresh from1 the oven");
    // The mismatch was fed back for one repair attempt: the second
    // model call's messages carry the verification feedback.
    const secondCallMessages = vi.mocked(callLLMWithTools).mock.calls[1][1] as Array<{
      role: string;
      content: string;
    }>;
    expect(
      secondCallMessages.some(
        (m) => m.role === "user" && m.content.includes("Verification failed") && m.content.includes("Fresh from the oven every morning"),
      ),
    ).toBe(true);
    // And the run must NOT report success: it settles honestly failed,
    // with the user-facing text naming the unconfirmed literal.
    expect(result.failedHonestly).toBeTruthy();
    expect(result.failedHonestly).toContain("Fresh from the oven every morning");
    expect(result.finalText).toBe(result.failedHonestly);
    expect(result.finalText).not.toContain("has been updated");
  });

  it("succeeds when the model repairs the miss after the feedback", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: CORRUPTED }),
      )
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "index.html", content: CORRECTED }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(INSTRUCTION, transport, config);

    expect(files.get("index.html")).toContain("Fresh from the oven every morning.");
    expect(result.failedHonestly).toBeUndefined();
    expect(result.finalText).toContain("has been updated");
  });

  it("succeeds without any feedback when the literal lands the first time", async () => {
    const { transport } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: CORRECTED }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(INSTRUCTION, transport, config);

    expect(result.failedHonestly).toBeUndefined();
    const secondCallMessages = vi.mocked(callLLMWithTools).mock.calls[1][1] as Array<{
      role: string;
      content: string;
    }>;
    expect(
      secondCallMessages.some((m) => typeof m.content === "string" && m.content.includes("Verification failed")),
    ).toBe(false);
  });

  it("does not gate a paraphrased edit that specified no literal", async () => {
    const { transport } = memoryTransport();
    const withPastries = ORIGINAL.replace(
      "Welcome to Sunny Crust.",
      "Welcome to Sunny Crust — try our fresh pastries.",
    );
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: withPastries }),
      )
      .mockResolvedValueOnce({ text: "Done — the welcome paragraph now mentions fresh pastries.", toolCalls: [], finishReason: "stop", model: "test-model" });

    const result = await runAgentLoopV2(
      "mention fresh pastries in the welcome paragraph",
      transport,
      config,
    );

    expect(result.failedHonestly).toBeUndefined();
  });

  it("settles failedHonestly when the model dies during repair and the literal never landed", async () => {
    // Paid-beta blocker: the literal/completion read-back checks were
    // guarded by !modelFailed, so a provider failure during the bounded
    // correction attempt skipped verification entirely and the run
    // settled completed-with-warning on an unverified mutation.
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: CORRUPTED }),
      )
      .mockRejectedValue(new Error("provider 429: rate limited"));

    const result = await runAgentLoopV2(INSTRUCTION, transport, config);

    expect(files.get("index.html")).toContain("Fresh from1 the oven");
    expect(result.failedHonestly).toBeTruthy();
    expect(result.failedHonestly).toContain("Fresh from the oven every morning");
    expect(result.finalText).toBe(result.failedHonestly);
  });
});
