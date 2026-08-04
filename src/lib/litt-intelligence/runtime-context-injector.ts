/**
 * Runtime Context Injector — builds a structured runtime context object
 * and performs deterministic intent routing BEFORE the LLM is called.
 *
 * This module is the bridge between Studio UI state and the model request.
 * It ensures LiTT is grounded in actual platform state, not guessing.
 *
 * Used by:
 *   - /api/studio/conversations/[conversationId]/messages  (Studio chat)
 *   - /api/agents/chat  (legacy agent chat)
 *   - /api/litt/think   (LiTT command center)
 */

import "server-only";
import type { AgentMode } from "../litt-intelligence/agent-identity";

// ─── Types ────────────────────────────────────────────────────────

export interface RuntimeContextSnapshot {
  // Project
  projectId: string | null;
  projectName: string | null;
  // Repository
  repositoryConnected: boolean;
  repositoryName: string | null;
  activeBranch: string | null;
  // Workspace
  workspaceStatus: string | null;
  workspaceReady: boolean;
  // Terminal
  terminalConnected: boolean;
  terminalStatus: string | null;
  terminalSessionId: string | null;
  // Deployment
  deploymentStatus: string | null;
  deploymentUrl: string | null;
  // Approval
  writeAccess: boolean;
  approvalRequired: boolean;
  // Model
  selectedModelLabel: string | null;
  selectedModelId: string | null;
  // Agent
  activeAgentMode: AgentMode;
  activeAgentSlug: string;
  // Health
  recentHealthResults: HealthCheckResult[];
  // Voice (optional)
  voiceConfigured?: boolean;
  voiceTransportConnected?: boolean;
}

export interface HealthCheckResult {
  check: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  message: string;
  timestamp: string;
}

export type IntentCategory =
  | "project_status"
  | "weather"
  | "web_search"
  | "terminal_status"
  | "repository_info"
  | "code_change"
  | "deployment_status"
  | "creative"
  | "general";

export interface IntentDetectionResult {
  category: IntentCategory;
  confidence: number;
  matchedKeywords: string[];
  /** Tools that should be called before answering */
  requiredTools: string[];
}

export interface ToolCapability {
  id: string;
  name: string;
  description: string;
  available: boolean;
  /** Why the tool is unavailable, if applicable */
  unavailableReason?: string;
}

export interface ToolCapabilityManifest {
  tools: ToolCapability[];
  /** Formatted text block for the system prompt */
  manifestBlock: string;
}

// ─── Intent Detection ─────────────────────────────────────────────

const INTENT_KEYWORDS: Record<IntentCategory, string[]> = {
  project_status: [
    "where do things stand",
    "where does everything stand",
    "whats the status",
    "what's the status",
    "project status",
    "project health",
    "how are things",
    "where are we",
    "where do we stand",
    "give me an update",
    "status update",
    "what's going on",
    "whats going on",
    "overall status",
    "health check",
    "how's the project",
    "how is the project",
    "what state",
    "current state",
    "stand",
  ],
  weather: [
    "weather",
    "temperature",
    "forecast",
    "rain",
    "snow",
    "wind",
    "humidity",
    "how hot",
    "how cold",
    "is it hot",
    "is it cold",
    "umbrella",
    "what should i wear",
  ],
  web_search: [
    "search for",
    "look up",
    "find information",
    "what's the latest",
    "whats the latest",
    "current news",
    "google",
    "search the web",
    "find out",
    "what's happening",
  ],
  terminal_status: [
    "terminal",
    "is my terminal connected",
    "terminal connected",
    "terminal status",
    "can i run",
    "shell",
    "command line",
    "pty",
  ],
  repository_info: [
    "repository",
    "repo",
    "what repo",
    "which repo",
    "what branch",
    "which branch",
    "github",
    "what repository",
    "what repository am i using",
    "what branch am i on",
  ],
  code_change: [
    "change the code",
    "edit",
    "modify",
    "refactor",
    "fix the bug",
    "implement",
    "add a feature",
    "update the code",
    "write code",
    "build",
  ],
  deployment_status: [
    "deploy",
    "deployment",
    "deployed",
    "is it deployed",
    "vercel",
    "preview url",
    "production",
  ],
  creative: [
    "generate image",
    "create image",
    "make art",
    "design",
    "branding",
    "logo",
    "music",
    "song",
    "video",
    "creative",
    "artwork",
    "edm",
  ],
  general: [],
};

