"use client";

import { useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  Globe,
  Aperture,
  Briefcase,
  Hash,
  Music2,
  MessageCircle,
  Cloud,
} from "lucide-react";
import { type SocialPost } from "./PostCard";

interface ContentCalendarProps {
  posts: SocialPost[];
}

const PLATFORMS: Record<
  string,
  { label: string; color: string; icon: LucideIcon }
> = {
  facebook: { label: "Facebook", color: "#1877f2", icon: Globe },
  instagram: { label: "Instagram", color: "#e1306c", icon: Aperture },
  linkedin: { label: "LinkedIn", color: "#0a66c2", icon: Briefcase },
  x: { label: "X", color: "#e2e2e8", icon: Hash },
  tiktok: { label: "TikTok", color: "#ff0050", icon: Music2 },
  reddit: { label: "Reddit", color: "#ff4500", icon: MessageCircle },
  bluesky: { label: "Bluesky", color: "#3b82f6", icon: Cloud },
};

const STATUS_DOT: Record<SocialPost["status"], string> = {
  draft: "#fbbf24",
  approved: "#22c55e",
  scheduled: "#3b82f6",
  posted: "#10b981",
  failed: "#ef4444",
  rejected: "#6b7280",
};

function formatDateKey(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function ContentCalendar({ posts }: ContentCalendarProps) {
  const { resolvedColors: T } = useTheme();

  const groups = useMemo(() => {
    const map: Record<string, SocialPost[]> = {};
    const sorted = [...posts].sort(
      (a, b) =>
        new Date(a.scheduled_at || a.created_at).getTime() -
        new Date(b.scheduled_at || b.created_at).getTime(),
    );
    sorted.forEach((post) => {
      const key = formatDateKey(post.scheduled_at || post.created_at);
      map[key] = map[key] || [];
      map[key].push(post);
    });
    return map;
  }, [posts]);

  const dates = Object.keys(groups);

  if (dates.length === 0) {
    return (
      <div
        className="glass-card rounded-xl p-8 text-center"
        style={{ borderColor: T.borderColor + "30" }}
      >
        <CalendarDays
          size={32}
          className="mx-auto mb-3"
          style={{ color: T.textMuted }}
        />
        <p className="text-sm font-bold" style={{ color: T.textColor }}>
          No scheduled posts
        </p>
        <p className="text-xs mt-1" style={{ color: T.textMuted }}>
          Approve drafts to see them on your calendar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-black" style={{ color: T.textColor }}>
        Content Calendar
      </h2>
      <div className="relative pl-4">
        <div
          className="absolute left-4 top-2 bottom-2 w-px"
          style={{ backgroundColor: T.borderColor + "40" }}
        />
        {dates.map((date) => (
          <div key={date} className="relative mb-6 last:mb-0">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: T.accentColor }}
              />
              <span
                className="text-xs font-black uppercase tracking-wider"
                style={{ color: T.accentColor }}
              >
                {date}
              </span>
            </div>
            <div className="space-y-3 pl-5">
              {groups[date].map((post) => {
                const platformKey = post.platform.toLowerCase();
                const platform = PLATFORMS[platformKey] || {
                  label: post.platform,
                  color: T.accentColor,
                  icon: Globe,
                };
                const Icon = platform.icon;
                return (
                  <div
                    key={post.id}
                    className="glass-card rounded-lg p-3 flex items-start gap-3"
                    style={{ borderColor: T.borderColor + "30" }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: platform.color + "15",
                        border: `1px solid ${platform.color}30`,
                      }}
                    >
                      <Icon size={16} style={{ color: platform.color }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-xs font-bold"
                          style={{ color: T.textColor }}
                        >
                          {platform.label}
                        </span>
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: STATUS_DOT[post.status] }}
                        />
                        <span
                          className="text-[10px] font-medium uppercase"
                          style={{ color: T.textMuted }}
                        >
                          {post.status}
                        </span>
                      </div>
                      <p
                        className="text-xs line-clamp-2"
                        style={{ color: T.textMuted }}
                      >
                        {post.caption}
                      </p>
                      {post.scheduled_at && (
                        <p
                          className="text-[10px] mt-1.5"
                          style={{ color: T.textMuted }}
                        >
                          {new Date(post.scheduled_at).toLocaleTimeString(
                            undefined,
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
