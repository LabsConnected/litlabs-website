// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findToolCallMarkup, hasToolCallEnvelope, recoverTextToolCalls, stripEnvelopeMarkup } from "./tool-call-markup";

/**
 * The agent loop executes native structured tool calls only — a model that
 * emits its training-format markup as text is attempting an invocation the
 * system cannot honour. These fixtures pin the boundary: invocation-intent
 * markup is detected, ordinary prose quoting markup is not.
 */

const TOOLS = new Set(["terminal.execute", "files.read", "files.write", "apply_patch", "project.deploy"]);

// The exact payload shape observed in production: prose lead-in followed by
// a raw <tool_call> envelope that was persisted as assistant text while the
// run reported `completed` with no tool executed.
const PRODUCTION_PAYLOAD =
  "I need to read the current `index.html` to find the exact `</title>` line, then add the meta description right after it. Let me inspect the file first.\n" +
  "<tool_call>terminal\n<arg_key>command</arg_key>\n<arg_value>cat -n index.html</arg_value>" +
  "<arg_key>project_id</arg_key>\n<arg_value>f79fae8d-62f5-405d-b933-3d49a58acc61</arg_value>\n</tool_call>";

describe("findToolCallMarkup — invocation intent", () => {
  it("flags the production <tool_call> payload with a prose lead-in", () => {
    const hit = findToolCallMarkup(PRODUCTION_PAYLOAD, TOOLS);
    expect(hit).not.toBeNull();
    expect(hit?.kind).toBe("envelope");
  });

  it("flags a bare <tool_call> envelope naming a known tool", () => {
    expect(
      findToolCallMarkup("<tool_call>files.read\n<arg_key>path</arg_key><arg_value>index.html</arg_value></tool_call>", TOOLS),
    ).toMatchObject({ kind: "envelope" });
  });

  it("flags <invoke> envelopes with a tool name attribute", () => {
    const hit = findToolCallMarkup(
      '<invoke name="files.read"><parameter name="path">index.html</parameter></invoke>',
      TOOLS,
    );
    expect(hit).not.toBeNull();
  });

  it("flags <dots_function_call> envelopes with arg structure", () => {
    const hit = findToolCallMarkup(
      '<dots_function_call>terminal.execute<arg_key>command</arg_key><arg_value>ls</arg_value></dots_function_call>',
      TOOLS,
    );
    expect(hit).not.toBeNull();
  });

  it("flags a truncated envelope — opener with tool name, no close tag", () => {
    const hit = findToolCallMarkup("Sure, reading it now.\n<tool_call>terminal\n<arg_key>command</arg_key>", TOOLS);
    expect(hit).toMatchObject({ kind: "truncated_envelope" });
  });

  it("flags fenced tool_call JSON naming a known tool", () => {
    const hit = findToolCallMarkup(
      '```tool_call\n{"name": "files.read", "arguments": {"path": "index.html"}}\n```',
      TOOLS,
    );
    expect(hit).toMatchObject({ kind: "fenced_json", toolId: "files.read" });
  });

  it("flags bare JSON tool-call objects", () => {
    const hit = findToolCallMarkup(
      '{"name": "apply_patch", "arguments": {"path": "index.html", "patches": []}}',
      TOOLS,
    );
    expect(hit).toMatchObject({ kind: "bare_json", toolId: "apply_patch" });
  });

  it("flags bare JSON with a function.name shape", () => {
    const hit = findToolCallMarkup(
      '{"function": {"name": "files.write", "arguments": "{\\"path\\":\\"a\\"}"}}',
      TOOLS,
    );
    expect(hit).toMatchObject({ kind: "bare_json", toolId: "files.write" });
  });

  it("flags a bare JSON action envelope naming a known tool", () => {
    const hit = findToolCallMarkup(
      '{"action": "files.read", "project_id": "p1", "path": "index.html"}',
      TOOLS,
    );
    expect(hit).toMatchObject({ kind: "bare_json", toolId: "files.read" });
  });

  it("flags a bare JSON action envelope even when the action is not a registered tool — the exact production shape", () => {
    // Observed in production: the V1 text-only path persisted
    //   {"action": "inspect_project_files", "project_id": "…", "path": "index.html"}
    // as a completed answer. A whole-response action envelope is an
    // attempted invocation — never user-facing prose.
    const hit = findToolCallMarkup(
      '{"action": "inspect_project_files", "project_id": "f79fae8d-62f5-405d-b933-3d49a58acc61", "path": "index.html"}',
      TOOLS,
    );
    expect(hit).toMatchObject({ kind: "bare_json" });
  });

  it("flags a bare JSON name+arguments call shape with an unregistered tool name", () => {
    const hit = findToolCallMarkup(
      '{"name": "makeItPretty", "arguments": {"path": "index.html"}}',
      TOOLS,
    );
    expect(hit).toMatchObject({ kind: "bare_json" });
  });
});

