"use client";

import { useTheme } from "@/context/ThemeContext";

/** Skeleton shown while the public profile loads. */
export default function ProfileLoading() {
  const { tokens } = useTheme();
  const block = { backgroundColor: tokens.surfaceElevated };
  return (
    <div
      className="mx-auto w-full max-w-2xl min-w-0 px-3 pb-28"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div
        className="animate-pulse overflow-hidden rounded-2xl border"
        style={{
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        }}
      >
        <div className="h-32 w-full sm:h-40" style={block} />
        <div className="px-4 pb-5">
          <div
            className="-mt-10 mb-3 h-20 w-20 rounded-full"
            style={{ backgroundColor: tokens.surfaceElevated }}
          />
          <div className="h-5 w-1/2 rounded" style={block} />
          <div className="mt-2 h-3 w-1/3 rounded" style={block} />
          <div className="mt-3 h-3 w-full rounded" style={block} />
          <div className="mt-2 h-3 w-4/5 rounded" style={block} />
          <div className="mt-4 flex gap-5">
            <div className="h-8 w-14 rounded" style={block} />
            <div className="h-8 w-14 rounded" style={block} />
            <div className="h-8 w-14 rounded" style={block} />
          </div>
        </div>
      </div>
      <div
        className="mt-3 h-[52px] animate-pulse rounded-xl border"
        style={{
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        }}
      />
    </div>
  );
}
