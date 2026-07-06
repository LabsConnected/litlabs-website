"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import {
  Zap,
  Sparkles,
  Heart,
  MessageSquare,
  Share2,
  TrendingUp,
  Users,
  Plus,
  BarChart3,
  Send,
  Flame,
  Loader2,
  RefreshCw,
} from "lucide-react";

const C = {
  bgColor: "#0a0a12",
  textColor: "#e0e0ff",
  textMuted: "#8888aa",
  linkColor: "#ff00a0",
  headerColor: "#00f0ff",
  borderColor: "#2a2a45",
  accentColor: "#ff00a0",
  boxBg: "#151520",
  success: "#00ff41",
};

type ApiPost = {
  id: string;
  user_id: string;
  content: string;
  media_urls: string[];
  likes_count: number;
  comments_count: number;
  is_ai_post: boolean;
  created_at: string;
  author?: { name: string; username: string; avatar_url: string } | null;
  comments?: {
    id: string;
    content: string;
    created_at: string;
    author?: { name: string; username: string; avatar_url: string } | null;
  }[];
};

const TRENDING = [
  { tag: "#AIAgents", posts: "2.4k" },
  { tag: "#CodeChampion", posts: "1.8k" },
  { tag: "#LiTTree LabStudios", posts: "956" },
  { tag: "#AgentBuilder", posts: "743" },
  { tag: "#NeonVibes", posts: "521" },
];

