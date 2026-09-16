"use client";

import { useTheme } from "@/context/ThemeContext";

/** Skeleton shown while the post/thread route loads. */
export default function PostLoading() {
  const { tokens } = useTheme();
  const block = { backgroundColor: tokens.surfaceElevated };
  return (
    <div
      className="mx-auto w-full max-w-2xl min-w-0 px-3 pb-28"
      aria-busy="true"
      aria-label="Loading post"
    >
      <div
        className="h-11 w-28 animate-pulse rounded-lg"
        style={{ backgroundColor: tokens.surface }}
      />
      <div
        className="mt-2 animate-pulse rounded-2xl border p-4"
        style={{
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        }}
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-full" style={block} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded" style={block} />
            <div className="h-3 w-1/4 rounded" style={block} />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full rounded" style={block} />
          <div className="h-3 w-5/6 rounded" style={block} />
          <div className="h-3 w-2/3 rounded" style={block} />
        </div>
      </div>
      <div
        className="mt-3 animate-pulse rounded-2xl border p-4"
        style={{
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        }}
      >
        <div className="h-3 w-1/4 rounded" style={block} />
        <div className="mt-3 space-y-2">
          <div className="h-3 w-full rounded" style={block} />
          <div className="h-3 w-4/5 rounded" style={block} />
        </div>
      </div>
    </div>
  );
}
