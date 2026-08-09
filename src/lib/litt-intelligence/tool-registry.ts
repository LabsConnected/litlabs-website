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

import type { LiTTToolDefinition, ApprovalPolicy } from "./types";

type ToolHandler = (inputs: Record<string, unknown>, transport?: unknown) => Promise<unknown>;

const lazyHandlers: Record<string, () => Promise<ToolHandler>> = {
  // V1 handlers (legacy — still used by agent-loop.ts pre-LLM phase)
  "project.scan": async () => (await import("./tool-handlers")).handleProjectScan,
  "files.list": async () => (await import("./tool-handlers")).handleFilesList,
  "files.read": async () => (await import("./tool-handlers")).handleFilesRead,
  "files.write": async () => (await import("./tool-handlers")).handleFilesWrite,
  "git.status": async () => (await import("./tool-handlers")).handleGitStatus,
  "terminal.execute": async () => (await import("./tool-handlers")).handleTerminalExecute,
  "project.health": async () => (await import("./tool-handlers")).handleProjectHealth,
  // V2 workspace-aware handlers (used by agent-loop-v2.ts)
  // V2 handlers accept an optional transport param; the agent loop binds it at call time.
  "files.delete": async () => (await import("./tool-handlers-v2")).handleFilesDelete as ToolHandler,
  "files.mkdir": async () => (await import("./tool-handlers-v2")).handleFilesMkdir as ToolHandler,
  "files.rename": async () => (await import("./tool-handlers-v2")).handleFilesRename as ToolHandler,
  "search_code": async () => (await import("./tool-handlers-v2")).handleSearchCode as ToolHandler,
  "git.diff": async () => (await import("./tool-handlers-v2")).handleGitDiff as ToolHandler,
  "git.log": async () => (await import("./tool-handlers-v2")).handleGitLog as ToolHandler,
  "git.commit": async () => (await import("./tool-handlers-v2")).handleGitCommit as ToolHandler,
  "apply_patch": async () => (await import("./tool-handlers-v2")).handleApplyPatch as ToolHandler,
  "build.run": async () => (await import("./tool-handlers-v2")).handleBuildRun as ToolHandler,
  "test.run": async () => (await import("./tool-handlers-v2")).handleTestRun as ToolHandler,
  "typecheck.run": async () => (await import("./tool-handlers-v2")).handleTypecheckRun as ToolHandler,
  "lint.run": async () => (await import("./tool-handlers-v2")).handleLintRun as ToolHandler,
  "package.info": async () => (await import("./tool-handlers-v2")).handlePackageInfo as ToolHandler,
};

// ─── Registry ───────────────────────────────────────────────────

class ToolRegistry {
  private tools = new Map<string, LiTTToolDefinition>();
  private handlers = new Map<string, (() => Promise<(inputs: Record<string, unknown>) => Promise<unknown>>) | ((inputs: Record<string, unknown>) => Promise<unknown>)>();
  private listeners = new Set<(id: string, enabled: boolean) => void>();

