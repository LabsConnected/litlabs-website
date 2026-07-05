export type LiTActionType =
  | "run_command"
  | "insert_command"
  | "create_file"
  | "edit_file"
  | "start_agent"
  | "deploy";

export type LiTAction = {
  type: LiTActionType;
  label: string;
  command?: string;
  filePath?: string;
  content?: string;
  agentName?: string;
};

export type LiTAgentStatus = "online" | "idle" | "running" | "error";

export type LiTContext = {
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
    status: LiTAgentStatus;
  }[];
  websocketStatus: "connected" | "offline" | "connecting";
};

export type LiTThinkResponse = {
  answer: string;
  actions?: LiTAction[];
};

export function buildLitPrompt(message: string, context: LiTContext): string {
  return `
You are LiT inside LiTTree OS.

You are not a normal chatbot.
You are an AI developer command center.

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
- Return useful commands.
- Do not ask vague questions unless truly required.
- For dangerous commands, require approval.
- Prefer markdown formatting with code blocks.
`;
}

export function parseLitActions(answer: string): LiTAction[] {
  const actions: LiTAction[] = [];

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

export function collectLitContext(
  partial: Partial<LiTContext> & { route: string },
): LiTContext {
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
