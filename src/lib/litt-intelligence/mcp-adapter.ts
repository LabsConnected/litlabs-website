/**
 * MCP Client Adapter
 *
 * Connects to approved MCP servers and converts their tools into
 * LiTT tool definitions. MCP tools must pass the same validation
 * as internal tools and can never bypass the permission system.
 *
 * Only enable servers from an owner-approved registry.
 * Do not auto-install arbitrary MCP servers discovered on the internet.
 */

import type { LiTTToolDefinition, ToolRisk, ApprovalPolicy } from "./types";
import { toolRegistry } from "./tool-registry";

// ─── MCP Server Config ──────────────────────────────────────────

export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  transport: "stdio" | "http" | "sse";
  approved: boolean;
  allowedTools?: string[];
  quarantinedTools?: string[];
}

// ─── MCP Tool Schema (from MCP protocol) ────────────────────────

interface MCPToolSchema {
  name: string;
  description: string;
  inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] };
}

interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface MCPPrompt {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

// ─── MCP Adapter ────────────────────────────────────────────────

export class MCPAdapter {
  private servers = new Map<string, MCPServerConfig>();
  private connected = new Set<string>();

  /**
   * Register an MCP server config. Must be approved before use.
   */
  registerServer(config: MCPServerConfig): void {
    if (!config.approved) {
      throw new Error(`MCP server "${config.id}" is not approved. Only enable servers from an owner-approved registry.`);
    }
    this.servers.set(config.id, config);
  }

  /**
   * Connect to an MCP server and discover its tools.
   * Sends JSON-RPC 2.0 initialize request with proper Bearer authentication
   * (e.g. SUPABASE_ACCESS_TOKEN / Personal Access Token).
   */
  async connect(serverId: string, options: { token?: string } = {}): Promise<{
    tools: MCPToolSchema[];
    resources: MCPResource[];
    prompts: MCPPrompt[];
  }> {
    const config = this.servers.get(serverId);
    if (!config) {
      throw new Error(`MCP server "${serverId}" is not registered`);
    }
    if (!config.approved) {
      throw new Error(`MCP server "${serverId}" is not approved`);
    }

    const authToken = options.token || process.env.SUPABASE_ACCESS_TOKEN;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    if (config.transport === "http" || config.transport === "sse") {
      const initPayload = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "LiTT-Studio-Client", version: "1.0.0" }
        }
      };

      const initRes = await fetch(config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(initPayload),
      });

      if (initRes.status === 401) {
        throw new Error(`MCP initialize unauthorized (HTTP 401) for server "${serverId}". Ensure SUPABASE_ACCESS_TOKEN is set.`);
      }

      if (!initRes.ok) {
        const bodyText = await initRes.text();
        throw new Error(`MCP initialize failed with status ${initRes.status}: ${bodyText}`);
      }

      // After successful initialization, call tools/list
      const listToolsPayload = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      };

      const listRes = await fetch(config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(listToolsPayload),
      });

      if (!listRes.ok) {
        const bodyText = await listRes.text();
        throw new Error(`MCP tools/list failed with status ${listRes.status}: ${bodyText}`);
      }

      const listData = (await listRes.json()) as { result?: { tools?: MCPToolSchema[] } };
      const tools = listData.result?.tools || [];

      this.connected.add(serverId);
      return { tools, resources: [], prompts: [] };
    }

    // stdio transport — not supported in serverless; return empty
    this.connected.add(serverId);
    return { tools: [], resources: [], prompts: [] };
  }

  /**
   * Convert an MCP tool schema into a LiTT tool definition.
   * MCP tools are always marked as source "mcp" and must pass
   * the same validation as internal tools.
   */
  convertTool(
    serverId: string,
    mcpTool: MCPToolSchema,
    options: {
      risk?: ToolRisk;
      readOnly?: boolean;
      approvalPolicy?: ApprovalPolicy;
    } = {},
  ): LiTTToolDefinition {
    const config = this.servers.get(serverId);
    if (!config) {
      throw new Error(`MCP server "${serverId}" is not registered`);
    }

    // Check if tool is in allowed list
    if (config.allowedTools && !config.allowedTools.includes(mcpTool.name)) {
      throw new Error(`MCP tool "${mcpTool.name}" is not in the allowed tools list for server "${serverId}"`);
    }

    // Check if tool is quarantined
    const isQuarantined = config.quarantinedTools?.includes(mcpTool.name) ?? false;

    // Determine risk: default to medium for MCP tools (unknown provenance)
    const risk: ToolRisk = options.risk ?? "medium";

    // Determine approval policy: MCP tools require explicit approval for mutations
    const approvalPolicy: ApprovalPolicy = options.approvalPolicy ?? {
      required: true,
      autoApproveReadOnly: false,
      requireExplicitForMutations: true,
      neverAllow: isQuarantined,
    };

    return {
      id: `mcp:${serverId}:${mcpTool.name}`,
      name: mcpTool.name,
      description: mcpTool.description,
      source: "mcp",
      version: "1.0.0",
      inputSchema: mcpTool.inputSchema as Record<string, unknown>,
      outputSchema: { type: "object" },
      requiredCapabilities: [],
      requiredPermissions: [`mcp:${serverId}:invoke`],
      risk,
      approvalPolicy,
      timeoutMs: 30000,
      idempotent: false,
      readOnly: options.readOnly ?? false,
      permissionLevel: options.readOnly ? "read" : "external-write",
      enabled: !isQuarantined,
    };
  }

  /**
   * Register a converted MCP tool into the LiTT tool registry.
   */
  registerMCPTool(tool: LiTTToolDefinition, handler?: (inputs: Record<string, unknown>) => Promise<unknown>): void {
    toolRegistry.register(tool, handler);
  }

  /**
   * Quarantine an unsafe MCP server — disables all its tools.
   */
  quarantineServer(serverId: string, reason: string): void {
    const config = this.servers.get(serverId);
    if (!config) return;

    // Disable all tools from this server
    for (const tool of toolRegistry.list()) {
      if (tool.id.startsWith(`mcp:${serverId}:`)) {
        toolRegistry.quarantine(tool.id, reason);
      }
    }

    // Mark server as quarantined
    this.servers.set(serverId, {
      ...config,
      quarantinedTools: [...(config.quarantinedTools ?? []), ...toolRegistry.list()
        .filter((t) => t.id.startsWith(`mcp:${serverId}:`))
        .map((t) => t.name)],
    });
  }

  /**
   * Check if a server is connected.
   */
  isConnected(serverId: string): boolean {
    return this.connected.has(serverId);
  }

  /**
   * List registered servers.
   */
  listServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Disconnect from a server.
   */
  disconnect(serverId: string): void {
    this.connected.delete(serverId);
  }
}
