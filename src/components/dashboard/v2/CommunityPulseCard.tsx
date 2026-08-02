"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { ActionButton, EmptyState, SkeletonCard } from "./DashboardV2Primitives";
import { Icon, timeAgo } from "./dashboard-v2-utils";
import type { SocialPost } from "./dashboard-v2-types";

export function CommunityPulseCard({
  socialPosts,
  socialLoading,
  socialError,
  socialMock,
}: {
  socialPosts: SocialPost[];
  socialLoading: boolean;
  socialError: string | null;
  socialMock: boolean;
}) {
  const T = useTheme().resolvedColors;

  if (socialLoading) return <SkeletonCard />;

  if (socialError) {
    return (
      <EmptyState
        icon="alert"
        title="Community activity could not be loaded."
        message="Try again later."
        color="#ef4444"
      />
    );
  }

  if (socialMock) {
    return (
      <EmptyState
        icon="globe"
        title="Community feed is in demo mode."
        message="Real posts will appear once the community is active."
        color="#F97316"
        action={
          <ActionButton
            href="/discover"
            label="Open Discover"
            icon="globe"
            color="#F97316"
          />
        }
      />
    );
  }

  if (socialPosts.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="Nothing new in your community yet."
        message="Be the first to share something on Discover."
        color="#ff00a0"
        action={
          <ActionButton
            href="/discover"
            label="Open Discover"
            icon="globe"
            color="#ff00a0"
          />
        }
      />
    );
  }

  return (
    <div className="space-y-2.5">
      {socialPosts.slice(0, 4).map((post) => (
        <Link
          key={post.id}
          href="/discover"
          className="block rounded-xl p-3 transition-all hover:opacity-80"
          style={{ background: `${T.boxBg}80`, border: `1px solid ${T.borderColor}20` }}
        >
          <div className="flex items-center gap-2 mb-1">
            {post.author?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.author.avatar_url}
                alt={post.author.name}
                className="h-6 w-6 rounded-full object-cover"
              />
            ) : (
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black"
                style={{ background: "#ff00a015", color: "#ff00a0" }}
              >
                {(post.author?.name || "U")[0]?.toUpperCase()}
              </div>
            )}
            <span className="text-xs font-bold truncate" style={{ color: T.headerColor }}>
              {post.author?.name || "Unknown"}
            </span>
            <span className="text-xs opacity-30">· {timeAgo(post.created_at)}</span>
          </div>
          <p className="text-xs opacity-60 truncate ml-8">{post.content}</p>
          <div className="flex items-center gap-3 mt-1.5 ml-8 text-xs opacity-30">
            <span className="flex items-center gap-1">
              <Icon name="heart" size={10} />
              {post.likes_count}
            </span>
            <span className="flex items-center gap-1">
              <Icon name="comment" size={10} />
              {post.comments_count}
            </span>
          </div>
        </Link>
      ))}
      <Link
        href="/discover"
        className="inline-flex items-center gap-1 text-xs font-bold transition-all hover:opacity-80"
        style={{ color: "#ff00a0" }}
      >
        Open Discover <Icon name="arrow" size={10} />
      </Link>
    </div>
  );
}
