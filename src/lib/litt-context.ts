import { LITLABS_IDENTITY_SNIPPET, mergeLittIdentityWithProject } from "@/lib/litt-identity";

export type LiTTActionType =
  | "run_command"
  | "insert_command"
  | "create_file"
  | "edit_file"
  | "start_agent"
  | "deploy"
  | "add_goal"
  | "remember";

export type LiTTMemoryScope =
  | "profile"
  | "preference"
  | "agent"
  | "project"
  | "conversation"
  | "temporary";

export type LiTTAction = {
  type: LiTTActionType;
  label: string;
  command?: string;
  filePath?: string;
  content?: string;
  agentName?: string;
  // add_goal
  goalTitle?: string;
  goalNotes?: string;
  priority?: "low" | "medium" | "high";
  // remember
  memoryContent?: string;
  memoryScope?: LiTTMemoryScope;
};

export type LiTTAgentStatus = "online" | "idle" | "running" | "error";

export type LiTTContext = {
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
    status: LiTTAgentStatus;
  }[];
  websocketStatus: "connected" | "offline" | "connecting";
};

export type LiTTThinkResponse = {
  answer: string;
  actions?: LiTTAction[];
};

export type LiTTProjectContext = {
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
export function buildLiTTPrompt(message: string, context: LiTTContext): string {
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
export function buildLiTTSystemPrompt(project?: LiTTProjectContext): string {
  return mergeLittIdentityWithProject(project);
}

export function parseLiTTActions(answer: string): LiTTAction[] {
  const actions: LiTTAction[] = [];

  // Extract bash commands from the first code block and offer to insert/run
  const codeBlockMatch = answer.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    const command = codeBlockMatch[1].trim();
    if (command) {
      actions.push({ type: "insert_command", label: "Insert into terminal", command });
      actions.push({ type: "run_command", label: "Run command", command });
    }
  }

  // Extract JSON action blocks. The model is instructed to emit these when
  // the user says "add this to my list" / "make a goal" / "todo: X" / etc.
  // We accept both fenced ```json … ``` and bare inline objects.
  const jsonBlocks: string[] = [];
  const fenceMatches = answer.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g);
  for (const m of fenceMatches) jsonBlocks.push(m[1]);
  const inlineMatches = answer.matchAll(
    /(?<![`{])\{\s*"type"\s*:\s*"(add_goal|remember)"[\s\S]*?\}/g,
  );
  for (const m of inlineMatches) jsonBlocks.push(m[0]);

  const validPriorities = ["low", "medium", "high"] as const;
  const validScopes: LiTTMemoryScope[] = [
    "profile",
    "preference",
    "agent",
    "project",
    "conversation",
    "temporary",
  ];

  for (const raw of jsonBlocks) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (obj.type === "add_goal" && typeof obj.title === "string" && obj.title.trim()) {
        const priority = validPriorities.includes(obj.priority as never)
          ? (obj.priority as "low" | "medium" | "high")
          : "medium";
        actions.push({
          type: "add_goal",
          label: `Add goal: ${obj.title}`,
          goalTitle: obj.title.trim(),
          goalNotes: typeof obj.notes === "string" ? obj.notes : undefined,
          priority,
        });
      } else if (
        obj.type === "remember" &&
        typeof obj.content === "string" &&
        obj.content.trim()
      ) {
        const scope = validScopes.includes(obj.scope as LiTTMemoryScope)
          ? (obj.scope as LiTTMemoryScope)
          : "conversation";
        const preview = obj.content.length > 60 ? `${obj.content.slice(0, 60)}…` : obj.content;
        actions.push({
          type: "remember",
          label: `Remember: ${preview}`,
          memoryContent: obj.content.trim(),
          memoryScope: scope,
        });
      }
    } catch {
      // Malformed JSON — skip this block, the rest of the answer is still useful.
    }
  }

  return actions;
}

export function collectLiTTContext(
  partial: Partial<LiTTContext> & { route: string },
): LiTTContext {
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
