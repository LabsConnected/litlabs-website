/**
 * Regression tests for the tool-less text-lane guard.
 *
 * Background: the agents/chat director fallback injected the full tool
 * manifest ("you MUST call the tool before answering") into a prompt,
 * then called generateText with NO tools attached — a primed model could
 * echo a fake tool call as a chat reply, which was returned verbatim AND
 * persisted to memory. The V1 messages lane had the same re-priming
 * hazard from envelope markup persisted in conversation history.
 */
import { describe, expect, it } from "vitest";
import {
  TOOLLESS_TEXT_LANE_DIRECTIVE,
  buildToollessPrompt,
  sanitizeTextLaneHistory,
  scanToollessOutput,
} from "./toolless-lane-guard";

const TOOL_IDS = new Set([
  "files.write",
  "image.generate",
  "terminal.execute",
  "weather.current",
]);

describe("buildToollessPrompt", () => {
  it("appends the no-tools directive after the base prompt", () => {
    const prompt = buildToollessPrompt("base prompt");
    expect(prompt.startsWith("base prompt")).toBe(true);
    expect(prompt).toContain(TOOLLESS_TEXT_LANE_DIRECTIVE);
    // The directive must come AFTER the priming content so it wins.
    expect(prompt.indexOf("base prompt")).toBeLessThan(
      prompt.indexOf(TOOLLESS_TEXT_LANE_DIRECTIVE),
    );
  });

  it("directive explicitly overrides the MUST-call-tool priming", () => {
    expect(TOOLLESS_TEXT_LANE_DIRECTIVE).toMatch(/NO tools are\s+attached/i);
    expect(TOOLLESS_TEXT_LANE_DIRECTIVE).toMatch(/MUST call a tool/i);
    expect(TOOLLESS_TEXT_LANE_DIRECTIVE).toMatch(/do NOT output/i);
  });
});

describe("scanToollessOutput", () => {
  it("hits on a fake tool call echoing the taught syntax", () => {
    const hit = scanToollessOutput(
      'Sure — writing it now:\n<tool_call>files.write\n<arg_key>path</arg_key><arg_value>index.html</arg_value>\n</tool_call>',
      TOOL_IDS,
    );
    expect(hit).not.toBeNull();
    expect(hit?.toolId).toBe("files.write");
  });

  it("hits on a bare-JSON pseudo-call", () => {
    const hit = scanToollessOutput(
      JSON.stringify({ name: "image.generate", arguments: { prompt: "a cat" } }),
      TOOL_IDS,
    );
    expect(hit).not.toBeNull();
  });

  it("is null for ordinary prose", () => {
    expect(
      scanToollessOutput("Here's your project status: the build is green.", TOOL_IDS),
    ).toBeNull();
  });

  it("is null for markup quoted as an example", () => {
    expect(
      scanToollessOutput(
        "To call a tool you'd write `<tool_call>files.write</tool_call>`.",
        TOOL_IDS,
      ),
    ).toBeNull();
  });
});

describe("sanitizeTextLaneHistory", () => {
  // A pseudo-call as previously persisted by the unguarded lanes: an
  // assistant turn whose text is a tool envelope that never executed.
  const persistedPseudoCall =
    "On it — running the build:\n<tool_call>terminal.execute\n" +
    "<arg_key>command</arg_key><arg_value>npm run build</arg_value>\n</tool_call>";

  it("removes a persisted pseudo-call from assistant history", () => {
    const cleaned = sanitizeTextLaneHistory([
      { role: "user", content: "build my site" },
      { role: "assistant", content: persistedPseudoCall },
      { role: "user", content: "and then deploy it" },
    ]);
    expect(cleaned).toHaveLength(3);
    expect(cleaned[1].content).not.toContain("<tool_call>");
    expect(cleaned[1].content).not.toContain("terminal.execute");
    // No envelope markup remains anywhere in the assistant turn.
    expect(cleaned[1].content).not.toMatch(/<tool_call|<invoke|<dots_function_call/i);
  });

  it("leaves user turns untouched", () => {
    const userText = "wrap it in <tool_call> tags for me";
    const cleaned = sanitizeTextLaneHistory([
      { role: "user", content: userText },
    ]);
    expect(cleaned[0].content).toBe(userText);
  });

  it("preserves ordinary assistant prose verbatim", () => {
    const prose = "Done — the build passed with no errors.";
    const cleaned = sanitizeTextLaneHistory([
      { role: "assistant", content: prose },
    ]);
    expect(cleaned[0].content).toBe(prose);
  });

  it("preserves backtick-quoted markup examples in assistant turns", () => {
    const example =
      "You'd write `<tool_call>files.write</tool_call>` to save a file.";
    const cleaned = sanitizeTextLaneHistory([
      { role: "assistant", content: example },
    ]);
    expect(cleaned[0].content).toBe(example);
  });
});
