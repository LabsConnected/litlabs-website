import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";

/**
 * ACC-02 Defect A (staging Acceptance Run 2, 2026-11-24): the build
 * of a one-page bakery site reported success — its closing message
 * even described a "glassmorphic dark theme" with a "near-black
 * background" — while the page it wrote rendered its tagline and
 * opening-hours times invisibly: light text colors declared for the
 * intended dark theme, on a document whose effective background
 * stayed light.
 *
 * These tests reproduce that shape end-to-end through the loop: when
 * a written page's text would be invisible under its own declared
 * colors, the mismatch is fed back ONCE for a repair attempt, and if
 * the text still cannot be read the run settles failedHonestly —
 * never a false "Done".
 */
describe("runAgentLoopV2 — invisible-text verification (ACC-02 Defect A)", () => {
  function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
    return {
      text: "",
      toolCalls: [{ toolCallId, toolId, inputs }],
      finishReason: "tool_calls",
      model: "test-model",
    };
  }
  const doneReply = {
    text: "Your bakery site is live — a glassmorphic dark theme with a lime accent and near-black background.",
    toolCalls: [],
    finishReason: "stop",
    model: "test-model",
  };

  // The Run 2 shape: the tagline and the hours times carry light
  // colors written for the dark theme the reply describes, while the
  // body background the document actually declares is white.
  const INVISIBLE = [
    "<!DOCTYPE html>",
    "<html>",
    "<head><title>Sunny Crust Bakery</title>",
    "<style>",
    "  body { background: #ffffff; font-family: sans-serif; }",
    "  h1 { color: #1c1917; }",
    "  .tagline { color: #f5f5f4; }",
    "  .label { color: #44403c; }",
    "  .hours-time { color: #e7e5e4; }",
    "</style>",
    "</head>",
    "<body>",
    "  <h1>Sunny Crust Bakery</h1>",
    '  <p class="tagline">Fresh from the oven every morning.</p>',
    '  <p><span class="label">Monday - Friday:</span> <span class="hours-time">7:00 AM - 5:00 PM</span></p>',
    "</body>",
    "</html>",
  ].join("\n");

  // The repair the feedback asks for: the dark background the design
  // intended, actually declared on body.
  const FIXED = INVISIBLE.replace("background: #ffffff", "background: #03050a")
    .replace("h1 { color: #1c1917; }", "h1 { color: #f5f5f4; }")
    .replace(".label { color: #44403c; }", ".label { color: #d6d3d1; }");

  function memoryTransport() {
    const files = new Map<string, string>();
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

  const INSTRUCTION = "Build a one-page website for a bakery called Sunny Crust Bakery";
  const config = {
    model: "test-model",
    systemPrompt: "You are LiTT.",
    executionMode: "auto" as const,
    enableBuildFix: false,
  };

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("settles failedHonestly when the page ships invisible text and the repair chance is not taken", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: INVISIBLE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(INSTRUCTION, transport, config);

    // The invisible page really is what landed on disk.
    expect(files.get("index.html")).toContain("background: #ffffff");
    // The mismatch was fed back for one repair attempt: the second
    // model call's messages carry the contrast feedback.
    const secondCallMessages = vi.mocked(callLLMWithTools).mock.calls[1][1] as Array<{
      role: string;
      content: string;
    }>;
    expect(
      secondCallMessages.some(
        (m) => m.role === "user" && m.content.includes("Verification failed") && m.content.includes("INVISIBLE"),
      ),
    ).toBe(true);
    // And the run must NOT report success: it settles honestly failed,
    // naming the invisible text instead of the model's theme claim.
    expect(result.failedHonestly).toBeTruthy();
    expect(result.failedHonestly).toContain("invisible");
    expect(result.failedHonestly).toContain("Fresh from the oven every morning.");
    expect(result.finalText).toBe(result.failedHonestly);
    expect(result.finalText).not.toContain("glassmorphic");
  });

  it("succeeds when the model repairs the CSS after the feedback", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: INVISIBLE }),
      )
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "index.html", content: FIXED }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(INSTRUCTION, transport, config);

    expect(files.get("index.html")).toContain("background: #03050a");
    expect(result.failedHonestly).toBeUndefined();
    expect(result.finalText).toContain("glassmorphic dark theme");
  });

  it("succeeds without any feedback when the page is readable the first time", async () => {
    const { transport } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: FIXED }),
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
});

