/**
 * Voice Session Service
 *
 * Manages the lifecycle of voice provider calls (Vapi, Twilio, etc.)
 * mapped to LiTT user context. When a call starts, we resolve the
 * caller's phone number to a user, their active project, and a
 * conversation — then persist that mapping so every subsequent turn
 * during the call has instant context without re-resolving.
 *
 * This is the bridge between "someone is calling" and "LiTT knows who
 * they are, what they're working on, and their conversation history."
 */

import { supabaseAdmin } from "@/lib/supabase";
import { listProjects } from "@/lib/projects/project-repository";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";
import { createConversation } from "@/lib/studio/conversation-service";

export interface VoiceSession {
  id: string;
  provider: string;
  providerCallId: string;
  userId: string | null;
  conversationId: string | null;
  projectId: string | null;
  callerPhone: string | null;
  callerName: string | null;
  status: "active" | "ended" | "failed";
  startedAt: string;
  endedAt: string | null;
  metadata: Record<string, unknown> | null;
}

interface DbVoiceSession {
  id: string;
  provider: string;
  provider_call_id: string;
  user_id: string | null;
  conversation_id: string | null;
  project_id: string | null;
  caller_phone: string | null;
  caller_name: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  metadata: Record<string, unknown> | null;
}

function mapSession(row: DbVoiceSession): VoiceSession {
  return {
    id: row.id,
    provider: row.provider,
    providerCallId: row.provider_call_id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    callerPhone: row.caller_phone,
    callerName: row.caller_name,
    status: row.status as VoiceSession["status"],
    startedAt: row.started_at,
    endedAt: row.ended_at,
    metadata: row.metadata,
  };
}

/** Normalize a phone number to E.164-ish format for matching. */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

/**
 * Resolve a phone number to a Clerk user ID.
 * Returns null if the phone is not linked to any account.
 */
async function resolveUserByPhone(phone: string): Promise<{
  clerkId: string;
  displayName: string | null;
} | null> {
  if (!supabaseAdmin) return null;
  const normalized = normalizePhone(phone);
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("clerk_id, display_name")
    .eq("phone", normalized)
    .maybeSingle();
  if (error || !data?.clerk_id) return null;
  return { clerkId: data.clerk_id, displayName: data.display_name ?? null };
}

/**
 * Resolve the active project for a user.
 *
 * Resolution order:
 *   1. user_active_project (explicit selection in Studio/Dashboard)
 *   2. resolveCurrentProject (most recently updated project)
 *   3. listProjects legacy fallback
 */
async function resolveActiveProject(userId: string): Promise<string | null> {
  try {
    // 1. Honor the project explicitly selected in Studio/Dashboard
    if (supabaseAdmin) {
      const { data: activeRecord } = await supabaseAdmin
        .from("user_active_project")
        .select("project_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (activeRecord?.project_id) {
        const project = await resolveCurrentProject({
          userId,
          explicitProjectId: activeRecord.project_id,
        });

        if (project) {
          return project.projectId;
        }
      }
    }

    // 2. Fallback to most recently updated project
    const project = await resolveCurrentProject({ userId });
    return project?.projectId ?? null;
  } catch {
    // 3. Final legacy fallback
    try {
      const projects = await listProjects(userId);
      return projects.projects[0]?.id ?? projects.legacyOnly[0]?.id ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Create a voice session when a call starts.
 *
 * Resolves the caller's phone to a user, gets their active project,
 * creates a new conversation (or reuses an existing one), and persists
 * the mapping. Returns the session so the caller can inject context
 * into the voice assistant's system prompt.
 */
export async function startVoiceSession(params: {
  provider: string;
  providerCallId: string;
  callerPhone: string;
  callerName?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<VoiceSession> {
  // Check if a session already exists for this call (idempotent)
  if (supabaseAdmin) {
    const { data: existing } = await supabaseAdmin
      .from("voice_sessions")
      .select("*")
      .eq("provider", params.provider)
      .eq("provider_call_id", params.providerCallId)
      .maybeSingle();
    if (existing) return mapSession(existing as DbVoiceSession);
  }

  // Resolve caller → user
  const user = await resolveUserByPhone(params.callerPhone);
  const userId = user?.clerkId ?? null;

  // Resolve active project
  let projectId: string | null = null;
  if (userId) {
    projectId = await resolveActiveProject(userId);
  }

  // Create a conversation for this call (if we have a user + project)
  let conversationId: string | null = null;
  if (userId && projectId) {
    const conversation = await createConversation(
      userId,
      projectId,
      `Voice call — ${new Date().toLocaleString()}`,
      "litt",
    );
    conversationId = conversation?.id ?? null;
  }

  // Persist the session
  if (!supabaseAdmin) {
    return {
      id: `local-${Date.now()}`,
      provider: params.provider,
      providerCallId: params.providerCallId,
      userId,
      conversationId,
      projectId,
      callerPhone: normalizePhone(params.callerPhone),
      callerName: params.callerName ?? user?.displayName ?? null,
      status: "active",
      startedAt: new Date().toISOString(),
      endedAt: null,
      metadata: params.metadata ?? null,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("voice_sessions")
    .insert({
      provider: params.provider,
      provider_call_id: params.providerCallId,
      user_id: userId,
      conversation_id: conversationId,
      project_id: projectId,
      caller_phone: normalizePhone(params.callerPhone),
      caller_name: params.callerName ?? user?.displayName ?? null,
      status: "active",
      metadata: params.metadata ?? {},
    })
    .select()
    .single();

  if (error || !data) {
    return {
      id: `fallback-${Date.now()}`,
      provider: params.provider,
      providerCallId: params.providerCallId,
      userId,
      conversationId,
      projectId,
      callerPhone: normalizePhone(params.callerPhone),
      callerName: params.callerName ?? user?.displayName ?? null,
      status: "active",
      startedAt: new Date().toISOString(),
      endedAt: null,
      metadata: params.metadata ?? null,
    };
  }

  return mapSession(data as DbVoiceSession);
}

/**
 * Get an active voice session by provider + call ID.
 */
export async function getVoiceSession(
  provider: string,
  providerCallId: string,
): Promise<VoiceSession | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("voice_sessions")
    .select("*")
    .eq("provider", provider)
    .eq("provider_call_id", providerCallId)
    .maybeSingle();
  if (error || !data) return null;
  return mapSession(data as DbVoiceSession);
}

/**
 * End a voice session (mark as ended).
 */
export async function endVoiceSession(
  provider: string,
  providerCallId: string,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { error } = await supabaseAdmin
    .from("voice_sessions")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
      metadata: metadata ?? undefined,
    })
    .eq("provider", provider)
    .eq("provider_call_id", providerCallId)
    .eq("status", "active");
  return !error;
}