  /**
   * Register a tool definition and optional handler.
   * Handler can be a direct function or a lazy loader that returns the handler.
   */
  register(
    tool: LiTTToolDefinition,
    handler?: ((inputs: Record<string, unknown>) => Promise<unknown>) | (() => Promise<(inputs: Record<string, unknown>) => Promise<unknown>>),
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
   * @param options.transport — optional WorkspaceTransport passed to V2 handlers
   */
  async execute(
    id: string,
    inputs: Record<string, unknown>,
    options: {
      hasApproval?: boolean;
      availableCapabilities?: string[];
      transport?: unknown;
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
    const handlerEntry = this.handlers.get(id);
    if (!handlerEntry) {
      return { ok: false, error: `Tool "${id}" has no handler registered` };
    }

    try {
      // Resolve lazy handler if needed
      const handler = typeof handlerEntry === "function" && handlerEntry.length === 0
        ? await (handlerEntry as () => Promise<(inputs: Record<string, unknown>, transport?: unknown) => Promise<unknown>>)()
        : handlerEntry as (inputs: Record<string, unknown>, transport?: unknown) => Promise<unknown>;
      const result = await handler(inputs, options.transport);
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

const _NEVER_ALLOW_APPROVAL: ApprovalPolicy = {
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
        description: "Scan the active project and return a structured intelligence snapshot including stack, architecture, dependencies, tests, risks, and capabilities",
        source: "internal",
        version: "1.1.0",
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
      handler: lazyHandlers["project.scan"],
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
        requiredCapabilities: [],
        requiredPermissions: ["files:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["files.list"],
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
        requiredCapabilities: [],
        requiredPermissions: ["files:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["files.read"],
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
        requiredCapabilities: [],
        requiredPermissions: ["files:write"],
        risk: "high",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 10000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
      handler: lazyHandlers["files.write"],
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
    // ─── Web Intelligence (Browserbase-powered unified web capability) ──
    {
      tool: {
        id: "web.intelligence",
        name: "Web Intelligence",
        description:
          "Unified web capability: search, fetch, research, browse, observe, act, extract, verify, compare, monitor, screenshot, and PDF. " +
          "Uses Browserbase as the execution layer with smart escalation (cache → search → fetch → browser). " +
          "All results are saved to the Source Registry with citations and evidence.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["search", "fetch", "research", "browse", "observe", "act", "extract", "verify", "compare", "monitor", "screenshot", "pdf"],
              description: "The web intelligence operation to perform",
            },
            query: { type: "string", description: "Search or research query" },
            url: { type: "string", description: "Target URL for fetch/browse/observe/act/extract/screenshot/pdf/monitor" },
            urls: { type: "array", items: { type: "string" }, description: "Multiple URLs for compare" },
            action: { type: "string", description: "Natural language action for act operation" },
            instruction: { type: "string", description: "Extraction or observation instruction" },
            claim: { type: "string", description: "Claim to verify" },
            schema: { type: "object", description: "Zod-compatible schema for structured extraction" },
            forceBrowser: { type: "boolean", description: "Skip cache/fetch and use a full browser session" },
            useProxies: { type: "boolean", description: "Route through residential proxies (paid feature)" },
            maxResults: { type: "number", description: "Max results for search/research (default 5)" },
            ownerId: { type: "string", description: "User ID for source ownership" },
            projectId: { type: "string", description: "Project ID for source scoping" },
          },
          required: ["operation", "ownerId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: ["web_search"],
        requiredPermissions: ["web:search"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 120000,
        idempotent: false,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
    },
    // ─── Terminal (enabled with safe read-only allowlist) ────────
    {
      tool: {
        id: "terminal.execute",
        name: "Execute Terminal Command",
        description: "Execute a terminal command. Read-only commands (git status, ls, cat, tsc, lint, tests) run automatically. Mutation commands (git commit, npm install, file writes) require approval.",
        source: "internal",
        version: "2.0.0",
        inputSchema: { type: "object", properties: { command: { type: "string" }, projectId: { type: "string" }, hasApproval: { type: "boolean" } }, required: ["command", "projectId"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["terminal:execute"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 30000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
      handler: lazyHandlers["terminal.execute"],
    },
    // ─── Git Status (read-only, auto-approved) ──────────────────
    {
      tool: {
        id: "git.status",
        name: "Git Status",
        description: "Get current git status, branch, recent commits, and diff summary",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["git.status"],
    },
    // ─── Project Health (read-only, auto-approved) ──────────────
    {
      tool: {
        id: "project.health",
        name: "Project Health Check",
        description: "Run TypeScript check, ESLint, and tests to assess project health",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 120000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["project.health"],
    },
    // ─── New workspace-aware tools (V2) ────────────────────────
    // File delete (mutation, requires approval)
    {
      tool: {
        id: "files.delete",
        name: "Delete File",
        description: "Delete a file from the project workspace",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["files:write"],
        risk: "high",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 10000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
      handler: lazyHandlers["files.delete"],
    },
    // File mkdir (mutation, requires approval)
    {
      tool: {
        id: "files.mkdir",
        name: "Create Directory",
        description: "Create a new directory in the project workspace",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["files:write"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 10000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
      handler: lazyHandlers["files.mkdir"],
    },
    // File rename (mutation, requires approval)
    {
      tool: {
        id: "files.rename",
        name: "Rename/Move File",
        description: "Rename or move a file within the project workspace",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { path: { type: "string" }, newPath: { type: "string" } }, required: ["path", "newPath"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["files:write"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 10000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
      handler: lazyHandlers["files.rename"],
    },
    // Search code (read-only)
    {
      tool: {
        id: "search_code",
        name: "Search Code",
        description: "Search the project codebase using ripgrep. Returns matching file paths, line numbers, and content.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { query: { type: "string" }, glob: { type: "string" }, maxResults: { type: "number" } }, required: ["query"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 15000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["search_code"],
    },
    // Git diff (read-only)
    {
      tool: {
        id: "git.diff",
        name: "Git Diff",
        description: "Show git diff for the project. Can show staged or unstaged changes, optionally for a specific path.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { staged: { type: "boolean" }, path: { type: "string" } }, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["git.diff"],
    },
    // Git log (read-only)
    {
      tool: {
        id: "git.log",
        name: "Git Log",
        description: "Show recent git commits with SHA, author, date, and message.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { maxCount: { type: "number" } }, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["git.log"],
    },
    // Git commit (mutation, requires approval)
    {
      tool: {
        id: "git.commit",
        name: "Git Commit",
        description: "Stage files and create a git commit in the project workspace.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { message: { type: "string" }, files: { type: "array", items: { type: "string" } } }, required: ["message"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["git:write"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 15000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
      handler: lazyHandlers["git.commit"],
    },
    // Apply patch (mutation, requires approval)
    {
      tool: {
        id: "apply_patch",
        name: "Apply Patch",
        description: "Apply targeted search-and-replace patches to an existing file in the project workspace.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { path: { type: "string" }, patches: { type: "array", items: { type: "object", properties: { search: { type: "string" }, replace: { type: "string" } } } } }, required: ["path", "patches"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["files:write"],
        risk: "high",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 10000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
      handler: lazyHandlers["apply_patch"],
    },
    // Build run (read-only — just executes a build check)
    {
      tool: {
        id: "build.run",
        name: "Run Build",
        description: "Discover the project's package manager and run the build script. Returns exit code and output.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 120000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["build.run"],
    },
    // Test run (read-only)
    {
      tool: {
        id: "test.run",
        name: "Run Tests",
        description: "Discover the project's package manager and run the test script. Returns exit code and output.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 120000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["test.run"],
    },
    // Typecheck run (read-only)
    {
      tool: {
        id: "typecheck.run",
        name: "Run Typecheck",
        description: "Discover the project's package manager and run the typecheck script (or tsc --noEmit). Returns exit code and output.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 120000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["typecheck.run"],
    },
    // Lint run (read-only)
    {
      tool: {
        id: "lint.run",
        name: "Run Lint",
        description: "Discover the project's package manager and run the lint script. Returns exit code and output.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 60000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["lint.run"],
    },
    // Package info (read-only)
    {
      tool: {
        id: "package.info",
        name: "Package Info",
        description: "Discover the project's package manager, available scripts, and which checks (build/test/typecheck/lint) are configured.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["project:read"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["package.info"],
    },
  ];

  for (const { tool, handler } of tools) {
    toolRegistry.register(tool, handler);
  }
}

// Initialize on module load
registerInternalTools();