describe("findToolCallMarkup — prose that must not be flagged", () => {
  it("ignores markup quoted inside inline code", () => {
    expect(
      findToolCallMarkup(
        "Models sometimes emit `<tool_call>terminal<arg_key>command</arg_key></tool_call>` instead of structured calls.",
        TOOLS,
      ),
    ).toBeNull();
  });

  it("ignores envelopes whose payload names no known tool and carries no arg structure", () => {
    expect(findToolCallMarkup("<tool_call>makeItPretty</tool_call>", TOOLS)).toBeNull();
  });

  it("ignores ordinary prose and empty payloads", () => {
    expect(findToolCallMarkup("The footer now reads Ember Roast.", TOOLS)).toBeNull();
    expect(findToolCallMarkup("", TOOLS)).toBeNull();
    expect(findToolCallMarkup("   ", TOOLS)).toBeNull();
  });

  it("ignores JSON prose that is not a tool call", () => {
    expect(findToolCallMarkup('{"summary": "all good", "changed": true}', TOOLS)).toBeNull();
    expect(findToolCallMarkup('{"name": "Ember Roast", "style": "dark"}', TOOLS)).toBeNull();
  });

  it("ignores an action envelope quoted mid-prose — only a whole-payload envelope is intent", () => {
    expect(
      findToolCallMarkup(
        'A broken model might answer with {"action": "inspect_project_files", "path": "index.html"} instead of prose.',
        TOOLS,
      ),
    ).toBeNull();
  });

  it("does not match tool names as substrings of other words", () => {
    expect(
      findToolCallMarkup("<tool_call>terminality\n<arg_key>x</arg_key><arg_value>y</arg_value></tool_call>", TOOLS),
    ).not.toBeNull(); // arg structure still signals intent
    expect(findToolCallMarkup("terminality is not a tool call", TOOLS)).toBeNull();
  });
});

describe("hasToolCallEnvelope — intent-free envelopes are still tool attempts", () => {
  // Production 2026-09-16: the model emitted
  // `<dots_function_call>find ./src -type f</dots_function_call>` amid
  // prose — no tool id, no arg structure, so findToolCallMarkup returns
  // null. The execution lane must still treat it as a text-format tool
  // attempt (fail over) rather than a final answer with zero tool calls.
  it("detects an intent-free <dots_function_call> envelope", () => {
    expect(hasToolCallEnvelope("<dots_function_call>find ./src -type f</dots_function_call>")).toBe(true);
  });

  it("detects an intent-free envelope surrounded by prose", () => {
    expect(
      hasToolCallEnvelope(
        "I'll search the workspace now.\n<dots_function_call>find ./src -type f</dots_function_call>\nLet me check the results.",
      ),
    ).toBe(true);
  });

  it("detects a truncated envelope at end of text", () => {
    expect(hasToolCallEnvelope("Creating the directory now:\n<dots_function_call>")).toBe(true);
  });

  it("detects intent-free <tool_call> envelopes too", () => {
    expect(hasToolCallEnvelope("<tool_call>makeItPretty</tool_call>")).toBe(true);
  });

  it("ignores envelopes quoted inside inline code", () => {
    expect(
      hasToolCallEnvelope("Models sometimes emit `<dots_function_call>find ./src</dots_function_call>` instead of structured calls."),
    ).toBe(false);
  });

  it("ignores ordinary prose and empty input", () => {
    expect(hasToolCallEnvelope("The footer now reads Ember Roast.")).toBe(false);
    expect(hasToolCallEnvelope("")).toBe(false);
    expect(hasToolCallEnvelope("   ")).toBe(false);
  });
});

