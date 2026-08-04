/**
 * LiTT Tool Registry
 *
 * Canonical tool registry owned by the LiTT Kernel. Every executable
 * tool must declare its schema, risk, approval policy, and permissions.
 *
 * MCP tools and OpenAPI-generated tools are converted into LiTT tool
 * definitions and must pass the same validation as internal tools.
 * They can never bypass the permission and approval system.
 */

import type { LiTTToolDefinition, ToolSource, ToolRisk, ApprovalPolicy } from "./types";

// ─── Registry ───────────────────────────────────────────────────

class ToolRegistry {
  private tools = new Map<string, LiTTToolDefinition>();
  private handlers = new Map<string, (inputs: Record<string, unknown>) => Promise<unknown>>();
  private listeners = new Set<(id: string, enabled: boolean) => void>();

  /**
   * Register a tool definition and optional handler.
   */
  register(
    tool: LiTTToolDefinition,
    handler?: (inputs: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.tools.set(tool.id, tool);
    if (handler) {
      this.handlers.set(tool.id, handler);
    }
  }

  /**
   * Get a tool definition by ID.
   */
  get(id: string): LiTTToolDefinition | undefined {
    return this.tools.get(id);
  }

  /**
   * List all registered tools.
   */
  list(): LiTTToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * List only enabled tools.
   */
  listEnabled(): LiTTToolDefinition[] {
    return this.list().filter((t) => t.enabled);
  }

  /**
   * Enable a tool.
   */
  enable(id: string): void {
    const tool = this.tools.get(id);
    if (tool) {
      this.tools.set(id, { ...tool, enabled: true });
      this.notify(id, true);
    }
  }

  /**
   * Disable a tool. Disabled tools cannot execute.
   */
  disable(id: string): void {
    const tool = this.tools.get(id);
    if (tool) {
      this.tools.set(id, { ...tool, enabled: false });
      this.notify(id, false);
    }
  }

  /**
   * Quarantine a tool — disable and mark as unsafe.
   */
  quarantine(id: string, reason: string): void {
    const tool = this.tools.get(id);
    if (tool) {
      this.tools.set(id, {
        ...tool,
        enabled: false,
        approvalPolicy: {
          ...tool.approvalPolicy,
          neverAllow: true,
        },
        description: `[QUARANTINED: ${reason}] ${tool.description}`,
      });
      this.notify(id, false);
    }
  }

  /**
   * Validate tool arguments against the tool's input schema.
   * Returns null if valid, or an error message.
   */
  validateInputs(id: string, inputs: Record<string, unknown>): string | null {
    const tool = this.tools.get(id);
    if (!tool) return `Tool "${id}" is not registered`;

    // Basic schema validation (required fields)
    const requiredFields = (tool.inputSchema.required as string[]) ?? [];
    for (const field of requiredFields) {
      if (!(field in inputs)) {
        return `Missing required field: ${field}`;
      }
    }

    // Type checking (basic)
    const properties = tool.inputSchema.properties as Record<string, { type?: string }> | undefined;
    if (properties) {
      for (const [field, value] of Object.entries(inputs)) {
        const schema = properties[field];
        if (schema?.type) {
          const actualType = Array.isArray(value) ? "array" : typeof value;
          if (schema.type !== actualType) {
            return `Field "${field}" expected type "${schema.type}", got "${actualType}"`;
          }
        }
      }
    }

    return null;
  }

  /**
   * Execute a tool by ID with validated inputs.
   * Checks: enabled, capabilities, approval, schema validation.
   */
  async execute(
    id: string,
    inputs: Record<string, unknown>,
    options: {
      hasApproval?: boolean;
      availableCapabilities?: string[];
    } = {},
  ): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    const tool = this.tools.get(id);
    if (!tool) {
      return { ok: false, error: `Tool "${id}" is not registered` };
    }

    // Check enabled
    if (!tool.enabled) {
      return { ok: false, error: `Tool "${id}" is disabled` };
    }

    // Check never-allow
    if (tool.approvalPolicy.neverAllow) {
      return { ok: false, error: `Tool "${id}" is quarantined and cannot execute` };
    }

    // Check approval
    if (tool.approvalPolicy.requireExplicitForMutations && !tool.readOnly) {
      if (!options.hasApproval) {
        return { ok: false, error: `Tool "${id}" requires explicit approval` };
      }
    }

    // Check capabilities
    if (tool.requiredCapabilities.length > 0) {
      const available = new Set(options.availableCapabilities ?? []);
      for (const cap of tool.requiredCapabilities) {
        if (!available.has(cap)) {
          return { ok: false, error: `Tool "${id}" requires capability "${cap}" which is not available` };
        }
      }
    }

    // Validate inputs
    const validationError = this.validateInputs(id, inputs);
    if (validationError) {
      return { ok: false, error: validationError };
    }

    // Execute
    const handler = this.handlers.get(id);
    if (!handler) {
      return { ok: false, error: `Tool "${id}" has no handler registered` };
    }

    try {
      const result = await handler(inputs);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Check if a tool can execute given current state.
   */
  canExecute(
    id: string,
    options: { hasApproval?: boolean; availableCapabilities?: string[] } = {},
  ): { can: boolean; reason?: string } {
    const tool = this.tools.get(id);
    if (!tool) return { can: false, reason: "Not registered" };
    if (!tool.enabled) return { can: false, reason: "Disabled" };
    if (tool.approvalPolicy.neverAllow) return { can: false, reason: "Quarantined" };
    if (tool.approvalPolicy.requireExplicitForMutations && !tool.readOnly && !options.hasApproval) {
      return { can: false, reason: "Approval required" };
    }
    const available = new Set(options.availableCapabilities ?? []);
    for (const cap of tool.requiredCapabilities) {
      if (!available.has(cap)) return { can: false, reason: `Missing capability: ${cap}` };
    }
    return { can: true };
  }

  /**
   * Subscribe to tool enable/disable changes.
   */
  onChange(listener: (id: string, enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(id: string, enabled: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(id, enabled);
      } catch {
        // non-fatal
      }
    }
  }

  /**
   * Clear all tools — used in tests.
   */
  clear(): void {
    this.tools.clear();
    this.handlers.clear();
    this.listeners.clear();
  }
}

// ─── Singleton ──────────────────────────────────────────────────

export const toolRegistry = new ToolRegistry();

// ─── Initial internal tools ─────────────────────────────────────

const READ_ONLY_APPROVAL: ApprovalPolicy = {
  required: false,
  autoApproveReadOnly: true,
  requireExplicitForMutations: false,
  neverAllow: false,
};

const MUTATION_APPROVAL: ApprovalPolicy = {
  required: true,
  autoApproveReadOnly: false,
  requireExplicitForMutations: true,
  neverAllow: false,
};

const NEVER_ALLOW_APPROVAL: ApprovalPolicy = {
  required: true,
  autoApproveReadOnly: false,
  requireExplicitForMutations: true,
  neverAllow: true,
};

export function registerInternalTools(): void {
  const tools: Array<{ tool: LiTTToolDefinition; handler?: (inputs: Record<string, unknown>) => Promise<unknown> }> = [
    // ─── Read-only tools ──────────────────────────────────────
    {
      tool: {
        id: "project.scan",
        name: "Project Scan",
        description: "Scan the active project and return a structured intelligence snapshot",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 30000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "project.read_context",
        name: "Read Project Context",
        description: "Read the current project context including repository info and capabilities",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "memory.search",
        name: "Search Memory",
        description: "Search project-scoped memories and knowledge records",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { query: { type: "string" }, projectId: { type: "string" } }, required: ["query", "projectId"] },
        outputSchema: { type: "array" },
        requiredCapabilities: [],
        requiredPermissions: ["memory:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "web.search",
        name: "Web Search",
        description: "Search the web for current information using registered research providers",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        outputSchema: { type: "array" },
        requiredCapabilities: ["web_search"],
        requiredPermissions: ["web:search"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 15000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "web.fetch",
        name: "Fetch URL",
        description: "Fetch content from a URL for research purposes",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["web_search"],
        requiredPermissions: ["web:fetch"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "github.search_code",
        name: "GitHub Code Search",
        description: "Search GitHub repositories and code",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        outputSchema: { type: "array" },
        requiredCapabilities: ["github"],
        requiredPermissions: ["github:search"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "github.read_file",
        name: "Read GitHub File",
        description: "Read a file from a GitHub repository",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { repo: { type: "string" }, path: { type: "string" } }, required: ["repo", "path"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["github"],
        requiredPermissions: ["github:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "github.list_pull_requests",
        name: "List Pull Requests",
        description: "List open pull requests for a repository",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
        outputSchema: { type: "array" },
        requiredCapabilities: ["github"],
        requiredPermissions: ["github:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "github.inspect_workflow",
        name: "Inspect Workflow",
        description: "Inspect GitHub Actions workflow runs and status",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["github"],
        requiredPermissions: ["github:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "api.search_openapi",
        name: "Search OpenAPI Directory",
        description: "Search APIs.guru for machine-readable OpenAPI definitions",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        outputSchema: { type: "array" },
        requiredCapabilities: [],
        requiredPermissions: ["api:search"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 15000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "package.inspect",
        name: "Inspect Package",
        description: "Inspect package metadata from npm or PyPI registries",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { name: { type: "string" }, registry: { type: "string" } }, required: ["name"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["package:inspect"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "files.list",
        name: "List Files",
        description: "List files in a project directory",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" }, path: { type: "string" } }, required: ["projectId"] },
        outputSchema: { type: "array" },
        requiredCapabilities: ["filesystem"],
        requiredPermissions: ["files:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    {
      tool: {
        id: "files.read",
        name: "Read File",
        description: "Read a file from the project workspace",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" }, path: { type: "string" } }, required: ["projectId", "path"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["filesystem"],
        requiredPermissions: ["files:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    // ─── Mutation tools (require approval) ────────────────────
    {
      tool: {
        id: "image.generate",
        name: "Generate Image",
        description: "Generate an image using the project's image generation provider",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { prompt: { type: "string" }, projectId: { type: "string" } }, required: ["prompt", "projectId"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["image_generation"],
        requiredPermissions: ["image:generate"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 60000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
    },
    {
      tool: {
        id: "files.write",
        name: "Write File",
        description: "Write or create a file in the project workspace",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" }, path: { type: "string" }, content: { type: "string" } }, required: ["projectId", "path", "content"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["filesystem"],
        requiredPermissions: ["files:write"],
        risk: "high",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 10000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
    },
    {
      tool: {
        id: "files.patch",
        name: "Patch File",
        description: "Apply a targeted patch to an existing file",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" }, path: { type: "string" }, patch: { type: "string" } }, required: ["projectId", "path", "patch"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["filesystem"],
        requiredPermissions: ["files:write"],
        risk: "high",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 10000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
    },
    {
      tool: {
        id: "checkpoint.create",
        name: "Create Checkpoint",
        description: "Create a project checkpoint (snapshot)",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" }, label: { type: "string" } }, required: ["projectId"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["filesystem"],
        requiredPermissions: ["checkpoint:create"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 30000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
    },
    {
      tool: {
        id: "checkpoint.restore",
        name: "Restore Checkpoint",
        description: "Restore a project to a previous checkpoint",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" }, checkpointId: { type: "string" } }, required: ["projectId", "checkpointId"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["filesystem"],
        requiredPermissions: ["checkpoint:restore"],
        risk: "critical",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 30000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
    },
    {
      tool: {
        id: "preview.open",
        name: "Open Preview",
        description: "Open a private preview of the project",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["preview:open"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 15000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
    },
    {
      tool: {
        id: "memory.store",
        name: "Store Memory",
        description: "Store a knowledge record in project memory",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" }, content: { type: "string" }, category: { type: "string" } }, required: ["projectId", "content"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["memory:write"],
        risk: "low",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 5000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
    },
    {
      tool: {
        id: "approval.request",
        name: "Request Approval",
        description: "Request user approval for a proposed action",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { action: { type: "string" }, reason: { type: "string" } }, required: ["action", "reason"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: [],
        risk: "none",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    // ─── Terminal (disabled for public users) ─────────────────
    {
      tool: {
        id: "terminal.execute",
        name: "Execute Terminal Command",
        description: "Execute a terminal command in a sandboxed environment (Coming Soon)",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { command: { type: "string" }, projectId: { type: "string" } }, required: ["command", "projectId"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["pty"],
        requiredPermissions: ["terminal:execute"],
        risk: "critical",
        approvalPolicy: NEVER_ALLOW_APPROVAL,
        timeoutMs: 30000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: false, // Disabled until cloud sandbox is complete
      },
    },
  ];

  for (const { tool, handler } of tools) {
    toolRegistry.register(tool, handler);
  }
}

// Initialize on module load
registerInternalTools();
