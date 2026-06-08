"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Heart, Download, Share2, Wand2 } from "lucide-react";
import Image from "next/image";

interface MediaCardProps {
  src: string;
  title?: string;
  author?: string;
  authorAvatar?: string;
  type?: "image" | "video" | "audio";
  onRemix?: () => void;
  onDownload?: () => void;
  onShare?: () => void;
  className?: string;
}

export default function MediaCard({
  src,
  title,
  author,
  authorAvatar,
  type = "image",
  onRemix,
  onDownload,
  onShare,
  className = "",
}: MediaCardProps) {
  const { resolvedColors } = useTheme();
  const [liked, setLiked] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`glass-card rounded-lg overflow-hidden group relative ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ borderColor: resolvedColors.borderColor + "20" }}
    >
      {/* Media */}
      <div className="relative aspect-video overflow-hidden bg-black/30">
        {type === "image" ? (
          <Image
            src={src}
            alt={title || "Generated media"}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            unoptimized
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-3xl">{type === "video" ? "▶️" : "🎵"}</span>
          </div>
        )}

        {/* Hover overlay */}
        {hovered && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center gap-2 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); setLiked(!liked); }}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              title="Like"
            >
              <Heart size={16} className={liked ? "fill-rose-500 text-rose-500" : "text-white"} />
            </button>
            {onRemix && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemix(); }}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                title="Remix"
              >
                <Wand2 size={16} className="text-white" />
              </button>
            )}
            {onDownload && (
              <button
                onClick={(e) => { e.stopPropagation(); onDownload(); }}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                title="Download"
              >
                <Download size={16} className="text-white" />
              </button>
            )}
            {onShare && (
              <button
                onClick={(e) => { e.stopPropagation(); onShare(); }}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                title="Share"
              >
                <Share2 size={16} className="text-white" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      {(title || author) && (
        <div className="p-3">
          {title && (
            <div className="text-xs font-bold truncate mb-1" style={{ color: resolvedColors.textColor }}>
              {title}
            </div>
          )}
          {author && (
            <div className="flex items-center gap-1.5">
              {authorAvatar ? (
                <span className="text-sm">{authorAvatar}</span>
              ) : (
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: resolvedColors.accentColor + "30" }}
                />
              )}
              <span className="text-[10px] opacity-60" style={{ color: resolvedColors.textMuted }}>
                {author}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
