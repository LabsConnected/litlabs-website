import "server-only";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

export interface DiscoverFeedItem {
  id: string;
  authorName: string;
  authorAvatar: string | null;
  content: string;
  mediaUrls: string[];
  likesCount: number;
  commentsCount: number;
  createdAt: string;
}

/**
 * Resolve discover feed data for the dashboard widget.
 * Returns recent public posts.
 */
export async function resolveDiscoverFeedWidget(_userId: string): Promise<DiscoverFeedItem[]> {
  if (!isAdminSupabaseConfigured()) return [];

  try {
    const client = getAdminSupabase();

    const { data } = await client
      .from("posts")
      .select(`
        id,
        content,
        media_urls,
        likes_count,
        comments_count,
        created_at,
        users!posts_user_id_fkey(name, avatar_url)
      `)
      .order("created_at", { ascending: false })
      .limit(8);

    if (!data?.length) return [];

    return data.map((post) => {
      const userRow = (post as Record<string, unknown>).users as Record<string, unknown> | null;
      return {
        id: post.id as string,
        authorName: (userRow?.name as string) ?? "Unknown",
        authorAvatar: (userRow?.avatar_url as string) ?? null,
        content: (post.content as string) ?? "",
        mediaUrls: (post.media_urls as string[]) ?? [],
        likesCount: (post.likes_count as number) ?? 0,
        commentsCount: (post.comments_count as number) ?? 0,
        createdAt: (post.created_at as string) ?? new Date().toISOString(),
      };
    });
  } catch {
    return [];
  }
}
