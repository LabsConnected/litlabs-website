/**
 * agent-tools.ts
 * OpenAI-compatible function schemas and dispatcher for project-level tools.
 * Pattern mirrors ha-tools.ts.
 */

import * as path from "path";
import * as fs from "fs";
import { executeCommand, ExecuteCommandResult } from "./command-executor";
import { logCommandExecution } from "./agent-logger";

/* ------------------------------------------------------------------ */
/*  Tool Schema Types                                                  */
/* ------------------------------------------------------------------ */

export interface AgentToolSchema {
  name: string;
  description: string;
  readonly: boolean;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

export interface AgentToolResult {
  tool: string;
  success: boolean;
  result: unknown;
  message: string;
  requiresConfirmation?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Tool Schemas                                                       */
/* ------------------------------------------------------------------ */

export const AGENT_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: "git_status",
    description: "Show the current git status (branch, staged/unstaged changes)",
    readonly: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "git_log",
    description: "Show the last 5 git commits (one-line format)",
    readonly: true,
    parameters: {
      type: "object",
      properties: {
        n: { type: "number", description: "Number of commits to show (default 5, max 20)" },
      },
      required: [],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file inside the project root",
    readonly: true,
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories inside the project root",
    readonly: true,
    parameters: {
      type: "object",
      properties: {
        dir_path: {
          type: "string",
          description: "Path relative to project root (default: '.')",
        },
      },
      required: [],
    },
  },
  {
    name: "search_code",
    description: "Search for a text pattern in project source files",
    readonly: true,
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (fixed string)" },
        dir_path: {
          type: "string",
          description: "Directory to search in, relative to project root (default: 'src')",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "shell_command",
    description: "Run an allowlisted shell command with arguments",
    readonly: false,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The executable name (must be allowlisted)" },
        args: {
          type: "array",
          description: "Array of arguments to pass to the command",
        } as unknown as { type: string; description: string },
        cwd: {
          type: "string",
          description: "Working directory relative to project root (optional)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "npm_run",
    description: "Run an npm script from package.json (requires confirmation)",
    readonly: false,
    parameters: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "The npm script name to run, e.g. 'build', 'lint', 'test'",
        },
      },
      required: ["script"],
    },
  },
  {
    name: "run_build",
    description: "Run 'npm run build' to compile the project (requires confirmation)",
    readonly: false,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "run_lint",
    description: "Run 'npm run lint' to check code style (requires confirmation)",
    readonly: false,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

/* ------------------------------------------------------------------ */
/*  File helpers (no shell)                                            */
/* ------------------------------------------------------------------ */

function getProjectRoot(): string {
  return process.env.PROJECT_ROOT ?? process.cwd();
}

function safeResolvePath(relativePath: string): { ok: true; resolved: string } | { ok: false; error: string } {
  const root = getProjectRoot();
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(path.resolve(root))) {
    return { ok: false, error: `Path '${relativePath}' escapes project root` };
  }
  return { ok: true, resolved };
}

const MAX_FILE_SIZE = 65_536;

function readFileContents(filePath: string): AgentToolResult {
  const check = safeResolvePath(filePath);
  if (!check.ok) {
    const err = check as { ok: false; error: string };
    return { tool: "read_file", success: false, result: null, message: err.error };
  }

  try {
    const stat = fs.statSync(check.resolved);
    if (stat.size > MAX_FILE_SIZE) {
      return {
        tool: "read_file",
        success: false,
        result: null,
        message: `File too large (${stat.size} bytes). Max is ${MAX_FILE_SIZE} bytes.`,
      };
    }
    const content = fs.readFileSync(check.resolved, "utf-8");
    return { tool: "read_file", success: true, result: content, message: `Read ${stat.size} bytes` };
  } catch (err) {
    return {
      tool: "read_file",
      success: false,
      result: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function listDirectoryContents(dirPath: string): AgentToolResult {
  const check = safeResolvePath(dirPath);
  if (!check.ok) {
    const err = check as { ok: false; error: string };
    return { tool: "list_directory", success: false, result: null, message: err.error };
  }

  try {
    const entries = fs.readdirSync(check.resolved, { withFileTypes: true });
    const items = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "directory" : "file",
    }));
    return {
      tool: "list_directory",
      success: true,
      result: items,
      message: `${items.length} entries in '${dirPath}'`,
    };
  } catch (err) {
    return {
      tool: "list_directory",
      success: false,
      result: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Command-based tools                                                */
/* ------------------------------------------------------------------ */

async function runAndFormat(
  toolName: string,
  command: string,
  args: string[],
  cwd?: string,
): Promise<AgentToolResult> {
  const result: ExecuteCommandResult = await executeCommand({ command, args, cwd });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return {
    tool: toolName,
    success: result.ok,
    result: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: result.durationMs, truncated: result.truncated },
    message: result.ok
      ? output || `${toolName} completed (exit 0)`
      : (result.error ?? output) || `${toolName} failed (exit ${result.exitCode})`,
  };
}

/* ------------------------------------------------------------------ */
/*  Dispatcher                                                         */
/* ------------------------------------------------------------------ */

export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<AgentToolResult> {
  const schema = AGENT_TOOL_SCHEMAS.find((s) => s.name === toolName);
  if (!schema) {
    return { tool: toolName, success: false, result: null, message: `Unknown tool: ${toolName}` };
  }

  // Destructive tools return requiresConfirmation flag immediately — caller handles UX
  if (!schema.readonly) {
    const confirmed = args._confirmed === true;
    if (!confirmed) {
      return {
        tool: toolName,
        success: false,
        result: null,
        message: `Tool '${toolName}' requires explicit confirmation before running.`,
        requiresConfirmation: true,
      };
    }
  }

  let result: AgentToolResult;

  try {
    switch (toolName) {
      case "git_status":
        result = await runAndFormat("git_status", "git", ["status", "--short", "--branch"]);
        break;

      case "git_log": {
        const n = Math.min(Number(args.n ?? 5), 20);
        result = await runAndFormat("git_log", "git", ["log", `-${n}`, "--oneline"]);
        break;
      }

      case "read_file":
        result = readFileContents(String(args.file_path ?? ""));
        break;

      case "list_directory":
        result = listDirectoryContents(String(args.dir_path ?? "."));
        break;

      case "search_code": {
        const pattern = String(args.pattern ?? "");
        const dir = String(args.dir_path ?? "src");
        const dirCheck = safeResolvePath(dir);
        if (!dirCheck.ok) {
          const dirErr = dirCheck as { ok: false; error: string };
          result = { tool: "search_code", success: false, result: null, message: dirErr.error };
          break;
        }
        // Use findstr on Windows, grep on Unix
        const isWin = process.platform === "win32";
        if (isWin) {
          result = await runAndFormat(
            "search_code",
            "findstr",
            ["/s", "/i", "/n", pattern, `${dirCheck.resolved}\\*`],
          );
        } else {
          result = await runAndFormat(
            "search_code",
            "grep",
            ["-r", "-n", "--include=*.ts", "--include=*.tsx", pattern, dirCheck.resolved],
          );
        }
        break;
      }

      case "shell_command": {
        const cmd = String(args.command ?? "");
        const cmdArgs = Array.isArray(args.args) ? (args.args as unknown[]).map(String) : [];
        const cwd = args.cwd ? String(args.cwd) : undefined;
        result = await runAndFormat("shell_command", cmd, cmdArgs, cwd);
        break;
      }

      case "npm_run": {
        const script = String(args.script ?? "");
        result = await runAndFormat("npm_run", "npm", ["run", script]);
        break;
      }

      case "run_build":
        result = await runAndFormat("run_build", "npm", ["run", "build"]);
        break;

      case "run_lint":
        result = await runAndFormat("run_lint", "npm", ["run", "lint"]);
        break;

      default:
        result = { tool: toolName, success: false, result: null, message: `Tool '${toolName}' is not implemented` };
    }
  } catch (err) {
    result = {
      tool: toolName,
      success: false,
      result: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Audit log (fire and forget)
  void logCommandExecution({
    agentSlug: "agent-tool",
    userId,
    command: toolName,
    args: Object.entries(args).map(([k, v]) => `${k}=${String(v)}`),
    exitCode: result.success ? 0 : 1,
    durationMs: 0,
    outputLength: String(result.message).length,
    truncated: false,
    allowed: true,
    ok: result.success,
    error: result.success ? undefined : result.message,
  });

  return result;
}

/* ------------------------------------------------------------------ */
/*  Schema text for LLM prompts                                        */
/* ------------------------------------------------------------------ */

export function getAgentToolSchemaText(): string {
  return AGENT_TOOL_SCHEMAS.map((t) => {
    const params = Object.entries(t.parameters.properties)
      .map(([k, v]) => `  ${k}: ${v.type} — ${v.description}`)
      .join("\n");
    const readonlyLabel = t.readonly ? "[read-only]" : "[destructive — needs confirmation]";
    return `${t.name} ${readonlyLabel}:\n  description: ${t.description}${params ? `\n  parameters:\n${params}` : ""}`;
  }).join("\n\n");
}
