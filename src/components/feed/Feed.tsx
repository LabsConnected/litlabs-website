"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Flame, Sparkles, Users, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState } from "@/components/ui";
import type { FeedTab, PostDTO } from "./types";
import { PostCard } from "./PostCard";
import { FeedSkeleton } from "./FeedSkeleton";
import { Toast, useToastState } from "./Toast";

export interface FeedHandle {
  /** Prepend a freshly-published post to the top of the list. */
  prependPost: (post: PostDTO) => void;
}

const TABS: { id: FeedTab; label: string; icon: typeof Flame }[] = [
  { id: "for-you", label: "For You", icon: Sparkles },
  { id: "following", label: "Following", icon: Users },
  { id: "trending", label: "Trending", icon: Flame },
];

const PAGE_LIMIT = 20;

const TAB_EMPTY: Record<FeedTab, { title: string; description: string }> = {
  "for-you": {
    title: "No posts yet",
    description: "Be the first to share something with the community.",
  },
  following: {
    title: "Nothing from people you follow",
    description: "Follow creators to see their latest posts here.",
  },
  trending: {
    title: "Nothing trending right now",
    description: "Trending posts will show up here as the community gets talking.",
  },
};

/**
 * Canonical community feed: sticky tab bar, cursor-paginated infinite scroll,
 * skeletons / empty / error states. Renders only backend-provided posts —
 * never fake data.
 */
export const Feed = forwardRef<FeedHandle, { initialTab?: FeedTab }>(function Feed(
  { initialTab = "for-you" },
  ref,
) {
  const { tokens } = useTheme();
  const { isSignedIn } = useClerkAuth();
  const [toast, showToast] = useToastState();

  const [tab, setTab] = useState<FeedTab>(initialTab);
  const [posts, setPosts] = useState<PostDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  const fetchPage = useCallback(
    async (feedTab: FeedTab, cur: string | null): Promise<void> => {
      const params = new URLSearchParams({
        tab: feedTab,
        limit: String(PAGE_LIMIT),
      });
      if (cur) params.set("cursor", cur);
      const res = await fetch(`/api/posts?${params.toString()}`);
      if (!res.ok) throw new Error(`Feed request failed (${res.status})`);
      const data = await res.json();
      const page: PostDTO[] = Array.isArray(data.posts) ? data.posts : [];
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.filter((p) => !seen.has(p.id))];
      });
      setCursor(data.nextCursor ?? null);
    },
    [],
  );

  const loadInitial = useCallback(
    async (feedTab: FeedTab, myRequest: number) => {
      setInitialLoading(true);
      setError(null);
      setPosts([]);
      setCursor(null);
      try {
        await fetchPage(feedTab, null);
      } catch {
        if (requestId.current !== myRequest) return;
        setError("Couldn't load the feed. Check your connection and try again.");
      } finally {
        if (requestId.current === myRequest) setInitialLoading(false);
      }
    },
    [fetchPage],
  );

  const switchTab = (next: FeedTab) => {
    if (next === tab) return;
    requestId.current += 1;
    setTab(next);
    loadInitial(next, requestId.current);
  };

  useEffect(() => {
    const myRequest = ++requestId.current;
    loadInitial(initialTab, myRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Infinite scroll: sentinel + IntersectionObserver, with a fallback
  // "Load more" button for environments without it.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && cursor && !loadingMore && !initialLoading && !error) {
          setLoadingMore(true);
          const myRequest = requestId.current;
          fetchPage(tab, cursor)
            .catch(() => {
              if (requestId.current === myRequest)
                showToast("Couldn't load more posts.", "error");
            })
            .finally(() => {
              if (requestId.current === myRequest) setLoadingMore(false);
            });
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, loadingMore, initialLoading, error, tab, fetchPage]);

  useImperativeHandle(ref, () => ({
    prependPost: (post: PostDTO) => {
      setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]));
    },
  }), []);

  const updatePost = useCallback((next: PostDTO) => {
    setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  }, []);

  const removePost = useCallback((id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const requireAuth = useCallback(() => {
    showToast("Sign in to like, repost and comment.", "info");
  }, [showToast]);

  const retry = () => loadInitial(tab, ++requestId.current);

  const empty = TAB_EMPTY[tab];

  return (
    <div className="min-w-0 overflow-x-hidden">
      {/* Sticky tab bar — 44px touch targets, active indicator */}
      <div
        className="sticky top-0 z-40"
        style={{ backgroundColor: tokens.background, borderBottom: `1px solid ${tokens.border}` }}
        role="tablist"
        aria-label="Feed"
      >
        <div className="mx-auto flex max-w-4xl">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => switchTab(id)}
                className={cn(
                  "relative flex min-h-[44px] flex-1 items-center justify-center gap-1.5 text-sm",
                  active ? "font-bold" : "font-medium",
                )}
                style={{ color: active ? tokens.text : tokens.textMuted }}
              >
                <Icon size={16} style={{ color: active ? tokens.primary : undefined }} />
                {label}
                {active && (
                  <span
                    className="absolute inset-x-6 bottom-0 h-[3px] rounded-full"
                    style={{ backgroundColor: tokens.primary }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-auto max-w-4xl min-w-0">
        {initialLoading ? (
          <FeedSkeleton />
        ) : error ? (
          <div className="p-4">
            <ErrorState
              title="Feed unavailable"
              description={error}
              action={
                <button
                  type="button"
                  onClick={retry}
                  className="min-h-[44px] rounded-xl px-6 text-sm font-bold"
                  style={{ backgroundColor: tokens.primary, color: tokens.textInverse }}
                >
                  Retry
                </button>
              }
            />
          </div>
        ) : posts.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={empty.title}
              description={empty.description}
              action={
                isSignedIn ? (
                  <Link
                    href="#composer"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-5 text-sm font-bold"
                    style={{ backgroundColor: tokens.primary, color: tokens.textInverse }}
                  >
                    <Plus size={16} /> Create a post
                  </Link>
                ) : (
                  <Link
                    href="/sign-in"
                    className="inline-flex min-h-[44px] items-center rounded-xl px-6 text-sm font-bold"
                    style={{ backgroundColor: tokens.primary, color: tokens.textInverse }}
                  >
                    Sign in to post
                  </Link>
                )
              }
            />
          </div>
        ) : (
          <div>
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onUpdate={updatePost}
                onDelete={removePost}
                onAuthRequired={requireAuth}
              />
            ))}
            <div ref={sentinelRef} aria-hidden />
            {loadingMore && (
              <div className="flex justify-center py-4" style={{ color: tokens.textMuted }}>
                <Loader2 size={20} className="animate-spin" aria-label="Loading more posts" />
              </div>
            )}
            {cursor && typeof IntersectionObserver === "undefined" && !loadingMore && (
              <div className="p-4 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setLoadingMore(true);
                    const myRequest = requestId.current;
                    fetchPage(tab, cursor)
                      .catch(() => {
                        if (requestId.current === myRequest)
                          showToast("Couldn't load more posts.", "error");
                      })
                      .finally(() => {
                        if (requestId.current === myRequest) setLoadingMore(false);
                      });
                  }}
                  className="min-h-[44px] rounded-xl border px-6 text-sm font-semibold"
                  style={{ borderColor: tokens.border, color: tokens.text }}
                >
                  Load more
                </button>
              </div>
            )}
            {!cursor && posts.length > 0 && (
              <div className="py-6 text-center text-xs" style={{ color: tokens.textMuted }}>
                You&rsquo;re all caught up.
              </div>
            )}
          </div>
        )}
      </div>

      <Toast toast={toast} />
    </div>
  );
});