/**
 * Detect the intent category of a user message.
 * Uses keyword matching — deterministic, no LLM call needed.
 * Returns the category, confidence, matched keywords, and required tools.
 */
export function detectIntent(message: string): IntentDetectionResult {
  const lower = message.toLowerCase().trim();

  // Check each category in priority order
  const categories: IntentCategory[] = [
    "project_status",
    "weather",
    "terminal_status",
    "repository_info",
    "deployment_status",
    "code_change",
    "creative",
    "web_search",
  ];

  for (const category of categories) {
    const keywords = INTENT_KEYWORDS[category];
    const matched = keywords.filter((kw) => lower.includes(kw));

    if (matched.length > 0) {
      const confidence = Math.min(matched.length / 2, 1.0);
      const requiredTools = getRequiredToolsForCategory(category);
      return { category, confidence, matchedKeywords: matched, requiredTools };
    }
  }

  return {
    category: "general",
    confidence: 0,
    matchedKeywords: [],
    requiredTools: [],
  };
}

function getRequiredToolsForCategory(category: IntentCategory): string[] {
  switch (category) {
    case "project_status":
      return ["project.health", "project.status"];
    case "weather":
      return ["weather.current"];
    case "web_search":
      return ["web.search"];
    case "terminal_status":
      return ["terminal.status"];
    case "repository_info":
      return ["repository.info"];
    case "deployment_status":
      return ["deployment.status"];
    case "code_change":
      return ["workspace.write", "file.read"];
    case "creative":
      return ["image.generate", "audio.generate"];
    case "general":
      return [];
  }
}

// ─── Tool Capability Manifest ─────────────────────────────────────

/**
 * Build a tool capability manifest from the runtime context.
 * Only advertises tools that are actually available and healthy.
 */
export function buildToolManifest(ctx: RuntimeContextSnapshot): ToolCapabilityManifest {
  const tools: ToolCapability[] = [
    {
      id: "project.health",
      name: "Project Health Check",
      description: "Reports current project status, repository, branch, workspace, and terminal state",
      available: ctx.projectId !== null,
      unavailableReason: ctx.projectId === null ? "No active project selected" : undefined,
    },
    {
      id: "project.status",
      name: "Project Status",
      description: "Returns the full runtime context snapshot",
      available: true,
    },
    {
      id: "repository.info",
      name: "Repository Info",
      description: "Reports connected repository name, branch, and access level",
      available: ctx.repositoryConnected,
      unavailableReason: !ctx.repositoryConnected ? "No repository connected" : undefined,
    },
    {
      id: "terminal.status",
      name: "Terminal Status",
      description: "Reports terminal connection state and session ID",
      available: true,
    },
    {
      id: "terminal.execute",
      name: "Terminal Execute",
      description: "Executes shell commands in the project terminal",
      available: ctx.terminalConnected,
      unavailableReason: !ctx.terminalConnected ? "Terminal is disconnected" : undefined,
    },
    {
      id: "deployment.status",
      name: "Deployment Status",
      description: "Reports current deployment state and preview URL",
      available: ctx.deploymentStatus !== null,
      unavailableReason: ctx.deploymentStatus === null ? "No deployment information available" : undefined,
    },
    {
      id: "workspace.write",
      name: "Workspace Write",
      description: "Writes files to the project workspace",
      available: ctx.workspaceReady && ctx.writeAccess,
      unavailableReason: !ctx.workspaceReady
        ? `Workspace is ${ctx.workspaceStatus || "not ready"}`
        : !ctx.writeAccess
          ? "Write operations require approval"
          : undefined,
    },
    {
      id: "file.read",
      name: "File Read",
      description: "Reads files from the project workspace",
      available: ctx.workspaceReady,
      unavailableReason: !ctx.workspaceReady ? `Workspace is ${ctx.workspaceStatus || "not ready"}` : undefined,
    },
    {
      id: "weather.current",
      name: "Weather",
      description: "Fetches current weather for a location",
      available: true, // Weather tool uses open-meteo (no API key needed)
    },
    {
      id: "web.search",
      name: "Web Search",
      description: "Searches the web for current information",
      available: true,
    },
    {
      id: "image.generate",
      name: "Image Generation",
      description: "Generates images from text descriptions",
      available: true,
    },
    {
      id: "audio.generate",
      name: "Audio Generation",
      description: "Generates audio/music from text descriptions",
      available: true,
    },
  ];

  const manifestBlock = buildManifestBlock(tools);
  return { tools, manifestBlock };
}

