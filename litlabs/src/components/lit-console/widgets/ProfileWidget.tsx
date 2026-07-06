"use client";

import Link from "next/link";
import Image from "next/image";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useUser } from "@clerk/nextjs";
import { BentoCard } from "@/components/site/BentoCard";
import { User, Sparkles } from "lucide-react";
import { LC } from "../lit-console-theme";

export function ProfileWidget() {
  const { profile } = useProfile();
  const { isSignedIn } = useClerkAuth();
  const { user } = useUser();

  const displayName = user?.firstName || profile.displayName || "Creator";
  const avatarUrl = user?.imageUrl || profile.avatarUrl || "";
  const username = user?.username || profile.username || "creator";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <BentoCard
      title="My Profile"
      icon={<User size={14} />}
      action={
        <Link
          href="/profile"
          className="text-[10px] font-bold uppercase tracking-wider transition hover:opacity-70"
          style={{ color: LC.accentCyan }}
        >
          Edit
        </Link>
      }
    >
      <div className="flex items-center gap-3 mb-4">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt="avatar"
            width={56}
            height={56}
            className="w-14 h-14 rounded-full object-cover border-2"
            style={{ borderColor: LC.accentCyan }}
            unoptimized
          />
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center font-black text-sm border-2"
            style={{ borderColor: LC.accentCyan, backgroundColor: LC.bgSecondary, color: LC.accentCyan }}
          >
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-base font-black truncate" style={{ color: LC.text }}>
            {displayName}
          </div>
          <div className="text-[10px]" style={{ color: LC.textMuted }}>
            @{username}
          </div>
          <div className="flex items-center gap-1 mt-1">
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: LC.success, boxShadow: `0 0 6px ${LC.success}` }}
            />
            <span className="text-[9px] font-bold" style={{ color: LC.success }}>
              {isSignedIn ? "Online" : "Guest"}
            </span>
          </div>
        </div>
      </div>

      <div
        className="rounded-lg border p-2.5 mb-3 text-[11px] leading-relaxed"
        style={{ borderColor: `${LC.border}40`, backgroundColor: LC.bgSecondary, color: LC.textMuted }}
      >
        {profile.bio}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {profile.interests.slice(0, 4).map((interest) => (
          <span
            key={interest}
            className="px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider"
            style={{
              border: `1px solid ${LC.accentCyan}30`,
              color: LC.accentCyan,
              backgroundColor: `${LC.accentCyan}10`,
            }}
          >
            {interest}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        {(profile.badges || []).slice(0, 4).map((badge) => (
          <div
            key={badge}
            className="px-2 py-1.5 rounded text-[9px] font-bold text-center"
            style={{ backgroundColor: LC.bgSecondary, color: LC.textMuted, border: `1px solid ${LC.border}40` }}
          >
            {badge}
          </div>
        ))}
      </div>

      <Link
        href="/profile"
        className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-[10px] font-bold transition-all hover:scale-[1.02]"
        style={{ backgroundColor: LC.accentCyan, color: "#000" }}
      >
        <Sparkles size={11} /> View Full Profile
      </Link>
    </BentoCard>
  );
}
