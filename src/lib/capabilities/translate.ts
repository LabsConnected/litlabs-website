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
  /** Voice health from /api/voice/health (server-side check). */
  voiceHealth?: {
    configured: boolean;
    tokenService: "healthy" | "error" | "unknown";
    available: boolean;
    errorCode?: string;
    message?: string;
  };
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

  // ── Voice state (INDEPENDENT of GitHub/PTY — has its own config + transport) ──
  // Voice has THREE separate sub-states:
  //   1. Configuration: Are Inworld env vars set? (server-side check)
  //   2. Token service: Does the token endpoint actually work? (server-side test)
  //   3. Transport: Is the WebSocket connected? (client-side runtime state)
  //   4. Microphone: Is the mic capturing audio? (client-side runtime state)
  //
  // Voice being "not connected" (transport) does NOT mean voice is "not configured".
  // Voice being "configured" does NOT mean the transport is connected.
  // GitHub/PTY being disconnected does NOT affect voice at all.
  const voiceHealth = caps.voiceHealth;
  const voiceTransport = caps.voiceTransportConnected === true;
  const micOn = caps.voiceMicrophoneOn === true;

  let voiceConfigState: string;
  let voiceTransportState: string;
  let voiceMicState: string;
  let voiceFullState: string;

  // Configuration + token service
  if (!voiceHealth || voiceHealth.tokenService === "unknown") {
    voiceConfigState = "Voice configuration status is unknown (health check not completed).";
  } else if (!voiceHealth.configured) {
    voiceConfigState = "Voice is not configured (Inworld environment variables are missing).";
  } else if (voiceHealth.tokenService === "error") {
    voiceConfigState = "Voice is configured, but the token service is currently unavailable.";
  } else {
    voiceConfigState = "Voice is configured and the token service is healthy.";
  }

  // Transport (WebSocket to Inworld proxy)
  if (voiceTransport) {
    voiceTransportState = "Voice transport is connected (WebSocket to Inworld proxy is live).";
  } else {
    voiceTransportState = "Voice transport is disconnected (WebSocket not started yet).";
  }

  // Microphone
  if (micOn) {
    voiceMicState = "Microphone is on and capturing audio.";
  } else {
    voiceMicState = "Microphone is off.";
  }

  // Combined voice state for the LLM
  if (voiceHealth?.available && voiceTransport && micOn) {
    voiceFullState = "Voice is fully operational — configured, transport connected, microphone on.";
  } else if (voiceHealth?.available && voiceTransport) {
    voiceFullState = "Voice is available and transport is connected, but the microphone is off. The user can tap the microphone to start listening.";
  } else if (voiceHealth?.available) {
    voiceFullState = "Voice is configured and available, but the transport is not connected yet. The user can start voice to connect.";
  } else if (voiceHealth?.configured) {
    voiceFullState = "Voice is configured, but the token service is currently unavailable. GitHub and terminal status do NOT affect voice.";
  } else {
    voiceFullState = "Voice configuration status is unknown.";
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

  parts.push(`Voice configuration: ${voiceConfigState}`);
  parts.push(`Voice transport: ${voiceTransportState}`);
  parts.push(`Voice microphone: ${voiceMicState}`);
  parts.push(`Voice summary: ${voiceFullState}`);

  parts.push(
    `Other services: ${hasConnections ? connected.join(", ") : "none connected"}`,
  );

  parts.push("");
  parts.push("RULES:");
  parts.push("- Never use internal field names like \"repository capability\", \"repositoryIndexed\", \"terminalExecution\", or raw enum values in conversation.");
  parts.push("- GitHub connection, repository selection, workspace provisioning, file access, indexing, terminal (PTY), and voice are COMPLETELY SEPARATE states. Do not blend them.");
  parts.push("- A disconnected terminal does NOT mean GitHub is disconnected.");
  parts.push("- A disconnected GitHub or terminal does NOT mean voice is disconnected. Voice has its own configuration, token service, transport, and microphone states.");
  parts.push("- Voice can work WITHOUT GitHub, a repository, a project, PTY, or filesystem access. Do not tell the user they need to connect GitHub or create a project to use voice.");
  parts.push("- A repository can be usable before indexing finishes. Indexing is optional for basic file access.");
  parts.push("- Never claim you can read files, run commands, access a repository, or use voice/microphone unless the state above explicitly says it is connected and ready.");
  parts.push("- If voice is configured and the token service is healthy, voice is AVAILABLE even if the transport is not connected yet. Say \"voice is available\" not \"voice is disconnected\".");
  parts.push("- If voice configuration is unknown, do NOT claim voice is working, good, online, or nominal. Say you don't have live voice status.");
  parts.push("- DO NOT proactively mention GitHub, repository connection, or project setup unless the user's message is specifically about code, files, repositories, deployment, or project setup.");
  parts.push("- For general conversation (greetings, advice, creative requests), ignore the connection state entirely and answer naturally.");
  parts.push("- EXCEPTION: When the user asks about your operational status, readiness, or whether you are 'good', 'working', 'connected', 'operational', 'online', or 'ready', you MUST report the actual capability states above. Report voice, GitHub, and terminal SEPARATELY. Example: 'Chat and Inworld voice are available. GitHub and the terminal are not connected, so build tools are currently unavailable.' Do NOT group voice with GitHub or terminal.");
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
