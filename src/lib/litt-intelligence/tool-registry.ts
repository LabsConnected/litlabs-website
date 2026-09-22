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
import type { WorkspaceTransport } from "./workspace-transport";
// Shared realtime capability from @litt/agent-core — the ONE implementation.
// The web registry delegates to it so CLI and Studio have the same capability.
import { webSearch as coreWebSearch, safeFetch as coreSafeFetch, weatherForecast as coreWeatherForecast, SafeFetchError } from "@litt/agent-core";

type ToolHandler = (inputs: Record<string, unknown>, transport?: unknown) => Promise<unknown>;

type V2Module = typeof import("./tool-handlers-v2");
type V2Handler = (inputs: Record<string, unknown>, transport: WorkspaceTransport) => Promise<unknown>;

/**
 * Thrown when a tool handler exceeds its declared `timeoutMs`.
 * Every registered tool declares a timeoutMs — until now it was
 * documentation only: `execute()` awaited the handler with no bound, so a
 * wedged workspace call (dead socket, stalled terminal-server) could hang
 * the agent loop past every runtime budget and leave the run stuck in
 * 'streaming' with no persisted outcome.
 */
export class ToolExecutionTimeoutError extends Error {
  constructor(
    public readonly toolId: string,
    public readonly timeoutMs: number,
  ) {
    super(`Tool "${toolId}" timed out after ${timeoutMs}ms`);
    this.name = "ToolExecutionTimeoutError";
  }
}

/** Thrown when the run's abort signal fires while a tool is in flight. */
export class ToolExecutionAbortedError extends Error {
  constructor(public readonly toolId: string) {
    super(`Tool "${toolId}" was aborted`);
    this.name = "ToolExecutionAbortedError";
  }
}

/** Safety bound for tools that somehow lack a declared timeoutMs. */
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

/**
 * Bound a tool invocation by its declared deadline and the run's abort
 * signal. A timeout/abort rejects the awaited promise so the loop records
 * a truthful tool failure and can recover — the underlying handler may
 * still settle in the background (transports carry their own fetch
 * timeouts), but the run is never held hostage by it.
 */
function withExecutionDeadline<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  toolId: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => reject(new ToolExecutionTimeoutError(toolId, timeoutMs)));
    }, timeoutMs);
    // A detached run must not keep the process alive for its timeout.
    (timer as { unref?: () => void }).unref?.();
    const onAbort = () => {
      finish(() => reject(new ToolExecutionAbortedError(toolId)));
    };
    function finish(fn: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    }
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new ToolExecutionAbortedError(toolId));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    run().then(
      (value) => finish(() => resolve(value)),
      (err) => finish(() => reject(err)),
    );
  });
}

/**
 * Workspace-scoped tools MUST execute through the WorkspaceTransport
 * (authenticated, workspace-rooted terminal-server endpoints). They must
 * never fall back to the web service's own filesystem — process.cwd() on
 * this service is the LiTT app deployment, not user project storage.
 * Missing transport → fail closed.
 */
function workspaceTool(load: (mod: V2Module) => V2Handler): () => Promise<ToolHandler> {
  return async () => {
    const handler = load(await import("./tool-handlers-v2"));
    return (inputs, transport) => {
      if (!transport) {
        throw new Error("This tool requires an active project workspace");
      }
      return handler(inputs, transport as WorkspaceTransport);
    };
  };
}

/**
 * Deterministic close of the generate → site loop.
 *
 * image.generate returns a downloadUrl for chat rendering, but the model
 * demonstrably skips the follow-up project.insert_asset call and ships
 * <img> tags pointing at files that were never saved (P0 found in the
 * 2026-09-17 production acceptance run: broken hero image, agent claiming
 * "deployment verified with a 200 response"). So when image.generate
 * succeeds inside an active project workspace, the registry itself persists
 * the image into public/assets/images/ and appends the sitePath to the
 * result. The model then references a path that is guaranteed to exist.
 *
 * The save runs under the image.generate approval: generating "an image for
 * my site" is one user-visible action and the asset file is its
 * fulfillment. A failed save is reported loudly in the result — never
 * swallowed — so the agent cannot claim success with a missing asset.
 *
 * Exported for unit tests.
 */
