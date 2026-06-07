"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "@/context/ThemeContext";
import { useAuth, RedirectToSignIn } from "@clerk/nextjs";

// ─── Demo gallery items ──────────────────────────────────────────────────────
const DEMO_ITEMS: GalleryItem[] = [
  { id: "1", title: "Neon Cyber City", artist: "Pixel Forge", category: "360-worlds", imageUrl: "https://images.unsplash.com/photo-1515630278258-407f66498911?w=400&h=300&fit=crop", likes: 234, createdAt: "2026-06-01" },
  { id: "2", title: "Ethereal Dreamscape", artist: "DreamWeaver", category: "abstract", imageUrl: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400&h=500&fit=crop", likes: 189, createdAt: "2026-06-02" },
  { id: "3", title: "Lost Temple Ruins", artist: "Explorer-X", category: "landscape", imageUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=300&fit=crop", likes: 312, createdAt: "2026-05-28" },
  { id: "4", title: "Quantum Warrior", artist: "Pixel Forge", category: "character", imageUrl: "https://images.unsplash.com/photo-1535295972055-1c762f4483e5?w=400&h=500&fit=crop", likes: 156, createdAt: "2026-06-03" },
  { id: "5", title: "Crystal Cavern", artist: "GeoMancer", category: "360-worlds", imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop", likes: 278, createdAt: "2026-05-30" },
  { id: "6", title: "Void Entity", artist: "ShadowNet", category: "character", imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&h=500&fit=crop", likes: 421, createdAt: "2026-06-04" },
  { id: "7", title: "Sunset Megacity", artist: "Pixel Forge", category: "landscape", imageUrl: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&h=300&fit=crop", likes: 198, createdAt: "2026-05-25" },
  { id: "8", title: "Fractal Mind", artist: "DreamWeaver", category: "abstract", imageUrl: "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=400&h=400&fit=crop", likes: 267, createdAt: "2026-05-29" },
  { id: "9", title: "Underwater Utopia", artist: "AquaBot", category: "360-worlds", imageUrl: "https://images.unsplash.com/photo-1582967788606-a171f1080ca8?w=400&h=300&fit=crop", likes: 345, createdAt: "2026-06-01" },
  { id: "10", title: "Cyber Samurai", artist: "Pixel Forge", category: "character", imageUrl: "https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=400&h=500&fit=crop", likes: 189, createdAt: "2026-05-27" },
  { id: "11", title: "Starfield Station", artist: "StarWalker", category: "landscape", imageUrl: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&h=300&fit=crop", likes: 567, createdAt: "2026-06-04" },
  { id: "12", title: "Neural Network", artist: "DataMancer", category: "abstract", imageUrl: "https://images.unsplash.com/photo-1635070041078-e363dbe00518?w=400&h=400&fit=crop", likes: 234, createdAt: "2026-05-26" },
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

// ─── Types ───────────────────────────────────────────────────────────────────
type GalleryItem = {
  id: string;
  title: string;
  artist: string;
  category: string;
  imageUrl: string;
  likes: number;
  createdAt: string;
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function Gallery() {
  const { isLoaded, isSignedIn } = useAuth();
  const { resolvedColors: T } = useTheme();
  const [apiItems, setApiItems] = useState<GalleryItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [likedItems, setLikedItems] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [viewMode, setViewMode] = useState<"grid" | "masonry">("masonry");
  const [crtEnabled, setCrtEnabled] = useState(true);
  const [userItems, setUserItems] = useState<GalleryItem[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ title: "", imageUrl: "", artist: "", category: "abstract" });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Merge demo + real API + user items
  const items = [...apiItems, ...DEMO_ITEMS, ...userItems].map(item => ({
    ...item,
    likes: likeCounts[item.id] !== undefined ? likeCounts[item.id] : item.likes,
  }));

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

    const val = localStorage.getItem("crt_global_scanlines");
    if (val !== null) {
      setCrtEnabled(val === "true");
    }
    const storedUserItems = localStorage.getItem("litlabs-gallery-user");
    if (storedUserItems) {
      try { setUserItems(JSON.parse(storedUserItems)); } catch { /* ignore */ }
    }
  }, []);

  if (!isLoaded) {
    return (
      <div style={{ backgroundColor: T?.bgColor || "#0a0a0f", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: T?.textColor || "#00ff41", fontFamily: "monospace" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "16px" }}>⏳</div>
          <div>Loading gallery...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <RedirectToSignIn redirectUrl="/gallery" />;
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
    if (!uploadForm.imageUrl.trim() && !uploadFile) {
      showToast("Provide an image URL or select a file", "error");
      return;
    }
    if (uploading) return;

    setUploading(true);
    try {
      let imageUrl = uploadForm.imageUrl.trim();

      // 1) If a file was chosen, upload to /api/upload first to get a hosted URL
      if (uploadFile) {
        const fd = new FormData();
        fd.append("file", uploadFile);
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        const upData = await upRes.json();
        if (!upRes.ok) throw new Error(upData.error || "File upload failed");
        imageUrl = upData.url;
      }

      // 2) Persist the record to /api/gallery (Supabase user_media)
      let serverId: string | null = null;
      try {
        const saveRes = await fetch("/api/gallery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: imageUrl,
            caption: uploadForm.title.trim(),
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
        imageUrl,
        likes: 0,
        createdAt: new Date().toISOString().split("T")[0],
      };
      const updated = [newItem, ...userItems];
      setUserItems(updated);
      localStorage.setItem("litlabs-gallery-user", JSON.stringify(updated));
      setUploadForm({ title: "", imageUrl: "", artist: "", category: "abstract" });
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
    <div style={{ backgroundColor: T.bgColor, minHeight: "100vh", color: T.textColor, fontFamily: "monospace", position: "relative" }}>
      
      {/* CRT Scanline Filter */}
      {crtEnabled && (
        <div className="fixed inset-0 pointer-events-none z-40 opacity-[0.06]" style={{
          background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 1px, transparent 1px, transparent 2px)",
          boxShadow: "inset 0 0 80px rgba(0, 255, 0, 0.3)"
        }} />
      )}

      {/* Retro Ticker */}
      <div className="w-full bg-black py-1 border-b-2 overflow-hidden flex" style={{ borderColor: T.borderColor, color: T.accentColor }}>
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px]">
          <span>🎨 AI GALLERY RENDERS ONLINE // SECTOR 9 IMAGING SECTOR</span>
          <span>⚡ PIXEL FORGE MODELS LIVE GENERATING 360° SPHERES DAILY</span>
          <span>🪐 IMMERSIVE AI IMAGE GENERATION ACROSS MULTIPLE PROVIDERS</span>
        </div>
      </div>

      {/* ── Hero Header ── */}
      <div style={{ borderBottom: `2px solid ${T.borderColor}`, padding: "32px 24px", textAlign: "center", background: `linear-gradient(180deg, ${T.boxBg} 0%, ${T.bgColor} 100%)` }}>
        <h1 style={{ color: T.headerColor, fontSize: "32px", fontWeight: "bold", letterSpacing: "3px", marginBottom: "8px" }}>🎨 AI ART GALLERY</h1>
        <p style={{ color: T.textColor, fontSize: "13px", opacity: 0.7, maxWidth: "500px", margin: "0 auto 20px" }}>Explore worlds, characters, and dreams generated by AI agents</p>
        <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
          {[
            { label: "Total Works", value: items.length },
            { label: "Artists", value: new Set(items.map(i => i.artist)).size },
            { label: "Categories", value: 4 },
            { label: "Total Likes", value: items.reduce((s, i) => s + i.likes, 0) },
          ].map(stat => (
            <div key={stat.label} style={{ padding: "8px 16px", border: `1px solid ${T.borderColor}`, backgroundColor: "rgba(0,0,0,0.3)" }}>
              <div style={{ color: T.accentColor, fontSize: "18px", fontWeight: "bold" }}>{stat.value}</div>
              <div style={{ fontSize: "9px", color: T.textColor, opacity: 0.7 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`lit-toast ${toast.type}`}>
          {toast.msg}
        </div>
      )}

      {/* ── Controls Bar ── */}
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${T.borderColor}`, display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", backgroundColor: T.boxBg }}>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                padding: "6px 12px", fontSize: "11px", border: `1px solid ${selectedCategory === cat.id ? T.accentColor : T.borderColor}`,
                backgroundColor: selectedCategory === cat.id ? "rgba(255,255,0,0.15)" : "transparent",
                color: selectedCategory === cat.id ? T.accentColor : T.textColor,
                cursor: "pointer", fontFamily: "monospace",
              }}
            >
              {cat.label} ({cat.count})
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 Search art or artist..."
            style={{ padding: "8px 12px", backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: "#e0e0e0", fontSize: "12px", fontFamily: "monospace", width: "170px", outline: "none" }}
          />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{ padding: "8px", backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor, fontSize: "11px", fontFamily: "monospace", cursor: "pointer", outline: "none" }}
          >
            {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button onClick={() => setViewMode(v => v === "grid" ? "masonry" : "grid")} style={{ padding: "8px", backgroundColor: "transparent", border: `1px solid ${T.borderColor}`, color: T.textColor, cursor: "pointer", fontSize: "11px" }}>
            {viewMode === "grid" ? "☰ Masonry" : "⊞ Grid"}
          </button>
          <button onClick={() => setShowUpload(!showUpload)} style={{ padding: "8px 14px", backgroundColor: T.linkColor, color: "#0a0a0f", border: "none", cursor: "pointer", fontSize: "11px", fontWeight: "bold" }}>
            {showUpload ? "✕ Close" : "+ Share Creation"}
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
                <label style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Title</label>
                <input type="text" value={uploadForm.title} onChange={e => setUploadForm({ ...uploadForm, title: e.target.value })} placeholder="Name your piece..." style={{ width: "100%", padding: "8px", backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor, fontSize: "12px", outline: "none", marginTop: "4px" }} />
              </div>
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

      {/* ── Gallery Grid ── */}
      <div className="px-4 py-6 md:px-6" style={{ display: "grid", gap: "16px", gridTemplateColumns: viewMode === "grid" ? "repeat(auto-fill, minmax(260px, 1fr))" : "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {filteredItems.map(item => (
          <div
            key={item.id}
            onClick={() => setSelectedItem(item)}
            className="lit-box group"
            style={{
              borderColor: T.borderColor, backgroundColor: T.boxBg, cursor: "pointer",
              padding: "0px", margin: "0", overflow: "hidden"
            }}
          >
            <div style={{ position: "relative", width: "100%", height: viewMode === "masonry" ? `${180 + (item.id.charCodeAt(0) % 3) * 60}px` : "200px", overflow: "hidden" }}>
              <Image src={item.imageUrl} alt={item.title} fill style={{ objectFit: "cover" }} sizes="(max-width: 768px) 100vw, 300px" unoptimized />
              <div style={{ position: "absolute", top: "8px", right: "8px", padding: "4px 8px", backgroundColor: "rgba(0,0,0,0.8)", border: `1px solid ${T.borderColor}`, color: T.accentColor, fontSize: "9px", textTransform: "uppercase" }}>
                {item.category}
              </div>
              {item.id.startsWith("user_") && (
                <button
                  onClick={e => { e.stopPropagation(); handleDeleteUserItem(item.id); }}
                  style={{ position: "absolute", top: "8px", left: "8px", padding: "4px 8px", backgroundColor: "rgba(255,0,0,0.7)", color: "white", border: "none", cursor: "pointer", fontSize: "10px", fontWeight: "bold" }}
                >
                  🗑
                </button>
              )}
            </div>
            <div style={{ padding: "12px" }}>
              <div style={{ color: T.headerColor, fontSize: "13px", fontWeight: "bold", marginBottom: "4px" }}>{item.title}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "10px", color: T.textColor, opacity: 0.7 }}>by {item.artist}</span>
                <button
                  onClick={e => { e.stopPropagation(); toggleLike(item.id); }}
                  style={{ backgroundColor: "transparent", border: "none", color: likedItems.has(item.id) ? "#ff0080" : T.textColor, cursor: "pointer", fontSize: "12px" }}
                >
                  {likedItems.has(item.id) ? "❤️" : "🤍"} {item.likes}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredItems.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: T.textColor, opacity: 0.5 }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>🔍</div>
          <div>No works found matching your search.</div>
        </div>
      )}

      {/* ── Lightbox Modal ── */}
      {selectedItem && (
        <div
          onClick={() => setSelectedItem(null)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.95)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
        >
          <div onClick={e => e.stopPropagation()} className="lit-box" style={{ maxWidth: "900px", width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", backgroundColor: T.boxBg, borderColor: T.borderColor, padding: "0" }}>
            <div style={{ position: "relative", flex: 1, minHeight: "300px", height: "50vh" }}>
              <Image src={selectedItem.imageUrl} alt={selectedItem.title} fill style={{ objectFit: "contain" }} sizes="900px" unoptimized />
              <button onClick={() => setSelectedItem(null)} style={{ position: "absolute", top: "12px", right: "12px", backgroundColor: "rgba(0,0,0,0.7)", border: `1px solid ${T.borderColor}`, color: "white", padding: "8px 12px", cursor: "pointer", fontSize: "14px" }}>✕</button>
            </div>
            <div style={{ padding: "16px", borderTop: `1px solid ${T.borderColor}` }}>
              <div style={{ color: T.headerColor, fontSize: "18px", fontWeight: "bold", marginBottom: "8px" }}>{selectedItem.title}</div>
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "11px" }}>
                <span style={{ color: T.textColor }}>👤 ARTIST: <strong style={{ color: T.linkColor }}>{selectedItem.artist}</strong></span>
                <span style={{ color: T.textColor }}>📂 CATEGORY: <strong style={{ color: T.accentColor }}>{selectedItem.category.toUpperCase()}</strong></span>
                <span style={{ color: T.textColor }}>❤️ ENGAGEMENTS: {selectedItem.likes} sparks</span>
                <span style={{ color: T.textColor }}>📅 COMPILED: {selectedItem.createdAt}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Floating Create Button ── */}
      <Link href="/generate" style={{ position: "fixed", bottom: "24px", right: "24px", width: "56px", height: "56px", borderRadius: "50%", backgroundColor: T.linkColor, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", textDecoration: "none", boxShadow: `0 4px 16px ${T.linkColor}40`, zIndex: 50, cursor: "pointer" }} title="AI Image Generator">
        🎨
      </Link>

      <style>{`
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${T.bgColor}; }
        ::-webkit-scrollbar-thumb { background: ${T.borderColor}; }
      `}</style>
    </div>
  );
}
