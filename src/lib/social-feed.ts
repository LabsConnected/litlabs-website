// Shared social-feed backend helpers — server only.
// All rows key on users.id (UUID), never raw Clerk IDs.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSupabase } from "@/lib/supabase-admin";

export type FeedTab = "for-you" | "following" | "trending";

export interface PostAuthorDTO {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PostDTO {
  id: string;
  author: PostAuthorDTO;
  content: string;
  postType: string;
  visibility: string;
  mediaUrls: string[];
  link: { url: string; title: string | null; description: string | null; imageUrl: string | null } | null;
  poll: {
    id: string;
    question: string;
    endsAt: string | null;
    options: { id: string; text: string; votes: number }[];
    viewerVotedOptionId: string | null;
    totalVotes: number;
  } | null;
  projectRef: string | null;
  music: { title: string; artist: string | null; url: string | null } | null;
  counts: { likes: number; comments: number; reposts: number; saves: number; shares: number };
  viewer: { liked: boolean; reaction: string | null; reposted: boolean; saved: boolean };
  createdAt: string;
  updatedAt: string;
}

interface DbUser {
  id: string;
  username: string | null;
}

/** Resolve the DB user row (UUID) for a Clerk user id. Returns null when absent. */
export async function resolveDbUser(clerkId: string | null | undefined): Promise<DbUser | null> {
  if (!clerkId) return null;
  const sb = getAdminSupabase();
  const { data, error } = await sb
    .from("users")
    .select("id, username")
    .eq("clerk_id", clerkId)
    .single();
  if (error || !data) return null;
  return { id: data.id, username: data.username ?? null };
}

/**
 * Visibility rule for a post row.
 * - public: always visible
 * - followers/crew: author or a viewer who follows the author
 *   (crew falls back to the follows graph until the Phase 4 crew system lands)
 * - private: author only
 */
export function isPostVisibleTo(
  post: { user_id: string; visibility: string | null },
  viewerDbId: string | null,
  isFollowingAuthor: boolean,
): boolean {
  const visibility = post.visibility ?? "public";
  if (visibility === "public") return true;
  if (viewerDbId && viewerDbId === post.user_id) return true;
  if (visibility === "private") return false;
  // "followers" and "crew" (crew falls back to follows until Phase 4 crew system)
  return isFollowingAuthor;
}

// ── Cursor helpers ──
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: createdAt, i: id })).toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): { t: string; i: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { t?: unknown }).t === "string" &&
      typeof (parsed as { i?: unknown }).i === "string"
    ) {
      return parsed as { t: string; i: string };
    }
    return null;
  } catch {
    return null;
  }
}

function applyKeysetPagination(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  cursor: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const c = decodeCursor(cursor);
  if (!c) return query;
  return query.or(`created_at.lt.${c.t},and(created_at.eq.${c.t},id.lt.${c.i})`);
}

const POST_SELECT = `
  id, user_id, content, media_urls, post_type, visibility,
  likes_count, comments_count, reposts_count, saves_count, shares_count,
  link_url, link_title, link_description, link_image_url,
  project_ref, music_title, music_artist, music_url,
  created_at, updated_at,
  users:user_id (username, name, avatar_url)
`;

function comparePostsDesc(a: { created_at: string; id: string }, b: { created_at: string; id: string }): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

async function fetchFollowSet(viewerDbId: string | null, authorIds: string[]): Promise<Set<string>> {
  if (!viewerDbId || authorIds.length === 0) return new Set();
  const sb = getAdminSupabase();
  const { data } = await sb
    .from("follows")
    .select("followee_id")
    .eq("follower_id", viewerDbId)
    .in("followee_id", [...new Set(authorIds)]);
  return new Set((data ?? []).map((r: { followee_id: string }) => r.followee_id));
}

