import {
  archiveConversation,
  createConversation,
  getConversation,
} from "@/lib/studio/conversation-service";
import type { Conversation } from "@/lib/studio/types";
import {
  claimGlobalLittPrimaryConversation,
  getGlobalLittSystemProject,
  getOrCreateGlobalLittSystemProject,
  type LittSystemProject,
} from "./system-project";

export interface GlobalLittConversation {
  systemProject: LittSystemProject;
  conversation: Conversation;
}

/**
 * Resolve the one persistent canonical conversation owned by Global LiTT.
 *
 * The system-project row is the coordination point. Two concurrent first
 * requests may both create a candidate conversation, but only one can claim
 * primary_conversation_id. The loser re-reads the winner and archives its
 * orphan candidate so normal conversation history stays clean.
 */
export async function getOrCreateGlobalLittConversation(
  ownerId: string,
): Promise<GlobalLittConversation> {
  let systemProject = await getOrCreateGlobalLittSystemProject(ownerId);

  if (systemProject.primaryConversationId) {
    const existing = await getConversation(systemProject.primaryConversationId, ownerId);
    if (existing && existing.projectId === systemProject.id) {
      return { systemProject, conversation: existing };
    }
  }

  const candidate = await createConversation(
    ownerId,
    systemProject.id,
    "Global LiTT",
    "litt",
  );
  if (!candidate) {
    throw new Error("Failed to create Global LiTT conversation");
  }

  const claimed = await claimGlobalLittPrimaryConversation(
    ownerId,
    systemProject.id,
    candidate.id,
  );
  if (claimed) {
    return { systemProject: claimed, conversation: candidate };
  }

  // Another request won the first-conversation race. Use the canonical row
  // and archive the losing candidate so it never appears as stray history.
  systemProject = await getGlobalLittSystemProject(ownerId) ?? systemProject;
  const canonicalId = systemProject.primaryConversationId;
  if (canonicalId) {
    const canonical = await getConversation(canonicalId, ownerId);
    if (canonical && canonical.projectId === systemProject.id) {
      await archiveConversation(candidate.id, ownerId);
      return { systemProject, conversation: canonical };
    }
  }

  await archiveConversation(candidate.id, ownerId);
  throw new Error("Failed to resolve canonical Global LiTT conversation");
}
