"use client";

import { useState } from "react";
import Link from "next/link";
import { MapPin, Link2, ArrowLeft } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import type { ProfileDTO } from "@/lib/social-server";
import FollowButton from "./FollowButton";
import ProfilePosts from "./ProfilePosts";

type TabId = "posts" | "about";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

/**
 * Minimal real public profile (Phase 1 shell). Every number and string
 * rendered here comes from GET /api/users/by-username/[handle] — there is
 * no placeholder content anywhere in this component.
 */
export default function ProfileClient({
  profile,
  handle,
  initialTab,
}: {
  profile: ProfileDTO;
  handle: string;
  initialTab: TabId;
}) {
  const { tokens } = useTheme();
  const [tab, setTab] = useState<TabId>(initialTab);
  const [followerCount, setFollowerCount] = useState(
    profile.counts.followers ?? 0,
  );

  const switchTab = (next: TabId) => {
    setTab(next);
    // Keep the URL shareable without a server round-trip.
    window.history.replaceState(null, "", `?tab=${next}`);
  };

  const websiteHref =
    profile.website == null
      ? null
      : /^https?:\/\//i.test(profile.website)
        ? profile.website
        : `https://${profile.website}`;

  const counts = [
    { label: "Posts", value: profile.counts.posts ?? 0 },
    { label: "Followers", value: followerCount },
    { label: "Following", value: profile.counts.following ?? 0 },
  ];

  return (
    <div className="min-w-0">
      <Link
        href="/discover"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold"
        style={{ color: tokens.textMuted }}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Discover
      </Link>

      {/* Header card */}
      <section
        className="mt-1 overflow-hidden rounded-2xl border"
        style={{
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        }}
        aria-label={`${profile.displayName} profile`}
      >
        {/* Cover */}
        <div
          className="relative h-32 w-full sm:h-40"
          style={
            profile.coverUrl
              ? { backgroundColor: tokens.surfaceElevated }
              : {
                  background: `linear-gradient(135deg, ${tokens.primary}, ${tokens.secondary})`,
                }
          }
        >
          {profile.coverUrl && (
            // Plain <img>: cover URLs are user-supplied and can point at
            // any host, outside next/image's remotePatterns allowlist.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.coverUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.45), transparent 60%)",
            }}
          />
        </div>

        <div className="px-4 pb-5">
          {/* Avatar */}
          <div className="-mt-10 mb-3">
            <div
              className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-4 text-2xl font-bold"
              style={{
                borderColor: tokens.surface,
                backgroundColor: profile.avatarUrl
                  ? tokens.surfaceElevated
                  : tokens.primary,
                color: tokens.textInverse,
              }}
            >
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt={profile.displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span aria-hidden="true">
                  {initials(profile.displayName || profile.username)}
                </span>
              )}
            </div>
          </div>

          {/* Name + follow */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1
                className="truncate text-xl font-bold tracking-tight"
                style={{ color: tokens.text }}
              >
                {profile.displayName}
              </h1>
              <p className="text-sm" style={{ color: tokens.textMuted }}>
                @{profile.username}
              </p>
            </div>
            <div className="shrink-0">
              <FollowButton
                targetUserId={profile.id}
                initialFollowing={profile.viewer.following ?? false}
                handle={handle}
                onCountChange={(delta) =>
                  setFollowerCount((c) => Math.max(0, c + delta))
                }
              />
            </div>
          </div>

          {profile.bio && (
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: tokens.text }}
            >
              {profile.bio}
            </p>
          )}

          {/* Location / website */}
          {(profile.location || websiteHref) && (
            <div
              className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
              style={{ color: tokens.textMuted }}
            >
              {profile.location && (
                <span className="inline-flex min-h-[24px] items-center gap-1">
                  <MapPin size={12} aria-hidden="true" />
                  {profile.location}
                </span>
              )}
              {websiteHref && (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[24px] items-center gap-1 break-all underline"
                  style={{ color: tokens.primary }}
                >
                  <Link2 size={12} aria-hidden="true" className="shrink-0" />
                  {profile.website}
                </a>
              )}
            </div>
          )}

          {/* Counts — real values from the API only */}
          <div
            className="mt-3 flex items-center gap-5 border-t pt-3"
            style={{ borderColor: tokens.border }}
          >
            {counts.map((c) => (
              <div key={c.label} className="min-w-0">
                <div
                  className="text-base font-bold tabular-nums"
                  style={{ color: tokens.text }}
                >
                  {c.value.toLocaleString()}
                </div>
                <div
                  className="text-xs"
                  style={{ color: tokens.textMuted }}
                >
                  {c.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div
        className="mt-3 flex gap-1 overflow-x-auto rounded-xl border p-1"
        style={{
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        }}
        role="tablist"
        aria-label="Profile sections"
      >
        {(
          [
            { id: "posts", label: "Posts" },
            { id: "about", label: "About" },
          ] as { id: TabId; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => switchTab(t.id)}
            className="min-h-[44px] min-w-[88px] flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-bold"
            style={
              tab === t.id
                ? {
                    backgroundColor: tokens.surfaceElevated,
                    color: tokens.primary,
                  }
                : { color: tokens.textMuted }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="mt-3 min-w-0">
        {tab === "posts" ? (
          <div role="tabpanel" aria-label="Posts">
            <ProfilePosts authorId={profile.id} />
          </div>
        ) : (
          <div
            role="tabpanel"
            aria-label="About"
            className="rounded-2xl border p-4"
            style={{
              backgroundColor: tokens.surface,
              borderColor: tokens.border,
            }}
          >
            <h2
              className="text-sm font-bold uppercase tracking-wider"
              style={{ color: tokens.textMuted }}
            >
              About
            </h2>
            <dl className="mt-2 space-y-3 text-sm">
              <div>
                <dt
                  className="text-xs uppercase tracking-wider"
                  style={{ color: tokens.textMuted }}
                >
                  Name
                </dt>
                <dd style={{ color: tokens.text }}>
                  {profile.displayName}
                </dd>
              </div>
              <div>
                <dt
                  className="text-xs uppercase tracking-wider"
                  style={{ color: tokens.textMuted }}
                >
                  Handle
                </dt>
                <dd style={{ color: tokens.text }}>@{profile.username}</dd>
              </div>
              {profile.bio && (
                <div>
                  <dt
                    className="text-xs uppercase tracking-wider"
                    style={{ color: tokens.textMuted }}
                  >
                    Bio
                  </dt>
                  <dd style={{ color: tokens.text }}>{profile.bio}</dd>
                </div>
              )}
              {profile.location && (
                <div>
                  <dt
                    className="text-xs uppercase tracking-wider"
                    style={{ color: tokens.textMuted }}
                  >
                    Location
                  </dt>
                  <dd style={{ color: tokens.text }}>
                    {profile.location}
                  </dd>
                </div>
              )}
              {websiteHref && (
                <div>
                  <dt
                    className="text-xs uppercase tracking-wider"
                    style={{ color: tokens.textMuted }}
                  >
                    Website
                  </dt>
                  <dd>
                    <a
                      href={websiteHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all underline"
                      style={{ color: tokens.primary }}
                    >
                      {profile.website}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
