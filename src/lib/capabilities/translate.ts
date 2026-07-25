/**
 * translate.ts — Converts internal capability flags into user-facing messages.
 *
 * The LLM must never see raw field names like "repository capability is none"
 * or "repositoryIndexed is false". Instead, it receives plain-English state
 * descriptions and instructions on how to talk about them.
 */

export interface RawCapabilities {
  repository?: string;
  repositoryIndexed?: boolean;
  terminalExecution?: string;
  writeAccess?: boolean;
  connectedProviders?: string[];
  availableTools?: string[];
  connectionSummary?: string;
  terminalStatus?: string;
  terminalSessionId?: string | null;
}

export interface CapabilityTranslation {
  /** User-facing GitHub/repo state label */
  githubState: string;
  /** User-facing next action for GitHub/repo */
  githubAction: string;
  /** User-facing terminal state label */
  terminalState: string;
  /** User-facing next action for terminal */
  terminalAction: string;
  /** Whether any services are connected */
  hasConnections: boolean;
  /** Full plain-English context block for the LLM system prompt */
  contextBlock: string;
}

/**
 * Translate raw capability flags into user-facing messages.
 *
 * GitHub/repo, workspace, indexing, and terminal (PTY) are treated as
 * independent states. A disconnected PTY does NOT mean GitHub is disconnected.
 * A repository can be usable before indexing finishes.
 */
export function translateCapabilities(caps: RawCapabilities): CapabilityTranslation {
  const repo = caps.repository ?? "none";
  const indexed = caps.repositoryIndexed ?? false;
  const termExec = caps.terminalExecution ?? "unavailable";
  const connected = caps.connectedProviders ?? [];
  const hasConnections = connected.length > 0;

  // ── GitHub / Repository state ──
  let githubState: string;
  let githubAction: string;

  if (repo === "none" || repo === "not_configured") {
    githubState = "No repository is connected.";
    githubAction =
      "Tell the user: \"GitHub is not connected to this workspace yet. Connect a repository to let me inspect files, search the codebase, review changes, and help with commits or pull requests.\" Then offer: [Connect GitHub] or [Start Blank Project].";
  } else if (repo === "connecting" || repo === "validating") {
    githubState = "Repository connection is in progress.";
    githubAction = "Tell the user the connection is being established.";
  } else if (repo === "ready" || repo === "connected") {
    if (indexed) {
      githubState = "Repository connected and ready.";
      githubAction = "";
    } else {
      githubState = "Repository connected. Code search indexing is not complete yet — basic file access works, but code search may be limited.";
      githubAction = "If the user asks about search, mention indexing is still preparing.";
    }
  } else if (repo === "error" || repo === "degraded") {
    githubState = "Repository connection has an error.";
    githubAction = "Tell the user: \"The repository connection needs attention. Try reconnecting or check permissions.\" Offer: [Repair connection].";
  } else {
    githubState = "No repository is connected.";
    githubAction =
      "Tell the user: \"GitHub is not connected to this workspace yet. Connect a repository to let me inspect files, search the codebase, review changes, and help with commits or pull requests.\" Then offer: [Connect GitHub] or [Start Blank Project].";
  }

  // ── Terminal / PTY state ──
  let terminalState: string;
  let terminalAction: string;

  if (termExec === "available") {
    terminalState = "Project terminal is connected and ready.";
    terminalAction = "";
  } else if (termExec === "connecting") {
    terminalState = "Project terminal is still connecting.";
    terminalAction =
      "If the user asks about running commands, say: \"The repository connection and terminal connection are separate. The project terminal is still connecting, so I cannot run commands yet.\"";
  } else if (termExec === "error") {
    terminalState = "Project terminal is unavailable (error).";
    terminalAction =
      "If the user asks about running commands, say: \"The repository may still be connected, but the project terminal is unavailable.\"";
  } else {
    terminalState = "Project terminal is not connected.";
    terminalAction =
      "If the user asks about running commands, say: \"The terminal is not connected. The repository and terminal are separate — you may still have GitHub access without a terminal.\"";
  }

  // ── Full context block for LLM ──
  const parts: string[] = [
    "STUDIO CONNECTION STATE (for your reference — do NOT expose raw field names to the user):",
    "",
    `GitHub: ${githubState}`,
  ];

  if (githubAction) parts.push(`  → Next action: ${githubAction}`);

  parts.push(`Terminal: ${terminalState}`);

  if (terminalAction) parts.push(`  → Next action: ${terminalAction}`);

  parts.push(
    `Other services: ${hasConnections ? connected.join(", ") : "none connected"}`,
  );

  parts.push("");
  parts.push("RULES:");
  parts.push("- Never use internal field names like \"repository capability\", \"repositoryIndexed\", \"terminalExecution\", or raw enum values in conversation.");
  parts.push("- Always translate state into a clear, user-facing message with one concrete next action.");
  parts.push("- GitHub connection, repository selection, workspace provisioning, file access, indexing, and terminal (PTY) connection are SEPARATE states. Do not blend them.");
  parts.push("- A disconnected terminal does NOT mean GitHub is disconnected.");
  parts.push("- A repository can be usable before indexing finishes. Indexing is optional for basic file access.");
  parts.push("- Never claim you can read files, run commands, or access a repository unless the state above explicitly says it is connected and ready.");
  parts.push("- If the user wants to see raw diagnostics, they can open the Diagnostics view. Do not dump raw fields in normal conversation.");

  return {
    githubState,
    githubAction,
    terminalState,
    terminalAction,
    hasConnections,
    contextBlock: parts.join("\n"),
  };
}
