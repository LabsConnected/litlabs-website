import "server-only";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

export interface RecentCreation {
  id: string;
  title: string;
  type: "image" | "video" | "music" | "audio" | "document";
  url: string;
  thumbnailUrl: string | null;
  createdAt: string;
  projectId: string | null;
}

/**
 * Resolve recent creations for the dashboard widget.
 * Pulls from studio_messages (agent-generated media) and gallery items.
 */
export async function resolveRecentCreations(userId: string): Promise<RecentCreation[]> {
  if (!isAdminSupabaseConfigured()) return [];

  try {
    const client = getAdminSupabase();

    // Fetch recent gallery items owned by the user
    const { data: galleryItems } = await client
      .from("gallery_items")
      .select("id, title, image_url, video_url, media_type, created_at, project_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12);

    if (!galleryItems?.length) return [];

    return galleryItems.map((item) => ({
      id: item.id,
      title: item.title ?? "Untitled",
      type: (item.media_type ?? "image") as RecentCreation["type"],
      url: item.image_url ?? item.video_url ?? "",
      thumbnailUrl: item.image_url ?? null,
      createdAt: item.created_at,
      projectId: item.project_id ?? null,
    }));
  } catch {
    return [];
  }
}