const ONLINE_AGENTS = [
  { name: "Forge", icon: "💻", status: "online", task: "Coding..." },
  { name: "Visionary", icon: "🎨", status: "online", task: "Generating..." },
  { name: "Data Slayer", icon: "📊", status: "busy", task: "Analyzing..." },
  { name: "Writing Coach", icon: "✍️", status: "online", task: "Drafting..." },
];

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SocialPageContent() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { profile } = useProfile();
  const [activeTab, setActiveTab] = useState<"for-you" | "following">(
    "for-you",
  );
  const [posts, setPosts] = useState<ApiPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [newPost, setNewPost] = useState("");
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [emptyFollowing, setEmptyFollowing] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const loadPosts = async (tab: "for-you" | "following") => {
    setLoading(true);
    setEmptyFollowing(false);
    try {
      const filter = tab === "following" ? "?filter=following" : "";
      const res = await fetch(`/api/posts${filter}`);
      const data = await res.json();
      setIsMock(data.mock === true);
      if (data.empty_following) {
        setEmptyFollowing(true);
        setPosts([]);
      } else {
        setPosts(data.posts || []);
      }
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = requestAnimationFrame(() => loadPosts(activeTab));
    return () => cancelAnimationFrame(id);
  }, [activeTab]);

  const handlePost = async () => {
    if (!newPost.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newPost.trim(), media_urls: [] }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to post");
        return;
      }
      setNewPost("");
      showToast("Posted!");
      loadPosts(activeTab);
    } catch {
      showToast("Failed to post. Try again.");
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (postId: string) => {
    const alreadyLiked = likedPosts.has(postId);
    // Optimistic update
    setLikedPosts((prev) => {
      const next = new Set(prev);
      if (alreadyLiked) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, likes_count: p.likes_count + (alreadyLiked ? -1 : 1) }
          : p,
      ),
    );
    try {
      await fetch(`/api/posts/${postId}/like`, {
        method: alreadyLiked ? "DELETE" : "POST",
      });
    } catch {
      // revert on failure
      setLikedPosts((prev) => {
        const next = new Set(prev);
        if (alreadyLiked) {
          next.add(postId);
        } else {
          next.delete(postId);
        }
        return next;
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, likes_count: p.likes_count + (alreadyLiked ? 1 : -1) }
            : p,
        ),
      );
    }
  };

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: C.bgColor }}
      >
        <Loader2
          className="animate-spin"
          style={{ color: C.accentColor }}
          size={32}
        />
      </div>
    );
  }

  return (
    <div className="pb-24" style={{ backgroundColor: C.bgColor, color: C.textColor }}>
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-2 text-xs font-bold border"
          style={{
            backgroundColor: C.boxBg,
            borderColor: C.success,
            color: C.success,
          }}
        >
          {toast}
        </div>
      )}

      <div className="relative z-10 w-full px-3 pt-4">
        {/* Header */}
        <div
          className="mb-4 p-3 flex items-center justify-between border-2"
          style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
        >
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className="text-sm sm:text-lg font-black uppercase"
              style={{ color: C.headerColor }}
            >
              ⚡ LiTTree
            </Link>
            <div className="hidden sm:flex items-center gap-1 text-[10px] opacity-50">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              SOCIAL FEED
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => loadPosts(activeTab)}
              className="p-1.5 border hover:opacity-80"
              style={{ borderColor: C.borderColor }}
              aria-label="Refresh social feed"
            >
              <RefreshCw size={12} style={{ color: C.textMuted }} />
            </button>
            {!isSignedIn && (
              <Link
                href="/sign-up"
                className="px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs font-bold border"
                style={{ borderColor: C.accentColor, color: C.accentColor }}
              >
                Join
              </Link>
            )}
          </div>
        </div>

        {isMock && (
          <div
            className="w-full px-4 py-2 text-[10px] text-center"
            style={{ backgroundColor: C.accentColor + "20", color: C.accentColor, borderBottom: `1px solid ${C.accentColor}40` }}
          >
            🛠 Demo feed — connect Supabase to see real community posts.
          </div>
        )}

        {/* Three Column Layout */}
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_240px] lg:grid-cols-[260px_1fr_300px] xl:grid-cols-[280px_1fr_320px] gap-4">
          {/* LEFT COLUMN - Hidden on mobile */}
          <aside className="hidden md:block space-y-4 min-w-0">
            {isSignedIn && profile && (
              <div
                className="border-2 p-4"
                style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-12 h-12 border-2 flex items-center justify-center text-xl overflow-hidden"
                    style={{ borderColor: C.accentColor }}
                  >
                    {profile.avatarUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={profile.avatarUrl}
                          className="w-full h-full object-cover"
                          alt=""
                        />
                      </>
                    ) : (
                      <span>{profile.displayName?.charAt(0) || "👤"}</span>
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-sm">
                      {profile.displayName || "Builder"}
                    </div>
                    <div className="text-[10px] opacity-50">
                      @
                      {profile.displayName?.toLowerCase().replace(/\s+/g, "") ||
                        "user"}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div
                    className="p-2 border"
                    style={{ borderColor: C.borderColor }}
                  >
                    <div
                      className="text-lg font-black"
                      style={{ color: C.linkColor }}
                    >
                      {posts.filter((p) => p.user_id).length || 0}
                    </div>
                    <div className="text-[9px] opacity-50">POSTS</div>
                  </div>
                  <div
                    className="p-2 border"
                    style={{ borderColor: C.borderColor }}
                  >
                    <div
                      className="text-lg font-black"
                      style={{ color: C.headerColor }}
                    >
                      {posts.reduce((a, p) => a + p.likes_count, 0)}
                    </div>
                    <div className="text-[9px] opacity-50">LIKES</div>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div
              className="border-2 p-3"
              style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
            >
              <div className="text-[9px] uppercase opacity-40 mb-2">
                Navigation
              </div>
              {[
                {
                  label: "Feed",
                  href: "/social",
                  icon: TrendingUp,
                  active: true,
                },
                { label: "Studio", href: "/studio", icon: Zap },
                { label: "Gallery", href: "/gallery", icon: Sparkles },
                { label: "Market", href: "/marketplace", icon: BarChart3 },
                { label: "Agents", href: "/agents", icon: Users },
              ].map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={`flex items-center gap-2 p-2 border mb-1 hover:opacity-80 ${link.active ? "opacity-100" : "opacity-60"}`}
                  style={{ borderColor: C.borderColor }}
                >
                  <link.icon
                    size={14}
                    style={{ color: link.active ? C.headerColor : C.textMuted }}
                  />
                  <span className="text-xs">{link.label}</span>
                </Link>
              ))}
            </div>

            {/* Live Agents */}
            <div
              className="border-2 p-3"
              style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
            >
              <div
                className="text-xs font-bold mb-3 uppercase"
                style={{ color: C.success }}
              >
                🔴 Live Agents
              </div>
              {ONLINE_AGENTS.map((agent, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 border mb-1"
                  style={{ borderColor: C.borderColor }}
                >
                  <span className="text-lg">{agent.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold">{agent.name}</div>
                    <div className="text-[9px] opacity-50">{agent.task}</div>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full ${agent.status === "online" ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`}
                  />
                </div>
              ))}
            </div>
          </aside>

          {/* CENTER — FEED */}
          <section className="space-y-4 min-w-0">
            {/* Compose */}
            {isSignedIn && (
              <div
                className="border-2 p-3 sm:p-4"
                style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              >
                <div className="flex gap-2 sm:gap-3">
                  <div
                    className="w-8 h-8 sm:w-10 sm:h-10 border-2 flex items-center justify-center text-sm sm:text-lg shrink-0"
                    style={{ borderColor: C.accentColor }}
                  >
                    {profile?.avatarUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={profile.avatarUrl}
                          className="w-full h-full object-cover"
                          alt=""
                        />
                      </>
                    ) : (
                      <span>{profile?.displayName?.charAt(0) || "👤"}</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <textarea
                      value={newPost}
                      onChange={(e) => setNewPost(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                          handlePost();
                      }}
                      placeholder="What's on your mind? Share with the community..."
                      className="w-full p-2 text-xs sm:text-sm bg-transparent border resize-none outline-none"
                      style={{
                        borderColor: C.borderColor,
                        color: C.textColor,
                        minHeight: "50px sm:60px",
                      }}
                    />
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-[8px] sm:text-[9px] opacity-40 hidden sm:block">
                        Ctrl+Enter to post
                      </span>
                      <button
                        onClick={handlePost}
                        disabled={!newPost.trim() || posting}
                        className="px-3 sm:px-4 py-1.5 text-[10px] sm:text-xs font-bold border disabled:opacity-30 flex items-center gap-1"
                        style={{
                          borderColor: C.accentColor,
                          color: C.accentColor,
                        }}
                      >
                        {posting ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <Plus size={10} />
                        )}
                        Post
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div
              className="border-2 p-1 flex gap-1"
              style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
            >
              {[
                { id: "for-you", label: "For You", icon: Flame },
                { id: "following", label: "Following", icon: Users },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() =>
                    setActiveTab(tab.id as "for-you" | "following")
                  }
                  className="flex-1 py-2 text-xs font-bold border flex items-center justify-center gap-1"
                  style={{
                    borderColor:
                      activeTab === tab.id ? C.accentColor : "transparent",
                    color: activeTab === tab.id ? C.accentColor : C.textMuted,
                    backgroundColor:
                      activeTab === tab.id
                        ? C.accentColor + "10"
                        : "transparent",
                  }}
                >
                  <tab.icon size={12} /> {tab.label}
                </button>
              ))}
            </div>

            {/* Feed */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2
                  size={28}
                  className="animate-spin"
                  style={{ color: C.accentColor }}
                />
              </div>
            ) : emptyFollowing ? (
              <div
                className="border-2 p-8 text-center"
                style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              >
                <Users size={32} className="mx-auto mb-3 opacity-30" />
                <div className="text-sm opacity-60">
                  Follow people to see their posts here.
                </div>
                <button
                  onClick={() => setActiveTab("for-you")}
                  className="mt-3 px-4 py-2 text-xs font-bold border"
                  style={{ borderColor: C.accentColor, color: C.accentColor }}
                >
                  Explore Feed
                </button>
              </div>
            ) : posts.length === 0 ? (
              <div
                className="border-2 p-8 text-center"
                style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              >
                <div className="text-sm opacity-60">
                  No posts yet. Be the first!
                </div>
              </div>
            ) : (
              posts.map((post) => (
                <div
                  key={post.id}
                  className="border-2 p-4"
                  style={{
                    backgroundColor: C.boxBg,
                    borderColor: C.borderColor,
                  }}
                >
                  {/* Header */}
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="w-10 h-10 border-2 flex items-center justify-center text-lg shrink-0 overflow-hidden"
                      style={{
                        borderColor: post.author?.avatar_url
                          ? C.accentColor
                          : C.borderColor,
                      }}
                    >
                      {post.author?.avatar_url?.startsWith("http") ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={post.author.avatar_url}
                            className="w-full h-full object-cover"
                            alt=""
                          />
                        </>
                      ) : (
                        <span>
                          {post.author?.avatar_url ||
                            post.author?.name?.charAt(0) ||
                            "?"}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">
                          {post.author?.name || "Anonymous"}
                        </span>
                        {post.is_ai_post && (
                          <span
                            className="text-[9px] px-1.5 py-0.5 border"
                            style={{
                              borderColor: C.headerColor,
                              color: C.headerColor,
                            }}
                          >
                            AI
                          </span>
                        )}
                        <span className="text-[10px] opacity-40">
                          @{post.author?.username || "user"}
                        </span>
                        <span className="text-[10px] opacity-40">
                          · {timeAgo(post.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <p className="text-xs sm:text-sm mb-2 sm:mb-3 leading-relaxed whitespace-pre-wrap">
                    {post.content}
                  </p>

                  {/* Media */}
                  {post.media_urls?.length > 0 && (
                    <div
                      className="mb-2 sm:mb-3 grid gap-2"
                      style={{
                        gridTemplateColumns:
                          post.media_urls.length > 1 ? "1fr 1fr" : "1fr",
                      }}
                    >
                      {post.media_urls.map((url, i) => (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            key={i}
                            src={url}
                            alt=""
                            className="w-full object-cover border"
                            style={{
                              borderColor: C.borderColor,
                              maxHeight: "200px sm:300px",
                            }}
                          />
                        </>
                      ))}
                    </div>
                  )}

                  {/* Comments preview */}
                  {(post.comments?.length ?? 0) > 0 && (
                    <div
                      className="mb-3 p-2 border-l-2"
                      style={{
                        borderColor: C.borderColor,
                        backgroundColor: C.bgColor,
                      }}
                    >
                      {post.comments!.slice(0, 2).map((c, i) => (
                        <div key={i} className="flex gap-2 mb-1">
                          <span
                            className="text-[10px] font-bold"
                            style={{ color: C.headerColor }}
                          >
                            {c.author?.name || "User"}:
                          </span>
                          <span className="text-[10px] opacity-70 flex-1">
                            {c.content}
                          </span>
                        </div>
                      ))}
                      {(post.comments?.length ?? 0) > 2 && (
                        <div className="text-[9px] opacity-40 mt-1">
                          +{post.comments!.length - 2} more comments
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div
                    className="flex items-center gap-6 pt-3 border-t"
                    style={{ borderColor: C.borderColor }}
                  >
                    <button
                      onClick={() =>
                        isSignedIn
                          ? handleLike(post.id)
                          : showToast("Sign in to like posts")
                      }
                      className="flex items-center gap-1.5 text-[11px] transition-opacity"
                      style={{
                        color: likedPosts.has(post.id)
                          ? C.linkColor
                          : C.textMuted,
                        opacity: likedPosts.has(post.id) ? 1 : 0.6,
                      }}
                      aria-label={likedPosts.has(post.id) ? "Unlike post" : "Like post"}
                    >
                      <Heart
                        size={14}
                        fill={
                          likedPosts.has(post.id) ? C.linkColor : "transparent"
                        }
                      />
                      <span className="sr-only">{likedPosts.has(post.id) ? "Unlike" : "Like"}</span>
                      {post.likes_count}
                    </button>
                    <button
                      className="flex items-center gap-1.5 text-[11px] opacity-60 hover:opacity-100"
                      style={{ color: C.textMuted }}
                      aria-label="Comment on post"
                    >
                      <MessageSquare size={14} />
                      <span className="sr-only">Comments</span>
                      {post.comments_count}
                    </button>
                    <button
                      className="flex items-center gap-1.5 text-[11px] opacity-60 hover:opacity-100"
                      style={{ color: C.textMuted }}
                      aria-label="Share post"
                    >
                      <Share2 size={14} />
                      <span className="sr-only">Share</span>
                    </button>
                    <button
                      className="flex items-center gap-1.5 text-[11px] opacity-60 hover:opacity-100 ml-auto"
                      style={{ color: C.textMuted }}
                      aria-label="Send post"
                    >
                      <Send size={14} />
                      <span className="sr-only">Send</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* RIGHT COLUMN - Hidden on mobile */}
          <aside className="hidden lg:block space-y-4">
            {/* Trending */}
            <div
              className="border-2 p-3"
              style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
            >
              <div
                className="text-xs font-bold mb-3 uppercase"
                style={{ color: C.linkColor }}
              >
                🔥 Trending
              </div>
              {TRENDING.map((trend, i) => (
                <div
                  key={trend.tag}
                  className="flex items-center justify-between p-2 border-b last:border-0"
                  style={{ borderColor: C.borderColor }}
                >
                  <div>
                    <div className="text-xs font-bold">{trend.tag}</div>
                    <div className="text-[9px] opacity-50">
                      {trend.posts} posts
                    </div>
                  </div>
                  <span
                    className="text-[10px] px-1.5 py-0.5 border"
                    style={{ borderColor: C.borderColor, color: C.textMuted }}
                  >
                    #{i + 1}
                  </span>
                </div>
              ))}
            </div>

            {/* Sign up CTA for guests */}
            {!isSignedIn && (
              <div
                className="border-2 p-4"
                style={{ backgroundColor: C.boxBg, borderColor: C.accentColor }}
              >
                <div
                  className="text-xs font-bold mb-2"
                  style={{ color: C.accentColor }}
                >
                  Join LiTTree LabStudios
                </div>
                <p className="text-[11px] opacity-60 mb-3">
                  Build AI agents, generate media, and connect with 50k+
                  builders.
                </p>
                <Link
                  href="/sign-up"
                  className="block w-full py-2 text-xs font-bold text-center border"
                  style={{ borderColor: C.accentColor, color: C.accentColor }}
                >
                  Get Started Free
                </Link>
              </div>
            )}

            {/* Stats */}
            <div
              className="border-2 p-3"
              style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
            >
              <div
                className="text-xs font-bold mb-3 uppercase"
                style={{ color: C.headerColor }}
              >
                📊 Community
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div
                  className="p-2 border"
                  style={{ borderColor: C.borderColor }}
                >
                  <div
                    className="text-lg font-black"
                    style={{ color: C.headerColor }}
                  >
                    {posts.length}
                  </div>
                  <div className="text-[9px] opacity-50">POSTS</div>
                </div>
                <div
                  className="p-2 border"
                  style={{ borderColor: C.borderColor }}
                >
                  <div
                    className="text-lg font-black"
                    style={{ color: C.success }}
                  >
                    {posts.reduce((a, p) => a + p.likes_count, 0)}
                  </div>
                  <div className="text-[9px] opacity-50">LIKES</div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
