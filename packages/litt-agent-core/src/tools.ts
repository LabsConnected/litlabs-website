/**
 * Tool registry — canonical tool definitions and handlers.
 *
 * This is the interface that existing registries (project-tools,
 * litt-intelligence, connectors) will be adapted into.
 *
 * Phase 1 only registers read-only project tools.
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
import {
  gitStatus,
  gitDiff,
  gitLog,
  gitBranch,
  listFiles,
  readFile,
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
  description: "List files in a directory (non-recursive)",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path relative to project root" },
    },
    required: ["path"],
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
  description: "Run an arbitrary command in the project directory",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Command to run" },
      args: { type: "array", items: { type: "string" }, description: "Arguments" },
    },
    required: ["command"],
  },
  readOnly: true,
};

// ─── Tool Handlers ────────────────────────────────────────────────

const READ_ONLY_META: ToolMetadata = {
  projectScoped: false,
  mutating: false,
  readOnly: true,
};

const statusHandler: ToolHandler = async (ctx) => {
  const { resolveProjectContext } = await import("./project.js");
  const project = await resolveProjectContext(ctx.shell, ctx.cwd);
  const statusResult = await gitStatus(ctx.shell, ctx.cwd);
  return {
    status: "success",
    success: true,
    message: `${project.name} on ${project.branch ?? "detached"} — ${statusResult.message}`,
    data: {
      root: project.root,
      name: project.name,
      isGitRepo: project.isGitRepo,
      branch: project.branch,
      remote: project.remote,
      gitStatus: statusResult.data,
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
  return runCommand(ctx.shell, command, cmdArgs, { cwd: ctx.cwd });
};

// ─── Registry ─────────────────────────────────────────────────────

const ENTRIES: Record<string, ToolEntry> = {
  "project.status": { definition: STATUS_DEF, handler: statusHandler, metadata: READ_ONLY_META },
  "project.diff": { definition: DIFF_DEF, handler: diffHandler, metadata: READ_ONLY_META },
  "project.log": { definition: LOG_DEF, handler: logHandler, metadata: READ_ONLY_META },
  "project.branch": { definition: BRANCH_DEF, handler: branchHandler, metadata: READ_ONLY_META },
  "project.list_files": { definition: LIST_FILES_DEF, handler: listFilesHandler, metadata: READ_ONLY_META },
  "project.read_file": { definition: READ_FILE_DEF, handler: readFileHandler, metadata: READ_ONLY_META },
  "project.search": { definition: SEARCH_DEF, handler: searchHandler, metadata: READ_ONLY_META },
  "project.inspect_package": { definition: INSPECT_PKG_DEF, handler: inspectPkgHandler, metadata: READ_ONLY_META },
  "project.check": { definition: CHECK_DEF, handler: checkHandler, metadata: READ_ONLY_META },
  "project.test": { definition: TEST_DEF, handler: testHandler, metadata: READ_ONLY_META },
  "project.build": { definition: BUILD_DEF, handler: buildHandler, metadata: READ_ONLY_META },
  "project.run": { definition: RUN_DEF, handler: runHandler, metadata: READ_ONLY_META },
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
