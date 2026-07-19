"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth, useAppUser } from "@/hooks/useClerkAuth";
import { useRouter } from "next/navigation";
import PageShell from "@/components/PageShell";
import Lightbox from "@/components/Lightbox";

// ─── Demo gallery items ──────────────────────────────────────────────────────
// The API handles demo fallback when Supabase is not configured.
// This page only renders items from the API + user uploads.

const CATEGORIES = [
  { id: "all", label: "🌌 All Works" },
  { id: "360-worlds", label: "🌍 360° Worlds" },
  { id: "character", label: "👤 Characters" },
  { id: "landscape", label: "🏔️ Landscapes" },
  { id: "abstract", label: "🎨 Abstract" },
];

const SORT_OPTIONS = [
  { id: "newest", label: "🕐 Newest" },
  { id: "popular", label: "🔥 Most Liked" },
  { id: "name", label: "🔤 Name" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++)
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash % 360);
  return `hsl(${h}, 65%, 45%)`;
}

// Extract aspect ratio from Pollinations URL (width/height params)
function getImageAspectRatio(imageUrl: string): number {
  // Default to 1:1 if URL parsing fails
  let width = 1024;
  let height = 1024;

  try {
    const url = new URL(imageUrl);
    const w = url.searchParams.get("width");
    const h = url.searchParams.get("height");
    if (w) width = parseInt(w, 10) || width;
    if (h) height = parseInt(h, 10) || height;
  } catch {
    // If URL parsing fails, try regex fallback
    const widthMatch = imageUrl.match(/[?&]width=(\d+)/);
    const heightMatch = imageUrl.match(/[?&]height=(\d+)/);
    if (widthMatch) width = parseInt(widthMatch[1], 10) || width;
    if (heightMatch) height = parseInt(heightMatch[1], 10) || height;
  }

  // Clamp aspect ratio to reasonable masonry bounds
  const ratio = width / height;
  return Math.max(0.6, Math.min(1.8, ratio));
}

