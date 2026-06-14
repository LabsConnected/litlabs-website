"use client";

import { useState, useEffect, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import { LayoutGrid, Search, X, Image as ImageIcon, Film, Music, Download, Trash2, Plus, ExternalLink, Loader2 } from "lucide-react";

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
  } catch { return undefined; }
}

const DEMO_ITEMS: GalleryItem[] = [
  { id: "featured_yt_1", title: "Don't Matter — LiTBit", artist: "LiTBit", category: "video", source: "discover", imageUrl: "https://img.youtube.com/vi/76saU4w8sNM/hqdefault.jpg", videoUrl: "https://youtu.be/76saU4w8sNM", likes: 42, createdAt: "2026-06-10" },
  { id: "d1", title: "Neon Cyber City", artist: "Pixel Forge", category: "image", source: "discover", imageUrl: "https://images.unsplash.com/photo-1515630278258-407f66498911?w=1600&h=1200&fit=crop&q=80", likes: 234, createdAt: "2026-06-01" },
  { id: "d2", title: "Ethereal Dreamscape", artist: "DreamWeaver", category: "image", source: "discover", imageUrl: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=1600&h=1200&fit=crop&q=80", likes: 189, createdAt: "2026-06-02" },
  { id: "d3", title: "Lost Temple Ruins", artist: "Explorer-X", category: "image", source: "discover", imageUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1600&h=1200&fit=crop&q=80", likes: 312, createdAt: "2026-05-28" },
  { id: "d4", title: "Quantum Warrior", artist: "Pixel Forge", category: "image", source: "discover", imageUrl: "https://images.unsplash.com/photo-1535295972055-1c762f4483e5?w=1600&h=1200&fit=crop&q=80", likes: 156, createdAt: "2026-06-03" },
  { id: "d5", title: "Crystal Cavern", artist: "GeoMancer", category: "image", source: "discover", imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&h=1200&fit=crop&q=80", likes: 278, createdAt: "2026-05-30" },
  { id: "d6", title: "Void Entity", artist: "ShadowNet", category: "image", source: "discover", imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1600&h=1200&fit=crop&q=80", likes: 421, createdAt: "2026-06-04" },
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
      items.push(...imgs.map((g: { id: string; prompt: string; imageUrl: string; createdAt: number }) => ({
        id: g.id, title: g.prompt?.slice(0, 40) || "Image", artist: "You", category: "image", source: "image" as const,
        imageUrl: g.imageUrl, prompt: g.prompt, likes: 0, createdAt: new Date(g.createdAt).toISOString().split("T")[0],
      })));
    }
  } catch { }
  try {
    const vidRaw = localStorage.getItem("litlabs-studio-video-history");
    if (vidRaw) {
      const vids = JSON.parse(vidRaw);
      items.push(...vids.map((g: { id: string; prompt: string; videoUrl?: string; createdAt: number }) => ({
        id: g.id, title: g.prompt?.slice(0, 40) || "Video", artist: "You", category: "video", source: "video" as const,
        videoUrl: g.videoUrl, prompt: g.prompt, likes: 0, createdAt: new Date(g.createdAt).toISOString().split("T")[0],
      })));
    }
  } catch { }
  try {
    const audRaw = localStorage.getItem("litlabs-studio-audio-history");
    if (audRaw) {
      const auds = JSON.parse(audRaw);
      items.push(...auds.map((g: { id: string; text: string; audioUrl?: string; createdAt: number }) => ({
        id: g.id, title: g.text?.slice(0, 40) || "Audio", artist: "You", category: "audio", source: "audio" as const,
        audioUrl: g.audioUrl, prompt: g.text, likes: 0, createdAt: new Date(g.createdAt).toISOString().split("T")[0],
      })));
    }
  } catch { }
  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export default function GalleryTool() {
  const { resolvedColors: T } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [myItems, setMyItems] = useState<GalleryItem[]>([]);
  const [apiItems, setApiItems] = useState<GalleryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareForm, setShareForm] = useState({ title: "", videoUrl: "", artist: "" });

  useEffect(() => {
    setMyItems(loadGenerations());
    const handleStorage = () => setMyItems(loadGenerations());
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => { setMyItems(loadGenerations()); }, [activeTab]);

  useEffect(() => {
    fetch("/api/gallery")
      .then(r => r.json())
      .then(data => {
        if (!data.items) return;
        setApiItems((data.items as Array<{ id: string; title: string; artist: string; category: string; imageUrl: string; likes: number; createdAt: string; mediaType?: string; videoUrl?: string }>).map(item => ({
          id: item.id,
          title: item.title,
          artist: item.artist,
          category: item.category,
          source: (item.mediaType === "video" ? "video" : "api") as GalleryItem["source"],
          imageUrl: item.imageUrl,
          videoUrl: item.videoUrl,
          likes: item.likes || 0,
          createdAt: item.createdAt,
        })));
      })
      .catch(() => {});
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
    } catch { /* keep local id */ }
    setApiItems(prev => [newItem, ...prev]);
    setShareForm({ title: "", videoUrl: "", artist: "" });
    setShowShare(false);
    setIsSharing(false);
  };

  const allItems = useMemo(() => [...myItems, ...apiItems, ...DEMO_ITEMS], [myItems, apiItems]);

  const videoItems = useMemo(() => allItems.filter(i => i.source === "video" || i.source === "discover" && i.videoUrl), [allItems]);

  const filteredItems = useMemo(() => {
    let source = allItems;
    if (activeTab === "generations") source = allItems.filter(i => i.source === "image" || i.source === "video" || i.source === "audio");
    if (activeTab === "discover") source = allItems.filter(i => i.source === "discover" || i.source === "api");
    if (activeTab === "videos") source = videoItems;
    return source
      .filter(i => !searchQuery || i.title.toLowerCase().includes(searchQuery.toLowerCase()) || i.artist.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allItems, activeTab, searchQuery, videoItems]);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMyItems(prev => prev.filter(i => i.id !== id));
    ["litlabs-studio-image-history", "litlabs-studio-video-history", "litlabs-studio-audio-history"].forEach(key => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) { const parsed = JSON.parse(raw); const filtered = parsed.filter((g: { id: string }) => g.id !== id); localStorage.setItem(key, JSON.stringify(filtered)); }
      } catch { }
    });
  };

  const handleDownload = (url: string, name: string) => {
    const a = document.createElement("a"); a.href = url; a.download = name; a.target = "_blank"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
    <div className="p-4 h-full overflow-y-auto studio-scroll">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <LayoutGrid size={14} style={{ color: T.accentColor }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Asset Bucket</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] opacity-60" style={{ color: T.textMuted }}>{filteredItems.length} items</div>
          <button
            onClick={() => setShowShare(v => !v)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all"
            style={{ backgroundColor: showShare ? T.accentColor : T.accentColor + "15", color: showShare ? T.bgColor : T.accentColor, border: `1px solid ${T.accentColor}40` }}
          >
            <Plus size={10} /> Share Video
          </button>
        </div>
      </div>

      {showShare && (
        <div className="mb-4 p-3 rounded-xl border" style={{ borderColor: T.accentColor + "30", backgroundColor: T.accentColor + "08" }}>
          <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.accentColor }}>Share a Video</div>
          <div className="flex flex-col gap-2">
            <input
              value={shareForm.videoUrl}
              onChange={e => setShareForm(f => ({ ...f, videoUrl: e.target.value }))}
              placeholder="YouTube URL  (e.g. https://youtu.be/...)"
              className="w-full px-2.5 py-1.5 rounded-md text-xs outline-none"
              style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}40`, color: T.textColor }}
            />
            <div className="flex gap-2">
              <input
                value={shareForm.title}
                onChange={e => setShareForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Title (optional)"
                className="flex-1 px-2.5 py-1.5 rounded-md text-xs outline-none"
                style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}40`, color: T.textColor }}
              />
              <input
                value={shareForm.artist}
                onChange={e => setShareForm(f => ({ ...f, artist: e.target.value }))}
                placeholder="Your name"
                className="flex-1 px-2.5 py-1.5 rounded-md text-xs outline-none"
                style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}40`, color: T.textColor }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowShare(false)} className="px-3 py-1 rounded-md text-[10px]" style={{ color: T.textMuted, border: `1px solid ${T.borderColor}30` }}>Cancel</button>
              <button onClick={handleShareVideo} disabled={!shareForm.videoUrl.trim() || isSharing}
                className="flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-bold disabled:opacity-40"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                {isSharing ? <Loader2 size={10} className="animate-spin" /> : <Film size={10} />} Share
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 flex-wrap">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="px-2.5 py-1 rounded-md text-[10px] font-bold transition-all"
              style={{ border: `1px solid ${activeTab === tab.id ? T.accentColor + "40" : T.borderColor + "30"}`, backgroundColor: activeTab === tab.id ? T.accentColor + "12" : "transparent", color: activeTab === tab.id ? T.accentColor : T.textColor + "80" }}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border ml-auto" style={{ borderColor: T.borderColor + "30", backgroundColor: T.bgColor }}>
          <Search size={12} style={{ color: T.textMuted }} />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search assets..."
            className="bg-transparent text-xs outline-none w-28" style={{ color: T.textColor }} />
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="text-center py-16 opacity-40">
          <div className="text-3xl mb-3">🪣</div>
          <div className="text-xs">Your bucket is empty.</div>
          <div className="text-[10px] mt-1" style={{ color: T.textMuted }}>Generate images, video, or audio to fill it.</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filteredItems.map(item => (
            <div key={item.id}
              onClick={() => {
                if (item.videoUrl) {
                  window.open(item.videoUrl, "_blank", "noopener,noreferrer");
                } else {
                  setSelectedItem(item);
                }
              }}
              className="border rounded-xl overflow-hidden group cursor-pointer transition-all duration-200 hover:scale-[1.02]"
              style={{ borderColor: T.borderColor + "25", backgroundColor: T.boxBg + "80" }}>
              <div className="relative aspect-square overflow-hidden bg-black/40">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                ) : item.videoUrl ? (
                  <video src={item.videoUrl} className="w-full h-full object-cover" muted />
                ) : item.audioUrl ? (
                  <div className="w-full h-full flex items-center justify-center"><Music size={24} style={{ color: sourceColor(item.source), opacity: 0.5 }} /></div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><ImageIcon size={24} style={{ color: sourceColor(item.source), opacity: 0.5 }} /></div>
                )}
                {item.videoUrl && (
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
                    <ExternalLink size={22} style={{ color: "#fff" }} />
                  </div>
                )}
                <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase" style={{ backgroundColor: "rgba(0,0,0,0.7)", color: sourceColor(item.source) }}>
                  {sourceIcon(item.source)} {item.videoUrl ? "video" : item.source}
                </div>
                {(item.source === "image" || item.source === "video" || item.source === "audio") && (
                  <button onClick={e => handleDelete(item.id, e)}
                    className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ backgroundColor: "rgba(255,0,0,0.7)", color: "white" }}>
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
              <div className="px-2.5 py-2">
                <div className="text-[11px] font-bold truncate" style={{ color: T.headerColor }}>{item.title}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] opacity-50" style={{ color: T.textMuted }}>{item.artist} · {item.createdAt}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedItem && (
        <div onClick={() => setSelectedItem(null)} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.92)" }}>
          <div onClick={e => e.stopPropagation()} className="max-w-3xl w-full max-h-[90vh] flex flex-col rounded-xl border overflow-hidden" style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "30" }}>
            <div className="relative flex-1 min-h-[300px] flex items-center justify-center" style={{ backgroundColor: T.bgColor }}>
              {selectedItem.imageUrl && !selectedItem.videoUrl ? (
                <img src={selectedItem.imageUrl} alt={selectedItem.title} className="w-full h-full object-contain" />
              ) : selectedItem.videoUrl && selectedItem.videoUrl.includes("youtu") ? (
                <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
                  {selectedItem.imageUrl && <img src={selectedItem.imageUrl} alt={selectedItem.title} className="max-h-48 rounded-lg object-cover" />}
                  <a href={selectedItem.videoUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm"
                    style={{ backgroundColor: "#ff0000", color: "#fff" }}>
                    <ExternalLink size={14} /> Watch on YouTube
                  </a>
                </div>
              ) : selectedItem.videoUrl ? (
                <video src={selectedItem.videoUrl} controls className="w-full h-full object-contain" />
              ) : selectedItem.audioUrl ? (
                <div className="flex flex-col items-center gap-4"><Music size={48} style={{ color: sourceColor(selectedItem.source), opacity: 0.5 }} /><audio src={selectedItem.audioUrl} controls className="w-64" /></div>
              ) : (
                <ImageIcon size={48} style={{ color: T.textMuted, opacity: 0.3 }} />
              )}
              <button onClick={() => setSelectedItem(null)} className="absolute top-3 right-3 p-2 rounded-lg" style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "white", border: `1px solid ${T.borderColor}40` }}>
                <X size={14} />
              </button>
            </div>
            <div className="px-4 py-3 border-t flex items-center justify-between" style={{ borderColor: T.borderColor + "20" }}>
              <div>
                <div className="text-sm font-bold" style={{ color: T.headerColor }}>{selectedItem.title}</div>
                <div className="flex gap-3 mt-1 text-[10px]" style={{ color: T.textMuted }}>
                  <span>{selectedItem.artist}</span>
                  <span style={{ color: sourceColor(selectedItem.source) }}>{selectedItem.source.toUpperCase()}</span>
                  <span>{selectedItem.createdAt}</span>
                </div>
              </div>
              {(selectedItem.imageUrl || selectedItem.videoUrl || selectedItem.audioUrl) && (
                <button onClick={() => handleDownload(selectedItem.imageUrl || selectedItem.videoUrl || selectedItem.audioUrl!, `litbit-${selectedItem.source}-${Date.now()}`)}
                  className="px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 border"
                  style={{ borderColor: T.borderColor + "30", color: T.textColor }}>
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