export async function maybeAutoInsertGeneratedImage(
  toolId: string,
  result: unknown,
  transport: unknown,
): Promise<unknown> {
  if (toolId !== "image.generate") return result;
  const r = result as Record<string, unknown> | null;
  if (!r || r.success !== true || typeof r.downloadUrl !== "string") return result;
  const t = transport as { projectId?: unknown; writeBinaryFile?: unknown } | null;
  if (!t || typeof t.projectId !== "string" || !t.projectId || typeof t.writeBinaryFile !== "function") {
    return result; // chat-only context: no project workspace to save into
  }
  try {
    const { insertAssetFromUrl } = await import("./tool-handlers-v2");
    const nameHint = typeof r.title === "string" && r.title.length > 0 ? r.title : undefined;
    const saved = await insertAssetFromUrl(r.downloadUrl, { nameHint }, t as WorkspaceTransport);
    if (saved.success) {
      // The save already happened under this approval — drop the handler's
      // insertHint/markdown, which still tell the model to call
      // project.insert_asset with the raw downloadUrl. Free providers return
      // multi-KB data: URLs the model can only re-emit truncated, which wrote
      // a corrupt stub asset and got referenced by the site HTML in the
      // 2026-09-18 acceptance run.
      const { insertHint: _insertHint, markdown: _markdown, ...rest } = r;
      return {
        ...rest,
        savedToProject: true,
        projectPath: saved.path,
        sitePath: saved.sitePath,
        siteReference:
          `The image is already saved in the project at ${saved.sitePath}. ` +
          `Reference it in the site's HTML as <img src="${saved.sitePath}" /> — ` +
          `do NOT call project.insert_asset again and do NOT invent another path.`,
      };
    }
    return {
      ...r,
      savedToProject: false,
      saveError: saved.error ?? "Failed to save image into project",
    };
  } catch (err) {
    return {
      ...r,
      savedToProject: false,
      saveError: err instanceof Error ? err.message : "Failed to save image into project",
    };
  }
}

