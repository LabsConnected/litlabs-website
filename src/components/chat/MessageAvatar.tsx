"use client";

import { useState } from "react";
import { useAppUser } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";

function getInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

export function UserMessageAvatar({ size = 30 }: { size?: number }) {
  const { user } = useAppUser();
  const { profile } = useProfile();
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = user?.imageUrl || profile.avatarUrl;
  const identity =
    user?.fullName ||
    user?.firstName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    profile.displayName ||
    profile.username ||
    "User";
  const initials = getInitials(identity);

  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border font-black uppercase"
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderColor: "rgba(249,115,22,.42)",
        background: "linear-gradient(135deg, #f97316, #7c2d12)",
        boxShadow: "0 0 14px rgba(249,115,22,.18)",
        color: "white",
        fontSize: Math.max(9, Math.round(size * 0.34)),
      }}
      aria-label={`${identity}'s avatar`}
      title={identity}
    >
      {imageUrl && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}

export function LiTTMessageAvatar({ size = 32 }: { size?: number }) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-cyan-300/25 font-black text-cyan-100"
      style={{
        width: size,
        height: size,
        minWidth: size,
        background: "radial-gradient(circle at 30% 30%, #0f3d3e, #051a1a 70%)",
        boxShadow: "0 0 16px rgba(34,211,238,.2)",
        fontSize: Math.max(9, Math.round(size * 0.34)),
      }}
      aria-label="LiTT avatar"
      title="LiTT"
    >
      {!imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand/litt-mascot-hero.png"
          alt=""
          className="h-full w-full object-cover drop-shadow-[0_0_6px_rgba(103,232,249,.6)]"
          style={{ objectPosition: "50% 13%" }}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span aria-hidden="true">L</span>
      )}
    </div>
  );
}
