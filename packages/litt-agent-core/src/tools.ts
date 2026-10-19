/**
 * Tool registry — canonical tool definitions and handlers.
 *
 * This is the interface that existing registries (project-tools,
 * litt-intelligence, connectors) will be adapted into.
 *
 * Registers read-only project tools PLUS the shared realtime internet
 * tools (web.fetch, web.search, weather.forecast) so every surface using
 * @litt/agent-core has the same external-data capability. See realtime.ts
 * for the SSRF defense and the single network implementation.
 */

import type {
  ToolDefinition,
  ToolHandler,
  ToolEntry,
  ToolMetadata,
  ToolContext,
  ToolResult,
  ShellExecutor,
} from "./types.js";
import { REALTIME_TOOL_ENTRIES } from "./realtime.js";
import {
  gitDiff,
  gitLog,
  gitBranch,
  listFiles,
  readFile,
  writeFile,
  searchFiles,
  inspectPackageJson,
  runTypecheck,
  runTest,
  runBuild,
  runCommand,
} from "./project.js";

// ─── Tool Definitions ─────────────────────────────────────────────

const STATUS_DEF: ToolDefinition = {
  id: "project.status",
  name: "status",
  description: "Get project status: root, branch, git changes, remote",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
};

const DIFF_DEF: ToolDefinition = {
  id: "project.diff",
  name: "diff",
  description: "Get git diff (unstaged changes by default)",
  inputSchema: {
    type: "object",
    properties: {
      staged: { type: "boolean", description: "Show staged changes", default: false },
    },
  },
  readOnly: true,
};

const LOG_DEF: ToolDefinition = {
  id: "project.log",
  name: "log",
  description: "Get recent git commits",
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "number", description: "Number of commits", default: 10 },
    },
  },
  readOnly: true,
};

const BRANCH_DEF: ToolDefinition = {
  id: "project.branch",
  name: "branch",
  description: "Get current git branch name",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
};

const LIST_FILES_DEF: ToolDefinition = {
  id: "project.list_files",
  name: "list_files",
  description: "List files in a directory (non-recursive). Omit path, or pass \".\" or \"\", to list the project root.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path relative to project root (default: project root)" },
    },
  },
  readOnly: true,
};

const READ_FILE_DEF: ToolDefinition = {
  id: "project.read_file",
  name: "read_file",
  description: "Read a file's contents",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to project root" },
    },
    required: ["path"],
  },
  readOnly: true,
};

const SEARCH_DEF: ToolDefinition = {
  id: "project.search",
  name: "search",
  description: "Search file contents using git grep",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  readOnly: true,
};

const INSPECT_PKG_DEF: ToolDefinition = {
  id: "project.inspect_package",
  name: "inspect_package",
  description: "Read and parse package.json",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
};

const CHECK_DEF: ToolDefinition = {
  id: "project.check",
  name: "check",
  description: "Run typecheck (tsc --noEmit or package.json typecheck script)",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
};

const TEST_DEF: ToolDefinition = {
  id: "project.test",
  name: "test",
  description: "Run tests via the project's test script",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
};

const BUILD_DEF: ToolDefinition = {
  id: "project.build",
  name: "build",
  description: "Run build via the project's build script",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
};

const RUN_DEF: ToolDefinition = {
  id: "project.run",
  name: "run",
  description:
    "Run a single executable in the project directory. There is NO shell: " +
    "\"command\" must be a bare executable name (e.g. \"pnpm\"), and every " +
    "remaining word goes in \"args\" as its own array entry. Shell syntax " +
    "(redirection \">\"/\">>\", pipes \"|\", \"&&\", \";\") is NOT " +
    "interpreted and will be rejected. To create or overwrite a file, use " +
    "project.write_file instead.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "A single executable name, with no spaces or shell operators (e.g. \"pnpm\", not \"pnpm build && echo done\")" },
      args: { type: "array", items: { type: "string" }, description: "Arguments, each as its own array entry" },
    },
    required: ["command"],
  },
  readOnly: true,
};

const SYSTEM_SNAPSHOT_DEF: ToolDefinition = {
  id: "system.snapshot",
  name: "system_snapshot",
  description:
    "Read-only host snapshot: CPU, memory, GPU/VRAM (when nvidia-smi is " +
    "present), and Ollama runtime state (loaded models, VRAM use) when a " +
    "local Ollama endpoint answers. Each section reports honest " +
    "unavailability — never guessed values.",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
};

