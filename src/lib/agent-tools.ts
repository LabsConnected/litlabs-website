/**
 * Agent Tools Framework
 * Part 1: Jarvis runtime tools (notify, search, home control, web search)
 * Part 2: OpenAI-compatible function schemas for project-level tools (git, file, shell)
 */

import * as path from "path";
import * as fs from "fs";
import { executeCommand, ExecuteCommandResult } from "./command-executor";
import { logCommandExecution } from "./agent-logger";

/* ================================================================== */
/*  Part 1 — Jarvis Runtime Tool Registry                              */
/* ================================================================== */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: Record<string, unknown>;
}

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
}

const toolRegistry: Map<string, ToolDefinition> = new Map();

export function registerTool(tool: ToolDefinition): void {
  toolRegistry.set(tool.name, tool);
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values());
}

export async function executeTool(
  name: string,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = toolRegistry.get(name);
  if (!tool) {
    return { success: false, output: `Unknown tool: ${name}` };
  }
  try {
    return await tool.execute(params);
  } catch (err) {
    return {
      success: false,
      output: `Tool error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Parse tool calls from agent response text.
 * Format: [TOOL:name {"param":"value"}]
 */
export function parseToolCalls(text: string): ToolCall[] {
  const regex = /\[TOOL:(\w+)\s+({[^}]+})\]/g;
  const calls: ToolCall[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const params = JSON.parse(match[1] === undefined ? "{}" : match[2]);
      calls.push({ tool: match[1], params });
    } catch {
      // Skip malformed tool calls
    }
  }
  return calls;
}

/**
 * Build tool descriptions for injection into agent system prompts.
 */
export function buildToolPrompt(): string {
  const tools = listTools();
  if (tools.length === 0) return "";

  const lines = tools.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([k, v]) => `    ${k}: ${v.type} — ${v.description}${v.required ? " (required)" : ""}`)
      .join("\n");
    return `- ${t.name}: ${t.description}\n${params}`;
  });

  return `\nAvailable tools (use format [TOOL:name {"param":"value"}] to invoke):\n${lines.join("\n\n")}`;
}

// ─── Built-in Jarvis Tools ─────────────────────────────────────────────

registerTool({
  name: "notify",
  description: "Send a notification via Jarvis (Discord, push, email)",
  parameters: {
    title: { type: "string", description: "Notification title", required: true },
    body: { type: "string", description: "Notification body", required: true },
    priority: { type: "string", description: "low | medium | high | critical" },
    channels: { type: "string[]", description: "discord, push, email" },
  },
  execute: async (params) => {
    const { default: jarvis } = await import("@/lib/jarvis");
    const success = await jarvis.notify({
      type: "system_alert",
      priority: (params.priority as "low" | "medium" | "high" | "critical") || "medium",
      title: String(params.title),
      body: String(params.body),
      channels: (params.channels as ("discord" | "push" | "email")[]) || ["discord"],
    });
    return { success, output: success ? "Notification sent" : "Failed to send" };
  },
});

registerTool({
  name: "search_notifications",
  description: "Search recent notifications/events on the platform",
  parameters: {
    limit: { type: "number", description: "Max results (default 5)" },
    type: { type: "string", description: "Filter by type (sale, signup, system_alert, etc.)" },
  },
  execute: async (params) => {
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const admin = getSupabaseAdmin();
    if (!admin) return { success: false, output: "Database unavailable" };

    let query = admin
      .from("notifications")
      .select("type, title, body, priority, created_at")
      .order("created_at", { ascending: false })
      .limit(Number(params.limit) || 5);

    if (params.type) {
      query = query.eq("type", String(params.type));
    }

    const { data, error } = await query;
    if (error) return { success: false, output: error.message };

    const formatted = (data || [])
      .map((n: Record<string, unknown>) => `[${n.priority}] ${n.title}: ${n.body}`)
      .join("\n");

    return {
      success: true,
      output: formatted || "No notifications found",
      data: { notifications: data },
    };
  },
});

registerTool({
  name: "get_stats",
  description: "Get platform statistics (users, agents, recent activity)",
  parameters: {},
  execute: async () => {
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const admin = getSupabaseAdmin();
    if (!admin) return { success: false, output: "Database unavailable" };

    const [users, notifications] = await Promise.all([
      admin.from("users").select("id", { count: "exact", head: true }),
      admin.from("notifications").select("id", { count: "exact", head: true }),
    ]);

    const stats = {
      totalUsers: users.count || 0,
      totalNotifications: notifications.count || 0,
    };

    return {
      success: true,
      output: `Users: ${stats.totalUsers} | Notifications: ${stats.totalNotifications}`,
      data: stats,
    };
  },
});

registerTool({
  name: "home_control",
  description: "Control smart home devices via Home Assistant",
  parameters: {
    action: { type: "string", description: "turn_on | turn_off | set_brightness | set_color", required: true },
    entity: { type: "string", description: "Home Assistant entity_id", required: true },
    value: { type: "string", description: "Value for the action (brightness 0-255, hex color, etc.)" },
  },
  execute: async (params) => {
    const haUrl = process.env.HOME_ASSISTANT_URL;
    const haToken = process.env.HOME_ASSISTANT_TOKEN;
    if (!haUrl || !haToken) {
      return { success: false, output: "Home Assistant not configured" };
    }

    const action = String(params.action);
    const entity = String(params.entity);
    const value = params.value ? String(params.value) : undefined;

    let service = "homeassistant";
    let serviceAction = action;
    const serviceData: Record<string, unknown> = { entity_id: entity };

    if (action === "turn_on" || action === "turn_off") {
      serviceAction = action;
    } else if (action === "set_brightness") {
      service = "light";
      serviceAction = "turn_on";
      serviceData.brightness = parseInt(value || "255", 10);
    } else if (action === "set_color") {
      service = "light";
      serviceAction = "turn_on";
      serviceData.rgb_color = value?.split(",").map(Number) || [255, 255, 255];
    }

    try {
      const res = await fetch(`${haUrl}/api/services/${service}/${serviceAction}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${haToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(serviceData),
      });
      if (res.ok) {
        return { success: true, output: `${action} executed on ${entity}` };
      }
      return { success: false, output: `HA returned ${res.status}` };
    } catch (err) {
      return { success: false, output: `HA error: ${err instanceof Error ? err.message : "Unknown"}` };
    }
  },
});

registerTool({
  name: "web_search",
  description: "Search the web for information",
  parameters: {
    query: { type: "string", description: "Search query", required: true },
  },
  execute: async (params) => {
    const query = String(params.query);
    try {
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
      );
      const data = await res.json();
      const abstract = data.AbstractText || data.Answer || "No direct answer found.";
      const relatedTopics = (data.RelatedTopics || [])
        .slice(0, 3)
        .map((t: Record<string, string>) => t.Text)
        .filter(Boolean)
        .join("\n");
      return {
        success: true,
        output: abstract + (relatedTopics ? `\n\nRelated:\n${relatedTopics}` : ""),
        data: { source: "DuckDuckGo" },
      };
    } catch {
      return { success: false, output: "Search failed" };
    }
  },
});

/* ================================================================== */
/*  Part 2 — OpenAI-compatible Agent Tool Schemas & Dispatcher         */
/* ================================================================== */

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