function buildManifestBlock(tools: ToolCapability[]): string {
  const available = tools.filter((t) => t.available);
  const unavailable = tools.filter((t) => !t.available);

  const lines: string[] = [
    "TOOL CAPABILITY MANIFEST (do NOT advertise capabilities that are not listed here as available):",
    "",
    "Available tools:",
  ];

  for (const tool of available) {
    lines.push(`  - ${tool.name}: ${tool.description}`);
  }

  if (unavailable.length > 0) {
    lines.push("");
    lines.push("Unavailable tools (do NOT claim to use these — explain the exact reason if asked):");
    for (const tool of unavailable) {
      lines.push(`  - ${tool.name}: ${tool.unavailableReason || "Not available"}`);
    }
  }

  lines.push("");
  lines.push("RULES:");
  lines.push("- Only claim to use tools listed above as 'Available'.");
  lines.push("- If a tool is unavailable and the user asks about it, state the exact unavailable reason.");
  lines.push("- Do NOT give generic 'I don't have access' responses — name the specific tool and the specific reason.");
  lines.push("- When a question depends on live data (weather, project status, terminal), you MUST call the tool before answering.");

  return lines.join("\n");
}

// ─── Runtime Context Block ────────────────────────────────────────

/**
 * Build a structured runtime context block for the system prompt.
 * This is the GROUND TRUTH that LiTT must reference when answering
 * questions about project state.
 */
export function buildRuntimeContextBlock(ctx: RuntimeContextSnapshot): string {
  const lines: string[] = [
    "RUNTIME CONTEXT (server-authoritative — use these values when answering questions about project state):",
    "",
    `Project: ${ctx.projectName || "No project selected"}`,
    `Project ID: ${ctx.projectId || "none"}`,
    "",
    "Repository:",
    `  Connected: ${ctx.repositoryConnected ? "yes" : "no"}`,
    `  Name: ${ctx.repositoryName || "none"}`,
    `  Branch: ${ctx.activeBranch || "none"}`,
    "",
    "Workspace:",
    `  Status: ${ctx.workspaceStatus || "unknown"}`,
    `  Ready: ${ctx.workspaceReady ? "yes" : "no"}`,
    "",
    "Terminal:",
    `  Connected: ${ctx.terminalConnected ? "yes" : "no"}`,
    `  Status: ${ctx.terminalStatus || "unknown"}`,
    `  Session ID: ${ctx.terminalSessionId || "none"}`,
    "",
    "Deployment:",
    `  Status: ${ctx.deploymentStatus || "no deployment information"}`,
    `  URL: ${ctx.deploymentUrl || "none"}`,
    "",
    "Approval:",
    `  Write access: ${ctx.writeAccess ? "permitted" : "not permitted"}`,
    `  Approval required: ${ctx.approvalRequired ? "yes" : "no"}`,
    "",
    "Model:",
    `  Selected: ${ctx.selectedModelLabel || "auto"}`,
    `  Model ID: ${ctx.selectedModelId || "auto"}`,
    "",
    "Agent:",
    `  Mode: ${ctx.activeAgentMode}`,
    `  Slug: ${ctx.activeAgentSlug}`,
  ];

  if (ctx.recentHealthResults.length > 0) {
    lines.push("");
    lines.push("Recent Health Checks:");
    for (const check of ctx.recentHealthResults) {
      lines.push(`  ${check.check}: ${check.status} — ${check.message}`);
    }
  }

  lines.push("");
  lines.push("CRITICAL RULES:");
  lines.push("- When asked 'where do things stand' or 'project status', report the EXACT values above.");
  lines.push("- Do NOT give vague or generic answers when specific data is available here.");
  lines.push("- If terminal is disconnected, say 'terminal is disconnected' — do not say 'terminal may not be available'.");
  lines.push("- If repository is connected, state the exact repository name and branch.");
  lines.push("- If write access requires approval, say 'write operations require approval'.");

  return lines.join("\n");
}