function filterVisiblePosts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posts: any[],
  viewerDbId: string | null,
  followSet: Set<string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  return posts.filter((p) =>
    isPostVisibleTo(p, viewerDbId, followSet.has(p.user_id)),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hydratePostDTOs(posts: any[], viewerDbId: string | null): Promise<PostDTO[]> {
  if (posts.length === 0) return [];
  const sb = getAdminSupabase();
  const postIds = posts.map((p) => p.id);

  const [likesRes, reactionsRes, repostsRes, savesRes, pollsRes] = await Promise.all([
    viewerDbId
      ? sb.from("post_likes").select("post_id").in("post_id", postIds).eq("user_id", viewerDbId)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
    viewerDbId
      ? sb.from("post_reactions").select("post_id, emoji").in("post_id", postIds).eq("user_id", viewerDbId)
      : Promise.resolve({ data: [] as { post_id: string; emoji: string }[] }),
    viewerDbId
      ? sb.from("post_reposts").select("post_id").in("post_id", postIds).eq("user_id", viewerDbId)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
    viewerDbId
      ? sb.from("post_saves").select("post_id").in("post_id", postIds).eq("user_id", viewerDbId)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
    sb.from("post_polls").select("id, post_id, question, ends_at").in("post_id", postIds),
  ]);

  const liked = new Set((likesRes.data ?? []).map((r: { post_id: string }) => r.post_id));
  const reacted = new Map<string, string>();
  for (const r of (reactionsRes.data ?? []) as { post_id: string; emoji: string }[]) {
    if (!reacted.has(r.post_id)) reacted.set(r.post_id, r.emoji);
  }
  const reposted = new Set((repostsRes.data ?? []).map((r: { post_id: string }) => r.post_id));
  const saved = new Set((savesRes.data ?? []).map((r: { post_id: string }) => r.post_id));

  const polls = (pollsRes.data ?? []) as { id: string; post_id: string; question: string; ends_at: string | null }[];
  const pollByPost = new Map<string, { id: string; question: string; endsAt: string | null }>();
  for (const p of polls) pollByPost.set(p.post_id, { id: p.id, question: p.question, endsAt: p.ends_at });

  const optionsByPoll = new Map<string, { id: string; text: string; votes: number }[]>();
  const viewerVotes = new Map<string, string>();
  if (polls.length > 0) {
    const pollIds = polls.map((p) => p.id);
    const [optsRes, votesRes] = await Promise.all([
      sb.from("poll_options").select("id, poll_id, text, votes_count, position").in("poll_id", pollIds).order("position"),
      viewerDbId
        ? sb.from("poll_votes").select("poll_id, option_id").in("poll_id", pollIds).eq("user_id", viewerDbId)
        : Promise.resolve({ data: [] as { poll_id: string; option_id: string }[] }),
    ]);
    for (const o of (optsRes.data ?? []) as { id: string; poll_id: string; text: string; votes_count: number }[]) {
      const arr = optionsByPoll.get(o.poll_id) ?? [];
      arr.push({ id: o.id, text: o.text, votes: o.votes_count ?? 0 });
      optionsByPoll.set(o.poll_id, arr);
    }
    for (const v of (votesRes.data ?? []) as { poll_id: string; option_id: string }[]) {
      viewerVotes.set(v.poll_id, v.option_id);
    }
  }

  return posts.map((p): PostDTO => {
    const author = p.users ?? {};
    const pollMeta = pollByPost.get(p.id) ?? null;
    const options = pollMeta ? (optionsByPoll.get(pollMeta.id) ?? []) : [];
    return {
      id: p.id,
      author: {
        id: p.user_id,
        username: author.username ?? "",
        displayName: author.name ?? author.username ?? "",
        avatarUrl: author.avatar_url ?? null,
      },
      content: p.content ?? "",
      postType: p.post_type ?? "text",
      visibility: p.visibility ?? "public",
      mediaUrls: Array.isArray(p.media_urls) ? p.media_urls : [],
      link: p.link_url
        ? { url: p.link_url, title: p.link_title ?? null, description: p.link_description ?? null, imageUrl: p.link_image_url ?? null }
        : null,
      poll: pollMeta
        ? {
            id: pollMeta.id,
            question: pollMeta.question,
            endsAt: pollMeta.endsAt,
            options,
            viewerVotedOptionId: viewerVotes.get(pollMeta.id) ?? null,
            totalVotes: options.reduce((s, o) => s + o.votes, 0),
          }
        : null,
      projectRef: p.project_ref ?? null,
      music:
        p.music_title || p.music_url
          ? { title: p.music_title ?? "", artist: p.music_artist ?? null, url: p.music_url ?? null }
          : null,
      counts: {
        likes: p.likes_count ?? 0,
        comments: p.comments_count ?? 0,
        reposts: p.reposts_count ?? 0,
        saves: p.saves_count ?? 0,
        shares: p.shares_count ?? 0,
      },
      viewer: {
        liked: liked.has(p.id),
        reaction: reacted.get(p.id) ?? null,
        reposted: reposted.has(p.id),
        saved: saved.has(p.id),
      },
      createdAt: p.created_at,
      updatedAt: p.updated_at ?? p.created_at,
    };
  });
}

export interface ListPostsArgs {
  viewerDbId: string | null;
  tab: FeedTab;
  authorId?: string | null;
  cursor?: string | null;
  limit?: number;
}

export interface ListPostsResult {
  posts: PostDTO[];
  nextCursor: string | null;
}

/**
 * Database-backed feed listing with keyset cursor pagination.
 * Ordered (created_at DESC, id DESC). All visibility filtering is enforced here.
 */
export async function listPosts(args: ListPostsArgs): Promise<ListPostsResult> {
  const sb = getAdminSupabase();
  const viewerDbId = args.viewerDbId ?? null;
  const limit = Math.min(25, Math.max(1, Math.floor(args.limit ?? 10)));
  const tab: FeedTab = args.tab === "following" || args.tab === "trending" ? args.tab : "for-you";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = [];

  if (tab === "trending") {
    // Last 7 days, ordered by engagement score desc. Cursor {t,i} identifies
    // the last item of the previous page within this ordering.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await sb
      .from("posts")
      .select(POST_SELECT)
      .eq("visibility", "public")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      throw new Error(`Failed to load trending posts: ${error.message}`);
    }
    const candidates = (data ?? []) as typeof rows;
    const score = (p: { likes_count?: number; comments_count?: number; reposts_count?: number }) =>
      (p.likes_count ?? 0) + (p.comments_count ?? 0) * 2 + (p.reposts_count ?? 0) * 3;
    candidates.sort((a, b) => {
      const d = score(b) - score(a);
      return d !== 0 ? d : comparePostsDesc(a, b);
    });
    const cursor = decodeCursor(args.cursor);
    let start = 0;
    if (cursor) {
      const idx = candidates.findIndex((p) => p.id === cursor.i && p.created_at === cursor.t);
      if (idx >= 0) start = idx + 1;
    }
    rows = candidates.slice(start, start + limit + 1);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages: any[][] = [];

    if (tab === "for-you") {
      // Public posts…
      let q = sb.from("posts").select(POST_SELECT).eq("visibility", "public");
      q = applyKeysetPagination(q, args.cursor);
      const { data, error } = await q
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);
      if (error) {
        throw new Error(`Failed to load feed posts: ${error.message}`);
      }
      pages.push((data ?? []) as typeof rows);

      if (viewerDbId) {
        // …plus the viewer's own posts and posts by authors they follow
        // with followers/crew visibility (private handled by viewer==author).
        const { data: follows, error: followsError } = await sb
          .from("follows")
          .select("followee_id")
          .eq("follower_id", viewerDbId);
        if (followsError) {
          throw new Error(`Failed to load follows: ${followsError.message}`);
        }
        const followeeIds = (follows ?? []).map((f: { followee_id: string }) => f.followee_id);
        const visibleAuthorIds = [viewerDbId, ...followeeIds];
        let q2 = sb
          .from("posts")
          .select(POST_SELECT)
          .in("user_id", visibleAuthorIds)
          .in("visibility", ["followers", "crew", "private"]);
        q2 = applyKeysetPagination(q2, args.cursor);
        const { data: d2, error: d2Error } = await q2
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit + 1);
        if (d2Error) {
          throw new Error(`Failed to load feed posts: ${d2Error.message}`);
        }
        pages.push((d2 ?? []) as typeof rows);
      }
    } else {
      // following: posts by followed authors (+ own), any visibility.
      if (viewerDbId) {
        const { data: follows, error: followsError } = await sb
          .from("follows")
          .select("followee_id")
          .eq("follower_id", viewerDbId);
        if (followsError) {
          throw new Error(`Failed to load follows: ${followsError.message}`);
        }
        const authorIds = [viewerDbId, ...(follows ?? []).map((f: { followee_id: string }) => f.followee_id)];
        let q = sb.from("posts").select(POST_SELECT).in("user_id", authorIds);
        if (args.authorId) q = q.eq("user_id", args.authorId);
        q = applyKeysetPagination(q, args.cursor);
        const { data, error } = await q
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit + 1);
        if (error) {
          throw new Error(`Failed to load feed posts: ${error.message}`);
        }
        pages.push((data ?? []) as typeof rows);
      } else {
        // Signed out: Following tab behaves like For You (public only).
        let q = sb.from("posts").select(POST_SELECT).eq("visibility", "public");
        q = applyKeysetPagination(q, args.cursor);
        const { data, error } = await q
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit + 1);
        if (error) {
          throw new Error(`Failed to load feed posts: ${error.message}`);
        }
        pages.push((data ?? []) as typeof rows);
      }
    }

    // Author filter on for-you (profile post lists).
    if (args.authorId && tab === "for-you") {
      for (const page of pages) {
        rows.push(...page.filter((p) => p.user_id === args.authorId));
      }
    } else {
      const seen = new Set<string>();
      for (const page of pages) {
        for (const p of page) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            rows.push(p);
          }
        }
      }
    }
    rows.sort(comparePostsDesc);
    rows = rows.slice(0, limit + 1);
  }

  // Visibility gate: follows/crew require the viewer to follow the author.
  const authorIds = rows.map((p) => p.user_id);
  const followSet = await fetchFollowSet(viewerDbId, authorIds);
  const visible = filterVisiblePosts(rows, viewerDbId, followSet);

  const page = visible.slice(0, limit);
  const hasMore = rows.length > limit || visible.length > limit;
  const nextCursor =
    hasMore && page.length > 0 ? encodeCursor(page[page.length - 1].created_at, page[page.length - 1].id) : null;

  return { posts: await hydratePostDTOs(page, viewerDbId), nextCursor };
}

/**
 * Single post with author, counts, viewer state, and poll. Returns null when
 * the post does not exist or is not visible to the viewer.
 */
export async function getPostDTO(postId: string, viewerDbId: string | null): Promise<PostDTO | null> {
  const sb = getAdminSupabase();
  const { data: post } = await sb.from("posts").select(POST_SELECT).eq("id", postId).single();
  if (!post) return null;

  const followSet = await fetchFollowSet(viewerDbId, [post.user_id]);
  if (!isPostVisibleTo(post, viewerDbId, followSet.has(post.user_id))) return null;

  const [dto] = await hydratePostDTOs([post], viewerDbId);
  return dto ?? null;
}

/**
 * Authenticate the request via Clerk and resolve the DB user (UUID).
 * Returns { dbUser } on success or { response } carrying a 401/404 JSON response.
 */
export async function requireAuthDbUser(
  req: NextRequest,
): Promise<{ dbUser: DbUser; response: null } | { dbUser: null; response: NextResponse }> {
  const { userId } = await auth(req);
  if (!userId) {
    return { dbUser: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const dbUser = await resolveDbUser(userId);
  if (!dbUser) {
    return { dbUser: null, response: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  }
  return { dbUser, response: null };
}
