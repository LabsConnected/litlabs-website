import { getSupabaseAdmin } from "./supabase";

const HOURLY_COMMAND_LIMIT = 100;

export async function checkUsageLimit(userId: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return { allowed: true, used: 0, limit: HOURLY_COMMAND_LIMIT };
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("terminal_command_history")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);

  if (error) {
    return { allowed: true, used: 0, limit: HOURLY_COMMAND_LIMIT };
  }

  const used = count ?? 0;
  return { allowed: used < HOURLY_COMMAND_LIMIT, used, limit: HOURLY_COMMAND_LIMIT };
}
