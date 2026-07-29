export type AgentSlug = "litt" | "spark";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type MessageStatus = "pending" | "streaming" | "completed" | "failed" | "cancelled";

export type MemoryType =
  | "user_preference"
  | "project_fact"
  | "project_decision"
  | "architecture"
  | "workflow"
  | "constraint"
  | "conversation_summary"
  | "agent_note";

export interface Conversation {
  id: string;
  ownerId: string;
  projectId: string;
  title: string | null;
  activeAgentSlug: AgentSlug;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  ownerId: string;
  projectId: string;
  role: MessageRole;
  agentSlug: AgentSlug | null;
  content: string;
  status: MessageStatus;
  parentMessageId: string | null;
  regenerationOfMessageId: string | null;
  clientRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedStudioContext {
  userId: string;
  projectId: string;
  conversationId: string;
  projectName: string;
  projectDescription: string | null;
  repositoryProvider: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  repositoryDefaultBranch: string | null;
  activeAgentSlug: AgentSlug;
  capabilities: StudioCapabilities;
}

export interface StudioCapabilities {
  repositoryConnected: boolean;
  repositoryName: string | null;
  terminalConnected: boolean;
  availableTools: string[];
  connectionSummary: string;
}

export interface BuiltInAgent {
  slug: AgentSlug;
  displayName: string;
  systemPrompt: string;
  capabilities: string[];
  memoryTypes: MemoryType[];
}

export interface StudioChatRequest {
  conversationId: string;
  message: string;
  clientRequestId: string;
  expectedRevision: number;
  requestedAgentSlug?: AgentSlug;
}

export interface ApiError {
  error: string;
  status: number;
  detail?: string;
}