describe("recoverTextToolCalls — canonical normalization", () => {
  it("recovers the production antml <tool_call> payload", () => {
    const r = recoverTextToolCalls(PRODUCTION_PAYLOAD, TOOLS);
    expect(r.malformed).toBe(false);
    expect(r.calls).toEqual([
      {
        toolId: "terminal.execute",
        inputs: { command: "cat -n index.html", project_id: "f79fae8d-62f5-405d-b933-3d49a58acc61" },
      },
    ]);
    expect(r.residualText).not.toContain("tool_call");
    expect(r.residualText).toContain("Let me inspect the file first.");
  });

  it("recovers <invoke name>…<parameter> envelopes", () => {
    const r = recoverTextToolCalls(
      'Working. <invoke name="files.read"><parameter name="path">index.html</parameter></invoke>',
      TOOLS,
    );
    expect(r.malformed).toBe(false);
    expect(r.calls).toEqual([{ toolId: "files.read", inputs: { path: "index.html" } }]);
    expect(r.residualText).toBe("Working.");
  });

  it("recovers <dots_function_call> envelopes carrying call JSON", () => {
    const r = recoverTextToolCalls(
      '<dots_function_call>{"name":"files.read","arguments":{"path":"a.txt"}}</dots_function_call>',
      TOOLS,
    );
    expect(r.malformed).toBe(false);
    expect(r.calls).toEqual([{ toolId: "files.read", inputs: { path: "a.txt" } }]);
  });

  it("recovers antml pairs inside <dots_function_call>", () => {
    const r = recoverTextToolCalls(
      '<dots_function_call>terminal.execute<arg_key>command</arg_key><arg_value>ls</arg_value></dots_function_call>',
      TOOLS,
    );
    expect(r.malformed).toBe(false);
    expect(r.calls).toEqual([{ toolId: "terminal.execute", inputs: { command: "ls" } }]);
  });

  it("recovers fenced ```tool_call and ```json envelopes", () => {
    const r = recoverTextToolCalls(
      '```tool_call\n{"tool":"files.write","inputs":{"path":"a","content":"b"}}\n```\n' +
        '```json\n{"name":"files.read","arguments":{"path":"a"}}\n```',
      TOOLS,
    );
    expect(r.malformed).toBe(false);
    expect(r.calls).toEqual([
      { toolId: "files.write", inputs: { path: "a", content: "b" } },
      { toolId: "files.read", inputs: { path: "a" } },
    ]);
  });

  it("recovers a bare JSON envelope as the whole payload", () => {
    const r = recoverTextToolCalls('{"name":"apply_patch","arguments":{"path":"i","patches":[]}}', TOOLS);
    expect(r.malformed).toBe(false);
    expect(r.calls).toEqual([{ toolId: "apply_patch", inputs: { path: "i", patches: [] } }]);
  });

  it("maps the underscore-sanitized name files_read → files.read", () => {
    const r = recoverTextToolCalls(
      '<tool_call>{"name":"files_read","arguments":{"path":"a.txt"}}</tool_call>',
      TOOLS,
    );
    expect(r.malformed).toBe(false);
    expect(r.calls[0]?.toolId).toBe("files.read");
  });

  it("collapses repeated identical calls to one", () => {
    const r = recoverTextToolCalls(
      '<tool_call>{"name":"files.read","arguments":{"path":"a"}}</tool_call>' +
        '<tool_call>{"name":"files.read","arguments":{"path":"a"}}</tool_call>',
      TOOLS,
    );
    expect(r.calls).toHaveLength(1);
  });

  it("marks truncated envelopes malformed — intent but unparseable", () => {
    const r = recoverTextToolCalls(
      "Reading. <tool_call>files.read\n<arg_key>path</arg_key>",
      TOOLS,
    );
    expect(r.malformed).toBe(true);
    expect(r.calls).toHaveLength(0);
  });

  it("marks envelopes naming unregistered tools malformed", () => {
    const r = recoverTextToolCalls(
      '<tool_call>{"name":"system.wipe","arguments":{"target":"all"}}</tool_call>',
      TOOLS,
    );
    expect(r.malformed).toBe(true);
    expect(r.calls).toHaveLength(0);
  });

  it("marks malformed tool_call fence JSON as intent", () => {
    const r = recoverTextToolCalls(
      '```tool_call\n{"tool":"files.write","inputs":{"path":\n```',
      TOOLS,
    );
    expect(r.malformed).toBe(true);
    expect(r.calls).toHaveLength(0);
  });

  it("does not touch prose, quoted markup, or non-tool JSON", () => {
    for (const text of [
      "Models emit `<tool_call>x</tool_call>` sometimes.",
      '{"name": "Alice", "age": 3}',
      "```json\n{\"name\": \"Alice\"}\n```",
      "The footer reads Ember Roast.",
    ]) {
      const r = recoverTextToolCalls(text, TOOLS);
      expect(r.calls).toHaveLength(0);
      expect(r.malformed).toBe(false);
      expect(r.residualText).toBe(text);
    }
  });

  it("strips consumed markup but keeps surrounding prose", () => {
    const r = recoverTextToolCalls(
      'Before.\n<tool_call>{"name":"files.read","arguments":{"path":"a"}}</tool_call>\nAfter.',
      TOOLS,
    );
    expect(r.calls).toHaveLength(1);
    expect(r.residualText).toBe("Before.\n\nAfter.");
  });
});


describe("stripEnvelopeMarkup", () => {
  it("removes closed dots_function_call envelopes", () => {
    expect(
      stripEnvelopeMarkup(
        "Let me check.\n<dots_function_call>find ./src -type d</dots_function_call>\nDone.",
      ),
    ).toBe("Let me check.\n\nDone.");
  });

  it("removes closed invoke envelopes", () => {
    expect(
      stripEnvelopeMarkup("Working.\n<invoke>files.read path=a</invoke>\nAfter."),
    ).toBe("Working.\n\nAfter.");
  });

  it("removes truncated envelopes at end of text", () => {
    expect(stripEnvelopeMarkup("Creating it now:\n<dots_function_call>")).toBe(
      "Creating it now:",
    );
  });

  it("preserves markup quoted inside inline code", () => {
    const text =
      "Models sometimes emit `<dots_function_call>find ./src</dots_function_call>` instead.";
    expect(stripEnvelopeMarkup(text)).toBe(text);
  });

  it("leaves plain prose untouched", () => {
    expect(stripEnvelopeMarkup("The footer reads Ember Roast.")).toBe(
      "The footer reads Ember Roast.",
    );
  });
});