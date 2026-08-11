/**
 * LiTT Runtime — Canonical Types
 *
 * Every interface (Studio chat, global companion, voice, CLI, mobile) funnels
 * through the LiTT Runtime via LiTTRunRequest. The server resolves auth,
 * project, conversation, capabilities, and provider state itself — client
 * hints are never treated as authoritative.
 */

export type LiTTMode = "studio" | "companion" | "voice" | "cli" | "mobile";

export interface AttachmentInput {
  type: "image";
  dataUrl: string;
}

/**
 * Canonical request contract for the LiTT Runtime.
 * Accepted by POST /api/litt/run and by runLiTT().
 */
export interface LiTTRunRequest {
  message: string;
  conversationId?: string;
  projectId?: string;
  missionId?: string;
  activeCanvasId?: string;
  agentMode?: LiTTMode;
  /** Hint a specific provider (e.g. "gemini"). Server may override. */
  requestedProvider?: string;
  /** Hint a specific model id. Server may override. */
  requestedModel?: string;
  attachments?: AttachmentInput[];
  stream?: boolean;

  // ── Compatibility / surface hints (NOT authoritative) ──────────────
  /** Legacy agent slug (e.g. "litt", "spark"). Server resolves the agent. */
  agentSlug?: string;
  /** Marketplace agent instance id (user_agents.id). */
  agentInstanceId?: string;
  /** Client-supplied history. Server prefers DB-loaded history when authenticated. */
  history?: HistoryEntry[];
  /** Model category for routing (auto/free/fast/code/creative/vision/byok). */
  category?: string;
  /** Max output tokens (overrides default 2048). Voice uses 300 for speed. */
  maxTokens?: number;
  /** Per-request LLM timeout in ms. Voice uses 12000 to fail fast. */
  timeoutMs?: number;
  userName?: string;
  pageContext?: PageContextHint;
  /** Client-derived capability hints. Server re-resolves and ignores conflicts. */
  runtimeContext?: Record<string, unknown>;
  /** Idempotency key for message persistence. */
  clientRequestId?: string;
}

export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface PageContextHint {
  surface?: string;
  pageTitle?: string;
  route?: string;
  activeEntity?: { type: string; name: string };
  authenticated?: boolean;
}

export interface LiTTRunResult {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  reasoning?: string;
  actions?: unknown[];
}

/**
 * Resolved context produced by request-context.ts. All fields are
 * server-authoritative — never echo unverified client state into prompts.
 */
export interface ResolvedRunContext {
  userId: string | null;
  clerkId: string | null;
  isAuthenticated: boolean;
  isAnonymousCompanion: boolean;
  isDev: boolean;
  mode: LiTTMode;
  projectId: string | null;
  projectName: string | null;
  conversationId: string | null;
  /** Server-resolved project context, or null when no project is selected. */
  project: import("@/lib/studio").ResolvedProject | null;
  /** Capabilities re-derived from the project record + client hints. */
  capabilities: import("@/lib/capabilities/translate").RawCapabilities;
  kernelCapabilities: import("@/lib/litt-kernel").CapabilityRecord[];
  history: HistoryEntry[];
  /** Recalled project-scoped memories (authenticated users only). */
  memoryContext: string;
}

/**
 * Output of prompt-builder.ts — the fully assembled prompt pieces.
 * The execution engine only needs `fullPrompt`; the rest is for audit/Studio.
 */
export interface BuiltPrompt {
  systemPrompt: string;
  fullPrompt: string;
  kernelResult: import("@/lib/litt-kernel").KernelResult;
  agentDisplayName: string;
  memoryContext: string;
  projectBlock: string | null;
}
