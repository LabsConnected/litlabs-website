// Gallery API — GET (list) / POST (save image)
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

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

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const mine = searchParams.get("mine") === "true";

    let query = supabaseAdmin
      .from("user_media")
      .select("id, url, type, caption, created_at, users:user_id (name, username)")
      .in("type", ["image", "video"])
      .order("created_at", { ascending: false });

    if (mine) {
      const { userId: clerkId } = await auth();
      if (!clerkId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const { data: user } = await supabaseAdmin.from("users").select("id").eq("clerk_id", clerkId).single();
      if (!user) return NextResponse.json({ items: [] });
      query = query.eq("user_id", user.id);
    }

    if (category) {
      query = query.ilike("caption", `%${category}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Gallery fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch gallery" }, { status: 500 });
    }

    const items = (data || []).map((item: { id: string; url: string; type: string; caption: string | null; created_at: string; users: Array<{ name: string | null; username: string | null }> | null }) => {
      const user = Array.isArray(item.users) ? item.users[0] : item.users;
      const isVideo = item.type === "video";
      const thumbnail = isVideo ? getVideoThumbnailUrl(item.url) || item.url : item.url;

      return {
        id: item.id,
        title: item.caption || "Untitled",
        artist: user?.name || user?.username || "Anonymous",
        category: item.caption ? "generated" : "gallery",
        imageUrl: thumbnail,
        likes: 0,
        createdAt: item.created_at,
        mediaType: item.type,
        videoUrl: isVideo ? item.url : undefined,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("Gallery error:", err);
    return NextResponse.json({ error: "Failed to fetch gallery" }, { status: 500 });
  }
}

async function postHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { url, caption, type } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    const { data: user } = await supabaseAdmin.from("users").select("id").eq("clerk_id", clerkId).single();
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
      })
      .select()
      .single();

    if (error) {
      console.error("Gallery insert error:", error);
      return NextResponse.json({ error: "Failed to save image" }, { status: 500 });
    }

    return NextResponse.json({ success: true, item }, { status: 201 });
  } catch (err) {
    console.error("Gallery save error:", err);
    return NextResponse.json({ error: "Failed to save image" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
