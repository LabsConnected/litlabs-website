"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  X,
  Pencil,
  RefreshCw,
  Globe,
  Aperture,
  Briefcase,
  Hash,
  Music2,
  MessageCircle,
  Cloud,
} from "lucide-react";

export type SocialPost = {
  id: string;
  platform: string;
  caption: string;
  image_prompt: string;
  hashtags: string[];
  status: "draft" | "approved" | "scheduled" | "posted" | "failed" | "rejected";
  scheduled_at: string | null;
  created_at: string;
};

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

const STATUS_COLORS: Record<
  SocialPost["status"],
  { bg: string; text: string; border: string }
> = {
  draft: { bg: "#fbbf2418", text: "#fbbf24", border: "#fbbf2430" },
  approved: { bg: "#22c55e18", text: "#22c55e", border: "#22c55e30" },
  scheduled: { bg: "#3b82f618", text: "#3b82f6", border: "#3b82f630" },
  posted: { bg: "#10b98118", text: "#10b981", border: "#10b98130" },
  failed: { bg: "#ef444418", text: "#ef4444", border: "#ef444430" },
  rejected: { bg: "#6b728018", text: "#6b7280", border: "#6b728030" },
};

interface PostCardProps {
  post: SocialPost;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (id: string, caption: string) => void;
  onRegenerate?: (id: string) => void;
}

export default function PostCard({
  post,
  onApprove,
  onReject,
  onEdit,
  onRegenerate,
}: PostCardProps) {
  const { resolvedColors: T } = useTheme();
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(post.caption);

  const platformKey = post.platform.toLowerCase();
  const platform = PLATFORMS[platformKey] || {
    label: post.platform,
    color: T.accentColor,
    icon: Globe,
  };
  const PlatformIcon = platform.icon;
  const statusStyle = STATUS_COLORS[post.status];

  const handleSave = () => {
    onEdit(post.id, caption);
    setEditing(false);
  };

  const formattedDate = post.scheduled_at
    ? new Date(post.scheduled_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date(post.created_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });

  return (
    <div
      className="glass-card rounded-xl p-4 flex flex-col gap-3 hover-lift"
      style={{ borderColor: T.borderColor + "30" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              backgroundColor: platform.color + "15",
              border: `1px solid ${platform.color}30`,
            }}
          >
            <PlatformIcon size={16} style={{ color: platform.color }} />
          </div>
          <span className="text-sm font-bold" style={{ color: T.textColor }}>
            {platform.label}
          </span>
        </div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border"
          style={{
            backgroundColor: statusStyle.bg,
            color: statusStyle.text,
            borderColor: statusStyle.border,
          }}
        >
          {post.status}
        </span>
      </div>

      {editing ? (
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          className="w-full min-h-[100px] rounded-lg p-3 text-sm resize-none outline-none focus:ring-2"
          style={{
            backgroundColor: T.bgColor,
            color: T.textColor,
            border: `1px solid ${T.borderColor}40`,
          }}
        />
      ) : (
        <p className="text-sm leading-relaxed" style={{ color: T.textColor }}>
          {post.caption}
        </p>
      )}

      {post.hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {post.hashtags.map((tag) => (
            <span
              key={tag}
              className="text-[11px] font-medium px-2 py-0.5 rounded-md"
              style={{
                backgroundColor: T.accentColor + "12",
                color: T.accentColor,
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="text-[11px] font-medium" style={{ color: T.textMuted }}>
        {post.scheduled_at
          ? `Scheduled: ${formattedDate}`
          : `Created: ${formattedDate}`}
      </div>

      <div
        className="flex items-center gap-2 pt-2 border-t"
        style={{ borderColor: T.borderColor + "20" }}
      >
        {editing ? (
          <>
            <button
              onClick={handleSave}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors"
              style={{
                backgroundColor: T.accentColor + "20",
                color: T.accentColor,
              }}
            >
              <Check size={14} /> Save
            </button>
            <button
              onClick={() => {
                setCaption(post.caption);
                setEditing(false);
              }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors"
              style={{
                backgroundColor: T.borderColor + "20",
                color: T.textMuted,
              }}
            >
              <X size={14} /> Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onApprove(post.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors hover:bg-white/5"
              style={{ color: STATUS_COLORS.approved.text }}
            >
              <Check size={14} /> Approve
            </button>
            <button
              onClick={() => onReject(post.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors hover:bg-white/5"
              style={{ color: STATUS_COLORS.rejected.text }}
            >
              <X size={14} /> Reject
            </button>
            <button
              onClick={() => setEditing(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors hover:bg-white/5"
              style={{ color: T.textMuted }}
            >
              <Pencil size={14} /> Edit
            </button>
            {onRegenerate && (
              <button
                onClick={() => onRegenerate(post.id)}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-white/5"
                style={{ color: T.textMuted }}
                title="Regenerate"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