// ─── Project Status Answer Generator ──────────────────────────────

/**
 * Generate a deterministic project status answer from the runtime context.
 * This is used when intent is "project_status" — the answer comes directly
 * from the context, NOT from the LLM. This guarantees accuracy.
 */
export function generateProjectStatusAnswer(ctx: RuntimeContextSnapshot): string {
  const parts: string[] = [];

  // Repository
  if (ctx.repositoryConnected && ctx.repositoryName) {
    parts.push(`Your repository ${ctx.repositoryName} is connected on branch ${ctx.activeBranch || "main"}.`);
  } else {
    parts.push("No repository is currently connected.");
  }

  // Workspace
  if (ctx.workspaceReady) {
    parts.push("The workspace is available and chat is working.");
  } else {
    parts.push(`The workspace is ${ctx.workspaceStatus || "not ready"}.`);
  }

  // Terminal
  if (ctx.terminalConnected) {
    parts.push("The terminal is connected and ready for commands.");
  } else {
    parts.push("The terminal is currently disconnected.");
  }

  // Approval
  if (ctx.approvalRequired || !ctx.writeAccess) {
    parts.push("Write actions require approval.");
  } else {
    parts.push("Write access is permitted.");
  }

  // Deployment
  if (ctx.deploymentStatus) {
    parts.push(`Deployment status: ${ctx.deploymentStatus}.`);
  } else {
    parts.push("No deployment status is currently shown.");
  }

  // Model
  if (ctx.selectedModelLabel) {
    parts.push(`Active model: ${ctx.selectedModelLabel}.`);
  }

  return parts.join(" ");
}

// ─── Unavailable Tool Error Messages ──────────────────────────────

/**
 * Generate a precise error message for an unavailable tool.
 * Never gives generic "I don't have access" — always names the exact dependency.
 */
export function explainUnavailableTool(toolId: string, ctx: RuntimeContextSnapshot): string {
  switch (toolId) {
    case "terminal.execute":
    case "terminal.status":
      if (!ctx.terminalConnected) {
        return "The terminal is disconnected. To run commands, connect the terminal first.";
      }
      return "The terminal is connected but encountered an error.";

    case "repository.info":
      if (!ctx.repositoryConnected) {
        return "No repository is connected. Connect a GitHub repository in the Projects page.";
      }
      return "Repository is connected but encountered an error.";

    case "workspace.write":
      if (!ctx.workspaceReady) {
        return `The workspace is ${ctx.workspaceStatus || "not ready"}. Wait for workspace provisioning to complete.`;
      }
      if (!ctx.writeAccess) {
        return "Write operations require approval. Request approval for the specific file change.";
      }
      return "Workspace write is available.";

    case "deployment.status":
      return "No deployment information is available. Deploy from the Deployments page.";

    case "weather.current":
      return "Weather tool is not configured. It requires a location — provide a city name.";

    case "web.search":
      return "Web search is not configured.";

    case "github.permission":
      return "GitHub permission is missing. Reconnect your GitHub account with the required scopes.";

    default:
      return `Tool '${toolId}' is not available.`;
  }
}
