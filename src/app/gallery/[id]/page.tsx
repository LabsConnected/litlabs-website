"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import { ArrowLeft, Heart, Share2, Download, Sparkles, MessageCircle, Check } from "lucide-react";

interface GalleryArtifact {
  id: string;
  title: string;
  artist: string;
  artistAvatar?: string | null;
  category: string;
  imageUrl: string;
  videoUrl?: string;
  mediaType?: "image" | "video" | "audio";
  likes: number;
  comments?: { id: string; author: string; text: string; createdAt: string }[];
  isPublic?: boolean;
  isOwner?: boolean;
  createdAt: string;
  prompt?: string;
  toolUsed?: string;
  providerUsed?: string;
  projectName?: string;
  projectId?: string;
}

export default function GalleryArtifactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { isLoaded } = useClerkAuth();
  const { tokens: T } = useTheme();
  const [item, setItem] = useState<GalleryArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState<GalleryArtifact["comments"]>([]);
  const [sharingToDiscover, setSharingToDiscover] = useState(false);
  const [sharedToDiscover, setSharedToDiscover] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/gallery?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) {
          if (res.status === 404) {
            setError("This creation could not be found.");
          } else {
            setError("Failed to load this creation.");
          }
          return;
        }
        const data = (await res.json()) as GalleryArtifact;
        setItem(data);
        setLikeCount(data.likes ?? 0);
        setComments(data.comments ?? []);
      } catch {
        setError("Network error while loading this creation.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleLike = async () => {
    setLiked((prev) => !prev);
    setLikeCount((prev) => (liked ? prev - 1 : prev + 1));
    try {
      await fetch(`/api/gallery/${id}/like`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Revert on error
      setLiked((prev) => !prev);
      setLikeCount((prev) => (liked ? prev + 1 : prev - 1));
    }
  };

  const handleShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: item?.title ?? "Gallery creation", url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Non-fatal
    }
  };

  const handleComment = async () => {
    if (!commentText.trim()) return;
    const newComment = {
      id: `local-${Date.now()}`,
      author: "You",
      text: commentText.trim(),
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => [...(prev ?? []), newComment]);
    setCommentText("");
    try {
      await fetch(`/api/gallery/${id}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newComment.text }),
      });
    } catch {
      // Non-fatal — optimistic update
    }
  };

  const handleShareToDiscover = async () => {
    setSharingToDiscover(true);
    try {
      const res = await fetch(`/api/gallery/${id}/share`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `Check out my creation: ${item?.title ?? ""}` }),
      });
      if (res.ok) {
        setSharedToDiscover(true);
      }
    } catch {
      // Non-fatal
    } finally {
      setSharingToDiscover(false);
    }
  };

  if (!isLoaded || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: T.background, color: T.textMuted }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4" style={{ background: T.background, color: T.text }}>
        <p className="text-sm" style={{ color: T.textMuted }}>{error ?? "Creation not found."}</p>
        <Link href="/gallery" className="rounded-lg px-4 py-2 text-xs font-bold" style={{ background: T.primary, color: "#fff" }}>
          Back to Gallery
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: T.background, color: T.text }}>
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Back link */}
        <Link
          href="/gallery"
          className="inline-flex items-center gap-2 text-xs font-bold transition hover:opacity-80"
          style={{ color: T.textMuted }}
        >
          <ArrowLeft size={14} />
          Back to Gallery
        </Link>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Media viewer */}
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: T.border + "30" }}>
            {item.mediaType === "video" && item.videoUrl ? (
              <video src={item.videoUrl} controls className="w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.imageUrl} alt={item.title} className="w-full object-contain" />
            )}
          </div>

          {/* Details sidebar */}
          <div className="space-y-4">
            {/* Title + creator */}
            <div className="rounded-2xl border p-5" style={{ borderColor: T.border + "30", background: T.surface + "60" }}>
              <h1 className="text-lg font-black" style={{ color: T.text }}>{item.title}</h1>
              <div className="mt-2 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full text-xs" style={{ background: T.primary + "20" }}>
                  {item.artistAvatar ?? item.artist.charAt(0).toUpperCase()}
                </span>
                <span className="text-xs font-bold" style={{ color: T.text }}>{item.artist}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase" style={{ borderColor: T.primary + "40", color: T.primary }}>
                  {item.mediaType ?? "image"}
                </span>
                {item.category && (
                  <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase" style={{ borderColor: T.border + "40", color: T.textMuted }}>
                    {item.category}
                  </span>
                )}
              </div>
              <div className="mt-3 text-[10px]" style={{ color: T.textMuted }}>
                Published {new Date(item.createdAt).toLocaleDateString()}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleLike}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition hover:opacity-80"
                style={{
                  borderColor: liked ? T.primary + "60" : T.border + "30",
                  background: liked ? T.primary + "12" : "transparent",
                  color: liked ? T.primary : T.textMuted,
                }}
              >
                <Heart size={14} fill={liked ? "currentColor" : "none"} />
                {likeCount}
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition hover:opacity-80"
                style={{ borderColor: T.border + "30", color: T.textMuted }}
                aria-label="Share"
              >
                {copied ? <Check size={14} /> : <Share2 size={14} />}
              </button>
              {item.isOwner && (
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition hover:opacity-80"
                  style={{ borderColor: T.border + "30", color: T.textMuted }}
                  aria-label="Download"
                >
                  <Download size={14} />
                </button>
              )}
            </div>

            {/* Remix / Use in Studio */}
            <div className="flex gap-2">
              <Link
                href={`/studio?tool=chat&remix=${encodeURIComponent(item.id)}`}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-black transition hover:opacity-90"
                style={{ background: T.primary, color: "#fff" }}
              >
                <Sparkles size={14} />
                Remix
              </Link>
              <Link
                href={`/studio?tool=chat&use=${encodeURIComponent(item.id)}`}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black transition hover:opacity-80"
                style={{ borderColor: T.primary + "40", color: T.primary }}
              >
                Use in Studio
              </Link>
            </div>

            {/* Share to Discover — owner only */}
            {item.isOwner && (
              <button
                type="button"
                onClick={handleShareToDiscover}
                disabled={sharingToDiscover}
                className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition hover:opacity-80 disabled:opacity-40"
                style={{ borderColor: T.border + "30", color: T.textMuted }}
              >
                <Share2 size={14} />
                {sharedToDiscover ? "Shared to Discover" : "Share to Discover"}
              </button>
            )}

            {/* Prompt + tool info */}
            {(item.prompt || item.toolUsed || item.providerUsed) && (
              <div className="rounded-2xl border p-4" style={{ borderColor: T.border + "30", background: T.surface + "40" }}>
                <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: T.textMuted }}>
                  Creation Details
                </div>
                {item.prompt && (
                  <div className="mt-2">
                    <div className="text-[10px] font-bold" style={{ color: T.textMuted }}>Prompt</div>
                    <p className="mt-1 text-xs" style={{ color: T.text }}>{item.prompt}</p>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-3 text-[10px]" style={{ color: T.textMuted }}>
                  {item.toolUsed && <span>Tool: <strong style={{ color: T.text }}>{item.toolUsed}</strong></span>}
                  {item.providerUsed && <span>Provider: <strong style={{ color: T.text }}>{item.providerUsed}</strong></span>}
                </div>
              </div>
            )}

            {/* Related project */}
            {item.projectName && (
              <Link
                href={item.projectId ? `/studio?project=${encodeURIComponent(item.projectId)}` : "/gallery"}
                className="block rounded-2xl border p-4 transition hover:opacity-90"
                style={{ borderColor: T.border + "30", background: T.surface + "40" }}
              >
                <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: T.textMuted }}>
                  Related Project
                </div>
                <div className="mt-1 text-sm font-bold" style={{ color: T.text }}>{item.projectName}</div>
              </Link>
            )}

            {/* Comments */}
            <div className="rounded-2xl border p-4" style={{ borderColor: T.border + "30", background: T.surface + "40" }}>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider" style={{ color: T.textMuted }}>
                <MessageCircle size={12} />
                Comments ({comments?.length ?? 0})
              </div>
              <div className="mt-3 space-y-2">
                {(comments ?? []).map((c) => (
                  <div key={c.id} className="rounded-xl border p-2.5" style={{ borderColor: T.border + "20" }}>
                    <div className="text-[10px] font-bold" style={{ color: T.primary }}>{c.author}</div>
                    <p className="mt-0.5 text-xs" style={{ color: T.text }}>{c.text}</p>
                  </div>
                ))}
                {(!comments || comments.length === 0) && (
                  <div className="py-3 text-center text-[10px]" style={{ color: T.textMuted }}>
                    No comments yet. Be the first!
                  </div>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleComment()}
                  placeholder="Add a comment..."
                  className="flex-1 rounded-lg border px-3 py-2 text-xs"
                  style={{
                    borderColor: T.border + "30",
                    background: T.surface,
                    color: T.text,
                  }}
                />
                <button
                  type="button"
                  onClick={handleComment}
                  disabled={!commentText.trim()}
                  className="rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40"
                  style={{ background: T.primary, color: "#fff" }}
                >
                  Post
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Related works */}
        <div className="mt-8">
          <h2 className="text-xs font-black uppercase tracking-wider" style={{ color: T.textMuted }}>
            Related Works
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Link
                key={i}
                href={`/gallery/${id}-${i + 1}`}
                className="aspect-square overflow-hidden rounded-lg border"
                style={{ borderColor: T.border + "20", background: T.surface + "40" }}
              >
                <div className="grid h-full w-full place-items-center">
                  <Sparkles size={16} style={{ color: T.textMuted }} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
