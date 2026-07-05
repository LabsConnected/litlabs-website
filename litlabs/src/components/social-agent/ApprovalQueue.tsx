"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Inbox, Plus } from "lucide-react";
import PostCard, { type SocialPost } from "./PostCard";
import PlatformTabs from "./PlatformTabs";

interface ApprovalQueueProps {
  posts: SocialPost[];
  onAction: (
    postId: string,
    action: string,
    data?: Record<string, string>,
  ) => void;
  loading?: boolean;
}

function SkeletonCard() {
  return (
    <div className="glass-card rounded-xl p-4 space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/5" />
          <div className="w-20 h-4 rounded bg-white/5" />
        </div>
        <div className="w-16 h-5 rounded-full bg-white/5" />
      </div>
      <div className="space-y-2">
        <div className="w-full h-3 rounded bg-white/5" />
        <div className="w-full h-3 rounded bg-white/5" />
        <div className="w-2/3 h-3 rounded bg-white/5" />
      </div>
      <div className="flex gap-2 pt-2">
        <div className="flex-1 h-8 rounded-lg bg-white/5" />
        <div className="flex-1 h-8 rounded-lg bg-white/5" />
        <div className="flex-1 h-8 rounded-lg bg-white/5" />
      </div>
    </div>
  );
}

export default function ApprovalQueue({
  posts,
  onAction,
  loading,
}: ApprovalQueueProps) {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [selected, setSelected] = useState<string>("all");

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: posts.length };
    posts.forEach((p) => {
      const key = p.platform.toLowerCase();
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [posts]);

  const filtered = useMemo(() => {
    if (selected === "all") return posts;
    return posts.filter(
      (p) => p.platform.toLowerCase() === selected.toLowerCase(),
    );
  }, [posts, selected]);

  if (!isLoaded || loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-48 rounded-lg bg-white/5 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-black" style={{ color: T.textColor }}>
          Approval Queue
        </h2>
        <Link
          href="/social-agent/new"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: T.accentColor, color: T.bgColor }}
        >
          <Plus size={14} /> New Post
        </Link>
      </div>

      <PlatformTabs
        selected={selected}
        onChange={setSelected}
        counts={counts}
      />

      {!isSignedIn ? (
        <div
          className="glass-card rounded-xl p-8 text-center"
          style={{ borderColor: T.borderColor + "30" }}
        >
          <Inbox
            size={32}
            className="mx-auto mb-3"
            style={{ color: T.textMuted }}
          />
          <p className="text-sm font-bold" style={{ color: T.textColor }}>
            Sign in to manage your approval queue
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="glass-card rounded-xl p-8 text-center"
          style={{ borderColor: T.borderColor + "30" }}
        >
          <Inbox
            size={32}
            className="mx-auto mb-3"
            style={{ color: T.textMuted }}
          />
          <p className="text-sm font-bold mb-1" style={{ color: T.textColor }}>
            No posts waiting for approval
          </p>
          <p className="text-xs" style={{ color: T.textMuted }}>
            Generate new drafts or adjust your platform filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onApprove={(id) => onAction(id, "approve")}
              onReject={(id) => onAction(id, "reject")}
              onEdit={(id, caption) => onAction(id, "edit", { caption })}
              onRegenerate={(id) => onAction(id, "regenerate")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
