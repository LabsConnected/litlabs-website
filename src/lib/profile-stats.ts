/**
 * profile-stats — honest profile counters.
 *
 * The profile page used to render hardcoded placeholder stats ("2.4K
 * followers", "22K views") for every user. These are the real counts from
 * the database. Fail-soft: any query error returns null and the UI shows
 * an "unknown" dash instead of a fabricated zero.
 */
import { getAdminSupabase } from "./supabase-admin";

export interface ProfileStats {
  followers: number;
  following: number;
  posts: number;
  projects: number;
}

/**
 * @param dbUserId  users.id (uuid) — used for follows + posts.
 * @param clerkId   Clerk user id — studio_projects.user_id stores the Clerk id.
 */
export async function getProfileStats(
  dbUserId: string,
  clerkId: string,
): Promise<ProfileStats | null> {
  try {
    const sb = getAdminSupabase();
    const [followers, following, posts, projects] = await Promise.all([
      sb.from("follows").select("id", { count: "exact", head: true }).eq("followee_id", dbUserId),
      sb.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", dbUserId),
      sb.from("posts").select("id", { count: "exact", head: true }).eq("user_id", dbUserId),
      sb.from("studio_projects").select("id", { count: "exact", head: true }).eq("user_id", clerkId),
    ]);
    if (followers.error || following.error || posts.error || projects.error) {
      return null;
    }
    return {
      followers: followers.count ?? 0,
      following: following.count ?? 0,
      posts: posts.count ?? 0,
      projects: projects.count ?? 0,
    };
  } catch {
    return null;
  }
}

/** Compact display: 0–999 as-is, 1.2K / 3.4M above. Never fabricates. */
export function formatStatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(Math.floor(n));
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}K`;
  }
  const v = n / 1_000_000;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}M`;
}
