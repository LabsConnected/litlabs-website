/**
 * Command router — deterministic commands that bypass the LLM.
 *
 * `litt status` and `litt diff` call exactly the same underlying
 * handlers as the slash commands `/status` and `/diff`.
 *
 * No LLM inference is permitted for deterministic commands.
 */

import type { ShellExecutor, ToolResult, ToolContext } from "./types.js";
import { ToolRegistry, createDefaultRegistry } from "./tools.js";
import { resolveProjectContext } from "./project.js";

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

  constructor(shell: ShellExecutor, options?: {
    registry?: ToolRegistry;
    cwd?: string;
    userId?: string | null;
  }) {
    this.shell = shell;
    this.registry = options?.registry ?? createDefaultRegistry();
    this.cwd = options?.cwd ?? shell.cwd;
    this.userId = options?.userId ?? null;
  }

  private ctx(): ToolContext {
    return {
      cwd: this.cwd,
      projectId: null,
      userId: this.userId,
      shell: this.shell,
    };
  }

  async status(): Promise<CommandResult> {
    const project = await resolveProjectContext(this.shell, this.cwd);
    const result = await this.registry.execute("project.status", this.ctx(), {});
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
    const result = await this.registry.execute("project.check", this.ctx(), {});
    return { command: "check", result };
  }

  async test(): Promise<CommandResult> {
    const result = await this.registry.execute("project.test", this.ctx(), {});
    return { command: "test", result };
  }

  async build(): Promise<CommandResult> {
    const result = await this.registry.execute("project.build", this.ctx(), {});
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