// ─── Types ───────────────────────────────────────────────────────────────────
type GalleryItem = {
  id: string;
  title: string;
  artist: string;
  artistAvatar?: string | null;
  category: string;
  imageUrl: string;
  likes: number;
  isPublic?: boolean;
  isOwner?: boolean;
  createdAt: string;
  mediaType?: "image" | "video" | "audio";
  videoUrl?: string;
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function Gallery() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user } = useAppUser();
  const router = useRouter();
  const { resolvedColors: T } = useTheme();
  const [apiItems, setApiItems] = useState<GalleryItem[]>([]);
  const [viewMode, setViewMode] = useState<"community" | "my-uploads">(
    "community",
  );
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [likedItems, setLikedItems] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [userItems, setUserItems] = useState<GalleryItem[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = localStorage.getItem("litlabs-gallery-user");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return [];
      }
    }
    return [];
  });
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: "",
    imageUrl: "",
    videoUrl: "",
    artist: "",
    category: "abstract",
    mediaType: "image" as "image" | "video",
    isPublic: true,
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [isMock, setIsMock] = useState(false);

  // Real API items first; fall back to user items only when API returns nothing
  const baseItems =
    apiItems.length > 0
      ? [...apiItems, ...userItems]
      : [...userItems];
  const items = baseItems.map((item) => ({
    ...item,
    likes: likeCounts[item.id] !== undefined ? likeCounts[item.id] : item.likes,
  }));

  // Memoized Lightbox navigation handlers to prevent infinite loops
  const handleLightboxNext = useCallback(() => {
    if (!selectedItem) return;
    const idx = items.findIndex((i) => i.id === selectedItem.id);
    if (idx !== -1) {
      setSelectedItem(items[(idx + 1) % items.length]);
    }
  }, [items, selectedItem]);

  const handleLightboxPrev = useCallback(() => {
    if (!selectedItem) return;
    const idx = items.findIndex((i) => i.id === selectedItem.id);
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

  // Fetch gallery items when view mode or category changes
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("view", viewMode);
    if (selectedCategory !== "all") {
      params.set("category", selectedCategory);
    }

    fetch(`/api/gallery?${params.toString()}`)
      .then((r) => r.json())
      .then((data: { items?: GalleryItem[]; mock?: boolean }) => {
        setIsMock(data.mock === true);
        if (data.items && data.items.length > 0) {
          // Mark items as owned by current user
          const currentUserName = user?.fullName || user?.username;
          const itemsWithOwnership = data.items.map((item) => ({
            ...item,
            isOwner: item.artist === currentUserName,
          }));
          setApiItems(itemsWithOwnership);
        }
      })
      .catch(() => {
        // silent fail — demo items still show
      });
  }, [viewMode, selectedCategory, user]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/gallery");
    }
  }, [isLoaded, isSignedIn, router]);

  const toggleLike = useCallback(
    (id: string) => {
      setLikedItems((prev) => {
        const next = new Set(prev);
        const wasLiked = next.has(id);
        if (wasLiked) {
          next.delete(id);
        } else {
          next.add(id);
        }
        // Update like count
        setLikeCounts((counts) => {
          const current =
            counts[id] ?? items.find((i) => i.id === id)?.likes ?? 0;
          return { ...counts, [id]: wasLiked ? current - 1 : current + 1 };
        });
        return next;
      });
    },
    [items],
  );

  if (!isLoaded) {
    return (
      <div
        style={{
          backgroundColor: T?.bgColor || "#0f0f14",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: T?.textColor || "#e2e8f0",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "16px" }}>⏳</div>
          <div>Loading gallery...</div>
        </div>
      </div>
    );
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <div
        style={{
          backgroundColor: T?.bgColor || "#0f0f14",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: T?.textColor || "#e2e8f0",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "16px" }}>🔒</div>
          <div>Sign in to view the gallery</div>
        </div>
      </div>
    );
  }

  const filteredItems = items
    .filter(
      (i) => selectedCategory === "all" || i.category === selectedCategory,
    )
    .filter(
      (i) =>
        !searchQuery ||
        i.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.artist.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .sort((a, b) => {
      if (sortBy === "newest")
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      if (sortBy === "popular") return b.likes - a.likes;
      if (sortBy === "name") return a.title.localeCompare(b.title);
      return 0;
    });

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
      const videoUrl = uploadForm.videoUrl.trim();

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
            isPublic: uploadForm.isPublic,
            category: uploadForm.category,
          }),
        });
        const saveData = await saveRes.json();
        if (saveRes.ok && saveData?.item?.id) {
          serverId = saveData.item.id;
        } else {
          // Not fatal — keep the local copy so the user sees their work
          showToast(
            `Saved locally — server: ${saveData?.error || "unavailable"}`,
            "error",
          );
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
        isPublic: uploadForm.isPublic,
        isOwner: true,
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
        isPublic: true,
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

  const handleDeleteItem = async (id: string) => {
    try {
      const res = await fetch(`/api/gallery?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");

      // Remove from local state
      setApiItems((prev) => prev.filter((i) => i.id !== id));
      const updated = userItems.filter((i) => i.id !== id);
      setUserItems(updated);
      localStorage.setItem("litlabs-gallery-user", JSON.stringify(updated));
      showToast("Item deleted successfully");
    } catch {
      showToast("Failed to delete item", "error");
    }
  };

  const handleToggleVisibility = async (id: string, isPublic: boolean) => {
    try {
      const res = await fetch(`/api/gallery?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic }),
      });
      if (!res.ok) throw new Error("Failed to update");

      // Update local state
      setApiItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isPublic } : item)),
      );
      showToast(isPublic ? "Item is now public" : "Item is now private");
    } catch {
      showToast("Failed to update visibility", "error");
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        setUploadFile(file);
        // Create preview
        const reader = new FileReader();
        reader.onload = (ev) => {
          setUploadForm((prev) => ({
            ...prev,
            imageUrl: ev.target?.result as string,
            mediaType: file.type.startsWith("video/") ? "video" : "image",
          }));
        };
        reader.readAsDataURL(file);
      } else {
        showToast("Please drop an image or video file", "error");
      }
    }
  };

  return (
    <PageShell
      title="Gallery"
      subtitle="AI-generated art, worlds, and creative works"
    >
      {/* Retro Ticker */}
      <div
        className="w-full bg-black py-1 border-b-2 overflow-hidden flex"
        style={{ borderColor: T.borderColor, color: T.accentColor }}
      >
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px]">
          <span>🎨 AI GALLERY RENDERS ONLINE // SECTOR 9 IMAGING SECTOR</span>
          <span>⚡ PIXEL FORGE MODELS LIVE GENERATING 360° SPHERES DAILY</span>
          <span>
            🪐 IMMERSIVE AI IMAGE GENERATION ACROSS MULTIPLE PROVIDERS
          </span>
        </div>
      </div>

      {isMock && (
        <div
          className="w-full px-4 py-2 text-[10px] text-center"
          style={{ backgroundColor: T.accentColor + "20", color: T.accentColor, borderBottom: `1px solid ${T.accentColor}40` }}
        >
          🎨 Demo gallery — upload your first creation to start the community gallery.
        </div>
      )}

      {/* ── Dynamic Featured Hero ── */}
      <div
        className="relative overflow-hidden"
        style={{ borderBottom: `2px solid ${T.borderColor}` }}
      >
        {(() => {
          const featured =
            items.length > 0
              ? [...items].sort((a, b) => b.likes - a.likes)[0]
              : null;
          if (!featured) return null;
          return (
            <div className="relative h-[280px] sm:h-[380px] md:h-[480px] group">
              {brokenImages.has(featured.imageUrl) ? (
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${T.accentColor}20, ${T.linkColor}20)`,
                  }}
                >
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
                  sizes="100vw"
                  onError={() =>
                    setBrokenImages((prev) =>
                      new Set(prev).add(featured.imageUrl),
                    )
                  }
                />
              )}
              {/* Vignette + gradient overlays */}
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to top, ${T.bgColor} 0%, ${T.bgColor}e6 35%, transparent 70%)`,
                }}
              />
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(135deg, ${T.linkColor}10 0%, transparent 50%)`,
                }}
              />
              <div
                className="absolute inset-0"
                style={{ boxShadow: `inset 0 -80px 80px -40px ${T.bgColor}` }}
              />

              {/* Hero content */}
              <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 md:p-10">
                <div className="w-full">
                  <div className="flex items-center gap-2 mb-2 sm:mb-3">
                    <span
                      className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: T.accentColor + "20",
                        color: T.accentColor,
                        border: `1px solid ${T.accentColor}40`,
                      }}
                    >
                      Featured
                    </span>
                    <span
                      className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider opacity-50"
                      style={{ color: T.textColor }}
                    >
                      {featured.artist}
                    </span>
                    <span className="text-[9px] sm:text-[10px] opacity-30">·</span>
                    <span
                      className="text-[9px] sm:text-[10px] opacity-40"
                      style={{ color: T.textColor }}
                    >
                      {featured.likes.toLocaleString()} sparks
                    </span>
                  </div>
                  <h1
                    className="text-2xl sm:text-4xl md:text-6xl font-black tracking-tight mb-1 sm:mb-2"
                    style={{
                      color: T.headerColor,
                      textShadow: `0 2px 30px ${T.bgColor}`,
                    }}
                  >
                    {featured.title}
                  </h1>
                  <p
                    className="text-xs sm:text-sm md:text-base opacity-60 max-w-lg mb-4 sm:mb-6 hidden sm:block"
                    style={{ color: T.textColor }}
                  >
                    Worlds, characters, and dreams generated by AI agents. Every
                    pixel born from a prompt.
                  </p>
                  <div className="flex gap-2 sm:gap-3 flex-wrap items-center">
                    {[
                      { label: "Works", value: items.length },
                      {
                        label: "Artists",
                        value: new Set(items.map((i) => i.artist)).size,
                      },
                      {
                        label: "Sparks",
                        value: items.reduce((s, i) => s + i.likes, 0),
                      },
                    ].map((stat, i) => (
                      <div
                        key={stat.label}
                        className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg backdrop-blur-sm"
                        style={{
                          backgroundColor: T.boxBg + "80",
                          border: `1px solid ${T.borderColor}30`,
                        }}
                      >
                        <div
                          className="text-base sm:text-lg font-black"
                          style={{
                            color: i === 0 ? T.accentColor : T.headerColor,
                          }}
                        >
                          {stat.value.toLocaleString()}
                        </div>
                        <div
                          className="text-[9px] sm:text-[10px] uppercase tracking-wider opacity-40"
                          style={{ color: T.textColor }}
                        >
                          {stat.label}
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        // Clear filters so featured item is in the Lightbox list
                        setSelectedCategory("all");
                        setSearchQuery("");
                        setSelectedItem(featured);
                      }}
                      className="px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all hover:scale-105"
                      style={{
                        backgroundColor: T.accentColor,
                        color: T.bgColor,
                      }}
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
      <div
        style={{
          borderBottom: `1px solid ${T.borderColor}30`,
          backgroundColor: T.boxBg + "30",
        }}
      >
        <div className="w-full px-4 sm:px-6 py-4">
          <div className="flex items-center gap-3 mb-3">
            <span
              className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-40"
              style={{ color: T.accentColor }}
            >
              Trending Now
            </span>
            <div
              className="flex-1 h-px"
              style={{ backgroundColor: T.borderColor + "20" }}
            />
          </div>
          <div
            className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
            style={{ scrollbarWidth: "none" }}
          >
            {[...items]
              .sort((a, b) => b.likes - a.likes)
              .slice(0, 6)
              .map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="shrink-0 w-[140px] sm:w-[180px] text-left rounded-lg overflow-hidden transition-transform hover:scale-[1.03] group"
                  style={{
                    backgroundColor: T.boxBg,
                    border: `1px solid ${T.borderColor}20`,
                  }}
                >
                  <div className="relative h-[90px] sm:h-[110px]">
                    {brokenImages.has(item.imageUrl) ? (
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{
                          background: `linear-gradient(135deg, ${T.accentColor}15, ${T.linkColor}15)`,
                        }}
                      >
                        <span className="text-lg opacity-30">🎨</span>
                      </div>
                    ) : (
                      <Image
                        src={item.imageUrl}
                        alt={item.title}
                        fill
                        className="object-cover"
                        unoptimized
                        sizes="180px"
                        onError={() =>
                          setBrokenImages((prev) =>
                            new Set(prev).add(item.imageUrl),
                          )
                        }
                      />
                    )}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{
                        background: `linear-gradient(to top, ${T.bgColor}cc, transparent)`,
                      }}
                    />
                  </div>
                  <div className="p-2">
                    <div
                      className="text-[10px] font-bold truncate"
                      style={{ color: T.textColor }}
                    >
                      {item.title}
                    </div>
                    <div
                      className="text-[9px] opacity-40 flex items-center gap-1"
                      style={{ color: T.textColor }}
                    >
                      <span>♡</span> {item.likes.toLocaleString()}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && <div className={`lit-toast ${toast.type}`}>{toast.msg}</div>}

      {/* ── Controls Bar ── */}
      <div
        className="sticky top-0 z-30 backdrop-blur-md"
        style={{
          padding: "12px 16px sm:14px 24px",
          borderBottom: `1px solid ${T.borderColor}40`,
          display: "flex",
          gap: "8px sm:gap-12px",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: T.boxBg + "dd",
        }}
      >
        {/* Left side: View Mode Tabs + Categories */}
        <div className="flex gap-2 sm:gap-3 flex-wrap items-center">
          {/* View Mode Tabs */}
          <div
            className="flex rounded-lg p-0.5"
            style={{
              backgroundColor: T.bgColor + "60",
              border: `1px solid ${T.borderColor}30`,
            }}
          >
            <button
              onClick={() => setViewMode("community")}
              className="px-2 sm:px-3 py-1.5 rounded-md text-[10px] sm:text-[11px] font-bold transition-all"
              style={{
                backgroundColor:
                  viewMode === "community"
                    ? T.accentColor + "20"
                    : "transparent",
                color:
                  viewMode === "community" ? T.accentColor : T.textColor + "80",
              }}
            >
              🌐 Community
            </button>
            <button
              onClick={() => setViewMode("my-uploads")}
              className="px-2 sm:px-3 py-1.5 rounded-md text-[10px] sm:text-[11px] font-bold transition-all"
              style={{
                backgroundColor:
                  viewMode === "my-uploads"
                    ? T.accentColor + "20"
                    : "transparent",
                color:
                  viewMode === "my-uploads"
                    ? T.accentColor
                    : T.textColor + "80",
              }}
            >
              👤 My Uploads
            </button>
          </div>

          {/* Divider */}
          <div
            className="w-px h-5 hidden sm:block"
            style={{ backgroundColor: T.borderColor + "40" }}
          />

          {/* Category pills - mobile: horizontal scroll */}
          <div className="flex gap-1.5 sm:gap-2 flex-wrap overflow-x-auto scrollbar-hide">
            {CATEGORIES.slice(0, 4).map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[9px] sm:text-[11px] font-medium transition-all duration-200 whitespace-nowrap"
                style={{
                  border: `1px solid ${selectedCategory === cat.id ? T.accentColor + "60" : T.borderColor + "30"}`,
                  backgroundColor:
                    selectedCategory === cat.id
                      ? T.accentColor + "12"
                      : T.bgColor + "60",
                  color:
                    selectedCategory === cat.id
                      ? T.accentColor
                      : T.textColor + "cc",
                  cursor: "pointer",
                }}
              >
                {cat.label.replace(/[🌌🌍👤🏔️🎨]/g, "").trim()}
              </button>
            ))}
          </div>
        </div>

        {/* Right controls */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs outline-none transition-all focus:ring-1"
              style={{
                backgroundColor: T.bgColor + "80",
                border: `1px solid ${T.borderColor}30`,
                color: T.textColor,
                width: "140px",
              }}
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs opacity-30">
              🔍
            </span>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-[11px] outline-none cursor-pointer"
            style={{
              backgroundColor: T.bgColor + "80",
              border: `1px solid ${T.borderColor}30`,
              color: T.textColor + "cc",
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label.replace(/[🕐🔥🔤]/g, "").trim()}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:opacity-90"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            {showUpload ? "✕" : "+ Upload"}
          </button>
        </div>
      </div>

      {/* ── Upload Form ── */}
      {showUpload && (
        <div
          style={{
            padding: "24px",
            borderBottom: `1px solid ${T.borderColor}`,
            backgroundColor: T.boxBg,
          }}
        >
          <div
            className="lit-box p-4 w-full"
            style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}
          >
            <div
              className="lit-header -mx-4 -mt-4 mb-3"
              style={{ color: "white" }}
            >
              Share Your Creation
            </div>
            <div style={{ display: "grid", gap: "12px" }}>
              <div>
                <label
                  style={{
                    fontSize: "10px",
                    color: T.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  Media Type
                </label>
                <select
                  value={uploadForm.mediaType}
                  onChange={(e) =>
                    setUploadForm({
                      ...uploadForm,
                      mediaType: e.target.value as "image" | "video",
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "8px",
                    backgroundColor: T.bgColor,
                    border: `1px solid ${T.borderColor}`,
                    color: T.textColor,
                    fontSize: "12px",
                    outline: "none",
                    marginTop: "4px",
                  }}
                >
                  <option value="image">Image</option>
                  <option value="video">Video (YouTube / MP4 URL)</option>
                </select>
              </div>
              <div>
                <label
                  style={{
                    fontSize: "10px",
                    color: T.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  Title
                </label>
                <input
                  type="text"
                  value={uploadForm.title}
                  onChange={(e) =>
                    setUploadForm({ ...uploadForm, title: e.target.value })
                  }
                  placeholder="Name your piece..."
                  style={{
                    width: "100%",
                    padding: "8px",
                    backgroundColor: T.bgColor,
                    border: `1px solid ${T.borderColor}`,
                    color: T.textColor,
                    fontSize: "12px",
                    outline: "none",
                    marginTop: "4px",
                  }}
                />
              </div>
              {uploadForm.mediaType === "image" && (
                <>
                  {/* Drag and drop zone */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    style={{
                      border: `2px dashed ${isDragging ? T.accentColor : T.borderColor + "60"}`,
                      borderRadius: "8px",
                      padding: "24px",
                      textAlign: "center",
                      backgroundColor: isDragging
                        ? T.accentColor + "10"
                        : T.bgColor + "60",
                      transition: "all 0.2s",
                    }}
                  >
                    {uploadFile ? (
                      <div>
                        <div style={{ fontSize: "14px", marginBottom: "8px" }}>
                          📄
                        </div>
                        <div style={{ fontSize: "12px", color: T.textColor }}>
                          {uploadFile.name}
                        </div>
                        <button
                          onClick={() => {
                            setUploadFile(null);
                            setUploadForm((prev) => ({
                              ...prev,
                              imageUrl: "",
                            }));
                          }}
                          style={{
                            fontSize: "10px",
                            color: "#ff4444",
                            marginTop: "8px",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          Remove file
                        </button>
                      </div>
                    ) : uploadForm.imageUrl ? (
                      <div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={uploadForm.imageUrl}
                          alt="Preview"
                          style={{
                            maxHeight: "120px",
                            maxWidth: "100%",
                            borderRadius: "4px",
                            marginBottom: "8px",
                          }}
                        />
                        <button
                          onClick={() =>
                            setUploadForm((prev) => ({ ...prev, imageUrl: "" }))
                          }
                          style={{
                            fontSize: "10px",
                            color: "#ff4444",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          Clear URL
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: "24px", marginBottom: "8px" }}>
                          📁
                        </div>
                        <div style={{ fontSize: "12px", color: T.textMuted }}>
                          Drag & drop image here, or{" "}
                          <label
                            style={{
                              color: T.accentColor,
                              cursor: "pointer",
                              textDecoration: "underline",
                            }}
                          >
                            browse
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  setUploadFile(file);
                                  const reader = new FileReader();
                                  reader.onload = (ev) => {
                                    setUploadForm((prev) => ({
                                      ...prev,
                                      imageUrl: ev.target?.result as string,
                                    }));
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }}
                              style={{ display: "none" }}
                            />
                          </label>
                        </div>
                        <div
                          style={{
                            fontSize: "10px",
                            color: T.textMuted,
                            marginTop: "8px",
                            opacity: 0.6,
                          }}
                        >
                          — or paste an image URL below —
                        </div>
                      </div>
                    )}
                  </div>

                  {/* URL input (alternative) */}
                  {!uploadFile && !uploadForm.imageUrl && (
                    <div>
                      <input
                        type="text"
                        value={uploadForm.imageUrl}
                        onChange={(e) =>
                          setUploadForm({
                            ...uploadForm,
                            imageUrl: e.target.value,
                          })
                        }
                        placeholder="https://... (paste image URL)"
                        style={{
                          width: "100%",
                          padding: "8px",
                          backgroundColor: T.bgColor,
                          border: `1px solid ${T.borderColor}`,
                          color: T.textColor,
                          fontSize: "12px",
                          outline: "none",
                          borderRadius: "4px",
                        }}
                      />
                    </div>
                  )}
                </>
              )}
              {uploadForm.mediaType === "video" && (
                <div>
                  <label
                    style={{
                      fontSize: "10px",
                      color: T.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Video URL
                  </label>
                  <input
                    type="text"
                    value={uploadForm.videoUrl}
                    onChange={(e) =>
                      setUploadForm({ ...uploadForm, videoUrl: e.target.value })
                    }
                    placeholder="https://youtu.be/... or https://...mp4"
                    style={{
                      width: "100%",
                      padding: "8px",
                      backgroundColor: T.bgColor,
                      border: `1px solid ${T.borderColor}`,
                      color: T.textColor,
                      fontSize: "12px",
                      outline: "none",
                      marginTop: "4px",
                    }}
                  />
                </div>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: "10px",
                      color: T.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Artist
                  </label>
                  <input
                    type="text"
                    value={uploadForm.artist}
                    onChange={(e) =>
                      setUploadForm({ ...uploadForm, artist: e.target.value })
                    }
                    placeholder="Your name..."
                    style={{
                      width: "100%",
                      padding: "8px",
                      backgroundColor: T.bgColor,
                      border: `1px solid ${T.borderColor}`,
                      color: T.textColor,
                      fontSize: "12px",
                      outline: "none",
                      marginTop: "4px",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: "10px",
                      color: T.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Category
                  </label>
                  <select
                    value={uploadForm.category}
                    onChange={(e) =>
                      setUploadForm({ ...uploadForm, category: e.target.value })
                    }
                    style={{
                      width: "100%",
                      padding: "8px",
                      backgroundColor: T.bgColor,
                      border: `1px solid ${T.borderColor}`,
                      color: T.textColor,
                      fontSize: "12px",
                      outline: "none",
                      marginTop: "4px",
                    }}
                  >
                    <option value="abstract">Abstract</option>
                    <option value="character">Character</option>
                    <option value="landscape">Landscape</option>
                    <option value="360-worlds">360° Worlds</option>
                  </select>
                </div>

                {/* Visibility toggle */}
                <div>
                  <label
                    style={{
                      fontSize: "10px",
                      color: T.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Visibility
                  </label>
                  <button
                    onClick={() =>
                      setUploadForm({
                        ...uploadForm,
                        isPublic: !uploadForm.isPublic,
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "8px",
                      backgroundColor: T.bgColor,
                      border: `1px solid ${T.borderColor}`,
                      color: T.textColor,
                      fontSize: "12px",
                      outline: "none",
                      marginTop: "4px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                    }}
                  >
                    <span>{uploadForm.isPublic ? "🌐" : "🔒"}</span>
                    <span>
                      {uploadForm.isPublic
                        ? "Public (visible to all)"
                        : "Private (only you)"}
                    </span>
                  </button>
                </div>
              </div>
              <button
                onClick={handleUpload}
                disabled={uploading}
                style={{
                  padding: "10px",
                  backgroundColor: T.accentColor,
                  color: "#0a0a0f",
                  border: "none",
                  cursor: uploading ? "wait" : "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                  opacity: uploading ? 0.6 : 1,
                }}
              >
                {uploading ? "⏳ Uploading..." : "🚀 Publish to Gallery"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Enhanced Masonry Gallery ── */}
      <div className="px-3 py-4 sm:px-4 sm:py-6 w-full">
        <div className="gallery-masonry">
          {filteredItems.map((item) => {
            // Calculate actual aspect ratio from image URL dimensions
            const aspect = getImageAspectRatio(item.imageUrl);
            const isLiked = likedItems.has(item.id);
            return (
              <div
                key={item.id}
                className="gallery-item group relative rounded-xl overflow-hidden cursor-pointer"
                style={{
                  backgroundColor: T.boxBg,
                  border: `1px solid ${T.borderColor}20`,
                  marginBottom: "16px",
                  breakInside: "avoid",
                  transition: "border-color 0.3s, box-shadow 0.3s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    T.accentColor + "40";
                  (e.currentTarget as HTMLElement).style.boxShadow =
                    `0 0 20px ${T.accentColor}10`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    T.borderColor + "20";
                  (e.currentTarget as HTMLElement).style.boxShadow = "none";
                }}
                onClick={() => {
                  if (item.mediaType === "video" && item.videoUrl) {
                    window.open(item.videoUrl, "_blank", "noopener,noreferrer");
                  } else {
                    setSelectedItem(item);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelectedItem(item);
                }}
                role="button"
                tabIndex={0}
              >
                {/* Image */}
                <div
                  className="relative overflow-hidden"
                  style={{ aspectRatio: `${aspect}` }}
                >
                  {brokenImages.has(item.imageUrl) ? (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${T.accentColor}15, ${T.linkColor}15)`,
                      }}
                    >
                      <span className="text-3xl opacity-30">🎨</span>
                    </div>
                  ) : (
                    <Image
                      src={item.imageUrl}
                      alt={item.title}
                      fill
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                      unoptimized
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      onError={() =>
                        setBrokenImages((prev) =>
                          new Set(prev).add(item.imageUrl),
                        )
                      }
                    />
                  )}
                  {/* Dark gradient overlay for text readability */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    style={{
                      background: `linear-gradient(to top, ${T.bgColor}f0 0%, ${T.bgColor}80 30%, transparent 60%)`,
                    }}
                  />
                  {/* Neon glow on hover */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                    style={{
                      boxShadow: `inset 0 0 40px ${T.accentColor}15, 0 0 30px ${T.accentColor}08`,
                    }}
                  />

                  {/* Category badge */}
                  <div
                    className="absolute top-3 right-3 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm"
                    style={{
                      backgroundColor: T.bgColor + "cc",
                      color: T.accentColor,
                      border: `1px solid ${T.accentColor}40`,
                    }}
                  >
                    {item.category}
                  </div>

                  {/* Ownership controls - show for user's own items */}
                  {item.isOwner && (
                    <div className="absolute top-3 left-3 flex gap-1">
                      {/* Visibility toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleVisibility(item.id, !item.isPublic);
                        }}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-xs backdrop-blur-sm transition-colors"
                        style={{
                          backgroundColor: T.bgColor + "cc",
                          color: item.isPublic ? "#22c55e" : T.textMuted,
                        }}
                        title={
                          item.isPublic
                            ? "Public - click to make private"
                            : "Private - click to make public"
                        }
                      >
                        {item.isPublic ? "🌐" : "🔒"}
                      </button>
                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            confirm("Delete this item? This cannot be undone.")
                          ) {
                            handleDeleteItem(item.id);
                          }
                        }}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-xs backdrop-blur-sm transition-colors hover:bg-red-500/80"
                        style={{
                          backgroundColor: T.bgColor + "cc",
                          color: "#fff",
                        }}
                        title="Delete"
                      >
                        🗑
                      </button>
                    </div>
                  )}

                  {/* Hover action bar */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-2 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end justify-between">
                    <div>
                      <div
                        className="text-sm font-bold mb-0.5"
                        style={{
                          color: "#fff",
                          textShadow: "0 1px 6px rgba(0,0,0,0.9)",
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        className="text-[10px] opacity-80"
                        style={{
                          color: "#fff",
                          textShadow: "0 1px 6px rgba(0,0,0,0.9)",
                        }}
                      >
                        by {item.artist}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(
                          window.location.origin + "/gallery#" + item.id,
                        );
                        showToast("Link copied!", "success");
                      }}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs backdrop-blur-sm transition-all hover:scale-110"
                      style={{
                        backgroundColor: T.bgColor + "cc",
                        color: T.textColor,
                      }}
                      title="Copy link"
                    >
                      🔗
                    </button>
                  </div>
                </div>

                {/* Card footer */}
                <div className="px-3 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {item.artistAvatar ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={item.artistAvatar}
                        alt={item.artist}
                        className="w-5 h-5 rounded-full object-cover shrink-0"
                        onError={(e) => {
                          // Fallback to initial on error
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black shrink-0"
                        style={{
                          backgroundColor: stringToColor(item.artist),
                          color: "#fff",
                        }}
                      >
                        {item.artist.charAt(0)}
                      </div>
                    )}
                    <span
                      className="text-[11px] truncate opacity-60"
                      style={{ color: T.textColor }}
                    >
                      {item.artist}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLike(item.id);
                    }}
                    className="flex items-center gap-1 text-[11px] transition-all duration-200 hover:scale-110"
                    style={{
                      color: isLiked ? "#ff3366" : T.textColor + "80",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      className={`inline-block transition-transform duration-300 ${isLiked ? "scale-125" : ""}`}
                      style={{
                        filter: isLiked
                          ? "drop-shadow(0 0 4px #ff3366)"
                          : "none",
                      }}
                    >
                      {isLiked ? "❤" : "♡"}
                    </span>
                    <span className="font-medium">
                      {item.likes.toLocaleString()}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {filteredItems.length === 0 && (
        <div className="text-center py-20" style={{ color: T.textColor }}>
          <div className="text-5xl mb-4 opacity-30">�</div>
          <div className="text-sm font-bold mb-2" style={{ color: T.headerColor }}>
            {isMock ? "No uploads yet" : "No creations found in this sector."}
          </div>
          <div className="text-xs opacity-50 mb-4">
            {isMock
              ? "Be the first to share your work with the community."
              : "Try a different category or search term."}
          </div>
          <div className="flex gap-3 justify-center">
            {!isMock && (
              <button
                onClick={() => {
                  setSelectedCategory("all");
                  setSearchQuery("");
                }}
                className="text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-all hover:opacity-80"
                style={{
                  backgroundColor: T.accentColor + "15",
                  color: T.accentColor,
                  border: `1px solid ${T.accentColor}30`,
                }}
              >
                View All Works
              </button>
            )}
            <button
              onClick={() => setShowUpload(true)}
              className="text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-all hover:opacity-80"
              style={{
                backgroundColor: T.accentColor,
                color: T.bgColor,
              }}
            >
              Upload Your Work
            </button>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      <Lightbox
        images={items.map((item) => ({
          src: item.imageUrl,
          alt: item.title,
          caption: `${item.title} — by ${item.artist} · ${item.category.toUpperCase()} · ${item.likes} sparks`,
        }))}
        currentIndex={
          selectedItem
            ? Math.max(
                0,
                items.findIndex((i) => i.id === selectedItem.id),
              )
            : 0
        }
        isOpen={!!selectedItem}
        onClose={handleLightboxClose}
        onNext={handleLightboxNext}
        onPrev={handleLightboxPrev}
      />

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
