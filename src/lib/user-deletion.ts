// User Deletion Service — anonymize + selective purge
//
// Called by the Clerk webhook on `user.deleted` events.
//
// Strategy:
//   1. Find user by clerk_id
//   2. If already anonymized (deleted_at IS NOT NULL) → return success (idempotent)
//   3. Anonymize PII on the users row (keep row for FK integrity)
//   4. Purge user-content tables (posts, media, conversations, etc.)
//   5. Null out approved_by references in tool_executions
//   6. Retain billing/financial/audit tables untouched
//
// Tables PURGED (user content, no retention need):
//   user_preferences, user_agents, wallets, posts, post_likes,
//   post_comments, user_media, conversations, conversation_messages,
//   orchestration_jobs, active_tasks, agent_runs, agent_steps,
//   tool_executions (where user_id = X), agent_sessions, cli_sessions,
//   browser_agent_sessions, browser_jobs, terminal_workspaces,
//   studio_projects, music_generations, voice_sessions,
//   agent_station_layouts, builder_chat_sessions, project_loops,
//   user_facts, agent_memory, agent_paused_runs, notifications
//
// Tables RETAINED (billing/legal/audit):
//   transactions, subscriptions, creator_earnings, credit_ledger,
//   credit_reservations, audit_events, llm_usage_records,
//   creator_payout_ledger, ghl_affiliate_tracking, service_inquiries
//
// Tables ANONYMIZED:
//   users (blank PII, set deleted_at)

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DeletionResult {
  success: boolean;
  alreadyDeleted: boolean;
  clerkId: string;
  error?: string;
}

/**
 * Anonymize a user and purge their personal data.
 *
 * Idempotent: if the user is already anonymized (deleted_at set),
 * returns success without re-processing. Safe for duplicate webhook delivery.
 */
export async function anonymizeUser(
  db: SupabaseClient,
  clerkId: string,
): Promise<DeletionResult> {
  // 1. Find user by clerk_id
  const { data: user, error: findError } = await db
    .from("users")
    .select("id, deleted_at")
    .eq("clerk_id", clerkId)
    .single();

  if (findError || !user) {
    // User not in our DB — nothing to delete. This is success, not error.
    // Clerk may send webhooks for users that never signed into our app.
    return { success: true, alreadyDeleted: false, clerkId };
  }

  // 2. Idempotency check — already anonymized
  if (user.deleted_at) {
    return { success: true, alreadyDeleted: true, clerkId };
  }

  const userId = user.id as string;

  // 3. Purge user-content tables (explicit deletes, not relying on CASCADE)
  // Order matters for FK constraints: children before parents.
  const purgeTables: Array<{ table: string; column: string }> = [
    // Conversation children first
    { table: "conversation_messages", column: "conversation_id" },
    // Then conversations themselves
    { table: "conversations", column: "user_id" },
    // Social children
    { table: "post_likes", column: "user_id" },
    { table: "post_comments", column: "user_id" },
    { table: "post_likes", column: "post_id" }, // likes on user's posts
    { table: "post_comments", column: "post_id" }, // comments on user's posts
    // Social parents
    { table: "posts", column: "user_id" },
    // Media
    { table: "user_media", column: "user_id" },
    // Agent/task data
    { table: "active_tasks", column: "user_id" },
    { table: "orchestration_jobs", column: "user_id" },
    { table: "tool_executions", column: "user_id" },
    { table: "agent_steps", column: "user_id" },
    { table: "agent_runs", column: "user_id" },
    // Preferences and installs
    { table: "user_preferences", column: "user_id" },
    { table: "user_agents", column: "user_id" },
    // Wallet (keep transactions history, delete the wallet itself)
    { table: "wallets", column: "user_id" },
    // Other personal data — best-effort deletes (tables may not exist)
    { table: "agent_sessions", column: "user_id" },
    { table: "cli_sessions", column: "user_id" },
    { table: "browser_agent_sessions", column: "user_id" },
    { table: "browser_jobs", column: "user_id" },
    { table: "terminal_workspaces", column: "user_id" },
    { table: "studio_projects", column: "user_id" },
    { table: "music_generations", column: "user_id" },
    { table: "voice_sessions", column: "user_id" },
    { table: "agent_station_layouts", column: "user_id" },
    { table: "builder_chat_sessions", column: "user_id" },
    { table: "project_loops", column: "user_id" },
    { table: "user_facts", column: "user_id" },
    { table: "agent_memory", column: "user_id" },
    { table: "agent_paused_runs", column: "user_id" },
    { table: "agent_system_notifications", column: "user_id" },
    { table: "model_usage", column: "user_id" },
    { table: "generation_jobs", column: "user_id" },
    { table: "agent_work_queue", column: "user_id" },
    { table: "agent_instances", column: "user_id" },
    { table: "agent_logs", column: "user_id" },
  ];

  // For tables where the column is a child FK (like conversation_messages → conversations),
  // we need to delete by a subquery. For direct user_id columns, simple eq filter.
  for (const { table, column } of purgeTables) {
    if (column === "conversation_id") {
      // Delete messages for conversations owned by this user
      await db
        .from(table)
        .delete()
        .in(
          "conversation_id",
          (
            await db
              .from("conversations")
              .select("id")
              .eq("user_id", userId)
          ).data?.map((r) => r.id) ?? [],
        );
    } else if (column === "post_id") {
      // Delete likes/comments on this user's posts
      await db
        .from(table)
        .delete()
        .in(
          "post_id",
          (
            await db.from("posts").select("id").eq("user_id", userId)
          ).data?.map((r) => r.id) ?? [],
        );
    } else {
      // Direct user_id column — best-effort (table may not exist in all envs)
      try {
        await db.from(table).delete().eq(column, userId);
      } catch {
        // Table doesn't exist or column mismatch — skip
      }
    }
  }

  // 4. Null out approved_by references in tool_executions
  //    (other users' executions where this user approved something)
  try {
    await db
      .from("tool_executions")
      .update({ approved_by: null })
      .eq("approved_by", userId);
  } catch {
    // Table may not exist — skip
  }

  // 5. Anonymize the user row
  const anonymizedEmail = `deleted_${userId.slice(0, 8)}@erased.litlabs.net`;
  const { error: anonError } = await db
    .from("users")
    .update({
      email: anonymizedEmail,
      name: null,
      username: null,
      avatar_url: null,
      bio: null,
      website: null,
      location: null,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (anonError) {
    return {
      success: false,
      alreadyDeleted: false,
      clerkId,
      error: `Failed to anonymize user: ${anonError.message}`,
    };
  }

  return { success: true, alreadyDeleted: false, clerkId };
}
