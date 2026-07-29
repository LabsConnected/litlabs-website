export type {
  AgentSlug,
  MessageRole,
  MessageStatus,
  MemoryType,
  Conversation,
  ConversationMessage,
  ResolvedStudioContext,
  StudioCapabilities,
  BuiltInAgent,
  StudioChatRequest,
  ApiError,
} from "./types";

export {
  BUILT_IN_AGENTS,
  resolveAgent,
  isValidAgentSlug,
  getAgentMemoryTypes,
} from "./agent-registry";

export {
  resolveProject,
  buildStudioContext,
  buildProjectContextBlock,
  type ResolvedProject,
} from "./project-resolver";

export {
  createConversation,
  listConversations,
  getConversation,
  updateConversation,
  archiveConversation,
  insertMessage,
  listMessages,
  getMessage,
  updateMessageStatus,
  getActiveAssistantMessage,
} from "./conversation-service";

export {
  recallMemories,
  persistMemory,
  formatMemoryContext,
} from "./memory-service";

export { studioLog, type LogContext } from "./logger";
