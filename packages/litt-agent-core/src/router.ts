/**
 * Command router — deterministic commands that bypass the LLM.
 *
 * `litt status` and `litt diff` call exactly the same underlying
 * handlers as the slash commands `/status` and `/diff`.
 *
 * No LLM inference is permitted for deterministic commands.
 *
 * Phase 2C: optionally updates a RuntimeStore with command start/end
 * events so both PowerShell and web surfaces see the same execution truth.
 */

import type { ShellExecutor, ToolResult, ToolContext } from "./types.js";
import { ToolRegistry, createDefaultRegistry } from "./tools.js";
import { resolveProjectContext } from "./project.js";
import type { RuntimeStore } from "./state.js";

export interface CommandResult {
  command: string;
  result: ToolResult;
  project?: {
    root: string;
    name: string;
    branch: string | null;
    remote: string | null;
    isGitRepo: boolean;
  };
}

export class CommandRouter {
  private registry: ToolRegistry;
  private shell: ShellExecutor;
  private cwd: string;
  private userId: string | null;
  private store: RuntimeStore | null;

  constructor(shell: ShellExecutor, options?: {
    registry?: ToolRegistry;
    cwd?: string;
    userId?: string | null;
    store?: RuntimeStore | null;
  }) {
    this.shell = shell;
    this.registry = options?.registry ?? createDefaultRegistry();
    this.cwd = options?.cwd ?? shell.cwd;
    this.userId = options?.userId ?? null;
    this.store = options?.store ?? null;
  }

  private ctx(): ToolContext {
    return {
      cwd: this.cwd,
      projectId: null,
      userId: this.userId,
      shell: this.shell,
    };
  }

  /**
   * Execute a tool with optional RuntimeStore tracking.
   * For execution commands (check/test/build), records start/end in the store.
   */
  private async execWithTracking(
    commandName: string,
    toolId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const isExecCommand = ["project.check", "project.test", "project.build", "project.run"].includes(toolId);

    if (this.store && isExecCommand) {
      this.store.commandStart(commandName, [], this.cwd);
    }
    const t0 = Date.now();
    const result = await this.registry.execute(toolId, this.ctx(), args);
    const durationMs = Date.now() - t0;

    if (this.store && isExecCommand) {
      this.store.commandEnd(
        commandName,
        result.success,
        (result.data.exitCode as number | null) ?? (result.success ? 0 : 1),
        durationMs,
        result.message,
      );
    }
    return result;
  }

  async status(): Promise<CommandResult> {
    const project = await resolveProjectContext(this.shell, this.cwd);
    const result = await this.registry.execute("project.status", this.ctx(), {});
    if (this.store) {
      this.store.setProject({
        root: project.root,
        name: project.name,
        isGitRepo: project.isGitRepo,
        branch: project.branch,
        remote: project.remote,
      });
      this.store.setGitChanges((result.data.gitStatus as { changeCount?: number })?.changeCount ?? 0);
    }
    return {
      command: "status",
      result,
      project: {
        root: project.root,
        name: project.name,
        branch: project.branch,
        remote: project.remote,
        isGitRepo: project.isGitRepo,
      },
    };
  }

  async diff(staged = false): Promise<CommandResult> {
    const result = await this.registry.execute("project.diff", this.ctx(), { staged });
    return { command: "diff", result };
  }

  async log(count = 10): Promise<CommandResult> {
    const result = await this.registry.execute("project.log", this.ctx(), { count });
    return { command: "log", result };
  }

  async branch(): Promise<CommandResult> {
    const result = await this.registry.execute("project.branch", this.ctx(), {});
    return { command: "branch", result };
  }

  async listFiles(dirPath: string): Promise<CommandResult> {
    const result = await this.registry.execute("project.list_files", this.ctx(), { path: dirPath });
    return { command: "list_files", result };
  }

  async readFile(filePath: string): Promise<CommandResult> {
    const result = await this.registry.execute("project.read_file", this.ctx(), { path: filePath });
    return { command: "read_file", result };
  }

  async search(query: string): Promise<CommandResult> {
    const result = await this.registry.execute("project.search", this.ctx(), { query });
    return { command: "search", result };
  }

  async inspectPackage(): Promise<CommandResult> {
    const result = await this.registry.execute("project.inspect_package", this.ctx(), {});
    return { command: "inspect_package", result };
  }

  async check(): Promise<CommandResult> {
    const result = await this.execWithTracking("check", "project.check", {});
    return { command: "check", result };
  }

  async test(): Promise<CommandResult> {
    const result = await this.execWithTracking("test", "project.test", {});
    return { command: "test", result };
  }

  async build(): Promise<CommandResult> {
    const result = await this.execWithTracking("build", "project.build", {});
    return { command: "build", result };
  }

  /**
   * Dispatch a command by name.
   * Used by CLI entry points.
   */
  async dispatch(command: string, args?: Record<string, unknown>): Promise<CommandResult> {
    switch (command) {
      case "status": return this.status();
      case "diff": return this.diff(Boolean(args?.staged));
      case "log": return this.log(typeof args?.count === "number" ? args.count : 10);
      case "branch": return this.branch();
      case "list_files": return this.listFiles(typeof args?.path === "string" ? args.path : ".");
      case "read_file": return this.readFile(typeof args?.path === "string" ? args.path : "");
      case "search": return this.search(typeof args?.query === "string" ? args.query : "");
      case "inspect_package": return this.inspectPackage();
      case "check": return this.check();
      case "test": return this.test();
      case "build": return this.build();
      default:
        return {
          command,
          result: { success: false, message: `Unknown command: ${command}`, data: {} },
        };
    }
  }
}
