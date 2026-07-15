"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import {
  Heart,
  MessageCircle,
  Send,
  ImageIcon,
  X,
  Loader2,
  Clapperboard,
} from "lucide-react";

type PostType = "text" | "image" | "reel";

type Post = {
  id: string;
  user_id: string;
  content: string;
  media_urls: string[];
  likes_count: number;
  comments_count: number;
  is_ai_post: boolean;
  created_at: string;
  author?: { name: string; username: string; avatar_url: string };
};

export default function SocialFeed({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { isLoaded, isSignedIn, userId: clerkUserId } = useClerkAuth();
  const { resolvedColors: T } = useTheme();
  const [posts, setPosts] = useState<Post[]>([]);
  const [postContent, setPostContent] = useState("");
  const [postType, setPostType] = useState<PostType>("text");
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaPreviews, setMediaPreviews] = useState<string[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(
    new Set(),
  );
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [followedUsers, setFollowedUsers] = useState<Set<string>>(new Set());
  const [feedFilter, setFeedFilter] = useState<"all" | "following">("all");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (
    msg: string,
    type: "success" | "error" | "info" = "success",
  ) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchCurrentUser = useCallback(async () => {
    if (!isSignedIn || !clerkUserId) return;
    try {
      const res = await fetch("/api/account");
      const data = await res.json();
      if (data.user?.id) setCurrentUserId(data.user.id);
    } catch {
      /* ignore */
    }
  }, [isSignedIn, clerkUserId]);

  const fetchFollows = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const res = await fetch("/api/follows?type=following");
      const data = await res.json();
      const ids = new Set<string>(
        (data.follows || [])
          .map((f: unknown) => {
            const item = f as Record<string, unknown>;
            const users = item.users as Record<string, unknown> | undefined;
            return String(users?.followee_id ?? item.followee_id ?? "");
          })
          .filter(Boolean),
      );
      setFollowedUsers(ids);
    } catch {
      /* ignore */
    }
  }, [isSignedIn]);

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/posts?filter=${feedFilter}`);
      const data = await res.json();
      setPosts(data.posts || []);
    } catch {
      showToast("Failed to load feed. Try refreshing.", "error");
    } finally {
      setLoading(false);
    }
  }, [feedFilter]);

  useEffect(() => {
    if (!isSignedIn) return;
    const id = requestAnimationFrame(() => {
      fetchPosts();
      fetchFollows();
      fetchCurrentUser();
    });
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchPosts();
        fetchFollows();
      }
    }, 10000);
    return () => {
      cancelAnimationFrame(id);
      clearInterval(interval);
    };
  }, [isSignedIn, feedFilter, fetchCurrentUser, fetchFollows, fetchPosts]);

  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Limit to 4 files
    const newFiles = files.slice(0, 4);
    setMediaFiles((prev) => [...prev, ...newFiles].slice(0, 4));

    // Create previews
    newFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setMediaPreviews((prev) =>
          [...prev, e.target?.result as string].slice(0, 4),
        );
      };
      reader.readAsDataURL(file);
    });
  };

  const removeMedia = (index: number) => {
    setMediaFiles((prev) => prev.filter((_, i) => i !== index));
    setMediaPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadMedia = async (): Promise<string[]> => {
    if (mediaFiles.length === 0) return [];
    setUploadingMedia(true);
    const urls: string[] = [];

    for (const file of mediaFiles) {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (data.url) urls.push(data.url);
      } catch {
        /* ignore failed uploads */
      }
    }

    setUploadingMedia(false);
    return urls;
  };

  const createPost = async () => {
    if (!postContent.trim() && mediaFiles.length === 0) return;
    if (posting) return;

    setPosting(true);
    try {
      // Upload media first
      const mediaUrls = await uploadMedia();

      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: postContent.trim(),
          media_urls: mediaUrls,
          post_type: postType,
        }),
      });
      if (res.ok) {
        setPostContent("");
        setMediaFiles([]);
        setMediaPreviews([]);
        setPostType("text");
        showToast("Post published!", "success");
        await fetchPosts();
      } else {
        const error = await res.json();
        showToast(error.error || "Failed to post", "error");
      }
    } catch {
      showToast("Network error. Try again.", "error");
    } finally {
      setPosting(false);
    }
  };

  const likePost = async (postId: string) => {
    if (likedPosts.has(postId)) return;
    try {
      const res = await fetch(`/api/posts/${postId}/like`, { method: "POST" });
      if (res.ok) {
        setLikedPosts((prev) => new Set([...prev, postId]));
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, likes_count: p.likes_count + 1 } : p,
          ),
        );
      }
    } catch {
      /* silently fail */
    }
  };

  const followUser = async (userId: string) => {
    if (!isSignedIn) {
      showToast("Sign in to follow", "info");
      return;
    }
    try {
      const res = await fetch("/api/follows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followee_id: userId }),
      });
      if (res.ok || res.status === 409) {
        setFollowedUsers((prev) => new Set([...prev, userId]));
        showToast("Following!", "success");
      }
    } catch {
      showToast("Failed to follow", "error");
    }
  };

  const unfollowUser = async (userId: string) => {
    try {
      const res = await fetch(`/api/follows?followee_id=${userId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setFollowedUsers((prev) => {
          const n = new Set(prev);
          n.delete(userId);
          return n;
        });
        showToast("Unfollowed", "info");
      }
    } catch {
      showToast("Failed to unfollow", "error");
    }
  };

  const toggleComments = (postId: string) => {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const addComment = async (postId: string) => {
    const text = commentText[postId]?.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        setCommentText((prev) => ({ ...prev, [postId]: "" }));
        showToast("Comment posted!", "success");
        await fetchPosts();
      }
    } catch {
      showToast("Failed to post comment", "error");
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          backgroundColor: T?.bgColor || "#0a0a0f",
          color: T?.textColor || "#e2e8f0",
        }}
      >
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">⏳</div>
          <div className="text-sm font-bold opacity-60">
            Loading social feed...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-20 right-5 z-200 px-5 py-3 text-xs font-bold max-w-xs border-2 rounded"
          style={{
            backgroundColor:
              toast.type === "success"
                ? "#0a2e0a"
                : toast.type === "error"
                  ? "#2e0a0a"
                  : "#0a1a2e",
            borderColor:
              toast.type === "success"
                ? T.accentColor
                : toast.type === "error"
                  ? "#ff4444"
                  : T.linkColor,
            color:
              toast.type === "success"
                ? T.accentColor
                : toast.type === "error"
                  ? "#ff4444"
                  : T.linkColor,
          }}
        >
          {toast.msg}
        </div>
      )}

      <div
        ref={feedRef}
        className={embedded ? "" : "max-w-xl mx-auto px-4 sm:px-6 py-4 sm:py-6"}
      >
        {/* Header — hidden when embedded */}
        {!embedded && (
          <div
            className="mb-6 pb-4"
            style={{ borderBottom: "1px solid " + T.borderColor + "30" }}
          >
            <h1
              className="text-xl sm:text-2xl font-black tracking-tight m-0 mb-1"
              style={{ color: T.headerColor }}
            >
              Social Feed
            </h1>
            <p className="text-xs opacity-50 m-0">
              Share your AI agent wins and connect with the community
            </p>
          </div>
        )}

        {/* Compose */}
        {isSignedIn && (
          <div
            className="mb-6 p-4 rounded-xl border"
            style={{
              borderColor: T.borderColor + "30",
              backgroundColor: T.boxBg,
            }}
          >
            {/* Post Type Selector */}
            <div className="flex items-center gap-2 mb-3">
              {[
                { type: "text" as PostType, icon: Send, label: "Text" },
                { type: "image" as PostType, icon: ImageIcon, label: "Photo" },
                { type: "reel" as PostType, icon: Clapperboard, label: "Reel" },
              ].map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  onClick={() => {
                    setPostType(type);
                    if (type !== "text") fileInputRef.current?.click();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={{
                    backgroundColor:
                      postType === type ? T.accentColor + "15" : T.bgColor,
                    color: postType === type ? T.accentColor : T.textMuted,
                    border: `1px solid ${postType === type ? T.accentColor + "30" : T.borderColor + "30"}`,
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            <textarea
              id="social-feed-post"
              name="socialFeedPost"
              placeholder={
                postType === "text"
                  ? "What's your AI agent story?"
                  : `Describe your ${postType}...`
              }
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              className="w-full px-3 py-2.5 text-sm rounded-lg outline-none resize-none border"
              style={{
                backgroundColor: T.bgColor,
                borderColor: T.borderColor,
                color: T.textColor,
                minHeight: "80px",
              }}
            />

            {/* Media Previews */}
            {mediaPreviews.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                {mediaPreviews.map((preview, i) => (
                  <div
                    key={i}
                    className="relative group rounded-lg overflow-hidden"
                    style={{
                      aspectRatio: postType === "reel" ? "16/9" : "1/1",
                    }}
                  >
                    {postType === "reel" ? (
                      <video
                        src={preview}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preview}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      </>
                    )}
                    <button
                      onClick={() => removeMedia(i)}
                      className="absolute top-1 right-1 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all"
                      style={{
                        backgroundColor: T.bgColor + "80",
                        color: T.textColor,
                      }}
                    >
                      <X size={12} />
                    </button>
                    {postType === "reel" && (
                      <span
                        className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
                        style={{
                          backgroundColor: T.bgColor,
                          color: T.accentColor,
                        }}
                      >
                        REEL
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center mt-3">
              <input
                ref={fileInputRef}
                type="file"
                accept={postType === "reel" ? "video/*" : "image/*"}
                multiple
                onChange={handleMediaSelect}
                className="hidden"
              />
              {uploadingMedia && (
                <div
                  className="flex items-center gap-2 text-xs"
                  style={{ color: T.textMuted }}
                >
                  <Loader2 size={14} className="animate-spin" />
                  Uploading...
                </div>
              )}
              <button
                onClick={createPost}
                disabled={
                  (!postContent.trim() && mediaFiles.length === 0) ||
                  posting ||
                  uploadingMedia
                }
                className="px-4 py-2 text-xs font-bold rounded-lg transition-all ml-auto"
                style={{
                  backgroundColor:
                    (postContent.trim() || mediaFiles.length > 0) &&
                    !posting &&
                    !uploadingMedia
                      ? T.accentColor
                      : T.borderColor + "80",
                  color:
                    (postContent.trim() || mediaFiles.length > 0) &&
                    !posting &&
                    !uploadingMedia
                      ? "#000"
                      : T.textMuted,
                  cursor:
                    (postContent.trim() || mediaFiles.length > 0) &&
                    !posting &&
                    !uploadingMedia
                      ? "pointer"
                      : "not-allowed",
                }}
              >
                {posting
                  ? "Posting..."
                  : postType === "text"
                    ? "Post"
                    : `Share ${postType}`}
              </button>
            </div>
          </div>
        )}

        {/* Feed filter tabs */}
        <div
          className="flex items-center gap-1 mb-4 p-1 rounded-xl"
          style={{
            backgroundColor: T.boxBg,
            border: `1px solid ${T.borderColor}20`,
          }}
        >
          {(["all", "following"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFeedFilter(f)}
              className="flex-1 px-3 py-1.5 text-xs font-bold rounded-lg transition-all"
              style={{
                backgroundColor:
                  feedFilter === f ? T.accentColor + "15" : "transparent",
                color: feedFilter === f ? T.accentColor : T.textMuted,
              }}
            >
              {f === "all" ? "For You" : "Following"}
            </button>
          ))}
        </div>

        {/* Posts */}
        {loading ? (
          <div className="text-center py-12 opacity-50">
            <div className="text-2xl mb-3">⏳</div>
            <div className="text-sm">Loading posts...</div>
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16 opacity-50">
            <div className="text-3xl mb-3">📭</div>
            <div className="text-sm font-bold mb-1">No posts yet</div>
            <div className="text-xs">
              Be the first to share your AI agent story!
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {posts.map((post) => (
              <div
                key={post.id}
                className="p-4 sm:p-5 rounded-xl border transition-all hover:border-opacity-40"
                style={{
                  borderColor: T.borderColor + "20",
                  backgroundColor: T.boxBg,
                }}
              >
                {/* Author */}
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0"
                    style={{
                      backgroundColor: T.accentColor + "15",
                      border: `1px solid ${T.accentColor}30`,
                    }}
                  >
                    {post.author?.avatar_url || "👤"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/profile/${(post.author?.username || "user").toLowerCase().replace(/\s+/g, "")}`}
                      className="block hover:opacity-80 transition-opacity"
                    >
                      <div
                        className="text-sm font-bold leading-snug"
                        style={{ color: T.headerColor }}
                      >
                        {post.author?.name || "Anonymous"}
                      </div>
                      <div className="text-[11px] opacity-40 leading-snug">
                        @{post.author?.username || "user"} ·{" "}
                        {formatTime(post.created_at)}
                      </div>
                    </Link>
                  </div>
                  {isSignedIn &&
                    currentUserId &&
                    post.user_id !== currentUserId && (
                      <button
                        onClick={() =>
                          followedUsers.has(post.user_id)
                            ? unfollowUser(post.user_id)
                            : followUser(post.user_id)
                        }
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all hover:opacity-80 shrink-0"
                        style={{
                          backgroundColor: followedUsers.has(post.user_id)
                            ? T.borderColor + "20"
                            : T.accentColor + "12",
                          color: followedUsers.has(post.user_id)
                            ? T.textMuted
                            : T.accentColor,
                          border: `1px solid ${followedUsers.has(post.user_id) ? T.borderColor + "30" : T.accentColor + "30"}`,
                        }}
                      >
                        {followedUsers.has(post.user_id)
                          ? "Following"
                          : "Follow"}
                      </button>
                    )}
                </div>

                {/* Content */}
                <p
                  className="text-sm sm:text-[15px] leading-relaxed mb-3 whitespace-pre-wrap"
                  style={{ color: T.textColor }}
                >
                  {post.content}
                </p>

                {/* Media */}
                {post.media_urls.length > 0 && (
                  <div
                    className={`grid gap-2 mb-3 ${post.media_urls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
                  >
                    {post.media_urls.map((url, i) => {
                      const isVideo =
                        url.match(/\.(mp4|webm|mov|avi|mkv)($|\?)/i) ||
                        url.startsWith("data:video");
                      return isVideo ? (
                        <video
                          key={i}
                          src={url}
                          controls
                          className="rounded-lg w-full object-cover"
                          style={{ maxHeight: "400px", aspectRatio: "16/9" }}
                        />
                      ) : (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            key={i}
                            src={url}
                            alt="post media"
                            className="rounded-lg w-full object-cover"
                            style={{
                              maxHeight: "400px",
                              aspectRatio:
                                post.media_urls.length === 1 ? "16/9" : "1/1",
                            }}
                          />
                        </>
                      );
                    })}
                  </div>
                )}

                {/* Stats + Actions */}
                <div
                  className="flex items-center justify-between pt-3"
                  style={{ borderTop: "1px solid " + T.borderColor + "25" }}
                >
                  <div className="flex items-center gap-4 text-xs opacity-40">
                    <span className="flex items-center gap-1.5">
                      <Heart size={14} /> {post.likes_count}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MessageCircle size={14} /> {post.comments_count}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => likePost(post.id)}
                      disabled={likedPosts.has(post.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                      style={{
                        backgroundColor: likedPosts.has(post.id)
                          ? "rgba(255,0,0,0.12)"
                          : T.borderColor + "10",
                        color: likedPosts.has(post.id)
                          ? "#ff4444"
                          : T.textMuted,
                      }}
                    >
                      <Heart
                        size={14}
                        className={
                          likedPosts.has(post.id) ? "fill-red-500" : ""
                        }
                      />
                      {likedPosts.has(post.id) ? "Liked" : "Like"}
                    </button>
                    <button
                      onClick={() => toggleComments(post.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                      style={{
                        backgroundColor: expandedComments.has(post.id)
                          ? T.linkColor + "12"
                          : T.borderColor + "10",
                        color: expandedComments.has(post.id)
                          ? T.linkColor
                          : T.textMuted,
                      }}
                    >
                      <MessageCircle size={14} /> Comment
                    </button>
                  </div>
                </div>

                {/* Comments */}
                {expandedComments.has(post.id) && (
                  <div
                    className="mt-3 pt-3"
                    style={{ borderTop: "1px solid " + T.borderColor + "25" }}
                  >
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Write a comment..."
                        value={commentText[post.id] || ""}
                        onChange={(e) =>
                          setCommentText((prev) => ({
                            ...prev,
                            [post.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey)
                            addComment(post.id);
                        }}
                        className="flex-1 px-3 py-2 text-sm rounded-lg outline-none border"
                        style={{
                          backgroundColor: T.bgColor,
                          borderColor: T.borderColor,
                          color: T.textColor,
                        }}
                      />
                      <button
                        onClick={() => addComment(post.id)}
                        disabled={!commentText[post.id]?.trim()}
                        className="px-3 py-2 rounded-lg transition-all"
                        style={{
                          backgroundColor: commentText[post.id]?.trim()
                            ? T.linkColor
                            : T.borderColor + "80",
                          color: commentText[post.id]?.trim()
                            ? "#fff"
                            : T.textMuted,
                          cursor: commentText[post.id]?.trim()
                            ? "pointer"
                            : "not-allowed",
                        }}
                        aria-label="Post comment"
                      >
                        <Send size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
