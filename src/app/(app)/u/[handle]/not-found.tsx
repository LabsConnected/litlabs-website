"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";

/** Shown when GET /api/users/by-username/[handle] returns 404. */
export default function ProfileNotFound() {
  const { tokens } = useTheme();
  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 px-3 pb-28">
      <div
        className="mt-8 rounded-2xl border p-8 text-center"
        style={{
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        }}
      >
        <div className="mb-3 text-4xl" aria-hidden="true">
          👤
        </div>
        <h1
          className="text-lg font-bold tracking-tight"
          style={{ color: tokens.text }}
        >
          This profile doesn&apos;t exist
        </h1>
        <p className="mt-2 text-sm" style={{ color: tokens.textMuted }}>
          The handle you&apos;re looking for isn&apos;t on LiTTree, or the
          profile was removed.
        </p>
        <Link
          href="/discover"
          className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-lg px-6 text-sm font-bold"
          style={{
            backgroundColor: tokens.primary,
            color: tokens.textInverse,
          }}
        >
          Back to Discover
        </Link>
      </div>
    </div>
  );
}
