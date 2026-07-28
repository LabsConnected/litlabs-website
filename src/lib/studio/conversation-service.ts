import { supabaseAdmin } from "@/lib/supabase";
import type { Conversation, ConversationMessage, AgentSlug, MessageStatus } from "./types";

interface DbConversation {
  id: string;
  owner_id: string;
  project_id: string;
  title: string | null;
  active_agent_slug: AgentSlug;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface DbMessage {
  id: string;
  conversation_id: string;
  owner_id: string;
  project_id: string;
  role: string;
  agent_slug: AgentSlug | null;
  content: string;
  status: string;
  parent_message_id: string | null;
  regeneration_of_message_id: string | null;
  client_request_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapConversation(row: DbConversation): Conversation {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    title: row.title,
    activeAgentSlug: row.active_agent_slug,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function mapMessage(row: DbMessage): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    role: row.role as ConversationMessage["role"],
    agentSlug: row.agent_slug,
    content: row.content,
    status: row.status as MessageStatus,
    parentMessageId: row.parent_message_id,
    regenerationOfMessageId: row.regeneration_of_message_id,
    clientRequestId: row.client_request_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create a conversation. The server generates the ID and sets ownership.
 * The caller cannot supply owner_id or revision.
 */
export async function createConversation(
  ownerId: string,
  projectId: string,
  title: string | null,
  activeAgentSlug: AgentSlug,
): Promise<Conversation | null> {
  const { data, error } = await supabaseAdmin
    .from("studio_conversations")
    .insert({
      owner_id: ownerId,
      project_id: projectId,
      title,
      active_agent_slug: activeAgentSlug,
      revision: 1,
    })
    .select()
    .single();

  if (error || !data) return null;
  return mapConversation(data as DbConversation);
}

/**
 * List conversations for a user, optionally filtered by project.
 * Always scoped by owner_id.
 */
export async function listConversations(
  ownerId: string,
  projectId?: string,
): Promise<Conversation[]> {
  let query = supabaseAdmin
    .from("studio_conversations")
    .select("*")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as DbConversation[]).map(mapConversation);
}

/**
 * Get a single conversation, scoped by owner_id.
 * Returns null if not found or not owned by the user.
 */
export async function getConversation(
  conversationId: string,
  ownerId: string,
): Promise<Conversation | null> {
  const { data, error } = await supabaseAdmin
    .from("studio_conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("owner_id", ownerId)
    .single();

  if (error || !data) return null;
  return mapConversation(data as DbConversation);
}

/**
 * Update a conversation with optimistic revision control.
 * The query scopes by id, owner_id, AND expected revision.
 * If the revision is stale, no row is returned → 409 conflict.
 */
export async function updateConversation(
  conversationId: string,
  ownerId: string,
  expectedRevision: number,
  patch: { title?: string | null; activeAgentSlug?: AgentSlug },
): Promise<{ conversation: Conversation | null; conflict: boolean }> {
  const updateData: Record<string, unknown> = {
    revision: expectedRevision + 1,
    updated_at: new Date().toISOString(),
  };

  if (patch.title !== undefined) updateData.title = patch.title;
  if (patch.activeAgentSlug !== undefined) updateData.active_agent_slug = patch.activeAgentSlug;

  const { data, error } = await supabaseAdmin
    .from("studio_conversations")
    .update(updateData)
    .eq("id", conversationId)
    .eq("owner_id", ownerId)
    .eq("revision", expectedRevision)
    .select()
    .single();

  if (error || !data) {
    // Check if the conversation exists but with a different revision
    const existing = await getConversation(conversationId, ownerId);
    if (existing) {
      return { conversation: null, conflict: true };
    }
    return { conversation: null, conflict: false };
  }

  return { conversation: mapConversation(data as DbConversation), conflict: false };
}

/**
 * Archive a conversation (soft delete). Scoped by owner_id.
 */
export async function archiveConversation(
  conversationId: string,
  ownerId: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("studio_conversations")
    .update({
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("owner_id", ownerId);

  return !error;
}

/**
 * Insert a message. The server generates the ID and sets ownership.
 * Checks for idempotency via client_request_id.
 */
export async function insertMessage(
  message: {
    conversationId: string;
    ownerId: string;
    projectId: string;
    role: ConversationMessage["role"];
    agentSlug?: AgentSlug | null;
    content: string;
    status?: MessageStatus;
    parentMessageId?: string | null;
    regenerationOfMessageId?: string | null;
    clientRequestId?: string | null;
  },
): Promise<{ message: ConversationMessage | null; duplicate: boolean }> {
  // Check for existing message with same client_request_id (idempotency)
  if (message.clientRequestId) {
    const { data: existing } = await supabaseAdmin
      .from("studio_conversation_messages")
      .select("*")
      .eq("owner_id", message.ownerId)
      .eq("conversation_id", message.conversationId)
      .eq("client_request_id", message.clientRequestId)
      .limit(1);

    if (existing && existing.length > 0) {
      return { message: mapMessage(existing[0] as DbMessage), duplicate: true };
    }
  }

  const { data, error } = await supabaseAdmin
    .from("studio_conversation_messages")
    .insert({
      conversation_id: message.conversationId,
      owner_id: message.ownerId,
      project_id: message.projectId,
      role: message.role,
      agent_slug: message.agentSlug ?? null,
      content: message.content,
      status: message.status ?? "pending",
      parent_message_id: message.parentMessageId ?? null,
      regeneration_of_message_id: message.regenerationOfMessageId ?? null,
      client_request_id: message.clientRequestId ?? null,
    })
    .select()
    .single();

  if (error || !data) return { message: null, duplicate: false };
  return { message: mapMessage(data as DbMessage), duplicate: false };
}

/**
 * List messages for a conversation, scoped by owner_id.
 * Ordered by created_at ascending.
 */
export async function listMessages(
  conversationId: string,
  ownerId: string,
): Promise<ConversationMessage[]> {
  const { data, error } = await supabaseAdmin
    .from("studio_conversation_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error || !data) return [];
  return (data as DbMessage[]).map(mapMessage);
}

/**
 * Get a single message, scoped by owner_id.
 */
export async function getMessage(
  messageId: string,
  ownerId: string,
): Promise<ConversationMessage | null> {
  const { data, error } = await supabaseAdmin
    .from("studio_conversation_messages")
    .select("*")
    .eq("id", messageId)
    .eq("owner_id", ownerId)
    .single();

  if (error || !data) return null;
  return mapMessage(data as DbMessage);
}

/**
 * Update message status (e.g., from streaming to completed).
 */
export async function updateMessageStatus(
  messageId: string,
  ownerId: string,
  status: MessageStatus,
  content?: string,
): Promise<boolean> {
  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (content !== undefined) updateData.content = content;

  const { error } = await supabaseAdmin
    .from("studio_conversation_messages")
    .update(updateData)
    .eq("id", messageId)
    .eq("owner_id", ownerId);

  return !error;
}

/**
 * Get the active assistant message for a conversation.
 * When regenerations exist, the latest regeneration is the active one.
 */
export async function getActiveAssistantMessage(
  conversationId: string,
  ownerId: string,
  parentMessageId: string,
): Promise<ConversationMessage | null> {
  // Find the latest assistant message that is a regeneration of a previous one,
  // or the original assistant message for this parent.
  const { data, error } = await supabaseAdmin
    .from("studio_conversation_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("owner_id", ownerId)
    .eq("role", "assistant")
    .or(`parent_message_id.eq.${parentMessageId},regeneration_of_message_id.eq.${parentMessageId}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return mapMessage(data[0] as DbMessage);
}
