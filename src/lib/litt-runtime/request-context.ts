/**
 * LiTT Runtime — Request Context Resolver
 *
 * Resolves the server-authoritative context for a run: auth, project,
 * conversation, capabilities, and memory. Client-supplied capability state
 * is treated as a hint only — the server re-derives repository/branch state
 * from the project record and only layers client hints for live signals
 * (terminal session, voice transport) that cannot be known server-side.
 */

import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { isAnonymousDevAllowed } from "@/lib/env";
import { resolveProject, buildProjectContextBlock, buildStudioContext } from "@/lib/studio/project-resolver";
import { recallMemories, formatMemoryContext } from "@/lib/studio/memory-service";
import { getConversation, listMessages } from "@/lib/studio/conversation-service";
import { adaptLegacyCapability } from "@/lib/litt-kernel";
import type { CapabilityRecord } from "@/lib/litt-kernel";
import type { RawCapabilities } from "@/lib/capabilities/translate";
import type { AgentSlug } from "@/lib/studio/types";
import type { ResolvedRunContext, LiTTRunRequest, LiTTMode, HistoryEntry } from "./types";

const HISTORY_LIMIT = 12;

const TERMINAL_EXECUTION_STATES = ["available", "unavailable", "connecting", "degraded", "error"] as const;
const TERMINAL_STATES = ["disconnected", "connecting", "connected", "error"] as const;
const VOICE_INPUT_STATES = ["idle", "requesting_permission", "connecting", "listening", "error"] as const;
const VOICE_STATES = ["idle", "requesting_permission", "connecting", "listening", "user_speaking", "processing", "assistant_speaking", "muted", "error"] as const;
const VOICE_OUTPUT_STATES = ["idle", "connecting", "speaking", "error"] as const;

function isValue<T extends readonly string[]>(values: T, candidate: unknown): candidate is T[number] {
  return typeof candidate === "string" && values.includes(candidate);
}

function parseVoiceHealth(value: unknown): RawCapabilities["voiceHealth"] {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const tokenService = input.tokenService === "healthy" || input.tokenService === "error" || input.tokenService === "unknown"
    ? input.tokenService
    : "unknown";
  return {
    configured: input.configured === true,
    tokenService,
    available: input.available === true,
  };
}

/**
 * Parse the client-supplied runtimeContext hint into a typed shape.
 * Unknown values are dropped — never echoed verbatim into prompts.
 */
export function parseRuntimeContextHint(value: unknown): Partial<RawCapabilities> {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  return {
    terminalExecution: isValue(TERMINAL_EXECUTION_STATES, input.terminalExecution) ? input.terminalExecution : undefined,
    terminalStatus: isValue(TERMINAL_STATES, input.terminalStatus) ? input.terminalStatus : undefined,
    terminalSessionId: typeof input.terminalSessionId === "string" && input.terminalSessionId.length <= 200
      ? input.terminalSessionId
      : undefined,
    voiceTransportConnected: input.voiceTransportConnected === true,
    voiceMicrophoneOn: input.voiceMicrophoneOn === true,
    voiceInputState: isValue(VOICE_INPUT_STATES, input.voiceInputState) ? input.voiceInputState : undefined,
    voiceState: isValue(VOICE_STATES, input.voiceState) ? input.voiceState : undefined,
    voiceOutputState: isValue(VOICE_OUTPUT_STATES, input.voiceOutputState) ? input.voiceOutputState : undefined,
    voiceHealth: parseVoiceHealth(input.voiceHealth),
    writeAccess: input.writeAccess === true,
    activeBranch: typeof input.activeBranch === "string" && input.activeBranch.length <= 200 ? input.activeBranch : undefined,
    repositoryName: typeof input.repositoryName === "string" && input.repositoryName.length <= 200 ? input.repositoryName : undefined,
    workspaceStatus: typeof input.workspaceStatus === "string" && input.workspaceStatus.length <= 100 ? input.workspaceStatus : undefined,
    selectedModelLabel: typeof input.selectedModelLabel === "string" && input.selectedModelLabel.length <= 100 ? input.selectedModelLabel : undefined,
    cameraActive: input.cameraActive === true,
    cameraStatus: typeof input.cameraStatus === "string" && input.cameraStatus.length <= 50 ? input.cameraStatus : undefined,
  };
}

function resolveMode(req: LiTTRunRequest, isCompanionSurface: boolean): LiTTMode {
  if (req.agentMode) return req.agentMode;
  if (isCompanionSurface) return "companion";
  return "studio";
}

