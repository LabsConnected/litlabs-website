// Post Comments — GET (threaded, cursor on top-level) / POST (create)
// DB-backed only. Errors return 500 (never success-on-failure).
import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";
import { auth } from "@/lib/auth";
import { getPostDTO, requireAuthDbUser, resolveDbUser } from "@/lib/social-feed";

const COMMENT_SELECT = `
  id, post_id, user_id, parent_comment_id, content, likes_count, created_at, edited_at,
  users:user_id (username, name, avatar_url)
`;

interface CommentDTO {
  id: string;
  postId: string;
  parentId: string | null;
  author: { id: string; username: string; displayName: string; avatarUrl: string | null };
  content: string;
  likes: number;
  viewerLiked: boolean;
  createdAt: string;
  editedAt: string | null;
  replies: CommentDTO[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDTO(c: any, viewerLiked: Set<string>): CommentDTO {
  const a = c.users ?? {};
  return {
    id: c.id,
    postId: c.post_id,
    parentId: c.parent_comment_id ?? null,
    author: {
      id: c.user_id,
      username: a.username ?? "",
      displayName: a.name ?? a.username ?? "",
      avatarUrl: a.avatar_url ?? null,
    },
    content: c.content ?? "",
    likes: c.likes_count ?? 0,
    viewerLiked: viewerLiked.has(c.id),
    createdAt: c.created_at,
    editedAt: c.edited_at ?? null,
    replies: [],
  };
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: createdAt, i: id })).toString("base64url");
}

function decodeCursor(cursor: string | null): { t: string; i: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t?: unknown; i?: unknown };
    if (typeof parsed.t === "string" && typeof parsed.i === "string") return { t: parsed.t, i: parsed.i };
    return null;
  } catch {
    return null;
  }
}

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));

  const { userId } = await auth(req);
  const viewerDbId = userId ? (await resolveDbUser(userId))?.id ?? null : null;

  // Post must be visible to read its comments
  const dto = await getPostDTO(postId, viewerDbId);
  if (!dto) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const sb = getAdminSupabase();
  let q = sb.from("post_comments").select(COMMENT_SELECT).eq("post_id", postId).is("parent_comment_id", null);
  const c = decodeCursor(cursor);
  if (c) {
    q = q.or(`created_at.lt.${c.t},and(created_at.eq.${c.t},id.lt.${c.i})`);
  }
  const { data: topLevel, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) {
    return NextResponse.json({ error: "Failed to load comments" }, { status: 500 });
  }

  const rows = (topLevel ?? []) as Record<string, unknown>[];
  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit && page.length > 0
      ? encodeCursor(page[page.length - 1].created_at as string, page[page.length - 1].id as string)
      : null;

  const commentIds = page.map((r) => r.id as string);
  const { data: replies } = commentIds.length
    ? await sb
        .from("post_comments")
        .select(COMMENT_SELECT)
        .eq("post_id", postId)
        .in("parent_comment_id", commentIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  let viewerLiked = new Set<string>();
  if (viewerDbId && commentIds.length) {
    const allIds = [...commentIds, ...((replies ?? []) as { id: string }[]).map((r) => r.id)];
    const { data: likes } = await sb
      .from("comment_likes")
      .select("comment_id")
      .in("comment_id", allIds)
      .eq("user_id", viewerDbId);
    viewerLiked = new Set(((likes ?? []) as { comment_id: string }[]).map((l) => l.comment_id));
  }

  const repliesByParent = new Map<string, CommentDTO[]>();
  for (const r of ((replies ?? []) as Parameters<typeof toDTO>[0][])) {
    const dtoR = toDTO(r, viewerLiked);
    const arr = repliesByParent.get(dtoR.parentId!) ?? [];
    arr.push(dtoR);
    repliesByParent.set(dtoR.parentId!, arr);
  }

  const comments = (page as Parameters<typeof toDTO>[0][]).map((r) => {
    const dtoC = toDTO(r, viewerLiked);
    dtoC.replies = repliesByParent.get(dtoC.id) ?? [];
    return dtoC;
  });

  return NextResponse.json({ comments, nextCursor });
}

async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const { dbUser, response } = await requireAuthDbUser(req);
  if (!dbUser) return response;

  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 2000) {
    return NextResponse.json({ error: "Content must be 1..2000 characters" }, { status: 400 });
  }
  const parentId = typeof body?.parentId === "string" && body.parentId ? body.parentId : null;

  const sb = getAdminSupabase();

  // Post must be visible to comment on it
  const dto = await getPostDTO(postId, dbUser.id);
  if (!dto) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  if (parentId) {
    // Parent must be a top-level comment on this post (one-level threading)
    const { data: parent } = await sb
      .from("post_comments")
      .select("id, parent_comment_id")
      .eq("id", parentId)
      .eq("post_id", postId)
      .single();
    if (!parent) {
      return NextResponse.json({ error: "Parent comment not found" }, { status: 404 });
    }
    if (parent.parent_comment_id) {
      return NextResponse.json({ error: "Replies are limited to one level" }, { status: 400 });
    }
  }

  const { data: comment, error } = await sb
    .from("post_comments")
    .insert({ post_id: postId, user_id: dbUser.id, parent_comment_id: parentId, content })
    .select(COMMENT_SELECT)
    .single();
  if (error || !comment) {
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
  }
  await sb.rpc("increment_post_comments", { post_id: postId });

  if (dto.author.id !== dbUser.id) {
    await sb.from("notifications").insert({
      recipient_id: dto.author.id,
      actor_id: dbUser.id,
      type: "comment",
      entity_type: "comment",
      entity_id: comment.id,
      content: `commented: "${content.slice(0, 40)}${content.length > 40 ? "..." : ""}"`,
    });
  }

  return NextResponse.json({ comment: toDTO(comment, new Set()) }, { status: 201 });
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
