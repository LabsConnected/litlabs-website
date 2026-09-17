"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Heart, Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PostDTO } from "./types";

/** 12 approved reaction emoji. */
export const APPROVED_REACTIONS = [
  "❤️", "🔥", "👍", "👏", "😂", "😮",
  "😢", "😡", "🎉", "💯", "🤝", "🚀",
] as const;

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * Like button + emoji-reaction popover with optimistic updates and rollback.
 * All mutations await the response before claiming persistence.
 */
export function ReactionBar({
  post,
  onUpdate,
  onAuthRequired,
}: {
  post: PostDTO;
  onUpdate: (post: PostDTO) => void;
  onAuthRequired: () => void;
}) {
  const { tokens } = useTheme();
  const { isSignedIn } = useClerkAuth();
  const [reaction, setReaction] = useState<string | null>(post.viewer.reaction);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const close = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [popoverOpen]);

  // Optimistic like-toggles already flow through post.counts.likes via onUpdate;
  // a local emoji reaction adds one displayed reaction count on top.
  const likeCount = post.counts.likes + (reaction ? 1 : 0);

  const toggleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSignedIn) {
      onAuthRequired();
      return;
    }
    const prev = post;
    const next: PostDTO = {
      ...post,
      viewer: { ...post.viewer, liked: !post.viewer.liked },
      counts: { ...post.counts, likes: post.counts.likes + (post.viewer.liked ? -1 : 1) },
    };
    onUpdate(next); // optimistic
    try {
      const res = await fetch(`/api/posts/${post.id}/like`, {
        method: post.viewer.liked ? "DELETE" : "POST",
      });
      if (res.status === 401) {
        onUpdate(prev);
        onAuthRequired();
        return;
      }
      if (!res.ok) throw new Error("like failed");
      const data = await res.json();
      if (typeof data?.likes === "number") {
        onUpdate({ ...next, counts: { ...next.counts, likes: data.likes } });
      }
    } catch {
      onUpdate(prev); // rollback
    }
  };

  const setEmojiReaction = async (emoji: string | null) => {
    setPopoverOpen(false);
    if (!isSignedIn) {
      onAuthRequired();
      return;
    }
    const prev = post;
    const removing = reaction === emoji;
    const target = removing ? null : emoji;
    const next: PostDTO = {
      ...post,
      viewer: { ...post.viewer, reaction: target },
    };
    setReaction(target);
    onUpdate(next); // optimistic
    try {
      let res: Response;
      if (target) {
        res = await fetch(`/api/posts/${post.id}/reactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji: target }),
        });
      } else {
        res = await fetch(`/api/posts/${post.id}/reactions`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        });
      }
      if (res.status === 401) {
        setReaction(prev.viewer.reaction);
        onUpdate(prev);
        onAuthRequired();
        return;
      }
      if (!res.ok) throw new Error("reaction failed");
    } catch {
      setReaction(prev.viewer.reaction);
      onUpdate(prev); // rollback
    }
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={post.viewer.liked}
          aria-label={post.viewer.liked ? "Unlike" : "Like"}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-2 transition-opacity hover:opacity-80"
          style={{ color: post.viewer.liked ? tokens.danger : tokens.textMuted }}
        >
          <Heart size={20} fill={post.viewer.liked ? "currentColor" : "none"} />
          {likeCount > 0 && (
            <span className="text-xs font-semibold tabular-nums">{formatCount(likeCount)}</span>
          )}
        </button>

        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPopoverOpen((o) => !o);
            }}
            aria-label="Add a reaction"
            aria-expanded={popoverOpen}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-2 text-xl leading-none transition-opacity hover:opacity-80"
            style={{ color: tokens.textMuted }}
            title="React"
          >
            {reaction ?? <Smile size={20} />}
          </button>
          {popoverOpen && (
            <div
              role="dialog"
              aria-label="Choose a reaction"
              className="absolute bottom-11 left-0 z-50 grid w-max grid-cols-6 gap-1 rounded-xl border p-2 shadow-xl"
              style={{ backgroundColor: tokens.surfaceElevated, borderColor: tokens.border }}
            >
              {APPROVED_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setEmojiReaction(emoji)}
                  aria-label={`React with ${emoji}`}
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-lg text-2xl transition-transform hover:scale-110",
                    reaction === emoji && "ring-2",
                  )}
                  style={reaction === emoji ? { ["--tw-ring-color" as string]: tokens.primary } : undefined}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { formatCount };