/**
 * Resolve the full server-authoritative context for a run.
 *
 * For authenticated Studio/CLI/voice requests, project + conversation +
 * history are loaded from Supabase. For the anonymous global companion,
 * no project/conversation/memory is loaded and a strict limited contract
 * is returned (the prompt builder enforces the companion guardrails).
 */
export async function resolveRequestContext(
  httpRequest: NextRequest,
  req: LiTTRunRequest,
): Promise<ResolvedRunContext> {
  const { userId, clerkId } = await auth(httpRequest);
  const isDev = isAnonymousDevAllowed();
  const isAuthenticated = Boolean(userId);
  const isCompanionSurface = req.pageContext?.surface === "global_companion";
  const isAnonymousCompanion = !isAuthenticated && !isDev && isCompanionSurface;
  const mode = resolveMode(req, isCompanionSurface);

  const hint = parseRuntimeContextHint(req.runtimeContext);

  // Anonymous companion: no project, no conversation, no memory.
  if (isAnonymousCompanion) {
    return {
      userId: null,
      clerkId: null,
      isAuthenticated: false,
      isAnonymousCompanion: true,
      isDev: false,
      mode,
      projectId: null,
      projectName: null,
      conversationId: null,
      project: null,
      capabilities: {},
      kernelCapabilities: [],
      history: (req.history ?? []).slice(-HISTORY_LIMIT),
      memoryContext: "",
    };
  }

  const uid = userId ?? (isDev ? "anonymous-dev" : null);

  // Resolve project server-side when a projectId is supplied.
  let project: ResolvedRunContext["project"] = null;
  if (userId && req.projectId) {
    project = await resolveProject(userId, req.projectId);
  }

  // Resolve conversation + DB history when authenticated and a conversation is supplied.
  let conversationId: string | null = req.conversationId ?? null;
  let history: HistoryEntry[] = [];
  if (userId && conversationId) {
    const conversation = await getConversation(conversationId, userId);
    if (conversation) {
      conversationId = conversation.id;
      const allMessages = await listMessages(conversation.id, userId);
      history = allMessages
        .filter((m) => m.status === "completed" && (m.role === "user" || m.role === "assistant"))
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    } else {
      conversationId = null;
    }
  } else if (req.history) {
    history = req.history.slice(-HISTORY_LIMIT);
  }

  // Recall project-scoped memories (authenticated users only).
  let memoryContext = "";
  if (userId && project) {
    const agentSlug = (req.agentSlug ?? "litt") as AgentSlug;
    const memories = await recallMemories(req.message, userId, project.projectId, {
      agentSlug,
      agentInstanceId: req.agentInstanceId,
      limit: 5,
    });
    memoryContext = formatMemoryContext(memories);
  }

  // Build capabilities: server-resolved project state first, client hints layered on top.
  const capabilities: RawCapabilities = {
    repository: project?.capabilities.repositoryConnected ? "connected" : hint.repository,
    repositoryIndexed: project?.capabilities.repositoryConnected,
    repositoryName: hint.repositoryName ?? project?.repositoryName ?? undefined,
    activeBranch: hint.activeBranch ?? project?.activeBranch ?? undefined,
    writeAccess: hint.writeAccess,
    workspaceStatus: hint.workspaceStatus,
    selectedModelLabel: hint.selectedModelLabel,
    terminalExecution: hint.terminalExecution ?? (project?.capabilities.terminalConnected ? "available" : "unavailable"),
    terminalStatus: hint.terminalStatus,
    terminalSessionId: hint.terminalSessionId,
    connectedProviders: project?.capabilities.availableTools,
    availableTools: project?.capabilities.availableTools,
    connectionSummary: project?.capabilities.connectionSummary,
    voiceTransportConnected: hint.voiceTransportConnected,
    voiceMicrophoneOn: hint.voiceMicrophoneOn,
    voiceInputState: hint.voiceInputState,
    voiceState: hint.voiceState,
    voiceOutputState: hint.voiceOutputState,
    voiceHealth: hint.voiceHealth,
    cameraActive: hint.cameraActive,
    cameraStatus: hint.cameraStatus,
  };

  // Kernel capability records — only advertise capabilities the server can verify.
  const kernelCapabilities: CapabilityRecord[] = [];
  if (project?.capabilities.repositoryConnected) {
    kernelCapabilities.push(adaptLegacyCapability({ id: "github", status: "ready", name: "Repository" }));
  }
  if (hint.terminalExecution === "available") {
    kernelCapabilities.push(adaptLegacyCapability({ id: "pty", status: "ready", name: "Terminal" }));
  }
  if (hint.voiceTransportConnected) {
    kernelCapabilities.push(adaptLegacyCapability({ id: "voice", status: "ready", name: "Voice" }));
  }

  return {
    userId: uid,
    clerkId,
    isAuthenticated,
    isAnonymousCompanion: false,
    isDev,
    mode,
    projectId: project?.projectId ?? req.projectId ?? null,
    projectName: project?.projectName ?? null,
    conversationId,
    project,
    capabilities,
    kernelCapabilities,
    history,
    memoryContext,
  };
}

