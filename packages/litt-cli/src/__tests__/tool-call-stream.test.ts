/**
 * Tool-call stream filter — the boundary that stops raw tool_call
 * protocol from leaking into the live chat preview.
 *
 * First-run acceptance failure #2: "Raw model tool-call syntax leaked
 * into chat: tool_call { "tool": "project.status", "inputs": {} }".
 *
 * Root cause: the old filter checked each stream delta in isolation.
 * A fenced tool_call block arrives token-by-token, so fragment deltas
 * (e.g. "```", "tool", "_call") passed the per-delta prefix check and
 * leaked into the transcript. This filter is stateful across deltas.
 */

import { describe, it, expect } from "vitest";
import { createToolCallStreamFilter, isToolCallMarkup } from "../lib/tool-call-stream.js";

function feed(filter: { next: (d: string) => string; flush: () => string }, deltas: string[]): string {
  return deltas.map((d) => filter.next(d)).join("") + filter.flush();
}

describe("createToolCallStreamFilter", () => {
  it("suppresses a fenced tool_call block arriving as a single delta", () => {
    const filter = createToolCallStreamFilter();
    const out = feed(filter, [
      'Here is what I found.\n```tool_call\n{ "tool": "project.status", "inputs": {} }\n```\nThe branch is correct.',
    ]);
    expect(out).toContain("Here is what I found.");
    expect(out).toContain("The branch is correct.");
    expect(out).not.toContain("tool_call");
    expect(out).not.toContain('"tool"');
  });

  it("suppresses a fence split across many deltas (the observed leak)", () => {
    const filter = createToolCallStreamFilter();
    const deltas = [
      "The ",
      "```",       // opener fragment
      "tool",      // opener fragment
      "_call",     // opener fragment
      "\n{ \"tool\": \"project.status\", \"inputs\": {} }\n",
      "```",       // closing fence
      " inspection result follows.",
    ];
    const out = feed(filter, deltas);
    expect(out).toContain("The ");
    expect(out).toContain(" inspection result follows.");
    expect(out).not.toContain("tool_call");
    expect(out).not.toContain("project.status");
  });

  it("suppresses a fence with CRLF line endings", () => {
    const filter = createToolCallStreamFilter();
    const out = feed(filter, ["```tool_call\r\n{ \"tool\": \"project.status\", \"inputs\": {} }\r\n```", "ok"]);
    expect(out).not.toContain("tool_call");
    expect(out).toBe("ok");
  });

  it("suppresses a bare JSON tool object line (no fences)", () => {
    const filter = createToolCallStreamFilter();
    const out = feed(filter, ["tool_call\n{ \"tool\": \"project.status\", \"inputs\": {} }\n", "Final answer."]);
    expect(out).not.toContain('"tool"');
    expect(out).not.toContain("project.status");
    expect(out).toContain("Final answer.");
  });

  it("suppresses multiple consecutive fences", () => {
    const filter = createToolCallStreamFilter();
    const out = feed(filter, [
      "```tool_call\n{ \"tool\": \"a\" }\n```",
      "```tool_call\n{ \"tool\": \"b\" }\n```",
      "done",
    ]);
    expect(out).not.toContain("tool_call");
    expect(out).toBe("done");
  });

  it("preserves prose and non-tool code fences", () => {
    const filter = createToolCallStreamFilter();
    const out = feed(filter, ["Here is a code block:\n```ts\nconst x = 1;\n```\nThat is all."]);
    expect(out).toContain("Here is a code block:");
    expect(out).toContain("const x = 1;");
    expect(out).toContain("That is all.");
  });

  it("handles an empty delta without crashing", () => {
    const filter = createToolCallStreamFilter();
    expect(filter.next("")).toBe("");
    expect(filter.next("hello")).toBe("");
    expect(filter.flush()).toBe("hello");
  });

  // ─── DOGFOOD REGRESSIONS: bare JSON tool objects split across deltas ─

  it("REGRESSION: bare tool JSON split after the opener does not leak trailing fragments", () => {
    // Observed live: `project.status","inputs":{}` appeared in the
    // transcript. The opener `{"tool":"` was suppressed, but the
    // following fragment no longer starts with `{` and used to pass.
    const filter = createToolCallStreamFilter();
    const deltas = [
      '{"tool":"',           // opener (suppressed)
      'project.status",',    // ← the observed leak fragment
      '"inputs":{}}',        // closing fragment
      "\nThe branch is main.",
    ];
    const out = feed(filter, deltas);
    expect(out).not.toContain("project.status");
    expect(out).not.toContain('"inputs"');
    expect(out).not.toContain('"tool"');
    expect(out).toContain("The branch is main.");
  });

  it("REGRESSION: the exact observed fragment never appears", () => {
    const filter = createToolCallStreamFilter();
    const out = feed(filter, [
      '{"tool":"',
      'project.status","inputs":{}}',   // exact observed leak
      " done",
    ]);
    expect(out).not.toContain('project.status","inputs":{}');
    expect(out).toBe(" done");
  });

  it("REGRESSION: a bare tool object with nested inputs split across many deltas", () => {
    const filter = createToolCallStreamFilter();
    const deltas = [
      '{ "tool": "proj',
      'ect.run", "inputs": { "command": "git", "arg',
      's": ["status"] } }',
      "\nResult below.",
    ];
    const out = feed(filter, deltas);
    expect(out).not.toContain("project.run");
    expect(out).not.toContain("git");
    expect(out).toContain("Result below.");
  });

  it("REGRESSION: multiple bare tool objects in one stream", () => {
    const filter = createToolCallStreamFilter();
    const out = feed(filter, [
      '{"tool":"a","inputs":{}}',
      '{"tool":"b","inputs":{}}',
      " final",
    ]);
    expect(out).not.toContain('"tool"');
    expect(out).toBe(" final");
  });

  it("REGRESSION: bare JSON object followed by a fenced block", () => {
    const filter = createToolCallStreamFilter();
    const out = feed(filter, [
      '{"tool":"a","inputs":{}}\n',
      "```tool_call\n{ \"tool\": \"b\" }\n```",
      " answer",
    ]);
    expect(out).not.toContain('"tool"');
    expect(out).not.toContain("```");
    expect(out).toContain("answer");
  });

  it("flush() inside a fragmented bare tool object drops the remainder", () => {
    const filter = createToolCallStreamFilter();
    filter.next('{"tool":"project.status"');
    expect(filter.flush()).toBe("");
  });
});

describe("isToolCallMarkup (back-compat predicate)", () => {
  it("detects tool protocol fragments", () => {
    expect(isToolCallMarkup("```tool_call")).toBe(true);
    expect(isToolCallMarkup('{"tool": "project.status"}')).toBe(true);
    expect(isToolCallMarkup("```")).toBe(true);
  });

  it("ignores normal prose", () => {
    expect(isToolCallMarkup("The project is clean.")).toBe(false);
  });
});
