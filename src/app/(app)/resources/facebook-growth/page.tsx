"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

export default function FacebookGrowthChecklistPage() {
  const { tokens } = useTheme();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-xs font-bold transition-opacity hover:opacity-80"
        style={{ color: tokens.textMuted }}
      >
        <ArrowLeft size={14} /> Back to dashboard
      </Link>

      <div
        className="mt-6 rounded-2xl border p-6"
        style={{
          borderColor: `${tokens.border}40`,
          backgroundColor: `${tokens.surface}90`,
        }}
      >
        <h1 className="text-2xl font-black" style={{ color: tokens.text }}>
          Facebook Growth Checklist
        </h1>
        <p className="mt-2 text-sm" style={{ color: tokens.textMuted }}>
          Open the checklist file in this workspace:
          <code className="ml-2 rounded border px-2 py-1 text-xs">FACEBOOK_FOLLOWER_GROWTH_CHECKLIST.md</code>
        </p>
        <p className="mt-4 text-sm" style={{ color: tokens.textMuted }}>
          Current goal: 125 ? 500 followers.
        </p>
      </div>
    </div>
  );
}