// Gallery API — GET (list) / POST (save image)
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

function getYoutubeIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);

    if (url.hostname === "youtu.be") {
      const id = url.pathname.slice(1);
      return id || null;
    }

    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname.startsWith("/shorts/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        return parts[1] || null;
      }
      const v = url.searchParams.get("v");
      if (v) return v;
    }

    return null;
  } catch {
    return null;
  }
}

function getVideoThumbnailUrl(rawUrl: string): string | null {
  const id = getYoutubeIdFromUrl(rawUrl);
  if (id) return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
  return null;
}

function pollinationsUrl(prompt: string, width = 2048, height = 2048): string {
  const encoded = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
}

// Demo gallery items when DB is not configured
const DEMO_GALLERY = [
  {
    id: "demo_1",
    title: "Neon Cyber City",
    artist: "Pixel Forge",
    category: "360-worlds",
    imageUrl: pollinationsUrl("Neon cyberpunk city street at night with neon signs and rain reflections, cinematic"),
    likes: 234,
    createdAt: "2026-06-01",
    mediaType: "image" as const,
  },
  {
    id: "demo_2",
    title: "Ethereal Dreamscape",
    artist: "DreamWeaver",
    category: "abstract",
    imageUrl: pollinationsUrl("Ethereal dreamscape with floating islands and soft pastel clouds, surreal art"),
    likes: 189,
    createdAt: "2026-06-02",
    mediaType: "image" as const,
  },
  {
    id: "demo_3",
    title: "Lost Temple Ruins",
    artist: "Explorer-X",
    category: "landscape",
    imageUrl: pollinationsUrl("Ancient lost temple ruins in a misty jungle with dramatic sunlight beams"),
    likes: 312,
    createdAt: "2026-05-28",
    mediaType: "image" as const,
  },
  {
    id: "demo_4",
    title: "Quantum Warrior",
    artist: "Pixel Forge",
    category: "character",
    imageUrl: pollinationsUrl("Quantum warrior futuristic samurai in glowing armor, digital art"),
    likes: 156,
    createdAt: "2026-06-03",
    mediaType: "image" as const,
  },
  {
    id: "demo_5",
    title: "Crystal Cavern",
    artist: "GeoMancer",
    category: "360-worlds",
    imageUrl: pollinationsUrl("Crystal cavern interior with glowing crystals and an underground lake"),
    likes: 278,
    createdAt: "2026-05-30",
    mediaType: "image" as const,
  },
  {
    id: "demo_6",
    title: "Void Entity",
    artist: "ShadowNet",
    category: "character",
    imageUrl: pollinationsUrl("Void entity abstract dark cosmic creature with glowing eyes, horror sci-fi"),
    likes: 421,
    createdAt: "2026-06-04",
    mediaType: "image" as const,
  },
  {
    id: "demo_7",
    title: "Sunset Megacity",
    artist: "Pixel Forge",
    category: "landscape",
    imageUrl: pollinationsUrl("Sunset megacity skyline with towering skyscrapers and orange sky"),
    likes: 198,
    createdAt: "2026-05-25",
    mediaType: "image" as const,
  },
  {
    id: "demo_8",
    title: "Fractal Mind",
    artist: "DreamWeaver",
    category: "abstract",
    imageUrl: pollinationsUrl("Fractal mind abstract colorful geometric patterns swirling, psychedelic art"),
    likes: 267,
    createdAt: "2026-05-29",
    mediaType: "image" as const,
  },
  {
    id: "demo_9",
    title: "Underwater Utopia",
    artist: "AquaBot",
    category: "360-worlds",
    imageUrl: pollinationsUrl("Underwater utopia with coral reefs and bioluminescent sea creatures"),
    likes: 345,
    createdAt: "2026-06-01",
    mediaType: "image" as const,
  },
  {
    id: "demo_10",
    title: "Cyber Samurai",
    artist: "Pixel Forge",
    category: "character",
    imageUrl: pollinationsUrl("Cyber samurai with katana and neon armor in a futuristic dojo"),
    likes: 189,
    createdAt: "2026-05-27",
    mediaType: "image" as const,
  },
  {
    id: "demo_11",
    title: "Starfield Station",
    artist: "StarWalker",
    category: "landscape",
    imageUrl: pollinationsUrl("Starfield station space station orbiting a purple nebula, sci-fi"),
    likes: 567,
    createdAt: "2026-06-04",
    mediaType: "image" as const,
  },
  {
    id: "demo_12",
    title: "Neural Network",
    artist: "DataMancer",
    category: "abstract",
    imageUrl: pollinationsUrl("Neural network visualization glowing nodes and synapses, dark background"),
    likes: 234,
    createdAt: "2026-05-26",
    mediaType: "image" as const,
  },
];

function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return !!(
    url &&
    key &&
    !url.includes("your-project") &&
    !key.includes("your-anon") &&
    !url.includes("placeholder")
  );
}