const WRITE_FILE_DEF: ToolDefinition = {
  id: "project.write_file",
  name: "write_file",
  description:
    "Create a file, or overwrite it if it already exists, with exact " +
    "content. The only way to persist new file content — project.run has " +
    "no shell and cannot do this via redirection. The path must be " +
    "relative to the project root and stay inside it (no absolute paths, " +
    "no \"..\"). Parent directories are created automatically. Mutating — " +
    "requires approval in ACT mode.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to the project root, e.g. \"index.html\" or \"src/app.js\"" },
      content: { type: "string", description: "The exact file content to write" },
    },
    required: ["path", "content"],
  },
  readOnly: false,
};

// ─── Tool Handlers ────────────────────────────────────────────────

const READ_ONLY_META: ToolMetadata = {
  projectScoped: false,
  mutating: false,
  readOnly: true,
};

const MUTATING_META: ToolMetadata = {
  projectScoped: true,
  mutating: true,
  readOnly: false,
};

const statusHandler: ToolHandler = async (ctx) => {
  const { projectStatus } = await import("./project.js");
  const status = await projectStatus(ctx.shell, ctx.cwd);
  if (!status.isGitRepo) {
    return {
      status: "success",
      success: true,
      message: `${status.name} — not a git repository`,
      data: {
        root: status.root,
        name: status.name,
        isGitRepo: false,
        branch: null,
        remote: null,
        clean: true,
        changed: 0,
        untracked: 0,
        files: [],
      },
    };
  }
  return {
    status: "success",
    success: true,
    message: `${status.name} on ${status.branch ?? "detached"} — ${
      status.clean ? "Working tree clean" : `${status.changed} changed, ${status.untracked} untracked`
    }`,
    data: {
      root: status.root,
      name: status.name,
      isGitRepo: status.isGitRepo,
      branch: status.branch,
      remote: status.remote,
      clean: status.clean,
      changed: status.changed,
      untracked: status.untracked,
      gitStatus: { porcelain: status.files.join("\n"), changeCount: status.changed + status.untracked, files: status.files },
    },
  };
};

const diffHandler: ToolHandler = async (ctx, args) => {
  const staged = Boolean(args.staged);
  return gitDiff(ctx.shell, ctx.cwd, staged);
};

const logHandler: ToolHandler = async (ctx, args) => {
  const count = typeof args.count === "number" ? args.count : 10;
  return gitLog(ctx.shell, ctx.cwd, count);
};

const branchHandler: ToolHandler = async (ctx) => {
  return gitBranch(ctx.shell, ctx.cwd);
};

const listFilesHandler: ToolHandler = async (ctx, args) => {
  const dirPath = typeof args.path === "string" ? args.path : ".";
  return listFiles(ctx.shell, dirPath);
};

const readFileHandler: ToolHandler = async (ctx, args) => {
  const filePath = typeof args.path === "string" ? args.path : "";
  if (!filePath) {
    return { status: "failed", success: false, message: "Missing required arg: path", data: {} };
  }
  return readFile(ctx.shell, filePath);
};

const searchHandler: ToolHandler = async (ctx, args) => {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query) {
    return { status: "failed", success: false, message: "Missing required arg: query", data: {} };
  }
  return searchFiles(ctx.shell, query);
};

const inspectPkgHandler: ToolHandler = async (ctx) => {
  return inspectPackageJson(ctx.shell, ctx.cwd);
};

const checkHandler: ToolHandler = async (ctx) => {
  return runTypecheck(ctx.shell, ctx.cwd);
};

const testHandler: ToolHandler = async (ctx) => {
  return runTest(ctx.shell, ctx.cwd);
};

const buildHandler: ToolHandler = async (ctx) => {
  return runBuild(ctx.shell, ctx.cwd);
};

const runHandler: ToolHandler = async (ctx, args) => {
  const command = typeof args.command === "string" ? args.command : "";
  if (!command) {
    return { status: "failed", success: false, message: "Missing required arg: command", data: {} };
  }
  const cmdArgs = Array.isArray(args.args) ? args.args.filter((a): a is string => typeof a === "string") : [];
  const stdin = typeof args.stdin === "string" ? args.stdin : undefined;
  return runCommand(ctx.shell, command, cmdArgs, { cwd: ctx.cwd, stdin });
};

