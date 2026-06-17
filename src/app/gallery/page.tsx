"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useRouter } from "next/navigation";
import PageShell from "@/components/PageShell";
import Lightbox from "@/components/Lightbox";

// ─── Demo gallery items ──────────────────────────────────────────────────────
/* ─── Real AI-generated art via Pollinations ───────────────────────── */
const P = (prompt: string, w: number, h: number, seed: number) =>
  `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${seed}&enhance=true`;

const DEMO_ITEMS: GalleryItem[] = [
  { id: "1", title: "Neon Cyber City", artist: "Pixel Forge", category: "360-worlds",
    imageUrl: P("futuristic neon cyberpunk city at night with flying cars holographic billboards rain soaked streets cinematic lighting 8k ultra detailed digital art", 1024, 768, 42), likes: 234, createdAt: "2026-06-01" },
  { id: "2", title: "Ethereal Dreamscape", artist: "DreamWeaver", category: "abstract",
    imageUrl: P("ethereal abstract dreamscape floating islands waterfalls of light aurora borealis colors swirling cosmic dust fantasy art highly detailed", 768, 1024, 77), likes: 189, createdAt: "2026-06-02" },
  { id: "3", title: "Lost Temple Ruins", artist: "Explorer-X", category: "landscape",
    imageUrl: P("massive ancient alien temple ruins overgrown with bioluminescent vines floating above clouds sunset god rays concept art epic scale", 1024, 768, 13), likes: 312, createdAt: "2026-05-28" },
  { id: "4", title: "Quantum Warrior", artist: "Pixel Forge", category: "character",
    imageUrl: P("female quantum warrior in glowing nanotech armor holding energy sword helmet off fierce expression sci fi character portrait detailed", 768, 1024, 88), likes: 156, createdAt: "2026-06-03" },
  { id: "5", title: "Crystal Cavern", artist: "GeoMancer", category: "360-worlds",
    imageUrl: P("vast underground crystal cavern with massive glowing amethyst geodes underground lake reflections fantasy environment art", 1024, 768, 55), likes: 278, createdAt: "2026-05-30" },
  { id: "6", title: "Void Entity", artist: "ShadowNet", category: "character",
    imageUrl: P("mysterious void entity humanoid shape made of swirling darkness and stars glowing purple eyes cosmic horror elegant digital painting", 768, 1024, 99), likes: 421, createdAt: "2026-06-04" },
  { id: "7", title: "Sunset Megacity", artist: "Pixel Forge", category: "landscape",
    imageUrl: P("futuristic megacity at sunset from above infinite skyscrapers connected by sky bridges flying vehicles orange pink sky sci fi matte painting", 1024, 768, 21), likes: 198, createdAt: "2026-05-25" },
  { id: "8", title: "Fractal Mind", artist: "DreamWeaver", category: "abstract",
    imageUrl: P("abstract human head profile made of glowing fractal patterns neural networks electric blue magenta synapses digital art high detail", 1024, 1024, 66), likes: 267, createdAt: "2026-05-29" },
  { id: "9", title: "Underwater Utopia", artist: "AquaBot", category: "360-worlds",
    imageUrl: P("underwater bioluminescent city with dome structures jellyfish swimming around coral towers fantasy sci fi environment art", 1024, 768, 33), likes: 345, createdAt: "2026-06-01" },
  { id: "10", title: "Cyber Samurai", artist: "Pixel Forge", category: "character",
    imageUrl: P("cyberpunk samurai with glowing katana red neon armor dark rainy Tokyo street detailed character art cinematic lighting", 768, 1024, 11), likes: 189, createdAt: "2026-05-27" },
  { id: "11", title: "Starfield Station", artist: "StarWalker", category: "landscape",
    imageUrl: P("massive ring shaped space station orbiting a gas planet with rings thousands of windows glowing milky way background sci fi art", 1024, 768, 72), likes: 567, createdAt: "2026-06-04" },
  { id: "12", title: "Neural Network", artist: "DataMancer", category: "abstract",
    imageUrl: P("abstract visualization of artificial neural network nodes and connections glowing fiber optic threads brain shape dark background digital art", 1024, 1024, 44), likes: 234, createdAt: "2026-05-26" },
];

