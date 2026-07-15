"use client";

import { useState, useEffect, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  LayoutGrid,
  Search,
  X,
  Image as ImageIcon,
  Film,
  Music,
  Download,
  Trash2,
  Plus,
  ExternalLink,
  Loader2,
} from "lucide-react";

function getYouTubeThumbnail(url: string): string | undefined {
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (u.hostname === "youtu.be") id = u.pathname.slice(1).split("?")[0];
    else if (u.hostname.endsWith("youtube.com")) {
      if (u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2];
      else id = u.searchParams.get("v");
    }
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : undefined;
  } catch {
    return undefined;
  }
}

const DEMO_ITEMS: GalleryItem[] = [
  {
    id: "featured_yt_1",
    title: "Don't Matter — LiTBit",
    artist: "LiTBit",
    category: "video",
    source: "discover",
    imageUrl: "https://img.youtube.com/vi/76saU4w8sNM/hqdefault.jpg",
    videoUrl: "https://youtu.be/76saU4w8sNM",
    likes: 42,
    createdAt: "2026-06-10",
  },
  {
    id: "d1",
    title: "Neon Cyber City",
    artist: "Pixel Forge",
    category: "image",
    source: "discover",
    imageUrl:
      "https://images.unsplash.com/photo-1515630278258-407f66498911?w=1600&h=1200&fit=crop&q=80",
    likes: 234,
    createdAt: "2026-06-01",
  },
  {
    id: "d2",
    title: "Ethereal Dreamscape",
    artist: "DreamWeaver",
    category: "image",
    source: "discover",
    imageUrl:
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=1600&h=1200&fit=crop&q=80",
    likes: 189,
    createdAt: "2026-06-02",
  },
  {
    id: "d3",
    title: "Lost Temple Ruins",
    artist: "Explorer-X",
    category: "image",
    source: "discover",
    imageUrl:
      "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1600&h=1200&fit=crop&q=80",
    likes: 312,
    createdAt: "2026-05-28",
  },
  {
    id: "d4",
    title: "Quantum Warrior",
    artist: "Pixel Forge",
    category: "image",
    source: "discover",
    imageUrl:
      "https://images.unsplash.com/photo-1535295972055-1c762f4483e5?w=1600&h=1200&fit=crop&q=80",
    likes: 156,
    createdAt: "2026-06-03",
  },
  {
    id: "d5",
    title: "Crystal Cavern",
    artist: "GeoMancer",
    category: "image",
    source: "discover",
    imageUrl:
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&h=1200&fit=crop&q=80",
    likes: 278,
    createdAt: "2026-05-30",
  },
  {
    id: "d6",
    title: "Void Entity",
    artist: "ShadowNet",
    category: "image",
    source: "discover",
    imageUrl:
      "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1600&h=1200&fit=crop&q=80",
    likes: 421,
    createdAt: "2026-06-04",
  },
];

type GalleryItem = {
  id: string;
  title: string;
  artist: string;
  category: string;
  source: "image" | "video" | "audio" | "discover" | "api";
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  prompt?: string;
  likes: number;
  createdAt: string;
};

type Tab = "all" | "generations" | "discover" | "videos";

