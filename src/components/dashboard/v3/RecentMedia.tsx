"use client";

/**
 * RecentMedia — media grid with tabs (All / Images / Video / Music).
 *
 * Shows real owned user assets. Hover/tap actions per type:
 *   Image: View, Open project, Download (where allowed), Favorite
 *   Video: Play, Open project, Queue, Favorite
 *   Music: Play, Add to Queue, Favorite, Open Music, Download (where allowed)
 *
 * Source badges: LiTT / Upload / YouTube.
 */

import { useState, useMemo, useCallback } from "react";
import { Music as MusicIcon, Play, Heart, Download, ListPlus, ExternalLink, Film, Image as ImageIcon } from "lucide-react";
import type { DashboardMediaItem, MediaCategory } from "./types";
import { toggleFavorite } from "./types";
import type { MediaDockActions } from "./useMediaDock";

interface RecentMediaProps {
  items: DashboardMediaItem[];
  loading: boolean;
  error: string | null;
  mediaActions: MediaDockActions;
}

const TABS: { id: MediaCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Video" },
  { id: "music", label: "Music" },
];

const SOURCE_BADGE: Record<DashboardMediaItem["source"], { label: string; color: string }> = {
  litt: { label: "LiTT", color: "#00ffc8" },
  upload: { label: "Upload", color: "#a1a1aa" },
  youtube: { label: "YouTube", color: "#ff0000" },
};

export function RecentMedia({ items, loading, error, mediaActions }: RecentMediaProps) {
  const [activeTab, setActiveTab] = useState<MediaCategory>("all");
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    return new Set(items.filter((i) => i.favorite).map((i) => i.id));
  });

  const filtered = useMemo(() => {
    if (activeTab === "all") return items;
    return items.filter((i) => i.type === activeTab);
  }, [items, activeTab]);

  const handleFavorite = useCallback((id: string) => {
    const isFav = toggleFavorite(id);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (isFav) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handlePlayMusic = useCallback(
    (item: DashboardMediaItem) => {
      if (item.track) {
        mediaActions.playLittTrack(item.track);
      }
    },
    [mediaActions],
  );

  const handleAddToQueue = useCallback(
    (item: DashboardMediaItem) => {
      if (item.track) {
        mediaActions.addLittTrackToQueue(item.track);
      }
    },
    [mediaActions],
  );

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border p-5"
      style={{
        background: "rgba(18,18,21,0.7)",
        borderColor: "rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        className="flex items-center justify-between border-b pb-3"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <h3 className="text-sm font-medium uppercase tracking-widest" style={{ color: "#71717a" }}>
          Recent Media
        </h3>
        <div className="flex gap-3 text-xs font-medium md:gap-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="pb-1 transition-colors"
              style={{
                color: activeTab === tab.id ? "#a78bfa" : "#71717a",
                borderBottom: activeTab === tab.id ? "1px solid #a78bfa" : "1px solid transparent",
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab.id) e.currentTarget.style.color = "#fafafa";
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab.id) e.currentTarget.style.color = "#71717a";
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded"
              style={{ background: "rgba(255,255,255,0.04)" }}
            />
          ))}
        </div>
      ) : error ? (
        <div className="py-6 text-center">
          <p className="text-sm" style={{ color: "#71717a" }}>
            Your generated and uploaded media will appear here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm" style={{ color: "#71717a" }}>
            {activeTab === "all"
              ? "Your generated and uploaded media will appear here."
              : `No ${activeTab} media yet.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 md:gap-3">
          {filtered.slice(0, 12).map((item) => (
            <MediaTile
              key={item.id}
              item={item}
              isFavorite={favorites.has(item.id)}
              onFavorite={() => handleFavorite(item.id)}
              onPlayMusic={() => handlePlayMusic(item)}
              onAddToQueue={() => handleAddToQueue(item)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MediaTile({
  item,
  isFavorite,
  onFavorite,
  onPlayMusic,
  onAddToQueue,
}: {
  item: DashboardMediaItem;
  isFavorite: boolean;
  onFavorite: () => void;
  onPlayMusic: () => void;
  onAddToQueue: () => void;
}) {
  const [hover, setHover] = useState(false);
  const source = SOURCE_BADGE[item.source];

  return (
    <div
      className="group relative aspect-square cursor-pointer overflow-hidden rounded border"
      style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(30,30,34,0.6)" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Content */}
      {item.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumbnailUrl}
          alt={item.title}
          className="h-full w-full object-cover transition-transform duration-500"
          style={{ transform: hover ? "scale(1.05)" : "scale(1)" }}
          loading="lazy"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1"
          style={{
            background: "linear-gradient(to bottom right, rgba(18,18,21,0.8), rgba(10,10,10,0.9))",
          }}
        >
          {item.type === "music" ? (
            <MusicIcon size={24} style={{ color: hover ? "#a78bfa" : "#71717a" }} />
          ) : item.type === "video" ? (
            <Film size={24} style={{ color: hover ? "#a78bfa" : "#71717a" }} />
          ) : (
            <ImageIcon size={24} style={{ color: hover ? "#a78bfa" : "#71717a" }} />
          )}
        </div>
      )}

      {/* Source badge */}
      <div
        className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold"
        style={{
          background: `${source.color}20`,
          color: source.color,
        }}
      >
        {source.label}
      </div>

      {/* Favorite button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onFavorite();
        }}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full transition-opacity"
        style={{
          background: "rgba(0,0,0,0.5)",
          opacity: isFavorite ? 1 : hover ? 1 : 0,
        }}
        aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
      >
        <Heart
          size={12}
          style={{
            color: isFavorite ? "#ef4444" : "#fafafa",
            fill: isFavorite ? "#ef4444" : "none",
          }}
        />
      </button>

      {/* Hover actions */}
      <div
        className="absolute inset-0 flex items-center justify-center gap-2 transition-opacity"
        style={{
          background: "rgba(0,0,0,0.5)",
          opacity: hover ? 1 : 0,
        }}
      >
        {item.type === "music" && item.track && (
          <>
            <ActionButton onClick={onPlayMusic} label="Play">
              <Play size={16} fill="currentColor" />
            </ActionButton>
            <ActionButton onClick={onAddToQueue} label="Add to Queue">
              <ListPlus size={14} />
            </ActionButton>
          </>
        )}
        {item.type === "video" && (
          <ActionButton onClick={() => {}} label="Play">
            <Play size={16} fill="currentColor" />
          </ActionButton>
        )}
        {item.type === "image" && (
          <ActionButton onClick={() => {}} label="View">
            <ExternalLink size={14} />
          </ActionButton>
        )}
        {item.url && (item.type === "image" || item.type === "music") && (
          <a
            href={item.url}
            download
            onClick={(e) => e.stopPropagation()}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20"
            aria-label="Download"
          >
            <Download size={14} />
          </a>
        )}
      </div>

      {/* Title overlay for music */}
      {item.type === "music" && (
        <div
          className="absolute bottom-0 left-0 right-0 truncate px-2 py-1 text-[10px] font-mono"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
            color: "#a1a1aa",
          }}
        >
          {item.title}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20"
      aria-label={label}
    >
      {children}
    </button>
  );
}
