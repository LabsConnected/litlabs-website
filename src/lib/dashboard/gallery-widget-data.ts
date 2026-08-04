import "server-only";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

export interface GalleryWidgetItem {
  id: string;
  title: string;
  artist: string;
  imageUrl: string;
  likes: number;
  mediaType: string;
  createdAt: string;
}

export interface GalleryWidgetData {
  myGallery: GalleryWidgetItem[];
  trending: GalleryWidgetItem[];
}

/**
 * Resolve gallery data for dashboard widgets.
 * - myGallery: user's published items
 * - trending: community items sorted by likes
 */
export async function resolveGalleryWidgetData(
  userId: string,
  widgetIds: string[],
): Promise<GalleryWidgetData> {
  if (!isAdminSupabaseConfigured()) {
    return { myGallery: [], trending: [] };
  }

  const wantsMy = widgetIds.includes("my-gallery") || !widgetIds.length;
  const wantsTrending = widgetIds.includes("trending-gallery") || !widgetIds.length;

  try {
    const client = getAdminSupabase();

    const [myResult, trendingResult] = await Promise.allSettled([
      wantsMy
        ? client
            .from("gallery_items")
            .select("id, title, artist, image_url, likes, media_type, created_at")
            .eq("user_id", userId)
            .eq("is_public", true)
            .order("created_at", { ascending: false })
            .limit(6)
        : Promise.resolve({ data: null }),
      wantsTrending
        ? client
            .from("gallery_items")
            .select("id, title, artist, image_url, likes, media_type, created_at")
            .eq("is_public", true)
            .order("likes", { ascending: false })
            .limit(6)
        : Promise.resolve({ data: null }),
    ]);

    const mapItem = (item: Record<string, unknown>): GalleryWidgetItem => ({
      id: item.id as string,
      title: (item.title as string) ?? "Untitled",
      artist: (item.artist as string) ?? "Unknown",
      imageUrl: (item.image_url as string) ?? "",
      likes: (item.likes as number) ?? 0,
      mediaType: (item.media_type as string) ?? "image",
      createdAt: (item.created_at as string) ?? new Date().toISOString(),
    });

    return {
      myGallery:
        myResult.status === "fulfilled" && myResult.value.data
          ? (myResult.value.data as Record<string, unknown>[]).map(mapItem)
          : [],
      trending:
        trendingResult.status === "fulfilled" && trendingResult.value.data
          ? (trendingResult.value.data as Record<string, unknown>[]).map(mapItem)
          : [],
    };
  } catch {
    return { myGallery: [], trending: [] };
  }
}