const systemSnapshotHandler: ToolHandler = async () => {
  const os = await import("node:os");
  const data: Record<string, unknown> = {
    cpu: {
      model: os.cpus()[0]?.model ?? null,
      cores: os.cpus().length,
      loadAvg: os.loadavg(),
    },
    memory: {
      totalMb: Math.round(os.totalmem() / 1048576),
      freeMb: Math.round(os.freemem() / 1048576),
    },
    platform: `${os.platform()} ${os.release()}`,
    uptimeSec: Math.round(os.uptime()),
  };

  // GPU via nvidia-smi — structured execFile, no shell, read-only query.
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)(
      "nvidia-smi",
      ["--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu", "--format=csv,noheader,nounits"],
      { timeout: 3_000 },
    );
    const [name, total, used, free, util] =
      stdout.trim().split("\n")[0].split(",").map((s) => s.trim());
    data.gpu = { name, vramTotalMb: +total, vramUsedMb: +used, vramFreeMb: +free, utilizationPct: +util };
  } catch {
    data.gpu = { available: false, reason: "nvidia-smi unavailable" };
  }

  // Ollama runtime — /api/ps on the configured/default endpoint.
  const rawEndpoint =
    process.env.LITT_OLLAMA_URL ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
  let endpoint = rawEndpoint;
  try {
    const u = new URL(rawEndpoint);
    u.username = "";
    u.password = "";
    endpoint = u.href.replace(/\/+$/, "");
  } catch {
    endpoint = "http://localhost:11434";
  }
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, "")}/api/ps`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      models?: Array<{ name?: string; size_vram?: number; context_length?: number; expires_at?: string }>;
    };
    data.ollama = {
      endpoint,
      reachable: true,
      loadedModels: (body.models ?? []).map((m) => ({
        name: m.name ?? null,
        vramMb: m.size_vram ? Math.round(m.size_vram / 1048576) : null,
        contextLength: m.context_length ?? null,
        expiresAt: m.expires_at ?? null,
      })),
    };
  } catch (err) {
    data.ollama = {
      endpoint,
      reachable: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  return { status: "success", success: true, message: "system snapshot collected", data };
};

const writeFileHandler: ToolHandler = async (ctx, args) => {
  const filePath = typeof args.path === "string" ? args.path : "";
  if (!filePath) {
    return { status: "failed", success: false, message: "Missing required arg: path", data: {} };
  }
  const content = typeof args.content === "string" ? args.content : "";
  return writeFile(ctx.shell, filePath, content);
};

// ─── Registry ─────────────────────────────────────────────────────

const ENTRIES: Record<string, ToolEntry> = {
  "project.status": { definition: STATUS_DEF, handler: statusHandler, metadata: READ_ONLY_META },
  "project.diff": { definition: DIFF_DEF, handler: diffHandler, metadata: READ_ONLY_META },
  "project.log": { definition: LOG_DEF, handler: logHandler, metadata: READ_ONLY_META },
  "project.branch": { definition: BRANCH_DEF, handler: branchHandler, metadata: READ_ONLY_META },
  "project.list_files": { definition: LIST_FILES_DEF, handler: listFilesHandler, metadata: READ_ONLY_META },
  "project.read_file": { definition: READ_FILE_DEF, handler: readFileHandler, metadata: READ_ONLY_META },
  "project.write_file": { definition: WRITE_FILE_DEF, handler: writeFileHandler, metadata: MUTATING_META },
  "project.search": { definition: SEARCH_DEF, handler: searchHandler, metadata: READ_ONLY_META },
  "project.inspect_package": { definition: INSPECT_PKG_DEF, handler: inspectPkgHandler, metadata: READ_ONLY_META },
  "project.check": { definition: CHECK_DEF, handler: checkHandler, metadata: READ_ONLY_META },
  "project.test": { definition: TEST_DEF, handler: testHandler, metadata: READ_ONLY_META },
  "project.build": { definition: BUILD_DEF, handler: buildHandler, metadata: READ_ONLY_META },
  "project.run": { definition: RUN_DEF, handler: runHandler, metadata: READ_ONLY_META },
  "system.snapshot": { definition: SYSTEM_SNAPSHOT_DEF, handler: systemSnapshotHandler, metadata: READ_ONLY_META },
  // Shared realtime internet capability — see realtime.ts.
  ...REALTIME_TOOL_ENTRIES,
};

export class ToolRegistry {
  private entries: Record<string, ToolEntry>;

  constructor(initial?: Record<string, ToolEntry>) {
    this.entries = { ...ENTRIES, ...initial };
  }

  register(entry: ToolEntry): void {
    this.entries[entry.definition.id] = entry;
  }

  get(toolId: string): ToolEntry | null {
    return this.entries[toolId] ?? null;
  }

  list(): ToolDefinition[] {
    return Object.values(this.entries).map((e) => e.definition);
  }

  async execute(
    toolId: string,
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const entry = this.entries[toolId];
    if (!entry) {
      return { status: "failed", success: false, message: `Unknown tool: ${toolId}`, data: {} };
    }
    return entry.handler(ctx, args);
  }
}

/** Default registry with read-only project tools pre-registered. */
export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry();
}
