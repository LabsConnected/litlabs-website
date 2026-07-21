/**
 * Unified Studio Chat types
 *
 * Canonical contracts for the single chat transport used across Studio:
 * one endpoint, one set of stream events, one hook/component surface.
 */

export type PersonaId =
  | "litt"
  | "littcode"
  | "littlebit"
  | "auto";

export type ChatMode =
  | "chat"
  | "build"
  | "code"
  | "research"
  | "mission";

export type Attachment = {
  id: string;
  type: "image" | "file" | "audio" | "video";
  url: string;
  name?: string;
};

export type ChatContext = {
  route?: string;
  selectedCode?: string;
  activeFile?: string;
  workspaceState?: unknown;
};

/**
 * Single request shape for POST /api/chat/unified
 */
export interface UnifiedChatRequest {
  conversationId?: string;
  message: string;
  persona?: PersonaId;
  mode?: ChatMode;
  projectId?: string;
  model?: string;
  attachments?: Attachment[];
  context?: ChatContext;
}

export type Artifact = {
  id: string;
  type: "code" | "image" | "file" | "website" | "plan";
  title: string;
  content?: string;
  url?: string;
  language?: string;
};

/**
 * Canonical SSE event stream contract. All chat endpoints emit this shape.
 */
export type ChatStreamEvent =
  | { type: "start"; conversationId: string }
  | { type: "status"; status: string }
  | { type: "text-delta"; delta: string }
  | { type: "tool-start"; tool: string; callId: string }
  | { type: "tool-result"; callId: string; result: unknown }
  | { type: "artifact"; artifact: Artifact }
  | { type: "mission"; missionId: string }
  | { type: "usage"; tokens: number; credits: number }
  | { type: "error"; code: string; message: string }
  | { type: "done"; provider: string; model: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export type Conversation = {
  id: string;
  title?: string;
  messages: ChatMessage[];
  updatedAt: string;
};
