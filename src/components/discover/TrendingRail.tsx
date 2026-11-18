"use client";

/**
 * TrendingRail — the Discover right rail (Phase 1 audit §5).
 *
 * Data honesty rules:
 *   - Source is the REAL trending query, reused as-is through
 *     GET /api/posts?tab=trending — public posts from the last
 *     7 days scored likes + 2·comments + 3·reposts server-side. The
 *     rail never queries posts directly and never re-implements the
 *     scoring, so it cannot leak non-public posts and cannot drift
 *     from the feed's definition of trending.
 *   - Only real counters are shown (likes / comments / reposts from
 *     the post DTO). There are no view counts and no hashtag metrics
 *     in the product, so none are rendered.
 *   - There is NO "Featured Creator" card: no featured flag or
 *     curation exists for users (audit §5), so the card is deferred
 *     rather than faked.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { Avatar } from "@/components/feed/Avatar";
import type { PostDTO } from "@/components/feed/types";

const RAIL_LIMIT = 5;

type RailState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; posts: PostDTO[] };

/** Short label for posts whose body text is empty (attachment-led). */
function excerpt(post: PostDTO): string {
  const text = post.content.trim();
  if (text) return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  switch (post.postType) {
    case "poll":
      return post.poll?.question ?? "Poll";
    case "link":
      return post.link?.title ?? "Shared a link";
    case "music":
      return post.music
        ? `${post.music.title}${post.music.artist ? ` — ${post.music.artist}` : ""}`
        : "Shared music";
    case "project":
      return post.projectRef?.name ?? "Shared a project";
    case "image":
      return "Shared an image";
    case "video":
      return "Shared a video";
    default:
      return "Post";
  }
}

export default function TrendingRail() {
  const { tokens } = useTheme();
  const [state, setState] = useState<RailState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/posts?tab=trending&limit=${RAIL_LIMIT}`);
        if (!res.ok) throw new Error(`Trending request failed (${res.status})`);
        const data = await res.json();
        const posts: PostDTO[] = Array.isArray(data.posts) ? data.posts : [];
        if (!cancelled) setState({ status: "ready", posts });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-label="Trending now"
      className="rounded-2xl border p-4"
      style={{
        backgroundColor: tokens.surface,
        borderColor: tokens.border,
      }}
    >
      <div className="flex items-center gap-2">
        <Flame size={16} aria-hidden style={{ color: tokens.primary }} />
        <h2 className="text-sm font-bold" style={{ color: tokens.text }}>
          Trending now
        </h2>
      </div>
      <p className="mt-1 text-xs" style={{ color: tokens.textMuted }}>
        Top community posts from the last 7 days
      </p>

      {state.status === "loading" && (
        <div className="mt-4 flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span
                className="h-8 w-8 shrink-0 animate-pulse rounded-full"
                style={{ backgroundColor: tokens.surfaceElevated }}
              />
              <span className="flex-1 space-y-1.5 pt-0.5">
                <span
                  className="block h-3 w-2/3 animate-pulse rounded"
                  style={{ backgroundColor: tokens.surfaceElevated }}
                />
                <span
                  className="block h-3 w-full animate-pulse rounded"
                  style={{ backgroundColor: tokens.surfaceElevated }}
                />
              </span>
            </div>
          ))}
        </div>
      )}

      {state.status === "error" && (
        <p className="mt-4 text-sm" style={{ color: tokens.textMuted }}>
          Trending is unavailable right now.
        </p>
      )}

      {state.status === "ready" && state.posts.length === 0 && (
        <p className="mt-4 text-sm" style={{ color: tokens.textMuted }}>
          Nothing trending yet — posts pick up likes, comments and
          reposts here as the community gets talking.
        </p>
      )}

      {state.status === "ready" && state.posts.length > 0 && (
        <ul className="mt-2 flex flex-col">
          {state.posts.map((post) => (
            <li
              key={post.id}
              className="border-b last:border-b-0"
              style={{ borderColor: tokens.border }}
            >
              <Link
                href={`/post/${post.id}`}
                className="flex items-start gap-2.5 py-3"
              >
                <Avatar
                  src={post.author.avatarUrl}
                  name={post.author.displayName}
                  size={32}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-sm font-semibold"
                    style={{ color: tokens.text }}
                  >
                    {post.author.displayName}
                    <span
                      className="ml-1.5 font-normal"
                      style={{ color: tokens.textMuted }}
                    >
                      @{post.author.username}
                    </span>
                  </span>
                  <span
                    className="mt-0.5 block text-sm leading-snug"
                    style={{ color: tokens.textMuted }}
                  >
                    {excerpt(post)}
                  </span>
                  <span
                    className="mt-1.5 flex items-center gap-3 text-xs tabular-nums"
                    style={{ color: tokens.textMuted }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Heart size={12} aria-hidden /> {post.counts.likes}
                      <span className="sr-only">likes</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle size={12} aria-hidden /> {post.counts.comments}
                      <span className="sr-only">comments</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Repeat2 size={12} aria-hidden /> {post.counts.reposts}
                      <span className="sr-only">reposts</span>
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
