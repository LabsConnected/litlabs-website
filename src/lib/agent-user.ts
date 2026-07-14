/**
 * User-owned personal agent domain.
 *
 * Supabase owns the configuration record; Supermemory indexes content for retrieval.
 */

export type AutonomyLevel = "ask-first" | "safe-actions" | "autonomous";

export type MemoryScope =
  | "profile"
  | "preference"
  | "agent"
  | "project"
  | "conversation"
  | "temporary";

export type MemoryPolicy = {
  allowProfile?: boolean;
  allowPreferences?: boolean;
  allowAgent?: boolean;
  allowProject?: boolean;
  allowConversation?: boolean;
  allowTemporary?: boolean;
  autoForgetDays?: number;
};

export type UserAgent = {
  id: string;
  ownerId: string;
  name: string;
  avatarUrl?: string;
  instructions: string;
  model: string;
  enabledTools: string[];
  memoryPolicy: MemoryPolicy;
  autonomy: AutonomyLevel;
  monthlyBudget: number;
  projectIds: string[];
  voiceSettings?: Record<string, unknown>;
  dataRetentionDays: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MemoryRecord = {
  id: string;
  ownerId: string;
  agentId?: string | null;
  content: string;
  scope: MemoryScope;
  source?: string;
  sourceId?: string;
  reason?: string;
  confidence?: number;
  expiresAt?: string | null;
  supermemoryId?: string | null;
  syncStatus: "pending" | "synced" | "failed";
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolPermissionLevel = "allow" | "ask" | "project-only" | "deny";

export type AgentToolPermission = {
  id: string;
  agentId: string;
  toolName: string;
  level: ToolPermissionLevel;
  projectIds: string[];
};

export type AgentApproval = {
  id: string;
  agentId: string;
  ownerId: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "expired";
  expiresAt?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  agentId: string;
  ownerId: string;
  projectId?: string | null;
  mode: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: "running" | "completed" | "failed" | "cancelled";
  costCents: number;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
};

export type DirectorMode =
  | "ask"
  | "image"
  | "build"
  | "code"
  | "agent"
  | "search"
  | "memory"
  | "deploy";