describe("runAgentLoopV2 — unverifiable runtime colors (ACC-03)", () => {
  function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
    return {
      text: "",
      toolCalls: [{ toolCallId, toolId, inputs }],
      finishReason: "tool_calls",
      model: "test-model",
    };
  }
  const doneReply = {
    text: "Your bakery site is live.",
    toolCalls: [],
    finishReason: "stop",
    model: "test-model",
  };

  // Colors decided entirely by palette utilities the checker will
  // not guess: before ACC-03 this page passed the contrast check
  // silently (the Tailwind runtime made the whole document
  // "unreasoned" and unreasoned meant ignored). It is the same
  // blind spot that shipped Run 1's blank page, one shape over.
  const UNVERIFIABLE = [
    "<!DOCTYPE html>",
    "<html>",
    "<head><title>Sunny Crust Bakery</title>",
    '  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>',
    "</head>",
    "<body>",
    '  <section class="bg-zinc-900">',
    '    <p class="text-zinc-100">Fresh from the oven every morning.</p>',
    "  </section>",
    "</body>",
    "</html>",
  ].join("\n");

  // The repair the feedback asks for: the same design with its
  // colors declared as plain CSS — verifiable by construction.
  const PLAIN_FIXED = [
    "<!DOCTYPE html>",
    "<html>",
    "<head><title>Sunny Crust Bakery</title>",
    "<style>",
    "  body { background: #18181b; }",
    "  p { color: #f4f4f5; }",
    "</style>",
    "</head>",
    "<body>",
    "  <p>Fresh from the oven every morning.</p>",
    "</body>",
    "</html>",
  ].join("\n");

  function memoryTransport() {
    const files = new Map<string, string>();
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

  const INSTRUCTION = "Build a one-page website for a bakery called Sunny Crust Bakery";
  const config = {
    model: "test-model",
    systemPrompt: "You are LiTT.",
    executionMode: "auto" as const,
    enableBuildFix: false,
  };

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  // ACC-06a item 1 (supersedes the ACC-03 settlement for this shape):
  // Acceptance Run 1 on 8cd7728c marked a build FAILED even though
  // the page was written and rendered correctly, because the
  // verifier cannot judge colors the Tailwind compiler decides at
  // runtime. Larry's rule: the verifier may only fail a build on
  // contrast evidence it can statically decide; runtime-decided
  // colors produce a pass-with-note, never a build failure — and no
  // repair pressure to rewrite a page the checker cannot judge.
  it("passes with a note — never failed — when colors are runtime-decided", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: UNVERIFIABLE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(INSTRUCTION, transport, config);

    // No repair feedback for a page the checker cannot judge.
    const secondCallMessages = vi.mocked(callLLMWithTools).mock.calls[1][1] as Array<{
      role: string;
      content: string;
    }>;
    expect(
      secondCallMessages.some(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.includes("Verification could not judge"),
      ),
    ).toBe(false);
    // The run PASSES, with the unverifiable scope stated as a note.
    expect(result.failedHonestly).toBeUndefined();
    expect(result.contrastNote).toBeTruthy();
    expect(result.contrastNote).toContain("couldn't statically verify");
    expect(result.finalText).toContain("Your bakery site is live.");
    expect(result.finalText).toContain("couldn't statically verify the text contrast");
    // The verifier fix must never alter written content: the file on
    // disk is byte-identical to what the model wrote.
    expect(files.get("index.html")).toBe(UNVERIFIABLE);
  });

  it("succeeds when the model repairs the page with plain-CSS colors", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: UNVERIFIABLE }),
      )
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "index.html", content: PLAIN_FIXED }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(INSTRUCTION, transport, config);

    expect(files.get("index.html")).toContain("background: #18181b");
    expect(result.failedHonestly).toBeUndefined();
    expect(result.finalText).toContain("Your bakery site is live.");
  });
});