function loadGenerations(): GalleryItem[] {
  const items: GalleryItem[] = [];
  try {
    const imgRaw = localStorage.getItem("litlabs-studio-image-history");
    if (imgRaw) {
      const imgs = JSON.parse(imgRaw);
      items.push(
        ...imgs.map(
          (g: {
            id: string;
            prompt: string;
            imageUrl: string;
            createdAt: number;
          }) => ({
            id: g.id,
            title: g.prompt?.slice(0, 40) || "Image",
            artist: "You",
            category: "image",
            source: "image" as const,
            imageUrl: g.imageUrl,
            prompt: g.prompt,
            likes: 0,
            createdAt: new Date(g.createdAt).toISOString().split("T")[0],
          }),
        ),
      );
    }
  } catch {}
  try {
    const vidRaw = localStorage.getItem("litlabs-studio-video-history");
    if (vidRaw) {
      const vids = JSON.parse(vidRaw);
      items.push(
        ...vids.map(
          (g: {
            id: string;
            prompt: string;
            videoUrl?: string;
            createdAt: number;
          }) => ({
            id: g.id,
            title: g.prompt?.slice(0, 40) || "Video",
            artist: "You",
            category: "video",
            source: "video" as const,
            videoUrl: g.videoUrl,
            prompt: g.prompt,
            likes: 0,
            createdAt: new Date(g.createdAt).toISOString().split("T")[0],
          }),
        ),
      );
    }
  } catch {}
  try {
    const audRaw = localStorage.getItem("litlabs-studio-audio-history");
    if (audRaw) {
      const auds = JSON.parse(audRaw);
      items.push(
        ...auds.map(
          (g: {
            id: string;
            text: string;
            audioUrl?: string;
            createdAt: number;
          }) => ({
            id: g.id,
            title: g.text?.slice(0, 40) || "Audio",
            artist: "You",
            category: "audio",
            source: "audio" as const,
            audioUrl: g.audioUrl,
            prompt: g.text,
            likes: 0,
            createdAt: new Date(g.createdAt).toISOString().split("T")[0],
          }),
        ),
      );
    }
  } catch {}
  return items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export default function GalleryTool() {
  const { resolvedColors: T } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [myItems, setMyItems] = useState<GalleryItem[]>(() =>
    loadGenerations(),
  );
  const [apiItems, setApiItems] = useState<GalleryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareForm, setShareForm] = useState({
    title: "",
    videoUrl: "",
    artist: "",
  });

  useEffect(() => {
    const handleStorage = () => setMyItems(loadGenerations());
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMyItems(loadGenerations()));
    return () => cancelAnimationFrame(id);
  }, [activeTab]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      fetch("/api/gallery")
        .then((r) => r.json())
        .then((data) => {
          if (!data.items) return;
          setApiItems(
            (
              data.items as Array<{
                id: string;
                title: string;
                artist: string;
                category: string;
                imageUrl: string;
                likes: number;
                createdAt: string;
                mediaType?: string;
                videoUrl?: string;
              }>
            ).map((item) => ({
              id: item.id,
              title: item.title,
              artist: item.artist,
              category: item.category,
              source: (item.mediaType === "video"
                ? "video"
                : "api") as GalleryItem["source"],
              imageUrl: item.imageUrl,
              videoUrl: item.videoUrl,
              likes: item.likes || 0,
              createdAt: item.createdAt,
            })),
          );
        })
        .catch(() => {});
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const handleShareVideo = async () => {
    const url = shareForm.videoUrl.trim();
    if (!url) return;
    setIsSharing(true);
    const thumb = getYouTubeThumbnail(url);
    const newItem: GalleryItem = {
      id: `share_${Date.now()}`,
      title: shareForm.title.trim() || "My Video",
      artist: shareForm.artist.trim() || "You",
      category: "video",
      source: "video",
      videoUrl: url,
      imageUrl: thumb,
      likes: 0,
      createdAt: new Date().toISOString().split("T")[0],
    };
    try {
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, caption: newItem.title, type: "video" }),
      });
      const data = await res.json();
      if (data?.item?.id) newItem.id = data.item.id;
    } catch {
      /* keep local id */
    }
    setApiItems((prev) => [newItem, ...prev]);
    setShareForm({ title: "", videoUrl: "", artist: "" });
    setShowShare(false);
    setIsSharing(false);
  };

  const allItems = useMemo(
    () => [...myItems, ...apiItems, ...DEMO_ITEMS],
    [myItems, apiItems],
  );

  const videoItems = useMemo(
    () =>
      allItems.filter(
        (i) => i.source === "video" || (i.source === "discover" && i.videoUrl),
      ),
    [allItems],
  );

  const filteredItems = useMemo(() => {
    let source = allItems;
    if (activeTab === "generations")
      source = allItems.filter(
        (i) =>
          i.source === "image" || i.source === "video" || i.source === "audio",
      );
    if (activeTab === "discover")
      source = allItems.filter(
        (i) => i.source === "discover" || i.source === "api",
      );
    if (activeTab === "videos") source = videoItems;
    return source
      .filter(
        (i) =>
          !searchQuery ||
          i.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          i.artist.toLowerCase().includes(searchQuery.toLowerCase()),
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [allItems, activeTab, searchQuery, videoItems]);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMyItems((prev) => prev.filter((i) => i.id !== id));
    [
      "litlabs-studio-image-history",
      "litlabs-studio-video-history",
      "litlabs-studio-audio-history",
    ].forEach((key) => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          const filtered = parsed.filter((g: { id: string }) => g.id !== id);
          localStorage.setItem(key, JSON.stringify(filtered));
        }
      } catch {}
    });
  };

  const handleDownload = (url: string, name: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const sourceIcon = (source: string) => {
    if (source === "video") return <Film size={10} />;
    if (source === "audio") return <Music size={10} />;
    return <ImageIcon size={10} />;
  };

  const sourceColor = (source: string) => {
    if (source === "video") return "#ff6b6b";
    if (source === "audio") return "#9b59b6";
    return T.accentColor;
  };

  const tabs = [
    { id: "all" as Tab, label: `All (${allItems.length})` },
    { id: "generations" as Tab, label: `My Bucket (${myItems.length})` },
    { id: "videos" as Tab, label: `Videos (${videoItems.length})` },
    { id: "discover" as Tab, label: "Community" },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#030308] studio-scroll">
      <div
        className="sticky top-0 z-20 border-b border-white/5 px-4 py-3 backdrop-blur-md"
        style={{ backgroundColor: "rgba(3,3,8,0.95)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
              <LayoutGrid size={16} className="text-cyan-400" />
            </div>
            <div>
              <div className="text-sm font-black tracking-wide text-white">
                Asset Bucket
              </div>
              <div className="hidden text-[10px] text-neutral-500 sm:block">
                Your generated images, video, and audio
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-full border border-white/5 bg-white/5 px-2.5 py-1 text-[10px] text-neutral-400">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              {filteredItems.length} ASSETS
            </span>
            <button
              onClick={() => setShowShare((v) => !v)}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold transition ${
                showShare
                  ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                  : "border border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
              }`}
            >
              <Plus size={12} /> Share
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pb-24 pt-3">
        {showShare && (
          <div
            className="mb-4 p-3 rounded-xl border"
            style={{
              borderColor: T.accentColor + "30",
              backgroundColor: T.accentColor + "08",
            }}
          >
            <div
              className="text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ color: T.accentColor }}
            >
              Share a Video
            </div>
            <div className="flex flex-col gap-2">
              <input
                id="gallery-tool-share-video-url"
                name="galleryToolShareVideoUrl"
                value={shareForm.videoUrl}
                onChange={(e) =>
                  setShareForm((f) => ({ ...f, videoUrl: e.target.value }))
                }
                placeholder="YouTube URL  (e.g. https://youtu.be/...)"
                className="w-full px-2.5 py-1.5 rounded-md text-xs outline-none"
                style={{
                  backgroundColor: T.bgColor,
                  border: `1px solid ${T.borderColor}40`,
                  color: T.textColor,
                }}
              />
              <div className="flex gap-2">
                <input
                  id="gallery-tool-share-title"
                  name="galleryToolShareTitle"
                  value={shareForm.title}
                  onChange={(e) =>
                    setShareForm((f) => ({ ...f, title: e.target.value }))
                  }
                  placeholder="Title (optional)"
                  className="flex-1 px-2.5 py-1.5 rounded-md text-xs outline-none"
                  style={{
                    backgroundColor: T.bgColor,
                    border: `1px solid ${T.borderColor}40`,
                    color: T.textColor,
                  }}
                />
                <input
                  id="gallery-tool-share-artist"
                  name="galleryToolShareArtist"
                  value={shareForm.artist}
                  onChange={(e) =>
                    setShareForm((f) => ({ ...f, artist: e.target.value }))
                  }
                  placeholder="Your name"
                  className="flex-1 px-2.5 py-1.5 rounded-md text-xs outline-none"
                  style={{
                    backgroundColor: T.bgColor,
                    border: `1px solid ${T.borderColor}40`,
                    color: T.textColor,
                  }}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowShare(false)}
                  className="px-3 py-1 rounded-md text-[10px]"
                  style={{
                    color: T.textMuted,
                    border: `1px solid ${T.borderColor}30`,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleShareVideo}
                  disabled={!shareForm.videoUrl.trim() || isSharing}
                  className="flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-bold disabled:opacity-40"
                  style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                >
                  {isSharing ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Film size={10} />
                  )}{" "}
                  Share
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 mb-4">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 sm:pb-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="shrink-0 rounded-md border border-white/5 px-3 py-1.5 text-xs font-bold transition hover:border-cyan-500/20 hover:text-cyan-300"
                style={{
                  backgroundColor:
                    activeTab === tab.id
                      ? T.accentColor + "12"
                      : "rgba(255,255,255,0.02)",
                  color: activeTab === tab.id ? T.accentColor : "#a3a3a3",
                  borderColor:
                    activeTab === tab.id ? T.accentColor + "40" : undefined,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative flex items-center sm:ml-auto">
            <Search size={14} className="absolute left-3 text-neutral-500" />
            <input
              id="gallery-tool-search"
              name="galleryToolSearch"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search assets..."
              className="w-full rounded-xl border border-white/10 bg-white/3 py-2 pl-9 pr-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-cyan-500/30 focus:bg-white/5 sm:w-56"
            />
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="text-center py-16 opacity-80">
            <div className="text-3xl mb-3">🪣</div>
            <div className="text-sm font-bold">Your bucket is empty.</div>
            <div className="text-xs mt-1" style={{ color: T.textMuted }}>
              Generate images, video, or audio to fill it.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  if (item.videoUrl) {
                    window.open(item.videoUrl, "_blank", "noopener,noreferrer");
                  } else {
                    setSelectedItem(item);
                  }
                }}
                className="group cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-white/2 transition hover:scale-[1.02] hover:border-cyan-500/20 hover:bg-cyan-500/5"
              >
                <div className="relative aspect-square overflow-hidden bg-black/40">
                  {item.imageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </>
                  ) : item.videoUrl ? (
                    <video
                      src={item.videoUrl}
                      className="w-full h-full object-cover"
                      muted
                    />
                  ) : item.audioUrl ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <Music
                        size={24}
                        style={{
                          color: sourceColor(item.source),
                          opacity: 0.5,
                        }}
                      />
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon
                        size={24}
                        style={{
                          color: sourceColor(item.source),
                          opacity: 0.5,
                        }}
                      />
                    </div>
                  )}
                  {item.videoUrl && (
                    <div
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
                    >
                      <ExternalLink size={22} style={{ color: "#fff" }} />
                    </div>
                  )}
                  <div
                    className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase"
                    style={{
                      backgroundColor: "rgba(0,0,0,0.7)",
                      color: sourceColor(item.source),
                    }}
                  >
                    {sourceIcon(item.source)}{" "}
                    {item.videoUrl ? "video" : item.source}
                  </div>
                  {(item.source === "image" ||
                    item.source === "video" ||
                    item.source === "audio") && (
                    <button
                      onClick={(e) => handleDelete(item.id, e)}
                      className="absolute top-2 right-2 p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{
                        backgroundColor: "rgba(255,0,0,0.7)",
                        color: "white",
                      }}
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
                <div className="px-2.5 py-2">
                  <div className="text-xs font-bold truncate text-white">
                    {item.title}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span
                      className="text-[10px] opacity-80"
                      style={{ color: T.textMuted }}
                    >
                      {item.artist} · {item.createdAt}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedItem && (
        <div
          onClick={() => setSelectedItem(null)}
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-3xl w-full max-h-[90vh] flex flex-col rounded-xl border overflow-hidden"
            style={{
              backgroundColor: T.boxBg,
              borderColor: T.borderColor + "30",
            }}
          >
            <div
              className="relative flex-1 min-h-[300px] flex items-center justify-center"
              style={{ backgroundColor: T.bgColor }}
            >
              {selectedItem.imageUrl && !selectedItem.videoUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedItem.imageUrl}
                    alt={selectedItem.title}
                    className="w-full h-full object-contain"
                  />
                </>
              ) : selectedItem.videoUrl &&
                selectedItem.videoUrl.includes("youtu") ? (
                <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
                  {selectedItem.imageUrl && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selectedItem.imageUrl}
                        alt={selectedItem.title}
                        className="max-h-48 rounded-lg object-cover"
                      />
                    </>
                  )}
                  <a
                    href={selectedItem.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm"
                    style={{ backgroundColor: "#ff0000", color: "#fff" }}
                  >
                    <ExternalLink size={14} /> Watch on YouTube
                  </a>
                </div>
              ) : selectedItem.videoUrl ? (
                <video
                  src={selectedItem.videoUrl}
                  controls
                  className="w-full h-full object-contain"
                />
              ) : selectedItem.audioUrl ? (
                <div className="flex flex-col items-center gap-4">
                  <Music
                    size={48}
                    style={{
                      color: sourceColor(selectedItem.source),
                      opacity: 0.5,
                    }}
                  />
                  <audio
                    src={selectedItem.audioUrl}
                    controls
                    className="w-64"
                  />
                </div>
              ) : (
                <ImageIcon
                  size={48}
                  style={{ color: T.textMuted, opacity: 0.3 }}
                />
              )}
              <button
                onClick={() => setSelectedItem(null)}
                className="absolute top-3 right-3 p-2 rounded-lg"
                style={{
                  backgroundColor: "rgba(0,0,0,0.6)",
                  color: "white",
                  border: `1px solid ${T.borderColor}40`,
                }}
              >
                <X size={14} />
              </button>
            </div>
            <div
              className="px-4 py-3 border-t flex items-center justify-between"
              style={{ borderColor: T.borderColor + "20" }}
            >
              <div>
                <div
                  className="text-sm font-bold"
                  style={{ color: T.headerColor }}
                >
                  {selectedItem.title}
                </div>
                <div
                  className="flex gap-3 mt-1 text-[10px]"
                  style={{ color: T.textMuted }}
                >
                  <span>{selectedItem.artist}</span>
                  <span style={{ color: sourceColor(selectedItem.source) }}>
                    {selectedItem.source.toUpperCase()}
                  </span>
                  <span>{selectedItem.createdAt}</span>
                </div>
              </div>
              {(selectedItem.imageUrl ||
                selectedItem.videoUrl ||
                selectedItem.audioUrl) && (
                <button
                  onClick={() =>
                    handleDownload(
                      selectedItem.imageUrl ||
                        selectedItem.videoUrl ||
                        selectedItem.audioUrl!,
                      `litbit-${selectedItem.source}-${Date.now()}`,
                    )
                  }
                  className="px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 border"
                  style={{
                    borderColor: T.borderColor + "30",
                    color: T.textColor,
                  }}
                >
                  <Download size={10} /> Download
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
