"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { PostCard } from "@/components/feed/PostCard";
import type { PostDTO } from "@/components/feed/types";

const PAGE_SIZE = 20;

/**
 * The profile's Posts tab: a real list backed by
 * GET /api/posts?authorId=<id>&cursor&limit, rendered with the shared
 * PostCard. Skeletons while loading, an honest empty state, and a retry
 * control on failure.
 */
export default function ProfilePosts({ authorId }: { authorId: string }) {
  const { tokens } = useTheme();
  const [posts, setPosts] = useState<PostDTO[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextCursor: string | null) => {
      if (nextCursor) {
        setLoadingMore(true);
      } else {
        setError(null);
      }
      try {
        const url =
          `/api/posts?authorId=${encodeURIComponent(authorId)}` +
          `&limit=${PAGE_SIZE}` +
          (nextCursor
            ? `&cursor=${encodeURIComponent(nextCursor)}`
            : "");
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Couldn't load posts (${res.status}).`);
        }
        const data = (await res.json().catch(() => null)) as {
          posts?: PostDTO[];
          nextCursor?: string | null;
        } | null;
        const fresh = Array.isArray(data?.posts) ? data.posts : [];
        setPosts((prev) => (nextCursor && prev ? [...prev, ...fresh] : fresh));
        setCursor(data?.nextCursor ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load posts.");
      } finally {
        setLoadingMore(false);
      }
    },
    [authorId],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  const cardStyle = {
    backgroundColor: tokens.surface,
    borderColor: tokens.border,
  };

  if (error && posts === null) {
    return (
      <div
        className="rounded-2xl border p-6 text-center"
        style={cardStyle}
        role="alert"
      >
        <p className="text-sm" style={{ color: tokens.text }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => load(null)}
          className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border px-5 text-sm font-bold"
          style={{ borderColor: tokens.border, color: tokens.text }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (posts === null) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading posts">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-2xl border p-4"
            style={cardStyle}
          >
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 rounded-full"
                style={{ backgroundColor: tokens.surfaceElevated }}
              />
              <div className="flex-1 space-y-2">
                <div
                  className="h-3 w-1/3 rounded"
                  style={{ backgroundColor: tokens.surfaceElevated }}
                />
                <div
                  className="h-3 w-1/4 rounded"
                  style={{ backgroundColor: tokens.surfaceElevated }}
                />
              </div>
            </div>
            <div
              className="mt-3 h-3 w-11/12 rounded"
              style={{ backgroundColor: tokens.surfaceElevated }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div
        className="rounded-2xl border p-8 text-center"
        style={cardStyle}
      >
        <p className="text-sm font-semibold" style={{ color: tokens.text }}>
          No posts yet
        </p>
        <p className="mt-1 text-sm" style={{ color: tokens.textMuted }}>
          Posts from this profile will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="space-y-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onUpdate={(updated) =>
              setPosts((prev) =>
                prev
                  ? prev.map((p) => (p.id === updated.id ? updated : p))
                  : prev,
              )
            }
            onDelete={(id) =>
              setPosts((prev) => (prev ? prev.filter((p) => p.id !== id) : prev))
            }
          />
        ))}
      </div>
      {cursor && (
        <button
          type="button"
          onClick={() => load(cursor)}
          disabled={loadingMore}
          className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border text-sm font-bold disabled:opacity-60"
          style={{ borderColor: tokens.border, color: tokens.text }}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
