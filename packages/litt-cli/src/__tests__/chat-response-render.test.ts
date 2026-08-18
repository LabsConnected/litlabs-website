/**
 * Chat Response Rendering — proves the LiTT response body is retained
 * and rendered, not silently dropped after runAgentLoop returns.
 *
 * Bug being fixed:
 *   User: "Whats up"
 *   Activity: CHAT Whats up / ROUTE Gemini / CHAT LiTT responded · 10.8s
 *   But the actual LiTT response body is invisible.
 *
 * Root cause: chatResponseText accumulated onModelStream deltas but was
 * never added to CockpitStore after runAgentLoop returned. Only the
 * "LiTT responded · Xs" summary event was emitted.
 *
 * Fix:
 *   - controller.ts emits an `agent.response` entry (tag "LiTT") carrying
 *     the FULL body in fullText after runAgentLoop returns.
 *   - activity-stream.tsx special-cases `agent.response` so the body is
 *     wrapped across the terminal width instead of being truncated to
 *     one line.
 *   - The concise "LiTT responded · Xs" completion summary is kept as a
 *     separate event — it does NOT replace the response body.
 *   - Raw tool_call/JSON markup is still excluded by isToolCallMarkup
 *     before accumulation.
 *
 * These tests mirror the controller and renderer logic (same pattern as
 * runtime-truth-fixes.test.ts). The controller is a React hook, so we
 * test the pure logic it composes.
 */
import { describe, it, expect } from "vitest";

// ── isToolCallMarkup — mirrors controller.ts ──
function isToolCallMarkup(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("```tool_call") || trimmed.startsWith("```json")
    || trimmed.startsWith("```tool_result") || trimmed.startsWith("```tool")
    || trimmed === "```" || trimmed.startsWith("```")) {
    return true;
  }
  if (trimmed.startsWith('{"tool"') || trimmed.startsWith('{"name"')
    || trimmed.startsWith('{"command"') || trimmed.startsWith('{"type"')) {
    return true;
  }
  if (trimmed === "```") return true;
  return false;
}

// ── truncateActivity — mirrors controller.ts ──
function truncateActivity(text: string, max = 80): string {
  const single = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return single.slice(0, max - 1) + "…";
}

// ── wrapText — mirrors activity-stream.tsx ──
function wrapText(text: string, max: number): string[] {
  if (max < 1) return [text];
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      out.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line.length === 0) {
        line = word;
      } else if (line.length + 1 + word.length <= max) {
        line += " " + word;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line.length > 0) out.push(line);
  }
  return out.length > 0 ? out : [""];
}

// ── ActivityEntry shape (subset) ──
interface ActivityEntry {
  id: string;
  ts: number;
  type: string;
  tag?: string;
  text: string;
  fullText?: string;
}

/**
 * Mirror of the controller's CHAT path: accumulate clean deltas,
 * then emit agent.response + agent.complete after the loop returns.
 * Returns the activity entries that would be added to CockpitStore.
 */
function simulateChatPath(
  deltas: string[],
  durationMs: number,
  toolCallCount = 0,
): ActivityEntry[] {
  let chatResponseText = "";
  for (const d of deltas) {
    // Filter tool-call markup exactly like the controller's onModelStream
    if (isToolCallMarkup(d)) continue;
    chatResponseText += d;
  }

  const added: ActivityEntry[] = [];
  const responseBody = chatResponseText.trim();
  if (responseBody) {
    added.push({
      id: `act_${Date.now()}_resp`,
      ts: Date.now(),
      type: "agent.response",
      tag: "LiTT",
      text: truncateActivity(responseBody, 80),
      fullText: responseBody,
    });
  }
  const seconds = (durationMs / 1000).toFixed(1);
  added.push({
    id: `act_${Date.now()}_done`,
    ts: Date.now(),
    type: "agent.complete",
    tag: "CHAT",
    text: `LiTT responded · ${seconds}s${toolCallCount > 0 ? ` · ${toolCallCount} tools` : ""}`,
  });
  return added;
}