// List files from Supabase Storage "media" bucket as gallery items
// Used as fallback when user_media table is empty or doesn't exist
async function listStorageGallery(): Promise<Array<{
  id: string;
  title: string;
  artist: string;
  category: string;
  imageUrl: string;
  likes: number;
  isPublic: boolean;
  createdAt: string;
  mediaType: string;
}>> {
  try {
    const sb = getAdminSupabase();
    const { data: files, error } = await sb.storage
      .from("media")
      .list(undefined, { limit: 100, sortBy: { column: "created_at", order: "desc" } });

    if (error || !files || files.length === 0) return [];

    const items = files
      .filter((f) => f.id && !f.id.endsWith(".emptyFolderPlaceholder") && f.metadata)
      .map((f) => {
        const fileId = f.id || f.name;
        const { data: urlData } = sb.storage.from("media").getPublicUrl(fileId);
        const ext = f.name.split(".").pop()?.toLowerCase() || "";
        const isVideo = ["mp4", "webm", "mov", "avi"].includes(ext);
        const isImage = ["jpg", "jpeg", "png", "webp", "gif", "svg", "bmp"].includes(ext);
        if (!isImage && !isVideo) return null;

        return {
          id: `storage_${f.id}`,
          title: f.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").slice(0, 60) || "Untitled",
          artist: "Community",
          category: "gallery",
          imageUrl: urlData.publicUrl,
          likes: 0,
          isPublic: true,
          createdAt: f.created_at || new Date().toISOString(),
          mediaType: isVideo ? "video" : "image",
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return items;
  } catch {
    return [];
  }
}

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const view = searchParams.get("view") || "community"; // "community" | "my-uploads"

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ items: DEMO_GALLERY, mock: true });
    }

    // Get current user (if authenticated)
    const { userId: clerkId } = await auth();
    let currentUserId: string | null = null;

    if (clerkId) {
      const { data: user } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("clerk_id", clerkId)
        .single();
      currentUserId = user?.id || null;
    }

    // Build query based on view mode
    let query = supabaseAdmin
      .from("user_media")
      .select(
        "id, url, type, caption, is_public, category, likes_count, created_at, users:user_id (name, username, avatar_url)",
      )
      .in("type", ["image", "video"]);

    if (view === "my-uploads") {
      // My uploads: require auth, show only user's items (public or private)
      if (!currentUserId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      query = query.eq("user_id", currentUserId);
    } else {
      // Community view: show all public items from all users
      query = query.eq("is_public", true);
    }

    // Apply category filter
    if (category && category !== "all") {
      // Try to match category field first, then fallback to caption search
      query = query.or(`category.eq.${category},caption.ilike.%${category}%`);
    }

    // Sort by newest first
    query = query.order("created_at", { ascending: false });

    const { data, error } = await query;

    if (error) {
      // Table might not exist yet — try storage fallback
      if (isAdminSupabaseConfigured()) {
        const storageItems = await listStorageGallery();
        if (storageItems.length > 0) {
          return NextResponse.json({ items: storageItems });
        }
      }
      return NextResponse.json({ items: [], mock: false });
    }

    if (!data || data.length === 0) {
      // No rows in user_media — try listing from Supabase Storage
      if (isAdminSupabaseConfigured()) {
        const storageItems = await listStorageGallery();
        if (storageItems.length > 0) {
          return NextResponse.json({ items: storageItems });
        }
      }
      return NextResponse.json({ items: [], mock: false });
    }

    const items = (data || []).map(
      (item: {
        id: string;
        url: string;
        type: string;
        caption: string | null;
        is_public: boolean;
        category: string | null;
        likes_count: number;
        created_at: string;
        users: Array<{
          name: string | null;
          username: string | null;
          avatar_url: string | null;
        }> | null;
      }) => {
        const user = Array.isArray(item.users) ? item.users[0] : item.users;
        const isVideo = item.type === "video";
        const thumbnail = isVideo
          ? getVideoThumbnailUrl(item.url) || item.url
          : item.url;

        return {
          id: item.id,
          title: item.caption || "Untitled",
          artist: user?.name || user?.username || "Anonymous",
          artistAvatar: user?.avatar_url || null,
          category: item.category || "gallery",
          imageUrl: thumbnail,
          likes: item.likes_count || 0,
          isPublic: item.is_public,
          createdAt: item.created_at,
          mediaType: item.type,
          videoUrl: isVideo ? item.url : undefined,
        };
      },
    );

    return NextResponse.json({ items });
  } catch {
    // If Supabase is configured, try storage fallback before demo
    if (isAdminSupabaseConfigured()) {
      try {
        const storageItems = await listStorageGallery();
        if (storageItems.length > 0) {
          return NextResponse.json({ items: storageItems });
        }
      } catch {}
    }
    return NextResponse.json({ items: DEMO_GALLERY, mock: true });
  }
}

async function postHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { url, caption, type, isPublic, category } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({
        success: true,
        id: `mock_${Date.now()}`,
        mock: true,
      });
    }

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const mediaType: "image" | "video" | "audio" =
      type === "video" || type === "audio" ? type : "image";

    const { data: item, error } = await supabaseAdmin
      .from("user_media")
      .insert({
        user_id: user.id,
        url: url.trim(),
        type: mediaType,
        caption: caption ? String(caption).trim() : null,
        is_public: isPublic !== false, // default to public
        category: category || "gallery",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to save image" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, item }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to save image" },
      { status: 500 },
    );
  }
}

async function deleteHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ success: true, mock: true });
    }

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Only allow deleting own items
    const { error } = await supabaseAdmin
      .from("user_media")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json(
        { error: "Failed to delete item" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete item" },
      { status: 500 },
    );
  }
}

async function patchHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const body = await req.json();
    const { isPublic, caption, category } = body;

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ success: true, mock: true });
    }

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};
    if (isPublic !== undefined) updates.is_public = isPublic;
    if (caption !== undefined)
      updates.caption = caption ? String(caption).trim() : null;
    if (category !== undefined) updates.category = category;

    const { data: item, error } = await supabaseAdmin
      .from("user_media")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id) // Only update own items
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to update item" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, item });
  } catch {
    return NextResponse.json(
      { error: "Failed to update item" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
export const DELETE = withRateLimit(deleteHandler, 30, 60);
export const PATCH = withRateLimit(patchHandler, 30, 60);