const lazyHandlers: Record<string, () => Promise<ToolHandler>> = {
  // Workspace-scoped tools — workspace-transport handlers only.
  "project.scan": workspaceTool((m) => m.handleProjectScan),
  "files.list": workspaceTool((m) => m.handleFilesList),
  "files.read": workspaceTool((m) => m.handleFilesRead),
  "files.write": workspaceTool((m) => m.handleFilesWrite),
  "git.status": workspaceTool((m) => m.handleGitStatus),
  "terminal.execute": workspaceTool((m) => m.handleTerminalExecute),
  "project.health": workspaceTool((m) => m.handleProjectHealth),
  "project.insert_asset": workspaceTool((m) => m.handleProjectInsertAsset),
  // App-level capability — server-side HTTP, not workspace-scoped.
  "image.generate": async () => (await import("./tool-handlers")).handleImageGenerate,
  // V2 workspace-aware handlers (used by agent-loop-v2.ts)
  // All require a WorkspaceTransport — missing transport fails closed.
  "files.delete": workspaceTool((m) => m.handleFilesDelete),
  "files.mkdir": workspaceTool((m) => m.handleFilesMkdir),
  "files.rename": workspaceTool((m) => m.handleFilesRename),
  "search_code": workspaceTool((m) => m.handleSearchCode),
  "git.diff": workspaceTool((m) => m.handleGitDiff),
  "git.log": workspaceTool((m) => m.handleGitLog),
  "git.commit": workspaceTool((m) => m.handleGitCommit),
  "apply_patch": workspaceTool((m) => m.handleApplyPatch),
  "build.run": workspaceTool((m) => m.handleBuildRun),
  "test.run": workspaceTool((m) => m.handleTestRun),
  "typecheck.run": workspaceTool((m) => m.handleTypecheckRun),
  "lint.run": workspaceTool((m) => m.handleLintRun),
  "package.info": workspaceTool((m) => m.handlePackageInfo),
  "preview.start": workspaceTool((m) => m.handlePreviewStart),
  "preview.status": workspaceTool((m) => m.handlePreviewStatus),
  "preview.stop": workspaceTool((m) => m.handlePreviewStop),
  // Deploy tools act on the configured deploy provider, not a workspace.
  "deploy.execute": async () => (await import("./tool-handlers-v2")).handleDeployExecute as ToolHandler,
  "deploy.verify": async () => (await import("./tool-handlers-v2")).handleDeployVerify as ToolHandler,
  "project.deploy": workspaceTool((m) => m.handleProjectDeploy),
  // Browser Agent Mode handlers (lazy-loaded, session-scoped)
  "browser.navigate": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.navigate"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.snapshot": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.snapshot"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.screenshot": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.screenshot"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.click": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.click"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.type": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.type"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.select": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.select"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.scroll": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.scroll"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.press": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.press"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.wait": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.wait"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.extract": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.extract"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.upload": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.upload"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.back": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.back"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.forward": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.forward"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.reload": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.reload"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  "browser.close": async () => {
    const h = (await import("./browser-tool-handlers")).browserToolHandlers["browser.close"];
    return ((inputs: Record<string, unknown>) => h({ sessionId: inputs.sessionId as string, userId: inputs.userId as string }, inputs)) as ToolHandler;
  },
  // browser.start_session is the entry point: it provisions the sessionId
  // the other browser.* tools require. Beta-gated inside the handler.
  // Phase 2: get-or-reuse — an existing live session for this conversation
  // is reused instead of starting a new one (multi-turn browsing).
  "browser.start_session": async () => {
    const m = await import("./browser-agent");
    return (async (inputs: Record<string, unknown>) => {
      const userId = inputs.userId as string;
      const task = typeof inputs.task === "string" ? inputs.task : undefined;
      const conversationId =
        typeof inputs.conversationId === "string" ? inputs.conversationId : undefined;
      return m.getOrReuseAgentBrowserSession({ userId, task, conversationId });
    }) as ToolHandler;
  },
  // ─── Realtime internet tools — delegate to @litt/agent-core ──
  // The ONE shared implementation (SSRF-safe fetch, NWS weather, DuckDuckGo
  // search). Surfaces adapt it; they never reimplement the network logic.
  "web.search": async () => {
    return (async (inputs: Record<string, unknown>) => {
      const query = typeof inputs.query === "string" ? inputs.query : "";
      if (!query) return { ok: false, error: "Missing required field: query" };
      try {
        return { ok: true, result: await coreWebSearch(query) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }) as ToolHandler;
  },
  "web.fetch": async () => {
    return (async (inputs: Record<string, unknown>) => {
      const url = typeof inputs.url === "string" ? inputs.url : "";
      if (!url) return { ok: false, error: "Missing required field: url" };
      try {
        return { ok: true, result: await coreSafeFetch(url) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }) as ToolHandler;
  },
  "weather.forecast": async () => {
    return (async (inputs: Record<string, unknown>) => {
      const zip = typeof inputs.zip === "string" ? inputs.zip : "";
      if (!zip) return { ok: false, error: "Missing required field: zip" };
      try {
        return { ok: true, result: await coreWeatherForecast(zip) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }) as ToolHandler;
  },
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
      signal?: AbortSignal;
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
      const timeoutMs =
        tool.timeoutMs && tool.timeoutMs > 0 ? tool.timeoutMs : DEFAULT_TOOL_TIMEOUT_MS;
      const finalResult = await withExecutionDeadline(
        async () =>
          maybeAutoInsertGeneratedImage(
            id,
            await handler(inputs, options.transport),
            options.transport,
          ),
        timeoutMs,
        id,
        options.signal,
      );
      return { ok: true, result: finalResult };
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
        enabled: false, // No handler implemented
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
        enabled: false, // No handler implemented
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
      handler: lazyHandlers["web.search"],
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
      handler: lazyHandlers["web.fetch"],
    },
    {
      tool: {
        id: "weather.forecast",
        name: "Weather Forecast",
        description: "Get a real current U.S. weather forecast for a 5-digit ZIP code from the National Weather Service. Returns structured periods with temperature, conditions, wind, and precipitation probability.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { zip: { type: "string" } }, required: ["zip"] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["web_search"],
        requiredPermissions: ["web:fetch"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 20000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["weather.forecast"],
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
        enabled: false, // No handler implemented
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
        enabled: false, // No handler implemented
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
        enabled: false, // No handler implemented
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
        enabled: false, // No handler implemented
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
        enabled: false, // No handler implemented
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
        enabled: false, // No handler implemented
      },
    },
    {
      tool: {
        id: "files.list",
        name: "List Files",
      description: "List files in a project directory. path must be workspace-relative; use . for the workspace root. Never use an absolute or parent path.",
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
      description: "Read a file from the project workspace. path must be workspace-relative; never use an absolute or parent path.",
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
        inputSchema: { type: "object", properties: { prompt: { type: "string" }, projectId: { type: "string" } }, required: ["prompt"] },
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
      handler: lazyHandlers["image.generate"],
    },
    {
      tool: {
        id: "project.insert_asset",
        name: "Insert Asset into Project",
        description:
          "Download an image from a URL and save it into the project workspace (defaults to the directory the " +
          "site's web root serves: public/assets/images for framework projects, assets/images for static sites). " +
          "Use this right after image.generate to place a generated image into the website being built — " +
          "then reference the returned sitePath in the site's HTML. Never leave site images as chat-only renders.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            url: { type: "string", description: "Public HTTPS URL of the image (e.g. the downloadUrl from image.generate)" },
            name: { type: "string", description: "Optional filename hint, e.g. 'hero-sunset'" },
            directory: { type: "string", description: "Optional workspace directory; defaults to the project's served asset directory" },
          },
          required: ["projectId", "url"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["files:write"],
        risk: "high",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 60000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
      handler: lazyHandlers["project.insert_asset"],
    },
    {
      tool: {
        id: "files.write",
        name: "Write File",
      description: "Write or create a file in the project workspace. path must be workspace-relative; never use an absolute or parent path.",
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
        enabled: false, // No handler implemented
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
        enabled: false, // No handler implemented
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
        enabled: false, // No handler implemented
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
        enabled: false, // No handler implemented
      },
    },
    {
      tool: {
        id: "project.deploy",
        name: "Deploy Project",
        description:
          "Deploy the user's current project to a PUBLIC live URL and return it. "
          + "Use this when the user asks to deploy, publish, ship, or go live. "
          + "This is NOT the preview: a preview is a private dev server behind "
          + "login, while this publishes a public snapshot anyone can open. "
          + "Write the project's files first — the deployment publishes what is "
          + "in the workspace, and requires an index.html. The live URL is "
          + "fetched and verified before this reports success, so only report "
          + "the site as live if this tool returned a publicUrl.",
        source: "internal",
        version: "1.0.0",
        // No projectId, userId, provider, account or service inputs: identity
        // and target come from the authorized server-side transport, so the
        // model cannot deploy another tenant's project or aim this at LiTT's
        // own infrastructure.
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["deploy:create"],
        risk: "high",
        approvalPolicy: MUTATION_APPROVAL,
        // Collect + persist + publish + HTTP-verify.
        timeoutMs: 60000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
      handler: lazyHandlers["project.deploy"],
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
        enabled: false, // No handler implemented
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
        enabled: false, // No handler implemented
      },
    },
    // ─── Web Intelligence (Browserbase-powered unified web capability) ──
    {
      tool: {
        id: "web.intelligence",
        name: "Web Intelligence (disabled — no handler)",
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
        enabled: false, // No handler implemented
      },
    },
    // ─── Terminal (disabled by default — enable when terminal connects) ────────
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
        approvalPolicy: NEVER_ALLOW_APPROVAL,
        timeoutMs: 30000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: false,
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
      description: "Apply targeted search-and-replace patches to an existing file. path must be workspace-relative; re-read the file before patching and never use an absolute or parent path.",
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
    // Preview tools (workspace mutation)
    {
      tool: {
        id: "preview.start",
        name: "Start Preview",
        description: "Start the project's dev server and begin health probing. Returns the runtime status, port, and framework once the server responds.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { packageManager: { type: "string" } }, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["preview:open"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 120000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'workspace-write',
        enabled: true,
      },
      handler: lazyHandlers["preview.start"],
    },
    {
      tool: {
        id: "preview.status",
        name: "Preview Status",
        description: "Get the current preview runtime status with a live health check and recent logs.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["preview:open"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 15000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["preview.status"],
    },
    {
      tool: {
        id: "preview.stop",
        name: "Stop Preview",
        description: "Stop the project's running preview dev server.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
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
      handler: lazyHandlers["preview.stop"],
    },
    // Deploy tools (production actions)
    {
      tool: {
        id: "deploy.execute",
        name: "Execute Deployment",
        description: "Trigger a Railway or Vercel deployment. Requires RAILWAY_API_TOKEN + RAILWAY_SERVICE_ID or VERCEL_TOKEN + VERCEL_PROJECT_ID. Returns the deployment ID, status, and verified production URL on success, or a truthful error on failure.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["deploy:execute"],
        risk: "high",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 600000,
        idempotent: false,
        readOnly: false,
        permissionLevel: 'production',
        // Only offer when an infra deploy provider is actually configured
        // AND infra deploys are explicitly opted in. This tool redeploys
        // the configured Railway/Vercel service — the LiTT app itself, not
        // the user's project (that's project.deploy). The app service's own
        // deploy creds are present in production, so without the opt-in the
        // model can pick this over project.deploy: pausing the run for an
        // approval that, once granted, redeploys LiTT instead of publishing
        // the user's site (observed in golden run 35056919596).
        enabled:
          process.env.LITT_ENABLE_INFRA_DEPLOY === "1"
          && Boolean(
            (process.env.RAILWAY_API_TOKEN && process.env.RAILWAY_SERVICE_ID && process.env.RAILWAY_ENVIRONMENT_ID)
            || (process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID),
          ),
      },
      handler: lazyHandlers["deploy.execute"],
    },
    {
      tool: {
        id: "deploy.verify",
        name: "Verify Production URL",
        description: "Fetch a production URL to confirm the deployed site is reachable and healthy.",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["deploy:execute"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 60000,
        idempotent: true,
        readOnly: true,
        permissionLevel: 'read',
        enabled: true,
      },
      handler: lazyHandlers["deploy.verify"],
    },
    // ─── Browser Agent Mode tools ─────────────────────────────
    // browser.start_session is the entry point: call it FIRST before any
    // other browser.* tool — they all require the sessionId it returns.
    {
      tool: {
        id: "browser.start_session",
        name: "Browser Start Session",
        description:
          "Start a new agent browser session (fresh clean profile: no cookies, no logins, no extensions). Returns a sessionId for the other browser.* tools. If you already have a live session for this conversation it is REUSED (reused: true) instead of starting a new one — keep using the returned sessionId across turns. Private beta: only the owner's account may start sessions; other accounts get an honest error. After starting, announce in chat what you are about to do with the browser. The session auto-closes after 10 idle minutes; close it yourself with browser.close when done. " +
          "If a page needs a login, CAPTCHA, MFA, or anything else you cannot do: do NOT try to bypass it and do NOT ask the user for credentials — announce in chat that you need them to take over, naming the blocker (e.g. 'I need you to take over: this page needs a login. Tap Take control, sign in, then Resume and I'll continue.'). While the user is in control your browser actions are refused; resume only after they tap Resume.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            userId: { type: "string" },
            task: {
              type: "string",
              description: "What the browser session is for, e.g. 'screenshot example.com'",
            },
            conversationId: {
              type: "string",
              description: "Injected server-side; enables session reuse across chat turns.",
            },
          },
          required: ["userId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 60000,
        idempotent: false,
        readOnly: true,
        permissionLevel: "read",
        enabled: true,
      },
      handler: lazyHandlers["browser.start_session"],
    },
    // Read-only browser tools (auto-approved)
    {
      tool: {
        id: "browser.navigate",
        name: "Browser Navigate",
        description: "Navigate the browser session to a URL. Returns updated page state (URL, title, screenshot).",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
            url: { type: "string" },
            waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
          },
          required: ["sessionId", "userId", "url"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 30000,
        idempotent: true,
        readOnly: true,
        permissionLevel: "read",
        enabled: true,
      },
      handler: lazyHandlers["browser.navigate"],
    },
    {
      tool: {
        id: "browser.snapshot",
        name: "Browser Snapshot",
        description: "Capture accessibility tree and visible text content from the current page. Returns structured page state for LiTT to understand the UI.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
          },
          required: ["sessionId", "userId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 15000,
        idempotent: true,
        readOnly: true,
        permissionLevel: "read",
        enabled: true,
      },
      handler: lazyHandlers["browser.snapshot"],
    },
    {
      tool: {
        id: "browser.screenshot",
        name: "Browser Screenshot",
        description: "Capture a screenshot of the current page. Returns base64 PNG image and page state.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
          },
          required: ["sessionId", "userId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: true,
        permissionLevel: "read",
        enabled: true,
      },
      handler: lazyHandlers["browser.screenshot"],
    },
    {
      tool: {
        id: "browser.extract",
        name: "Browser Extract",
        description: "Extract structured data from the current page using a natural language instruction and optional schema.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
            instruction: { type: "string" },
            schema: { type: "object" },
          },
          required: ["sessionId", "userId", "instruction"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 30000,
        idempotent: true,
        readOnly: true,
        permissionLevel: "read",
        enabled: true,
      },
      handler: lazyHandlers["browser.extract"],
    },
    {
      tool: {
        id: "browser.wait",
        name: "Browser Wait",
        description: "Wait for a condition: selector to appear, navigation to complete, or a timeout.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
            selector: { type: "string" },
            timeoutMs: { type: "number" },
            waitFor: { type: "string", enum: ["selector", "navigation", "timeout"] },
          },
          required: ["sessionId", "userId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 30000,
        idempotent: true,
        readOnly: true,
        permissionLevel: "read",
        enabled: true,
      },
      handler: lazyHandlers["browser.wait"],
    },
    {
      tool: {
        id: "browser.back",
        name: "Browser Back",
        description: "Navigate back in browser history. Returns updated page state.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
          },
          required: ["sessionId", "userId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 15000,
        idempotent: true,
        readOnly: true,
        permissionLevel: "read",
        enabled: true,
      },
      handler: lazyHandlers["browser.back"],
    },
    {
      tool: {
        id: "browser.forward",
        name: "Browser Forward",
        description: "Navigate forward in browser history. Returns updated page state.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
          },
          required: ["sessionId", "userId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 15000,
        idempotent: true,
        readOnly: true,
        permissionLevel: "read",
        enabled: true,
      },
      handler: lazyHandlers["browser.forward"],
    },
    {
      tool: {
        id: "browser.reload",
        name: "Browser Reload",
        description: "Reload the current page. Returns updated page state.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
          },
          required: ["sessionId", "userId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 15000,
        idempotent: true,
        readOnly: true,
        permissionLevel: "read",
        enabled: true,
      },
      handler: lazyHandlers["browser.reload"],
    },
    // Mutation browser tools (require approval in ACT mode)
    {
      tool: {
        id: "browser.click",
        name: "Browser Click",
        description: "Click an element on the page. Uses selector priority: DOM selector > accessibility attributes > text matching > coordinates.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
            selector: { type: "string" },
            role: { type: "string" },
            ariaLabel: { type: "string" },
            testId: { type: "string" },
            text: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["sessionId", "userId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 15000,
        idempotent: false,
        readOnly: false,
        permissionLevel: "draft",
        enabled: true,
      },
      handler: lazyHandlers["browser.click"],
    },
    {
      tool: {
        id: "browser.type",
        name: "Browser Type",
        description: "Type text into an input field. Uses selector priority chain to locate the field.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
            selector: { type: "string" },
            role: { type: "string" },
            ariaLabel: { type: "string" },
            testId: { type: "string" },
            text: { type: "string" },
            value: { type: "string" },
            clear: { type: "boolean" },
          },
          required: ["sessionId", "userId", "value"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 15000,
        idempotent: false,
        readOnly: false,
        permissionLevel: "draft",
        enabled: true,
      },
      handler: lazyHandlers["browser.type"],
    },
    {
      tool: {
        id: "browser.select",
        name: "Browser Select",
        description: "Select an option from a <select> dropdown element.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
            selector: { type: "string" },
            testId: { type: "string" },
            ariaLabel: { type: "string" },
            value: { type: "string" },
            label: { type: "string" },
          },
          required: ["sessionId", "userId", "value"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 15000,
        idempotent: false,
        readOnly: false,
        permissionLevel: "draft",
        enabled: true,
      },
      handler: lazyHandlers["browser.select"],
    },
    {
      tool: {
        id: "browser.scroll",
        name: "Browser Scroll",
        description: "Scroll the page or a specific element in a direction by a specified amount.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
            direction: { type: "string", enum: ["up", "down", "left", "right"] },
            amount: { type: "number" },
            selector: { type: "string" },
          },
          required: ["sessionId", "userId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: false,
        permissionLevel: "draft",
        enabled: true,
      },
      handler: lazyHandlers["browser.scroll"],
    },
    {
      tool: {
        id: "browser.press",
        name: "Browser Press Key",
        description: "Press a keyboard key (e.g. Enter, Tab, Escape, ArrowDown).",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
            key: { type: "string" },
          },
          required: ["sessionId", "userId", "key"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 10000,
        idempotent: true,
        readOnly: false,
        permissionLevel: "draft",
        enabled: true,
      },
      handler: lazyHandlers["browser.press"],
    },
    {
      tool: {
        id: "browser.upload",
        name: "Browser Upload File",
        description: "Upload a file to a file input element on the page.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
            selector: { type: "string" },
            testId: { type: "string" },
            ariaLabel: { type: "string" },
            filePath: { type: "string" },
          },
          required: ["sessionId", "userId", "filePath"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "medium",
        approvalPolicy: MUTATION_APPROVAL,
        timeoutMs: 30000,
        idempotent: false,
        readOnly: false,
        permissionLevel: "workspace-write",
        enabled: true,
      },
      handler: lazyHandlers["browser.upload"],
    },
    {
      tool: {
        id: "browser.close",
        name: "Browser Close Session",
        description: "Close the browser session and release all resources.",
        source: "internal",
        version: "1.0.0",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            userId: { type: "string" },
          },
          required: ["sessionId", "userId"],
        },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: ["browser:control"],
        risk: "low",
        approvalPolicy: READ_ONLY_APPROVAL,
        timeoutMs: 10000,
        idempotent: false,
        readOnly: false,
        permissionLevel: "draft",
        enabled: true,
      },
      handler: lazyHandlers["browser.close"],
    },
  ];

  for (const { tool, handler } of tools) {
    toolRegistry.register(tool, handler);
  }
}

// Initialize on module load
registerInternalTools();
