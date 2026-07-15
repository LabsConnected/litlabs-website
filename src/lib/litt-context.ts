import { LITLABS_IDENTITY_SNIPPET, mergeLittIdentityWithProject } from "@/lib/litt-identity";

export type JarvisActionType =
  | "run_command"
  | "insert_command"
  | "create_file"
  | "edit_file"
  | "start_agent"
  | "deploy";

export type JarvisAction = {
  type: JarvisActionType;
  label: string;
  command?: string;
  filePath?: string;
  content?: string;
  agentName?: string;
};

export type JarvisAgentStatus = "online" | "idle" | "running" | "error";

export type JarvisContext = {
  route: string;
  terminalOutput: string;
  commandHistory: string[];
  logs: string[];
  selectedFile?: {
    path: string;
    content: string;
  };
  fileTree: string[];
  agents: {
    name: string;
    status: JarvisAgentStatus;
  }[];
  websocketStatus: "connected" | "offline" | "connecting";
};

export type JarvisThinkResponse = {
  answer: string;
  actions?: JarvisAction[];
};

export type JarvisProjectContext = {
  name?: string;
  description?: string;
  stack?: string;
  goals?: string;
  repoUrl?: string;
  customInstructions?: string;
};

/**
 * Build the user prompt for the LiTT think route.
 *
 * The static litlabs.net project identity is auto-injected by the LLM
 * layer (see `withLittIdentity` in src/lib/llm.ts), so we do NOT include
 * it here again. We only include the live runtime context (route,
 * terminal, files, logs, agents).
 *
 * If you need to force the identity into a prompt-only caller (no system
 * message slot), use `mergeLittIdentityWithProject()` to prepend it.
 */
export function buildJarvisPrompt(message: string, context: JarvisContext): string {
  return `
You are LiTT inside LiTTree-LabStudios (litlabs.net).

You are not a normal chatbot.
You are an AI developer command center.

Project brain (in case the system prompt didn't carry it through):
${LITLABS_IDENTITY_SNIPPET}

User request:
${message}

Current app context:
Route: ${context.route}
WebSocket: ${context.websocketStatus}

Terminal output:
${context.terminalOutput || "No terminal output"}

Command history:
${context.commandHistory.join("\n") || "No commands yet"}

Logs:
${context.logs.join("\n") || "No logs"}

Selected file:
${context.selectedFile?.path || "None"}

Selected file content:
${context.selectedFile?.content || "None"}

File tree:
${context.fileTree.join("\n") || "No files loaded"}

Agents:
${context.agents.map((a) => `${a.name}: ${a.status}`).join("\n")}

Rules:
- Be direct.
- Diagnose the issue.
- Give prioritized fixes.
- Return useful commands (pnpm …, not npm …).
- Do not ask vague questions unless truly required.
- For dangerous commands, require approval.
- Prefer markdown formatting with code blocks.
- This is the litlabs.net codebase — use real paths (src/lib/…, src/app/api/…),
  not invented ones.
`;
}

/**
 * Build a *system* prompt that includes the project identity. Use this
 * when the caller can't pass a separate system-prompt slot and only has
 * a single user-prompt string to send to the LLM.
 */
export function buildJarvisSystemPrompt(project?: JarvisProjectContext): string {
  return mergeLittIdentityWithProject(project);
}

export function parseJarvisActions(answer: string): JarvisAction[] {
  const actions: JarvisAction[] = [];

  // Extract bash commands from the first code block and offer to insert/run
  const codeBlockMatch = answer.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    const command = codeBlockMatch[1].trim();
    if (command) {
      actions.push({ type: "insert_command", label: "Insert into terminal", command });
      actions.push({ type: "run_command", label: "Run command", command });
    }
  }

  return actions;
}

export function collectJarvisContext(
  partial: Partial<JarvisContext> & { route: string },
): JarvisContext {
  return {
    route: partial.route,
    terminalOutput: partial.terminalOutput || "",
    commandHistory: partial.commandHistory || [],
    logs: partial.logs || [],
    selectedFile: partial.selectedFile,
    fileTree: partial.fileTree || [],
    agents: partial.agents || [],
    websocketStatus: partial.websocketStatus || "offline",
  };
}
