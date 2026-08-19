/**
 * OpenAI native function-name compatibility boundary — dedicated tests.
 *
 * OpenAI rejects function names containing anything other than `A-Z a-z 0-9 _ -`
 * and caps length at 64. LiTT's canonical ToolRegistry IDs use dotted names
 * (`project.status`, `project.build`, `project.run`), which are invalid as
 * OpenAI function names. The provider boundary must sanitize them on the way
 * out and reverse-map them on the way back, WITHOUT renaming the canonical
 * internal tool IDs.
 *
 * These tests exercise the boundary utility directly plus the full
 * OpenAICompatibleModelProvider round-trip (outgoing schema + incoming
 * tool_calls reverse dispatch).
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  sanitizeOpenAiToolName,
  buildOpenAiToolNameMap,
  resolveCanonicalToolId,
  toOpenAiToolSchemas,
  OPENAI_NAME_RE,
  MAX_OPENAI_NAME_LEN,
  OpenAiToolNameMappingError,
} from "../lib/openai-tool-names.js";
import { OpenAICompatibleModelProvider } from "../lib/model-provider.js";
import { createDefaultRegistry, type ToolDefinition } from "@litt/agent-core";
import { parseToolCall, stripToolCallBlocks } from "@litt/agent-core";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sseBody(lines: string[]): BodyInit {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + "\n\n"));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

function recordingFetch(lines: string[], recorded: { body: any }): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    recorded.body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(sseBody(lines), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;
}

describe("sanitizeOpenAiToolName", () => {
  it("project.status -> project_status", () => {
    expect(sanitizeOpenAiToolName("project.status")).toBe("project_status");
  });

  it("project.run -> project_run", () => {
    expect(sanitizeOpenAiToolName("project.run")).toBe("project_run");
  });

  it("project.build -> project_build", () => {
    expect(sanitizeOpenAiToolName("project.build")).toBe("project_build");
  });

  it("project.check -> project_check", () => {
    expect(sanitizeOpenAiToolName("project.check")).toBe("project_check");
  });

  it("replaces colons and slashes", () => {
    expect(sanitizeOpenAiToolName("namespace:foo")).toBe("namespace_foo");
    expect(sanitizeOpenAiToolName("a/b/c")).toBe("a_b_c");
  });

  it("replaces spaces", () => {
    expect(sanitizeOpenAiToolName("my tool")).toBe("my_tool");
  });

  it("leaves already-valid names unchanged", () => {
    expect(sanitizeOpenAiToolName("project_status")).toBe("project_status");
    expect(sanitizeOpenAiToolName("valid-Name1_2")).toBe("valid-Name1_2");
  });

  it("always produces a name matching ^[a-zA-Z0-9_-]+$", () => {
    const samples = [
      "project.status",
      "project.run",
      "a:b/c d",
      "weird.name.with.many.dots",
      "already_ok",
      "hyphen-name",
    ];
    for (const s of samples) {
      expect(sanitizeOpenAiToolName(s)).toMatch(OPENAI_NAME_RE);
    }
  });
});

describe("buildOpenAiToolNameMap — forward + reverse", () => {
  const tools: ToolDefinition[] = [
    { id: "project.status", name: "status", description: "d", inputSchema: {}, readOnly: true },
    { id: "project.run", name: "run", description: "d", inputSchema: {}, readOnly: false },
  ];

  it("builds forward map canonical -> sanitized", () => {
    const map = buildOpenAiToolNameMap(tools);
    expect(map.forward.get("project.status")).toBe("project_status");
    expect(map.forward.get("project.run")).toBe("project_run");
  });

  it("builds reverse map sanitized -> canonical", () => {
    const map = buildOpenAiToolNameMap(tools);
    expect(map.reverse.get("project_status")).toBe("project.status");
    expect(map.reverse.get("project_run")).toBe("project.run");
  });

  it("resolveCanonicalToolId dispatches project_status -> project.status", () => {
    const map = buildOpenAiToolNameMap(tools);
    expect(resolveCanonicalToolId("project_status", map)).toBe("project.status");
    expect(resolveCanonicalToolId("project_run", map)).toBe("project.run");
  });

  it("resolveCanonicalToolId falls back to the raw name when unknown", () => {
    const map = buildOpenAiToolNameMap(tools);
    expect(resolveCanonicalToolId("unknown_tool", map)).toBe("unknown_tool");
  });

  it("resolveCanonicalToolId with null map returns the raw name", () => {
    expect(resolveCanonicalToolId("project_status", null)).toBe("project_status");
  });
});

describe("buildOpenAiToolNameMap — collision detection", () => {
  it("fails deterministically when two canonical IDs sanitize to the same OpenAI name", () => {
    // `foo.bar` and `foo_bar` both sanitize to `foo_bar` — ambiguous.
    const tools: ToolDefinition[] = [
      { id: "foo.bar", name: "a", description: "d", inputSchema: {}, readOnly: true },
      { id: "foo_bar", name: "b", description: "d", inputSchema: {}, readOnly: true },
    ];
    expect(() => buildOpenAiToolNameMap(tools)).toThrow(OpenAiToolNameMappingError);
    expect(() => buildOpenAiToolNameMap(tools)).toThrow(/collision/);
  });

  it("does NOT fail when the same canonical id appears twice (idempotent)", () => {
    const tools: ToolDefinition[] = [
      { id: "project.status", name: "status", description: "d", inputSchema: {}, readOnly: true },
      { id: "project.status", name: "status", description: "d", inputSchema: {}, readOnly: true },
    ];
    expect(() => buildOpenAiToolNameMap(tools)).not.toThrow();
  });

  it("fails on an empty canonical id", () => {
    const tools: ToolDefinition[] = [
      { id: "", name: "x", description: "d", inputSchema: {}, readOnly: true },
    ];
    expect(() => buildOpenAiToolNameMap(tools)).toThrow(OpenAiToolNameMappingError);
  });
});

describe("buildOpenAiToolNameMap — length validation", () => {
  it("fails when a sanitized name exceeds 64 characters", () => {
    // 65 chars, all valid — passes the regex but exceeds the length cap.
    const longId = "a".repeat(65);
    const tools: ToolDefinition[] = [
      { id: longId, name: "x", description: "d", inputSchema: {}, readOnly: true },
    ];
    expect(() => buildOpenAiToolNameMap(tools)).toThrow(OpenAiToolNameMappingError);
    expect(() => buildOpenAiToolNameMap(tools)).toThrow(
      new RegExp(`exceeds the ${MAX_OPENAI_NAME_LEN} character limit`),
    );
  });

  it("accepts a 64-character name (exactly at the cap)", () => {
    const id = "a".repeat(64);
    const tools: ToolDefinition[] = [
      { id, name: "x", description: "d", inputSchema: {}, readOnly: true },
    ];
    expect(() => buildOpenAiToolNameMap(tools)).not.toThrow();
  });
});

describe("toOpenAiToolSchemas", () => {
  it("produces schemas with sanitized names and valid parameters", () => {
    const tools: ToolDefinition[] = [
      { id: "project.status", name: "status", description: "Get status", inputSchema: { type: "object", properties: {} }, readOnly: true },
      { id: "project.run", name: "run", description: "Run a command", inputSchema: { type: "object", properties: { cmd: { type: "string" } } }, readOnly: false },
    ];
    const { schemas, map } = toOpenAiToolSchemas(tools);
    expect(schemas).toHaveLength(2);
    expect(schemas[0].type).toBe("function");
    expect(schemas[0].function.name).toBe("project_status");
    expect(schemas[0].function.description).toBe("Get status");
    expect(schemas[1].function.name).toBe("project_run");
    // Reverse map is returned for incoming tool_calls translation.
    expect(map.reverse.get("project_status")).toBe("project.status");
    expect(map.reverse.get("project_run")).toBe("project.run");
  });

  it("never emits an outgoing name containing '.', ':', '/', or spaces", () => {
    const tools: ToolDefinition[] = [
      { id: "project.status", name: "a", description: "d", inputSchema: {}, readOnly: true },
      { id: "namespace:foo", name: "b", description: "d", inputSchema: {}, readOnly: true },
      { id: "a/b c", name: "c", description: "d", inputSchema: {}, readOnly: true },
    ];
    const { schemas } = toOpenAiToolSchemas(tools);
    for (const s of schemas) {
      expect(s.function.name).toMatch(OPENAI_NAME_RE);
      expect(s.function.name).not.toContain(".");
      expect(s.function.name).not.toContain(":");
      expect(s.function.name).not.toContain("/");
      expect(s.function.name).not.toContain(" ");
      expect(s.function.name.length).toBeLessThanOrEqual(MAX_OPENAI_NAME_LEN);
    }
  });
});

describe("ALL registered LiTT tools serialize to valid OpenAI names", () => {
  // The default registry is the canonical tool set the agent loop presents
  // to the model. Every one of them MUST serialize to a valid OpenAI
  // function name — not just tools[0].
  it("createDefaultRegistry() tools all pass the OpenAI name rules", () => {
    const registry = createDefaultRegistry();
    const defs: ToolDefinition[] = registry.list();
    expect(defs.length).toBeGreaterThan(0);

    const { schemas } = toOpenAiToolSchemas(defs);
    expect(schemas.length).toBe(defs.length);
    for (const s of schemas) {
      expect(s.function.name).toMatch(OPENAI_NAME_RE);
      expect(s.function.name.length).toBeLessThanOrEqual(MAX_OPENAI_NAME_LEN);
      expect(s.function.name).not.toContain(".");
    }
  });

  it("every default-registry canonical id is recoverable via reverse map", () => {
    const registry = createDefaultRegistry();
    const defs: ToolDefinition[] = registry.list();
    const { map } = toOpenAiToolSchemas(defs);
    for (const def of defs) {
      const sanitized = map.forward.get(def.id);
      expect(sanitized).toBeDefined();
      expect(map.reverse.get(sanitized!)).toBe(def.id);
    }
  });
});

describe("OpenAICompatibleModelProvider — full boundary round-trip", () => {
  const STATUS_TOOL: ToolDefinition = {
    id: "project.status",
    name: "status",
    description: "Get project status",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
  };
  const RUN_TOOL: ToolDefinition = {
    id: "project.run",
    name: "run",
    description: "Run a command",
    inputSchema: { type: "object", properties: { cmd: { type: "string" } } },
    readOnly: false,
  };

  it("outgoing request declares sanitized function names", async () => {
    const recorded: { body: any } = { body: null };
    globalThis.fetch = recordingFetch(["data: [DONE]"], recorded);

    const provider = new OpenAICompatibleModelProvider({
      providerId: "openai",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "sk-test",
      model: "gpt-5.6-luna",
      tools: [STATUS_TOOL, RUN_TOOL],
    });
    await provider.stream([{ role: "user", content: "hi" }], () => {});

    const tools = recorded.body.tools as Array<{
      type: string;
      function: { name: string };
    }>;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("project_status");
    expect(names).toContain("project_run");
    // No outgoing name may violate OpenAI's pattern.
    for (const n of names) {
      expect(n).toMatch(OPENAI_NAME_RE);
      expect(n.length).toBeLessThanOrEqual(MAX_OPENAI_NAME_LEN);
    }
  });

  it("incoming project_status tool_call reverse-maps to project.status in the fence block", async () => {
    const lines = [
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"project_status\",\"arguments\":\"{}\"}}]}}]}",
      "data: [DONE]",
    ];
    globalThis.fetch = recordingFetch(lines, { body: null });

    const provider = new OpenAICompatibleModelProvider({
      providerId: "openai",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "sk-test",
      model: "gpt-5.6-luna",
      tools: [STATUS_TOOL],
    });
    const result = await provider.stream([{ role: "user", content: "What branch am I on?" }], () => {});

    expect(result.content).toContain("```tool_call");
    const parsed = parseToolCall(result.content);
    // The canonical LiTT tool ID is restored — ToolRegistry.execute() will
    // dispatch to project.status, not project_status.
    expect(parsed?.toolId).toBe("project.status");
    expect(parsed?.inputs).toEqual({});
    // And the sanitized name must never leak into a final answer.
    expect(stripToolCallBlocks(result.content)).not.toContain("project_status");
    expect(stripToolCallBlocks(result.content)).not.toContain("project.status");
  });

  it("incoming project_run tool_call reverse-maps to project.run", async () => {
    const lines = [
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"project_run\",\"arguments\":\"{\\\"cmd\\\":\\\"ls\\\"}\"}}]}}]}",
      "data: [DONE]",
    ];
    globalThis.fetch = recordingFetch(lines, { body: null });

    const provider = new OpenAICompatibleModelProvider({
      providerId: "openai",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "sk-test",
      model: "gpt-5.6-luna",
      tools: [RUN_TOOL],
    });
    const result = await provider.stream([{ role: "user", content: "run ls" }], () => {});
    const parsed = parseToolCall(result.content);
    expect(parsed?.toolId).toBe("project.run");
    expect(parsed?.inputs).toEqual({ cmd: "ls" });
  });

  it("constructor fails BEFORE any API request on a name collision", () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return new Response(sseBody(["data: [DONE]"]), { status: 200 });
    }) as typeof fetch;

    const colliding: ToolDefinition[] = [
      { id: "foo.bar", name: "a", description: "d", inputSchema: {}, readOnly: true },
      { id: "foo_bar", name: "b", description: "d", inputSchema: {}, readOnly: true },
    ];
    expect(() =>
      new OpenAICompatibleModelProvider({
        providerId: "openai",
        endpoint: "https://api.openai.com/v1/chat/completions",
        apiKey: "sk-test",
        model: "gpt-5.6-luna",
        tools: colliding,
      }),
    ).toThrow(OpenAiToolNameMappingError);

    expect(fetchCalled).toBe(false);
    globalThis.fetch = originalFetch;
  });

  it("constructor fails BEFORE any API request on a >64 char name", () => {
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return new Response(sseBody(["data: [DONE]"]), { status: 200 });
    }) as typeof fetch;

    const tooLong: ToolDefinition[] = [
      { id: "a".repeat(65), name: "x", description: "d", inputSchema: {}, readOnly: true },
    ];
    expect(() =>
      new OpenAICompatibleModelProvider({
        providerId: "openai",
        endpoint: "https://api.openai.com/v1/chat/completions",
        apiKey: "sk-test",
        model: "gpt-5.6-luna",
        tools: tooLong,
      }),
    ).toThrow(OpenAiToolNameMappingError);

    expect(fetchCalled).toBe(false);
  });
});
