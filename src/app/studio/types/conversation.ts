/**
 * Canonical conversation types for the Command Studio.
 *
 * Phase 2.1 — replaces the split message systems:
 * - useBuilderSessions (session-scoped messages)
 * - useStudioAgentStore (global per-agent threads)
 *
 * One source of truth: StudioConversation holds messages, agent
 * selection, project context, and terminal associations.
 */

import type { ArtifactAction } from "@/lib/canvas/types";

// ── Agent Identity ──────────────────────────────────────────────

/**
 * Agent identifiers known to the system.
 * The server resolves the full agent profile from a registry —
 * the client never defines the system prompt.
 */
export type AgentId = string;

/** Built-in agent IDs. Premium agents are resolved server-side. */
export const BUILTIN_AGENT_IDS = ["litt", "spark"] as const;
export type BuiltinAgentId = (typeof BUILTIN_AGENT_IDS)[number];

// ── Message Types ───────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system";

/**
 * Structured message status — Phase 2.6.
 * Replaces inferring execution state from assistant prose.
 */
export type MessageStatus =
  | "pending"     // queued, not yet sent
  | "streaming"   // assistant response in progress
  | "complete"    // finished successfully
  | "failed"      // errored
  | "cancelled";  // user cancelled

/**
 * Structured event types — Phase 2.6.
 * PlanCard, ActivityCard, ApprovalCard, CompletionCard render
 * from typed data, not from prose inference.
 */
export type MessageEventType =
  | "text"         // plain text message
  | "plan"         // structured plan with steps
  | "activity"     // activity log entry
  | "approval"     // approval request
  | "completion"   // task completion
  | "error"        // error report
  | "artifact"     // generated artifact (code, image, etc.)
  | "tool-result"; // result of a tool execution

/**
 * A structured plan step — used by PlanCard.
 */
export interface PlanStep {
  id: string;
  label: string;
  status: "pending" | "in-progress" | "complete" | "failed";
}

/**
 * A structured approval request — used by ApprovalCard.
 */
export interface ApprovalRequest {
  id: string;
  title: string;
  description: string;
  actions: { id: string; label: string; type: "approve" | "reject" | "modify" }[];
}

/**
 * Structured message event data — typed payload for event cards.
 */
export type MessageEventData =
  | { type: "plan"; steps: PlanStep[] }
  | { type: "activity"; action: string; detail?: string }
  | { type: "approval"; request: ApprovalRequest }
  | { type: "completion"; summary: string; artifacts?: string[] }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "artifact"; artifactType: string; name: string; url?: string }
  | { type: "tool-result"; tool: string; result: string; exitCode?: number };

/**
 * StudioMessage — the canonical message type.
 * Replaces both BuilderMessage and ChatMessage (agent store).
 */
export interface StudioMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** Agent that produced this message (for assistant messages). */
  agentId?: AgentId;
  /** Image attachments (data URLs or remote URLs). */
  images?: string[];
  /** Canvas actions proposed alongside this response. */
  actions?: ArtifactAction[];
  /** Structured event data for typed cards (Phase 2.6). */
  event?: MessageEventData;
  /** Message lifecycle status. */
  status: MessageStatus;
  /** Unix timestamp (ms). */
  createdAt: number;
  /** Last update timestamp (ms). */
  updatedAt?: number;
}

// ── Conversation Types ──────────────────────────────────────────

/**
 * Project context attached to a conversation.
 * Sent to the server so LiTT knows what project, repo, and branch
 * are active, and what capabilities are available.
 */
export interface ProjectContext {
  projectId: string | null;
  repositoryName: string | null;
  repositoryState: "none" | "connected" | "partial" | "read-only";
  branch: string | null;
  indexed: boolean;
  workspaceId: string | null;
  /** What LiTT is allowed to do — verified, not invented. */
  permissionMode: "read" | "write" | "execute" | "deploy" | "preview";
  /** Available capabilities snapshot. */
  capabilities: {
    read: boolean;
    write: boolean;
    execute: boolean;
    preview: boolean;
    deploy: boolean;
  };
}

/**
 * StudioConversation — the canonical conversation type.
 * Replaces BuilderSession and the per-agent thread split.
 */
export interface StudioConversation {
  id: string;
  title: string;
  pinned: boolean;
  /** Messages in chronological order. */
  messages: StudioMessage[];
  /** Which agent handles the next message. */
  selectedAgentId: AgentId;
  /** Project context — sent to server with each message. */
  project: ProjectContext;
  /** Terminal session IDs associated with this conversation. */
  terminalSessionIds: string[];
  /** Currently active terminal session. */
  activeTerminalSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Migration Helpers ───────────────────────────────────────────

/**
 * Legacy BuilderMessage format (from useBuilderSessions).
 * Used for migration to StudioMessage.
 */
export interface LegacyBuilderMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  actions?: ArtifactAction[];
}

/**
 * Legacy ChatMessage format (from useStudioAgentStore).
 * Used for migration to StudioMessage.
 */
export interface LegacyChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  images?: string[];
  actions?: ArtifactAction[];
}

/**
 * Legacy BuilderSession format (from useBuilderSessions).
 * Used for migration to StudioConversation.
 */
export interface LegacyBuilderSession {
  id: string;
  title: string;
  pinned: boolean;
  messages: LegacyBuilderMessage[];
  context: {
    projectId: string | null;
    repositoryState: "none" | "connected" | "partial" | "read-only";
    selectedAgent: string;
    terminalSessionIds: string[];
    activeTerminalSessionId: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Migrate a LegacyBuilderMessage to a StudioMessage.
 */
export function migrateMessage(
  msg: LegacyBuilderMessage | LegacyChatMessage,
  agentId?: AgentId,
): StudioMessage {
  return {
    id: crypto.randomUUID(),
    role: msg.role,
    content: msg.content,
    agentId: msg.role === "assistant" ? agentId : undefined,
    images: "images" in msg ? msg.images : undefined,
    actions: msg.actions,
    status: "complete",
    createdAt: msg.createdAt ?? Date.now(),
  };
}

/**
 * Migrate a LegacyBuilderSession to a StudioConversation.
 */
export function migrateSession(session: LegacyBuilderSession): StudioConversation {
  return {
    id: session.id,
    title: session.title,
    pinned: session.pinned,
    messages: session.messages.map((m) => migrateMessage(m, session.context.selectedAgent)),
    selectedAgentId: session.context.selectedAgent || "litt",
    project: {
      projectId: session.context.projectId,
      repositoryName: null,
      repositoryState: session.context.repositoryState,
      branch: null,
      indexed: false,
      workspaceId: null,
      permissionMode: "read",
      capabilities: {
        read: session.context.repositoryState !== "none",
        write: false,
        execute: false,
        preview: false,
        deploy: false,
      },
    },
    terminalSessionIds: session.context.terminalSessionIds,
    activeTerminalSessionId: session.context.activeTerminalSessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/**
 * Create a new empty conversation.
 */
export function createConversation(title = "New chat"): StudioConversation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    pinned: false,
    messages: [],
    selectedAgentId: "litt",
    project: {
      projectId: null,
      repositoryName: null,
      repositoryState: "none",
      branch: null,
      indexed: false,
      workspaceId: null,
      permissionMode: "read",
      capabilities: { read: false, write: false, execute: false, preview: false, deploy: false },
    },
    terminalSessionIds: [],
    activeTerminalSessionId: null,
    createdAt: now,
    updatedAt: now,
  };
}