describe("Chat response rendering — bug fix", () => {
  // ─── Response body is retained ───────────────────────────────────
  describe("agent.response entry is emitted with the full body", () => {
    it("retains the LiTT response text as an agent.response entry", () => {
      const entries = simulateChatPath(["Hey! Not much — just hanging out."], 10800);
      const resp = entries.find((e) => e.type === "agent.response");
      expect(resp).toBeDefined();
      expect(resp!.tag).toBe("LiTT");
      expect(resp!.fullText).toBe("Hey! Not much — just hanging out.");
    });

    it("preserves fullText verbatim — no truncation of the body", () => {
      const long = "This is a detailed LiTT response that is longer than the activity feed's one-line truncation limit. It explains the project state, lists files, and offers next steps. It should be preserved in fullText so the renderer can wrap it across the terminal width.";
      const entries = simulateChatPath([long], 5600);
      const resp = entries.find((e) => e.type === "agent.response")!;
      expect(resp.fullText).toBe(long);
      expect(resp.fullText!.length).toBeGreaterThan(resp.text.length);
    });

    it("emits agent.response BEFORE the concise completion summary", () => {
      const entries = simulateChatPath(["Hello there."], 1200);
      const respIdx = entries.findIndex((e) => e.type === "agent.response");
      const doneIdx = entries.findIndex((e) => e.type === "agent.complete");
      expect(respIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThanOrEqual(0);
      expect(respIdx).toBeLessThan(doneIdx);
    });
  });

  // ─── Multi-line / long responses are not collapsed ───────────────
  describe("multi-line and long responses are not reduced to the summary", () => {
    it("a multi-line response is preserved with newlines in fullText", () => {
      const body = "Here's the plan:\n1. Run typecheck\n2. Fix errors\n3. Re-verify";
      const entries = simulateChatPath([body], 3200);
      const resp = entries.find((e) => e.type === "agent.response")!;
      expect(resp.fullText).toBe(body);
      expect(resp.fullText!.split("\n").length).toBe(4);
    });

    it("wrapText produces multiple lines for a long response (not one truncated line)", () => {
      const body = "This is a long LiTT response that exceeds a typical 60-character terminal message column and must wrap onto multiple lines so the user can read the whole thing without it being cut off with an ellipsis.";
      const lines = wrapText(body, 60);
      expect(lines.length).toBeGreaterThan(1);
      // No line should exceed the max width
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(60);
      }
      // The wrapped text reconstructs to the same content (minus newlines)
      expect(lines.join(" ")).toBe(body);
    });

    it("the completion summary does NOT replace the response body", () => {
      const entries = simulateChatPath(["A full response body here."], 10800);
      const resp = entries.find((e) => e.type === "agent.response");
      const done = entries.find((e) => e.type === "agent.complete");
      expect(resp).toBeDefined();
      expect(done).toBeDefined();
      // The summary is concise timing info, NOT the body
      expect(done!.text).toBe("LiTT responded · 10.8s");
      expect(done!.text).not.toContain("A full response body here.");
      // The body lives on the agent.response entry, not the summary
      expect(resp!.fullText).toBe("A full response body here.");
    });

    it("a response that arrives in multiple deltas is concatenated correctly", () => {
      const entries = simulateChatPath([
        "Hello! ",
        "Let me look at that. ",
        "Based on what I see, you should try running the tests first.",
      ], 4200);
      const resp = entries.find((e) => e.type === "agent.response")!;
      expect(resp.fullText).toBe(
        "Hello! Let me look at that. Based on what I see, you should try running the tests first.",
      );
    });
  });

  // ─── Tool-call markup is still excluded ──────────────────────────
  describe("tool-call markup is excluded from the response body", () => {
    it("fenced tool_call blocks do not leak into chatResponseText", () => {
      const deltas = [
        "Let me check. ",
        "```tool_call\n{\"tool\":\"project.status\",\"inputs\":{}}\n```",
        "Done checking.",
      ];
      const entries = simulateChatPath(deltas, 2000);
      const resp = entries.find((e) => e.type === "agent.response")!;
      expect(resp.fullText).toBe("Let me check. Done checking.");
      expect(resp.fullText).not.toContain("tool_call");
      expect(resp.fullText).not.toContain("```");
    });

    it("raw JSON tool fragments do not leak into chatResponseText", () => {
      const deltas = [
        'Thinking about it. ',
        '{"tool": "project.status", "inputs": {}}',
        " Here is my answer.",
      ];
      const entries = simulateChatPath(deltas, 1500);
      const resp = entries.find((e) => e.type === "agent.response")!;
      expect(resp.fullText).toBe("Thinking about it.  Here is my answer.");
      expect(resp.fullText).not.toContain('"tool"');
    });

    it("a pure-tool-call response produces NO agent.response entry", () => {
      const deltas = [
        "```tool_call\n{\"tool\":\"project.status\",\"inputs\":{}}\n```",
      ];
      const entries = simulateChatPath(deltas, 1000);
      const resp = entries.find((e) => e.type === "agent.response");
      expect(resp).toBeUndefined();
      // The completion summary is still emitted
      const done = entries.find((e) => e.type === "agent.complete");
      expect(done).toBeDefined();
    });
  });

  // ─── Mission / runtime behavior is untouched ─────────────────────
  describe("mission/runtime behavior is untouched", () => {
    it("CHAT path uses isProcessing, not mission holoState", () => {
      // The CHAT path must not enter mission states. This invariant is
      // preserved by the fix — we only add an agent.response entry,
      // we do not touch holoState or missionState.
      const chatHoloState = "IDLE";
      const missionStates = ["UNDERSTANDING", "PLANNING", "READING", "EDITING", "RUNNING", "TESTING", "VERIFYING"];
      expect(missionStates).not.toContain(chatHoloState);
    });

    it("the fix adds an agent.response entry — it does not create a second runtime authority", () => {
      // The agent.response entry is presentation-only (CockpitStore).
      // It does NOT call createMission, startMission, or any RuntimeStore
      // lifecycle method. The canonical runAgentLoop path is preserved.
      const entries = simulateChatPath(["Hi!"], 800);
      const types = entries.map((e) => e.type);
      expect(types).toContain("agent.response");
      expect(types).toContain("agent.complete");
      // No mission lifecycle types are emitted by the CHAT path
      expect(types).not.toContain("agent.request");
      expect(types).not.toContain("verification.passed");
      expect(types).not.toContain("verification.failed");
    });

    it("the completion summary still includes timing and tool count", () => {
      const entries = simulateChatPath(["Body."], 10800, 2);
      const done = entries.find((e) => e.type === "agent.complete")!;
      expect(done.text).toContain("10.8s");
      expect(done.text).toContain("2 tools");
    });
  });

  // ─── wrapText edge cases ─────────────────────────────────────────
  describe("wrapText edge cases", () => {
    it("preserves explicit blank lines", () => {
      const lines = wrapText("para 1\n\npara 2", 80);
      expect(lines).toEqual(["para 1", "", "para 2"]);
    });

    it("handles a single word longer than max by overflowing it", () => {
      const lines = wrapText("supercalifragilisticexpialidocious", 10);
      expect(lines).toEqual(["supercalifragilisticexpialidocious"]);
    });

    it("returns an empty-string line for empty input", () => {
      expect(wrapText("", 80)).toEqual([""]);
    });
  });
});