/**
 * Build a ResolvedRunContext from an already-resolved Studio context.
 *
 * Used by the Studio messages route, which owns the revision RPC and
 * message persistence but delegates prompt construction to the runtime.
 * This avoids duplicating the capability-merging logic between the route
 * and the runtime.
 */
export function buildRunContextFromStudio(args: {
  userId: string;
  clerkId: string | null;
  studioCtx: import("@/lib/studio").ResolvedStudioContext;
  history: HistoryEntry[];
  memoryContext: string;
  runtimeContextHint?: Partial<RawCapabilities>;
  agentInstanceId?: string;
}): ResolvedRunContext {
  const { userId, clerkId, studioCtx, history, memoryContext, runtimeContextHint, agentInstanceId } = args;
  const hint = runtimeContextHint ?? {};

  const capabilities: RawCapabilities = {
    repository: studioCtx.capabilities.repositoryConnected ? "connected" : hint.repository,
    repositoryIndexed: studioCtx.capabilities.repositoryConnected,
    repositoryName: hint.repositoryName ?? studioCtx.repositoryName ?? undefined,
    activeBranch: hint.activeBranch ?? studioCtx.activeBranch ?? undefined,
    writeAccess: hint.writeAccess,
    workspaceStatus: hint.workspaceStatus,
    selectedModelLabel: hint.selectedModelLabel,
    terminalExecution: hint.terminalExecution ?? (studioCtx.capabilities.terminalConnected ? "available" : "unavailable"),
    terminalStatus: hint.terminalStatus,
    terminalSessionId: hint.terminalSessionId,
    connectedProviders: studioCtx.capabilities.availableTools,
    availableTools: studioCtx.capabilities.availableTools,
    connectionSummary: studioCtx.capabilities.connectionSummary,
    voiceTransportConnected: hint.voiceTransportConnected,
    voiceMicrophoneOn: hint.voiceMicrophoneOn,
    voiceInputState: hint.voiceInputState,
    voiceState: hint.voiceState,
    voiceOutputState: hint.voiceOutputState,
    voiceHealth: hint.voiceHealth,
    cameraActive: hint.cameraActive,
    cameraStatus: hint.cameraStatus,
  };

  const kernelCapabilities: CapabilityRecord[] = [];
  if (studioCtx.capabilities.repositoryConnected) {
    kernelCapabilities.push(adaptLegacyCapability({ id: "github", status: "ready", name: "Repository" }));
  }
  if (hint.terminalExecution === "available") {
    kernelCapabilities.push(adaptLegacyCapability({ id: "pty", status: "ready", name: "Terminal" }));
  }
  if (hint.voiceTransportConnected) {
    kernelCapabilities.push(adaptLegacyCapability({ id: "voice", status: "ready", name: "Voice" }));
  }

  // Reuse the studio-resolved project fields as a ResolvedProject-compatible object.
  const project = {
    projectId: studioCtx.projectId,
    projectName: studioCtx.projectName,
    projectDescription: studioCtx.projectDescription,
    repositoryProvider: studioCtx.repositoryProvider,
    repositoryOwner: studioCtx.repositoryOwner,
    repositoryName: studioCtx.repositoryName,
    repositoryDefaultBranch: studioCtx.repositoryDefaultBranch,
    activeBranch: studioCtx.activeBranch,
    framework: studioCtx.framework,
    scanStatus: studioCtx.scanStatus,
    scanSummary: studioCtx.scanSummary,
    capabilities: studioCtx.capabilities,
  } as ResolvedRunContext["project"];

  return {
    userId,
    clerkId,
    isAuthenticated: true,
    isAnonymousCompanion: false,
    isDev: false,
    mode: "studio",
    projectId: studioCtx.projectId,
    projectName: studioCtx.projectName,
    conversationId: studioCtx.conversationId,
    project,
    capabilities,
    kernelCapabilities,
    history,
    memoryContext,
  };
  void agentInstanceId; // reserved for future per-instance context shaping
}

export { buildProjectContextBlock, buildStudioContext, HISTORY_LIMIT };
