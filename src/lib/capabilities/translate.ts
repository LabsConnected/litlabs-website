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
  /** Voice transport connected (TTS-ready). Client-derived. */
  voiceTransportConnected?: boolean;
  /** Microphone currently capturing audio. Client-derived. */
  voiceMicrophoneOn?: boolean;
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
    // Do NOT instruct the LLM to proactively tell the user about GitHub.
    // Only mention it when the user explicitly asks about code/files/repos.
    githubAction = "";
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
    githubAction = "";
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

  // ── Voice state (client-derived, defaults to unknown) ──
  const voiceTransport = caps.voiceTransportConnected === true;
  const micOn = caps.voiceMicrophoneOn === true;
  const voiceUnknown = caps.voiceTransportConnected === undefined;
  let voiceState: string;
  if (voiceUnknown) {
    voiceState = "Voice status is unknown (no client snapshot provided).";
  } else if (voiceTransport && micOn) {
    voiceState = "Voice transport is connected and microphone is on.";
  } else if (voiceTransport) {
    voiceState = "Voice transport is connected (TTS ready) but microphone is off.";
  } else {
    voiceState = "Voice is not connected.";
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

  parts.push(`Voice: ${voiceState}`);

  parts.push(
    `Other services: ${hasConnections ? connected.join(", ") : "none connected"}`,
  );

  parts.push("");
  parts.push("RULES:");
  parts.push("- Never use internal field names like \"repository capability\", \"repositoryIndexed\", \"terminalExecution\", or raw enum values in conversation.");
  parts.push("- GitHub connection, repository selection, workspace provisioning, file access, indexing, terminal (PTY), and voice are SEPARATE states. Do not blend them.");
  parts.push("- A disconnected terminal does NOT mean GitHub is disconnected.");
  parts.push("- A repository can be usable before indexing finishes. Indexing is optional for basic file access.");
  parts.push("- Never claim you can read files, run commands, access a repository, or use voice/microphone unless the state above explicitly says it is connected and ready.");
  parts.push("- If voice status is unknown, do NOT claim voice is working, good, online, or nominal. Say you don't have live voice status and point to the Settings page.");
  parts.push("- DO NOT proactively mention GitHub, repository connection, or project setup unless the user's message is specifically about code, files, repositories, deployment, or project setup.");
  parts.push("- For general conversation (greetings, advice, creative requests), ignore the connection state entirely and answer naturally.");
  parts.push("- EXCEPTION: When the user asks about your operational status, readiness, or whether you are 'good', 'working', 'connected', 'operational', 'online', or 'ready', you MUST report the actual capability states above. Do NOT say 'I am', 'I'm good', 'I'm working', or 'I'm ready' unless ALL capabilities (GitHub, terminal, voice) are connected and ready. If any are not connected, say which ones are missing. Example: 'I can respond in chat, but voice is not connected and no project is initialized.'");
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