const CATEGORIES = [
  { id: "all", label: "🌌 All Works", count: DEMO_ITEMS.length },
  { id: "360-worlds", label: "🌍 360° Worlds", count: DEMO_ITEMS.filter(i => i.category === "360-worlds").length },
  { id: "character", label: "👤 Characters", count: DEMO_ITEMS.filter(i => i.category === "character").length },
  { id: "landscape", label: "🏔️ Landscapes", count: DEMO_ITEMS.filter(i => i.category === "landscape").length },
  { id: "abstract", label: "🎨 Abstract", count: DEMO_ITEMS.filter(i => i.category === "abstract").length },
];

const SORT_OPTIONS = [
  { id: "newest", label: "🕐 Newest" },
  { id: "popular", label: "🔥 Most Liked" },
  { id: "name", label: "🔤 Name" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash % 360);
  return `hsl(${h}, 65%, 45%)`;
}

// ─── Types ───────────────────────────────────────────────────────────────────
type GalleryItem = {
  id: string;
  title: string;
  artist: string;
  category: string;
  imageUrl: string;
  likes: number;
  createdAt: string;
  mediaType?: "image" | "video" | "audio";
  videoUrl?: string;
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function Gallery() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();
  const { resolvedColors: T } = useTheme();
  const [apiItems, setApiItems] = useState<GalleryItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [likedItems, setLikedItems] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [viewMode, setViewMode] = useState<"grid" | "masonry">("masonry");
  const [userItems, setUserItems] = useState<GalleryItem[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: "",
    imageUrl: "",
    videoUrl: "",
    artist: "",
    category: "abstract",
    mediaType: "image" as "image" | "video",
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  // Merge demo + real API + user items
  const items = [...apiItems, ...DEMO_ITEMS, ...userItems].map(item => ({
    ...item,
    likes: likeCounts[item.id] !== undefined ? likeCounts[item.id] : item.likes,
  }));

  // Memoized Lightbox navigation handlers to prevent infinite loops
  const handleLightboxNext = useCallback(() => {
    if (!selectedItem) return;
    const idx = items.findIndex(i => i.id === selectedItem.id);
    if (idx !== -1) {
      setSelectedItem(items[(idx + 1) % items.length]);
    }
  }, [items, selectedItem]);

  const handleLightboxPrev = useCallback(() => {
    if (!selectedItem) return;
    const idx = items.findIndex(i => i.id === selectedItem.id);
    if (idx !== -1) {
      setSelectedItem(items[(idx - 1 + items.length) % items.length]);
    }
  }, [items, selectedItem]);

  const handleLightboxClose = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    fetch("/api/gallery")
      .then(r => r.json())
      .then((data: { items?: GalleryItem[] }) => {
        if (data.items && data.items.length > 0) {
          setApiItems(data.items);
        }
      })
      .catch(() => {
        // silent fail — demo items still show
      });

    const storedUserItems = localStorage.getItem("litlabs-gallery-user");
    if (storedUserItems) {
      try { setUserItems(JSON.parse(storedUserItems)); } catch { /* ignore */ }
    }
  }, []);

  if (!isLoaded) {
    return (
      <div style={{ backgroundColor: T?.bgColor || "#0f0f14", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: T?.textColor || "#e2e8f0" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "16px" }}>⏳</div>
          <div>Loading gallery...</div>
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/gallery");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded || !isSignedIn) {
    return (
      <div style={{ backgroundColor: T?.bgColor || "#0f0f14", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: T?.textColor || "#e2e8f0" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "16px" }}>🔒</div>
          <div>Sign in to view the gallery</div>
        </div>
      </div>
    );
  }

  const filteredItems = items
    .filter(i => selectedCategory === "all" || i.category === selectedCategory)
    .filter(i => !searchQuery || i.title.toLowerCase().includes(searchQuery.toLowerCase()) || i.artist.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === "popular") return b.likes - a.likes;
      if (sortBy === "name") return a.title.localeCompare(b.title);
      return 0;
    });

  const toggleLike = useCallback((id: string) => {
    setLikedItems(prev => {
      const next = new Set(prev);
      const wasLiked = next.has(id);
      if (wasLiked) { next.delete(id); } else { next.add(id); }
      // Update like count
      setLikeCounts(counts => {
        const current = counts[id] ?? items.find(i => i.id === id)?.likes ?? 0;
        return { ...counts, [id]: wasLiked ? current - 1 : current + 1 };
      });
      return next;
    });
  }, [items]);

  const handleUpload = async () => {
    if (!uploadForm.title.trim()) {
      showToast("Title is required", "error");
      return;
    }
    if (uploadForm.mediaType === "image") {
      if (!uploadForm.imageUrl.trim() && !uploadFile) {
        showToast("Provide an image URL or select a file", "error");
        return;
      }
    } else if (uploadForm.mediaType === "video") {
      if (!uploadForm.videoUrl.trim()) {
        showToast("Provide a video URL (e.g. YouTube)", "error");
        return;
      }
    }
    if (uploading) return;

    setUploading(true);
    try {
      const isImage = uploadForm.mediaType === "image";
      let imageUrl = uploadForm.imageUrl.trim();
      let videoUrl = uploadForm.videoUrl.trim();

      // 1) If image mode and a file was chosen, upload to /api/upload first to get a hosted URL
      if (isImage && uploadFile) {
        const fd = new FormData();
        fd.append("file", uploadFile);
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        const upData = await upRes.json();
        if (!upRes.ok) throw new Error(upData.error || "File upload failed");
        imageUrl = upData.url;
      }

      const finalUrl = isImage ? imageUrl : videoUrl;

      // 2) Persist the record to /api/gallery (Supabase user_media)
      let serverId: string | null = null;
      try {
        const saveRes = await fetch("/api/gallery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: finalUrl,
            caption: uploadForm.title.trim(),
            type: isImage ? "image" : "video",
          }),
        });
        const saveData = await saveRes.json();
        if (saveRes.ok && saveData?.item?.id) {
          serverId = saveData.item.id;
        } else {
          // Not fatal — keep the local copy so the user sees their work
          showToast(`Saved locally — server: ${saveData?.error || "unavailable"}`, "error");
        }
      } catch {
        showToast("Offline — saved locally only", "error");
      }

      // 3) Add to local state (immediately visible) + cache in localStorage
      const newItem: GalleryItem = {
        id: serverId ?? `user_${Date.now()}`,
        title: uploadForm.title.trim(),
        artist: uploadForm.artist.trim() || "You",
        category: uploadForm.category,
        imageUrl: isImage
          ? imageUrl
          : "https://images.unsplash.com/photo-1515630278258-407f66498911?w=400&h=300&fit=crop",
        likes: 0,
        createdAt: new Date().toISOString().split("T")[0],
        mediaType: isImage ? "image" : "video",
        videoUrl: isImage ? undefined : videoUrl,
      };
      const updated = [newItem, ...userItems];
      setUserItems(updated);
      localStorage.setItem("litlabs-gallery-user", JSON.stringify(updated));
      setUploadForm({
        title: "",
        imageUrl: "",
        videoUrl: "",
        artist: "",
        category: "abstract",
        mediaType: "image",
      });
      setUploadFile(null);
      setShowUpload(false);
      if (serverId) showToast("Your creation has been shared to the gallery!");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteUserItem = (id: string) => {
    const updated = userItems.filter(i => i.id !== id);
    setUserItems(updated);
    localStorage.setItem("litlabs-gallery-user", JSON.stringify(updated));
    showToast("Item removed.");
  };

  return (
    <PageShell title="Gallery" subtitle="AI-generated art, worlds, and creative works">
      {/* Retro Ticker */}
      <div className="w-full bg-black py-1 border-b-2 overflow-hidden flex" style={{ borderColor: T.borderColor, color: T.accentColor }}>
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px]">
          <span>🎨 AI GALLERY RENDERS ONLINE // SECTOR 9 IMAGING SECTOR</span>
          <span>⚡ PIXEL FORGE MODELS LIVE GENERATING 360° SPHERES DAILY</span>
          <span>🪐 IMMERSIVE AI IMAGE GENERATION ACROSS MULTIPLE PROVIDERS</span>
        </div>
      </div>

      {/* ── Dynamic Featured Hero ── */}
      <div className="relative overflow-hidden" style={{ borderBottom: `2px solid ${T.borderColor}` }}>
        {(() => {
          const featured = [...items].sort((a, b) => b.likes - a.likes)[0] || DEMO_ITEMS[0];
          return (
            <div className="relative h-[380px] sm:h-[480px] group">
              {brokenImages.has(featured.imageUrl) ? (
                <div className="absolute inset-0 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${T.accentColor}20, ${T.linkColor}20)` }}>
                  <span className="text-4xl opacity-30">🎨</span>
                </div>
              ) : (
                <Image
                  src={featured.imageUrl}
                  alt={featured.title}
                  fill
                  className="object-cover transition-transform duration-[2s] ease-out group-hover:scale-105"
                  priority
                  unoptimized
                  onError={() => setBrokenImages(prev => new Set(prev).add(featured.imageUrl))}
                />
              )}
              {/* Vignette + gradient overlays */}
              <div className="absolute inset-0" style={{ background: `linear-gradient(to top, ${T.bgColor} 0%, ${T.bgColor}e6 35%, transparent 70%)` }} />
              <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${T.linkColor}10 0%, transparent 50%)` }} />
              <div className="absolute inset-0" style={{ boxShadow: `inset 0 -80px 80px -40px ${T.bgColor}` }} />

              {/* Hero content */}
              <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-10">
                <div className="max-w-6xl mx-auto">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded" style={{ backgroundColor: T.accentColor + '20', color: T.accentColor, border: `1px solid ${T.accentColor}40` }}>Featured</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-50" style={{ color: T.textColor }}>{featured.artist}</span>
                    <span className="text-[10px] opacity-30">·</span>
                    <span className="text-[10px] opacity-40" style={{ color: T.textColor }}>{featured.likes.toLocaleString()} sparks</span>
                  </div>
                  <h1 className="text-4xl sm:text-6xl font-black tracking-tight mb-2" style={{ color: T.headerColor, textShadow: `0 2px 30px ${T.bgColor}` }}>
                    {featured.title}
                  </h1>
                  <p className="text-sm sm:text-base opacity-60 max-w-lg mb-6" style={{ color: T.textColor }}>
                    Worlds, characters, and dreams generated by AI agents. Every pixel born from a prompt.
                  </p>
                  <div className="flex gap-3 flex-wrap items-center">
                    {[
                      { label: "Works", value: items.length },
                      { label: "Artists", value: new Set(items.map(i => i.artist)).size },
                      { label: "Sparks", value: items.reduce((s, i) => s + i.likes, 0) },
                    ].map((stat, i) => (
                      <div key={stat.label} className="px-4 py-2 rounded-lg backdrop-blur-sm" style={{ backgroundColor: T.boxBg + '80', border: `1px solid ${T.borderColor}30` }}>
                        <div className="text-lg font-black" style={{ color: i === 0 ? T.accentColor : T.headerColor }}>{stat.value.toLocaleString()}</div>
                        <div className="text-[10px] uppercase tracking-wider opacity-40" style={{ color: T.textColor }}>{stat.label}</div>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        // Clear filters so featured item is in the Lightbox list
                        setSelectedCategory('all');
                        setSearchQuery('');
                        setSelectedItem(featured);
                      }}
                      className="px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all hover:scale-105"
                      style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                    >
                      View Featured
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Trending Strip ── */}
      <div style={{ borderBottom: `1px solid ${T.borderColor}30`, backgroundColor: T.boxBg + '30' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-40" style={{ color: T.accentColor }}>Trending Now</span>
            <div className="flex-1 h-px" style={{ backgroundColor: T.borderColor + '20' }} />
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
            {[...items].sort((a, b) => b.likes - a.likes).slice(0, 6).map(item => (
              <button
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="shrink-0 w-[140px] sm:w-[180px] text-left rounded-lg overflow-hidden transition-transform hover:scale-[1.03] group"
                style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20` }}
              >
                <div className="relative h-[90px] sm:h-[110px]">
                  {brokenImages.has(item.imageUrl) ? (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${T.accentColor}15, ${T.linkColor}15)` }}>
                      <span className="text-lg opacity-30">🎨</span>
                    </div>
                  ) : (
                    <Image src={item.imageUrl} alt={item.title} fill className="object-cover" unoptimized sizes="180px" onError={() => setBrokenImages(prev => new Set(prev).add(item.imageUrl))} />
                  )}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: `linear-gradient(to top, ${T.bgColor}cc, transparent)` }} />
                </div>
                <div className="p-2">
                  <div className="text-[10px] font-bold truncate" style={{ color: T.textColor }}>{item.title}</div>
                  <div className="text-[9px] opacity-40 flex items-center gap-1" style={{ color: T.textColor }}>
                    <span>♡</span> {item.likes.toLocaleString()}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`lit-toast ${toast.type}`}>
          {toast.msg}
        </div>
      )}

      {/* ── Controls Bar ── */}
      <div className="sticky top-0 z-30 backdrop-blur-md" style={{ padding: "14px 24px", borderBottom: `1px solid ${T.borderColor}40`, display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", backgroundColor: T.boxBg + 'dd' }}>
        {/* Category pills */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className="px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200"
              style={{
                border: `1px solid ${selectedCategory === cat.id ? T.accentColor + '60' : T.borderColor + '30'}`,
                backgroundColor: selectedCategory === cat.id ? T.accentColor + '12' : T.bgColor + '60',
                color: selectedCategory === cat.id ? T.accentColor : T.textColor + 'cc',
                cursor: "pointer",
              }}
            >
              {cat.label.replace(/[🌌🌍👤🏔️🎨]/g, '').trim()} <span style={{ opacity: 0.5 }}>{cat.count}</span>
            </button>
          ))}
        </div>
        {/* Right controls */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs outline-none transition-all focus:ring-1"
              style={{
                backgroundColor: T.bgColor + '80',
                border: `1px solid ${T.borderColor}30`,
                color: T.textColor,
                width: '140px',
              }}
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs opacity-30">🔍</span>
          </div>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-[11px] outline-none cursor-pointer"
            style={{ backgroundColor: T.bgColor + '80', border: `1px solid ${T.borderColor}30`, color: T.textColor + 'cc' }}
          >
            {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label.replace(/[🕐🔥🔤]/g, '').trim()}</option>)}
          </select>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:opacity-90"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            {showUpload ? '✕' : '+ Upload'}
          </button>
        </div>
      </div>

      {/* ── Upload Form ── */}
      {showUpload && (
        <div style={{ padding: "24px", borderBottom: `1px solid ${T.borderColor}`, backgroundColor: T.boxBg }}>
          <div className="lit-box p-4 max-w-xl mx-auto" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
            <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Share Your Creation</div>
            <div style={{ display: "grid", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Media Type</label>
                <select
                  value={uploadForm.mediaType}
                  onChange={e => setUploadForm({ ...uploadForm, mediaType: e.target.value as "image" | "video" })}
                  style={{ width: "100%", padding: "8px", backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor, fontSize: "12px", outline: "none", marginTop: "4px" }}
                >
                  <option value="image">Image</option>
                  <option value="video">Video (YouTube / MP4 URL)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Title</label>
                <input type="text" value={uploadForm.title} onChange={e => setUploadForm({ ...uploadForm, title: e.target.value })} placeholder="Name your piece..." style={{ width: "100%", padding: "8px", backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor, fontSize: "12px", outline: "none", marginTop: "4px" }} />
              </div>
              {uploadForm.mediaType === "image" && (
                <>
                  <div>
                    <label style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Image File (optional)</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                      style={{ width: "100%", padding: "8px", backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor, fontSize: "12px", outline: "none", marginTop: "4px" }}
                    />
                    {uploadFile && <div style={{ fontSize: "10px", color: T.accentColor, marginTop: "4px" }}>Selected: {uploadFile.name}</div>}
                  </div>
                  <div>
                    <label style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>— or Image URL</label>
                    <input type="text" value={uploadForm.imageUrl} onChange={e => setUploadForm({ ...uploadForm, imageUrl: e.target.value })} placeholder="https://..." disabled={!!uploadFile} style={{ width: "100%", padding: "8px", backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor, fontSize: "12px", outline: "none", marginTop: "4px", opacity: uploadFile ? 0.4 : 1 }} />
                  </div>
                </>
              )}
              {uploadForm.mediaType === "video" && (
                <div>
                  <label style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Video URL</label>
                  <input
                    type="text"
                    value={uploadForm.videoUrl}
                    onChange={e => setUploadForm({ ...uploadForm, videoUrl: e.target.value })}
                    placeholder="https://youtu.be/... or https://...mp4"
                    style={{ width: "100%", padding: "8px", backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor, fontSize: "12px", outline: "none", marginTop: "4px" }}
                  />
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Artist</label>
                  <input type="text" value={uploadForm.artist} onChange={e => setUploadForm({ ...uploadForm, artist: e.target.value })} placeholder="Your name..." style={{ width: "100%", padding: "8px", backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor, fontSize: "12px", outline: "none", marginTop: "4px" }} />
                </div>
                <div>
                  <label style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Category</label>
                  <select value={uploadForm.category} onChange={e => setUploadForm({ ...uploadForm, category: e.target.value })} style={{ width: "100%", padding: "8px", backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor, fontSize: "12px", outline: "none", marginTop: "4px" }}>
                    <option value="abstract">Abstract</option>
                    <option value="character">Character</option>
                    <option value="landscape">Landscape</option>
                    <option value="360-worlds">360° Worlds</option>
                  </select>
                </div>
              </div>
              <button onClick={handleUpload} disabled={uploading} style={{ padding: "10px", backgroundColor: T.accentColor, color: "#0a0a0f", border: "none", cursor: uploading ? "wait" : "pointer", fontSize: "12px", fontWeight: "bold", opacity: uploading ? 0.6 : 1 }}>
                {uploading ? "⏳ Uploading..." : "🚀 Publish to Gallery"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Enhanced Masonry Gallery ── */}
      <div className="px-4 py-6 sm:px-6 max-w-7xl mx-auto">
        <div className="gallery-masonry">
          {filteredItems.map((item, idx) => {
            const aspect = [1, 1.25, 0.85, 1.1, 1.3, 0.9, 1.15, 1, 1.2, 0.8, 1.05, 1.35][idx % 12];
            const isLiked = likedItems.has(item.id);
            return (
              <div
                key={item.id}
                className="gallery-item group relative rounded-xl overflow-hidden cursor-pointer"
                style={{
                  backgroundColor: T.boxBg,
                  border: `1px solid ${T.borderColor}20`,
                  marginBottom: '16px',
                  breakInside: 'avoid',
                  transition: 'border-color 0.3s, box-shadow 0.3s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = T.accentColor + '40'; (e.currentTarget as HTMLElement).style.boxShadow = `0 0 20px ${T.accentColor}10`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.borderColor + '20'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
                onClick={() => {
                  if (item.mediaType === "video" && item.videoUrl) {
                    window.open(item.videoUrl, "_blank", "noopener,noreferrer");
                  } else {
                    setSelectedItem(item);
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') setSelectedItem(item); }}
                role="button"
                tabIndex={0}
              >
                {/* Image */}
                <div className="relative overflow-hidden" style={{ aspectRatio: `${aspect}` }}>
                  {brokenImages.has(item.imageUrl) ? (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${T.accentColor}15, ${T.linkColor}15)` }}>
                      <span className="text-3xl opacity-30">🎨</span>
                    </div>
                  ) : (
                    <Image
                      src={item.imageUrl}
                      alt={item.title}
                      fill
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      unoptimized
                      onError={() => setBrokenImages(prev => new Set(prev).add(item.imageUrl))}
                    />
                  )}
                  {/* Dark gradient overlay for text readability */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    style={{ background: `linear-gradient(to top, ${T.bgColor}f0 0%, ${T.bgColor}80 30%, transparent 60%)` }}
                  />
                  {/* Neon glow on hover */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                    style={{ boxShadow: `inset 0 0 40px ${T.accentColor}15, 0 0 30px ${T.accentColor}08` }}
                  />

                  {/* Category badge */}
                  <div className="absolute top-3 right-3 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm"
                    style={{ backgroundColor: T.bgColor + 'cc', color: T.accentColor, border: `1px solid ${T.accentColor}40` }}>
                    {item.category}
                  </div>

                  {/* Delete button for user items */}
                  {item.id.startsWith("user_") && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteUserItem(item.id); }}
                      className="absolute top-3 left-3 w-7 h-7 rounded-md flex items-center justify-center text-xs backdrop-blur-sm transition-colors hover:bg-red-500/80"
                      style={{ backgroundColor: T.bgColor + 'cc', color: '#fff' }}
                    >
                      🗑
                    </button>
                  )}

                  {/* Hover action bar */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-2 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end justify-between">
                    <div>
                      <div className="text-sm font-bold mb-0.5" style={{ color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>{item.title}</div>
                      <div className="text-[10px] opacity-80" style={{ color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>by {item.artist}</div>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(window.location.origin + '/gallery#' + item.id);
                        showToast('Link copied!', 'success');
                      }}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs backdrop-blur-sm transition-all hover:scale-110"
                      style={{ backgroundColor: T.bgColor + 'cc', color: T.textColor }}
                      title="Copy link"
                    >
                      🔗
                    </button>
                  </div>
                </div>

                {/* Card footer */}
                <div className="px-3 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black shrink-0"
                      style={{ backgroundColor: stringToColor(item.artist), color: '#fff' }}>
                      {item.artist.charAt(0)}
                    </div>
                    <span className="text-[11px] truncate opacity-60" style={{ color: T.textColor }}>{item.artist}</span>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); toggleLike(item.id); }}
                    className="flex items-center gap-1 text-[11px] transition-all duration-200 hover:scale-110"
                    style={{ color: isLiked ? '#ff3366' : T.textColor + '80', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    <span className={`inline-block transition-transform duration-300 ${isLiked ? 'scale-125' : ''}`} style={{ filter: isLiked ? 'drop-shadow(0 0 4px #ff3366)' : 'none' }}>
                      {isLiked ? '❤' : '♡'}
                    </span>
                    <span className="font-medium">{item.likes.toLocaleString()}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {filteredItems.length === 0 && (
        <div className="text-center py-20" style={{ color: T.textColor }}>
          <div className="text-5xl mb-4 opacity-30">🌑</div>
          <div className="text-sm opacity-50">No creations found in this sector.</div>
          <button
            onClick={() => { setSelectedCategory('all'); setSearchQuery(''); }}
            className="mt-4 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-all hover:opacity-80"
            style={{ backgroundColor: T.accentColor + '15', color: T.accentColor, border: `1px solid ${T.accentColor}30` }}
          >
            View All Works
          </button>
        </div>
      )}

      {/* ── Lightbox ── */}
      <Lightbox
        images={items.map(item => ({ src: item.imageUrl, alt: item.title, caption: `${item.title} — by ${item.artist} · ${item.category.toUpperCase()} · ${item.likes} sparks` }))}
        currentIndex={selectedItem ? Math.max(0, items.findIndex(i => i.id === selectedItem.id)) : 0}
        isOpen={!!selectedItem}
        onClose={handleLightboxClose}
        onNext={handleLightboxNext}
        onPrev={handleLightboxPrev}
      />

      {/* ── Floating Create Button ── */}
      <Link href="/studio?tool=image" style={{ position: "fixed", bottom: "24px", right: "24px", width: "56px", height: "56px", borderRadius: "50%", backgroundColor: T.linkColor, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", textDecoration: "none", boxShadow: `0 4px 16px ${T.linkColor}40`, zIndex: 50, cursor: "pointer" }} title="AI Image Generator">
        🎨
      </Link>

      <style>{`
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${T.bgColor}; }
        ::-webkit-scrollbar-thumb { background: ${T.borderColor}; border-radius: 3px; }
        .gallery-masonry {
          columns: 1;
          column-gap: 16px;
        }
        @media (min-width: 640px) { .gallery-masonry { columns: 2; } }
        @media (min-width: 1024px) { .gallery-masonry { columns: 3; } }
        @media (min-width: 1400px) { .gallery-masonry { columns: 4; } }
        .gallery-item { break-inside: avoid; page-break-inside: avoid; }
      `}</style>
    </PageShell>
  );
}
