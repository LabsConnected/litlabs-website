// Social feed API — GET (paginated feed) / POST (create post)
// DB-backed only. No mocks: honest 503 when the backend isn't connected.
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  FeedTab,
  getPostDTO,
  listPosts,
  requireAuthDbUser,
  resolveDbUser,
} from "@/lib/social-feed";
import { auth } from "@/lib/auth";

const POST_TYPES = ["text", "image", "video", "link", "project", "music", "poll"] as const;
const VISIBILITIES = ["public", "followers", "crew", "private"] as const;

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

async function getHandler(req: NextRequest) {
  // Honest 503 when the backend isn't connected (CI, unconfigured envs) —
  // never fake posts, never a 500 that looks like an app error.
  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json(
      { error: "The community feed isn't connected yet." },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const rawTab = searchParams.get("tab") ?? "for-you";
  const tab: FeedTab = rawTab === "following" || rawTab === "trending" ? rawTab : "for-you";
  const authorId = searchParams.get("authorId");
  const cursor = searchParams.get("cursor");
  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 10;

  let viewerDbId: string | null = null;
  const { userId } = await auth(req);
  if (userId) {
    const dbUser = await resolveDbUser(userId);
    viewerDbId = dbUser?.id ?? null;
  }

  const result = await listPosts({ viewerDbId, tab, authorId, cursor, limit });
  return NextResponse.json(result);
}

async function postHandler(req: NextRequest) {
  // Honest 503 when the backend isn't connected (CI, unconfigured envs) —
  // checked before auth so an unconfigured backend never 500s.
  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Posting is unavailable — the community feed isn't connected yet." },
      { status: 503 },
    );
  }

  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const postType = typeof body.postType === "string" ? body.postType : "text";
  const visibility = typeof body.visibility === "string" ? body.visibility : "public";

  if (!(POST_TYPES as readonly string[]).includes(postType)) {
    return NextResponse.json({ error: "Invalid postType" }, { status: 400 });
  }
  if (!(VISIBILITIES as readonly string[]).includes(visibility)) {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }
  if (content.length > 5000) {
    return NextResponse.json({ error: "Content exceeds 5000 characters" }, { status: 400 });
  }

  const mediaUrls = Array.isArray(body.mediaUrls) ? body.mediaUrls : [];
  if (mediaUrls.length > 4) {
    return NextResponse.json({ error: "At most 4 media URLs are allowed" }, { status: 400 });
  }
  for (const url of mediaUrls) {
    if (!isHttpsUrl(url)) {
      return NextResponse.json({ error: "Media URLs must be valid https URLs" }, { status: 400 });
    }
  }

  const link = body.link && typeof body.link === "object" ? body.link : null;
  let linkFields: Record<string, string | null> = {};
  if (postType === "link") {
    if (!isHttpsUrl(link?.url)) {
      return NextResponse.json({ error: "link.url must be a valid https URL" }, { status: 400 });
    }
    linkFields = {
      link_url: link.url,
      link_title: typeof link.title === "string" ? link.title.slice(0, 300) : null,
      link_description: typeof link.description === "string" ? link.description.slice(0, 1000) : null,
      link_image_url: isHttpsUrl(link.imageUrl) ? link.imageUrl : null,
    };
  }

  const poll = body.poll && typeof body.poll === "object" ? body.poll : null;
  let pollOptions: string[] | null = null;
  let pollEndsAt: string | null = null;
  if (postType === "poll") {
    const question = typeof poll?.question === "string" ? poll.question.trim() : "";
    const options = Array.isArray(poll?.options) ? poll.options : [];
    if (!question || question.length > 300) {
      return NextResponse.json({ error: "Poll question must be 1..300 characters" }, { status: 400 });
    }
    if (options.length < 2 || options.length > 4) {
      return NextResponse.json({ error: "Poll requires 2..4 options" }, { status: 400 });
    }
    pollOptions = [];
    for (const opt of options) {
      if (typeof opt !== "string" || !opt.trim() || opt.trim().length > 100) {
        return NextResponse.json({ error: "Poll options must be 1..100 characters" }, { status: 400 });
      }
      pollOptions.push(opt.trim());
    }
    if (poll?.endsAt != null) {
      const ends = new Date(poll.endsAt);
      if (Number.isNaN(ends.getTime()) || ends.getTime() <= Date.now()) {
        return NextResponse.json({ error: "Poll endsAt must be a future timestamp" }, { status: 400 });
      }
      pollEndsAt = ends.toISOString();
    }
  }

  const projectRef = typeof body.projectRef === "string" && body.projectRef.trim() ? body.projectRef.trim().slice(0, 200) : null;
  const music = body.music && typeof body.music === "object" ? body.music : null;
  const musicTitle = typeof music?.title === "string" ? music.title.trim().slice(0, 200) : "";
  if (postType === "music" && !musicTitle) {
    return NextResponse.json({ error: "music.title is required for music posts" }, { status: 400 });
  }
  const musicFields =
    postType === "music"
      ? {
          music_title: musicTitle,
          music_artist: typeof music?.artist === "string" ? music.artist.trim().slice(0, 200) || null : null,
          music_url: isHttpsUrl(music?.url) ? music.url : null,
        }
      : {};

  if (!content && mediaUrls.length === 0 && postType !== "poll" && postType !== "link" && !musicTitle && !projectRef) {
    return NextResponse.json({ error: "Content or media is required" }, { status: 400 });
  }

  const sb = getAdminSupabase();
  const { data: post, error } = await sb
    .from("posts")
    .insert({
      user_id: dbUser.id,
      content,
      media_urls: mediaUrls,
      post_type: postType,
      visibility,
      project_ref: postType === "project" ? projectRef : null,
      ...linkFields,
      ...musicFields,
    })
    .select("id")
    .single();

  if (error || !post) {
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }

  if (postType === "poll" && pollOptions) {
    const question = poll.question.trim();
    const { data: pollRow, error: pollError } = await sb
      .from("post_polls")
      .insert({ post_id: post.id, question, ends_at: pollEndsAt })
      .select("id")
      .single();
    if (pollError || !pollRow) {
      await sb.from("posts").delete().eq("id", post.id);
      return NextResponse.json({ error: "Failed to create poll" }, { status: 500 });
    }
    const { error: optsError } = await sb.from("poll_options").insert(
      pollOptions.map((text, position) => ({ poll_id: pollRow.id, text, position })),
    );
    if (optsError) {
      await sb.from("posts").delete().eq("id", post.id);
      return NextResponse.json({ error: "Failed to create poll" }, { status: 500 });
    }
  }

  const dto = await getPostDTO(post.id, dbUser.id);
  if (!dto) {
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
  return NextResponse.json({ post: dto }, { status: 201 });
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
