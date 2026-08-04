import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { toolRegistry, registerInternalTools } from "@/lib/litt-intelligence/tool-registry";
import { MCPAdapter } from "@/lib/litt-intelligence/mcp-adapter";
import { OpenAPIAdapter } from "@/lib/litt-intelligence/openapi-adapter";
import type { MCPServerConfig } from "@/lib/litt-intelligence/mcp-adapter";

describe("LiTT Intelligence — Tool Registry", () => {
  beforeEach(() => {
    toolRegistry.clear();
    registerInternalTools();
  });

  afterEach(() => {
    toolRegistry.clear();
  });

  // ─── Internal tools ───────────────────────────────────────────

  it("registers internal tools on init", () => {
    const tools = toolRegistry.list();
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.some((t) => t.id === "project.scan")).toBe(true);
    expect(tools.some((t) => t.id === "web.search")).toBe(true);
    expect(tools.some((t) => t.id === "files.read")).toBe(true);
  });

  it("get returns a tool by ID", () => {
    const tool = toolRegistry.get("web.search");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("Web Search");
    expect(tool!.readOnly).toBe(true);
  });

  it("listEnabled returns only enabled tools", () => {
    const enabled = toolRegistry.listEnabled();
    expect(enabled.every((t) => t.enabled)).toBe(true);
    expect(enabled.some((t) => t.id === "terminal.execute")).toBe(false);
  });

  it("terminal.execute is disabled by default", () => {
    const tool = toolRegistry.get("terminal.execute");
    expect(tool).toBeDefined();
    expect(tool!.enabled).toBe(false);
    expect(tool!.approvalPolicy.neverAllow).toBe(true);
  });

  // ─── Enable / Disable ─────────────────────────────────────────

  it("enable activates a tool", () => {
    toolRegistry.disable("web.search");
    expect(toolRegistry.get("web.search")!.enabled).toBe(false);
    toolRegistry.enable("web.search");
    expect(toolRegistry.get("web.search")!.enabled).toBe(true);
  });

  it("disable deactivates a tool", () => {
    toolRegistry.disable("files.read");
    expect(toolRegistry.get("files.read")!.enabled).toBe(false);
  });

  it("quarantine marks a tool as never-allow", () => {
    toolRegistry.quarantine("web.search", "Security issue detected");
    const tool = toolRegistry.get("web.search")!;
    expect(tool.enabled).toBe(false);
    expect(tool.approvalPolicy.neverAllow).toBe(true);
    expect(tool.description).toContain("QUARANTINED");
  });

  // ─── Validation ───────────────────────────────────────────────

  it("validateInputs returns null for valid inputs", () => {
    const error = toolRegistry.validateInputs("web.search", { query: "test" });
    expect(error).toBeNull();
  });

  it("validateInputs returns error for missing required field", () => {
    const error = toolRegistry.validateInputs("web.search", {});
    expect(error).toContain("query");
  });

  it("validateInputs returns error for wrong type", () => {
    const error = toolRegistry.validateInputs("web.search", { query: 123 });
    expect(error).toContain("type");
  });

  it("validateInputs returns error for unregistered tool", () => {
    const error = toolRegistry.validateInputs("nonexistent", {});
    expect(error).toContain("not registered");
  });

  // ─── Execution ────────────────────────────────────────────────

  it("execute fails for disabled tool", async () => {
    toolRegistry.disable("web.search");
    const result = await toolRegistry.execute("web.search", { query: "test" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("disabled");
  });

  it("execute fails for quarantined tool", async () => {
    toolRegistry.quarantine("web.search", "test");
    const result = await toolRegistry.execute("web.search", { query: "test" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/disabled|quarantined/);
  });

  it("execute fails for mutation tool without approval", async () => {
    const result = await toolRegistry.execute("files.write", {
      projectId: "p1",
      path: "test.txt",
      content: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("approval");
  });

  it("execute fails for missing capability", async () => {
    const result = await toolRegistry.execute("web.search", { query: "test" }, {
      availableCapabilities: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("web_search");
  });

  it("execute fails for missing handler", async () => {
    const result = await toolRegistry.execute("web.search", { query: "test" }, {
      availableCapabilities: ["web_search"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no handler");
  });

  it("execute succeeds with handler, capability, and approval", async () => {
    toolRegistry.clear();
    toolRegistry.register(
      {
        id: "test.tool",
        name: "Test Tool",
        description: "Test",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["test_cap"],
        requiredPermissions: ["test:run"],
        risk: "low",
        approvalPolicy: { required: false, autoApproveReadOnly: true, requireExplicitForMutations: false, neverAllow: false },
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        enabled: true,
      },
      async (inputs) => ({ result: inputs.x }),
    );

    const result = await toolRegistry.execute("test.tool", { x: "hello" }, {
      availableCapabilities: ["test_cap"],
    });
    expect(result.ok).toBe(true);
  });

  // ─── canExecute ───────────────────────────────────────────────

  it("canExecute returns true for enabled read-only tool", () => {
    const result = toolRegistry.canExecute("web.search", {
      availableCapabilities: ["web_search"],
    });
    expect(result.can).toBe(true);
  });

  it("canExecute returns false for missing capability", () => {
    const result = toolRegistry.canExecute("web.search", {
      availableCapabilities: [],
    });
    expect(result.can).toBe(false);
    expect(result.reason).toContain("web_search");
  });

  it("canExecute returns false for mutation without approval", () => {
    const result = toolRegistry.canExecute("files.write", {
      availableCapabilities: ["filesystem"],
    });
    expect(result.can).toBe(false);
    expect(result.reason).toContain("Approval");
  });

  it("canExecute returns true for mutation with approval", () => {
    const result = toolRegistry.canExecute("files.write", {
      availableCapabilities: ["filesystem"],
      hasApproval: true,
    });
    expect(result.can).toBe(true);
  });

  // ─── Change listener ──────────────────────────────────────────

  it("onChange fires when tool is enabled/disabled", () => {
    const events: Array<{ id: string; enabled: boolean }> = [];
    const unsubscribe = toolRegistry.onChange((id, enabled) => {
      events.push({ id, enabled });
    });

    toolRegistry.disable("web.search");
    toolRegistry.enable("web.search");

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ id: "web.search", enabled: false });
    expect(events[1]).toEqual({ id: "web.search", enabled: true });

    unsubscribe();
  });
});

// ─── MCP Adapter ────────────────────────────────────────────────

describe("LiTT Intelligence — MCP Adapter", () => {
  it("registerServer throws for unapproved server", () => {
    const adapter = new MCPAdapter();
    const config: MCPServerConfig = {
      id: "test",
      name: "Test Server",
      url: "http://localhost:3000",
      transport: "http",
      approved: false,
    };
    expect(() => adapter.registerServer(config)).toThrow("not approved");
  });

  it("registerServer accepts approved server", () => {
    const adapter = new MCPAdapter();
    adapter.registerServer({
      id: "test",
      name: "Test Server",
      url: "http://localhost:3000",
      transport: "http",
      approved: true,
    });
    expect(adapter.listServers()).toHaveLength(1);
  });

  it("connect throws for unregistered server", async () => {
    const adapter = new MCPAdapter();
    await expect(adapter.connect("nonexistent")).rejects.toThrow("not registered");
  });

  it("connect returns empty lists for stdio transport (no fetch needed)", async () => {
    const adapter = new MCPAdapter();
    adapter.registerServer({
      id: "test-stdio",
      name: "Test stdio",
      url: "http://localhost:3000",
      transport: "stdio",
      approved: true,
    });
    const result = await adapter.connect("test-stdio");
    expect(result.tools).toHaveLength(0);
    expect(result.resources).toHaveLength(0);
    expect(adapter.isConnected("test-stdio")).toBe(true);
  });

  it("connect sends JSON-RPC initialize + tools/list for http transport", async () => {
    const adapter = new MCPAdapter();
    adapter.registerServer({
      id: "test-http",
      name: "Test HTTP",
      url: "http://localhost:9999/mcp",
      transport: "http",
      approved: true,
    });

    // Mock fetch to return successful initialize + tools/list responses
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "initialize") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Map(),
          json: async () => ({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } }),
          text: async () => "",
        };
      }
      if (body.method === "tools/list") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Map(),
          json: async () => ({
            jsonrpc: "2.0",
            id: 2,
            result: {
              tools: [{ name: "search", description: "Search tool", inputSchema: { type: "object" } }],
            },
          }),
          text: async () => "",
        };
      }
      return { ok: false, status: 404, statusText: "Not Found", headers: new Map(), json: async () => ({}), text: async () => "" };
    });

    vi.stubGlobal("fetch", mockFetch);

    try {
      const result = await adapter.connect("test-http", { token: "test-pat-token" });
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe("search");
      expect(result.resources).toHaveLength(0);
      expect(adapter.isConnected("test-http")).toBe(true);

      // Verify fetch was called with Authorization header
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const initCall = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = initCall.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-pat-token");
      expect(headers["Content-Type"]).toBe("application/json");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("connect throws on 401 Unauthorized", async () => {
    const adapter = new MCPAdapter();
    adapter.registerServer({
      id: "test-401",
      name: "Test 401",
      url: "http://localhost:9999/mcp",
      transport: "http",
      approved: true,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: new Map(),
      json: async () => ({}),
      text: async () => "Unauthorized",
    });
    vi.stubGlobal("fetch", mockFetch);

    try {
      await expect(adapter.connect("test-401")).rejects.toThrow(/unauthorized/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("convertTool creates LiTT tool definition from MCP schema", () => {
    const adapter = new MCPAdapter();
    adapter.registerServer({
      id: "test",
      name: "Test",
      url: "http://localhost:3000",
      transport: "http",
      approved: true,
    });

    const tool = adapter.convertTool("test", {
      name: "search",
      description: "Search tool",
      inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    });

    expect(tool.id).toBe("mcp:test:search");
    expect(tool.source).toBe("mcp");
    expect(tool.risk).toBe("medium");
    expect(tool.approvalPolicy.requireExplicitForMutations).toBe(true);
  });

  it("convertTool throws for tool not in allowed list", () => {
    const adapter = new MCPAdapter();
    adapter.registerServer({
      id: "test",
      name: "Test",
      url: "http://localhost:3000",
      transport: "http",
      approved: true,
      allowedTools: ["safe_tool"],
    });

    expect(() =>
      adapter.convertTool("test", {
        name: "dangerous_tool",
        description: "Dangerous",
        inputSchema: { type: "object" },
      }),
    ).toThrow("not in the allowed tools list");
  });

  it("convertTool marks quarantined tools as never-allow", () => {
    const adapter = new MCPAdapter();
    adapter.registerServer({
      id: "test",
      name: "Test",
      url: "http://localhost:3000",
      transport: "http",
      approved: true,
      quarantinedTools: ["bad_tool"],
    });

    const tool = adapter.convertTool("test", {
      name: "bad_tool",
      description: "Bad",
      inputSchema: { type: "object" },
    });

    expect(tool.approvalPolicy.neverAllow).toBe(true);
    expect(tool.enabled).toBe(false);
  });

  it("quarantineServer disables all tools from that server", () => {
    const adapter = new MCPAdapter();
    adapter.registerServer({
      id: "test",
      name: "Test",
      url: "http://localhost:3000",
      transport: "http",
      approved: true,
    });

    // Register a tool from this server
    const tool = adapter.convertTool("test", {
      name: "search",
      description: "Search",
      inputSchema: { type: "object" },
    });
    adapter.registerMCPTool(tool);

    // Quarantine the server
    adapter.quarantineServer("test", "Security issue");

    const quarantined = toolRegistry.get("mcp:test:search");
    expect(quarantined).toBeDefined();
    expect(quarantined!.approvalPolicy.neverAllow).toBe(true);
  });
});

// ─── OpenAPI Adapter ────────────────────────────────────────────

describe("LiTT Intelligence — OpenAPI Adapter", () => {
  it("parse rejects non-object spec", () => {
    const adapter = new OpenAPIAdapter();
    const result = adapter.parse("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not an object");
  });

  it("parse rejects missing openapi version", () => {
    const adapter = new OpenAPIAdapter();
    const result = adapter.parse({ info: { title: "Test" } });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("openapi"))).toBe(true);
  });

  it("parse rejects external $ref references", () => {
    const adapter = new OpenAPIAdapter();
    const result = adapter.parse({
      openapi: "3.0.0",
      paths: { "/test": { $ref: "https://external.com/schema.json" } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("External $ref"))).toBe(true);
  });

  it("parse rejects disallowed server hosts", () => {
    const adapter = new OpenAPIAdapter();
    const result = adapter.parse({
      openapi: "3.0.0",
      servers: [{ url: "https://evil.example.com" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("not in the allowed hosts"))).toBe(true);
  });

  it("parse accepts valid spec with allowed host", () => {
    const adapter = new OpenAPIAdapter();
    const result = adapter.parse({
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      servers: [{ url: "https://api.github.com" }],
      paths: {},
    });
    expect(result.valid).toBe(true);
  });

  it("generateTools creates read tools for GET operations", () => {
    const adapter = new OpenAPIAdapter();
    const tools = adapter.generateTools({
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            operationId: "listUsers",
            summary: "List users",
            parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          },
        },
      },
    });

    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe("openapi:openapi:listUsers");
    expect(tools[0].readOnly).toBe(true);
    expect(tools[0].risk).toBe("low");
    expect(tools[0].approvalPolicy.requireExplicitForMutations).toBe(false);
  });

  it("generateTools creates mutation tools for POST operations", () => {
    const adapter = new OpenAPIAdapter();
    const tools = adapter.generateTools({
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          post: {
            operationId: "createUser",
            summary: "Create user",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { name: { type: "string" }, email: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(tools).toHaveLength(1);
    expect(tools[0].readOnly).toBe(false);
    expect(tools[0].risk).toBe("high");
    expect(tools[0].approvalPolicy.requireExplicitForMutations).toBe(true);
  });

  it("generateTools marks deprecated operations as disabled", () => {
    const adapter = new OpenAPIAdapter();
    const tools = adapter.generateTools({
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/old": {
          get: {
            operationId: "oldEndpoint",
            summary: "Old endpoint",
            deprecated: true,
          },
        },
      },
    });

    expect(tools[0].enabled).toBe(false);
  });

  it("allowHost adds a new allowed host", () => {
    const adapter = new OpenAPIAdapter();
    expect(adapter.isHostAllowed("api.example.com")).toBe(false);
    adapter.allowHost("api.example.com");
    expect(adapter.isHostAllowed("api.example.com")).toBe(true);
  });
});
