"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useAppUser } from "@/hooks/useClerkAuth";
export function YourWorldCard() {
  const T = useTheme().resolvedColors;
  const { profile } = useProfile();
  const { user } = useAppUser();
  const displayName =
    profile?.displayName || user?.firstName || user?.username || "Member";
  const username = profile?.username || user?.username || "member";
  const bio = profile?.bio || "No bio yet";
  const avatarUrl = profile?.avatarUrl || user?.imageUrl || null;

  return (
    <div className="flex items-center gap-4">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={displayName}
          className="h-14 w-14 rounded-full object-cover"
          style={{ border: `1px solid ${T.borderColor}40` }}
        />
      ) : (
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-black"
          style={{
            background: `${T.accentColor}15`,
            color: T.accentColor,
            border: `1px solid ${T.accentColor}30`,
          }}
        >
          {displayName[0]?.toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold truncate" style={{ color: T.headerColor }}>
          {displayName}
        </div>
        <div className="text-xs opacity-50 truncate">@{username}</div>
        <div className="text-xs opacity-40 truncate mt-1">{bio}</div>
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        <Link
          href="/settings/profile"
          className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80 text-center"
          style={{
            background: `${T.accentColor}20`,
            color: T.accentColor,
            minHeight: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Edit Profile
        </Link>
        <Link
          href={`/discover?creator=${username}`}
          className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80 text-center"
          style={{
            background: `${T.borderColor}20`,
            color: T.textColor,
            minHeight: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          View Profile
        </Link>
      </div>
    </div>
  );
}
