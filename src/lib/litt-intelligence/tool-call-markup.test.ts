// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findToolCallMarkup } from "./tool-call-markup";

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
  });

  it("does not match tool names as substrings of other words", () => {
    expect(
      findToolCallMarkup("<tool_call>terminality\n<arg_key>x</arg_key><arg_value>y</arg_value></tool_call>", TOOLS),
    ).not.toBeNull(); // arg structure still signals intent
    expect(findToolCallMarkup("terminality is not a tool call", TOOLS)).toBeNull();
  });
});
