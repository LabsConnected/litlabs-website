"use client";

import { useTheme } from "@/context/ThemeContext";
import { Skeleton } from "@/components/ui";

function PostCardSkeleton() {
  const { tokens } = useTheme();
  return (
    <div
      className="border-b px-3 py-3 sm:px-4 sm:py-4 min-w-0"
      style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
      aria-hidden
    >
      <div className="flex items-start gap-2.5">
        <Skeleton className="!rounded-full" width={44} height={44} />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton height={12} width="40%" />
          <Skeleton height={10} width="25%" />
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Skeleton height={14} width="95%" />
        <Skeleton height={14} width="70%" />
      </div>
      <Skeleton className="mt-3" height={120} width="100%" />
      <div className="mt-3 flex justify-between">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={28} width={44} />
        ))}
      </div>
    </div>
  );
}

/** 5 post-shaped skeletons for the initial feed load. */
export function FeedSkeleton() {
  return (
    <div aria-label="Loading feed">
      {[0, 1, 2, 3, 4].map((i) => (
        <PostCardSkeleton key={i} />
      ))}
    </div>
  );
}
