export type LiTActionType =
  | "run_command"
  | "insert_command"
  | "create_file"
  | "edit_file"
  | "start_agent"
  | "deploy"
  | "navigate";

export type LiTAction = {
  type: LiTActionType;
  label: string;
  command?: string;
  filePath?: string;
  content?: string;
  agentName?: string;
  url?: string;
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

export type LiTChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LiTThinkResponse = {
  answer: string;
  actions?: LiTAction[];
};

export function buildLitPrompt(
  message: string,
  context: LiTContext,
  fileCount?: number,
  recentMessages: LiTChatHistoryMessage[] = [],
  memoryBlock = "",
): string {
  const treePreview = context.fileTree.slice(0, 20);
  const treeSummary = treePreview.length > 0
    ? `${treePreview.join("\n")}${(fileCount || context.fileTree.length) > 20 ? `\n... (${fileCount || context.fileTree.length} total files)` : ""}`
    : "No files loaded";
  const recentSummary = recentMessages.length > 0
    ? recentMessages
        .slice(-8)
        .map((m) => `${m.role === "user" ? "User" : "LiT"}: ${m.content.slice(0, 700)}`)
        .join("\n\n")
    : "No recent chat history";

  return `
You are LiT inside LiTTree OS.

You are an AI developer command center with access to the live project.
${memoryBlock ? `\n${memoryBlock}\n` : ""}

User request:
${message}

Recent conversation:
${recentSummary}

Current app context:
Route: ${context.route}
WebSocket: ${context.websocketStatus}

Terminal output:
${context.terminalOutput || "No terminal output"}

Command history:
${context.commandHistory.join("\n") || "No commands yet"}

Selected file:
${context.selectedFile?.path || "None"}

Project file tree (summary — ${fileCount || context.fileTree.length} files total):
${treeSummary}

Agents:
${context.agents.map((a) => `${a.name}: ${a.status}`).join("\n")}

Instructions:
- Be direct and concise (2-5 sentences).
- When the user asks about the project, summarize what you see — don't dump file listings.
- Only suggest bash commands when the user explicitly asks to build, deploy, fix, or run something.
- For navigation, media generation, or general questions → answer conversationally. No code blocks.
- NEVER put file trees or directory listings in code blocks.
- Do not repeat the same capability list or the same "what can I do" answer if it appears in recent conversation.
- If the user is clarifying product direction, incorporate their latest product statement as context and move the idea forward.
- Use markdown formatting for readability.
`;
}

export function parseLitActions(answer: string): LiTAction[] {
  const actions: LiTAction[] = [];

  // Extract bash commands from code blocks and offer to insert/run
  // But only if the content looks like an actual shell command, not a file tree
  const codeBlockMatches = answer.matchAll(/```(?:bash|sh|shell)?\n([\s\S]*?)```/g);
  for (const match of codeBlockMatches) {
    const command = match[1].trim();
    if (!command) continue;

    // Skip if it looks like a file tree/listing, not a command
    const lines = command.split("\n");
    const looksLikeFileTree = lines.length > 5 &&
      lines.every(l => l.trim().match(/^[\w\-./\\]+\/?$/) || l.trim() === "");
    if (looksLikeFileTree) continue;

    // Skip if it contains backslash-separated paths (Windows file tree)
    if (lines.length > 3 && command.includes("\\") && !command.includes("#")) continue;

    actions.push({ type: "insert_command", label: "Insert into terminal", command });
    actions.push({ type: "run_command", label: "Run command", command });
  }

  // Extract navigation actions from links like [text](/path) or [text](https://litlabs.net/path)
  const linkMatches = answer.matchAll(/\[([^\]]+)]\((\/(?:[^)\s]+|https?:\/\/litlabs\.net\/[^)\s]+))\)/g);
  for (const match of linkMatches) {
    const label = match[1];
    let url = match[2];
    if (url.startsWith("https://litlabs.net")) {
      url = url.replace("https://litlabs.net", "");
    }
    if (url.startsWith("/") && !url.startsWith("//")) {
      actions.push({ type: "navigate", label: `Go to ${label}`, url });
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
    agents: partial.agents || [{ name: "LiT", status: "online" }],
    websocketStatus: partial.websocketStatus || "offline",
  };
}
