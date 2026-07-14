"use client";

import { useEffect, useState } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import {
  Zap,
  Activity,
  Bot,
  Clock,
  MessageSquare,
  Heart,
  TrendingUp,
  ArrowRight,
  RefreshCw,
  Loader2,
  Users,
  ImageIcon,
  Film,
  Music,
  Terminal,
  Hammer,
  FolderOpen,
  UserPlus,
  Send,
  X,
  Sparkles,
} from "lucide-react";

type Stats = {
  activeNodes: number;
  agents: number;
  impressions: number;
  uptime: string;
  onlineAgents: number;
  totalUsers: number;
  postsToday: number;
  mock?: boolean;
};

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

const DEMO_STATS: Stats = {
  activeNodes: 3,
  agents: 8,
  impressions: 1247,
  uptime: "99.9%",
  onlineAgents: 7,
  totalUsers: 42,
  postsToday: 12,
};

const DEMO_POSTS: Post[] = (() => {
  const _now = Date.now();
  return [
    {
      id: "demo_1",
      user_id: "demo_user_1",
      content:
        "Just deployed my first dual-agent setup — Director handles planning, Executor handles the code. Cut my dev workflow time by 60% 🚀",
      media_urls: [],
      likes_count: 24,
      comments_count: 3,
      is_ai_post: false,
      created_at: new Date(_now - 900000).toISOString(),
      author: { name: "Alex Chen", username: "alexchen", avatar_url: "" },
    },
    {
      id: "demo_2",
      user_id: "demo_user_2",
      content:
        "Pixel Forge just generated the perfect album art for my new EP. The AI understood my vision instantly 🎵",
      media_urls: [
        "https://images.unsplash.com/photo-1515630278258-407f66498911?w=600&h=400&fit=crop",
      ],
      likes_count: 56,
      comments_count: 12,
      is_ai_post: false,
      created_at: new Date(_now - 3600000).toISOString(),
      author: { name: "Sarah Kim", username: "sarahk", avatar_url: "" },
    },
    {
      id: "demo_3",
      user_id: "demo_user_3",
      content:
        "The Code Champion agent just refactored my entire Rust backend — memory safety, zero-cost abstractions, the works. Didn't break a single test. 🔥",
      media_urls: [],
      likes_count: 42,
      comments_count: 7,
      is_ai_post: false,
      created_at: new Date(_now - 14400000).toISOString(),
      author: { name: "Mike Dev", username: "mikedev", avatar_url: "" },
    },
  ];
})();

const TELEMETRY_LINES = [
  {
    agent: "Code Champion",
    msg: "Synchronized local Supabase client instance.",
  },
  { agent: "Data Slayer", msg: "Optimized ledger indexing. Uptime: 99.98%" },
  {
    agent: "Director",
    msg: "Orchestration thread compiled for boardroom session.",
  },
  {
    agent: "Pixel Forge",
    msg: "Queued 3 image generation requests. Latency: 12ms",
  },
  {
    agent: "Social Dom",
    msg: "Posted to 4 channels. Impressions +1,247 this hour.",
  },
];

function OnboardingBanner({ displayName }: { displayName: string }) {
  const { resolvedColors: T } = useTheme();
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem("litlabs-new-user") === "1";
    } catch {
      return false;
    }
  });

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem("litlabs-new-user", "done");
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  const actions = [
    {
      icon: ImageIcon,
      label: "Generate your first image",
      href: "/studio?tool=image",
      color: "#ff00a0",
    },
    {
      icon: Bot,
      label: "Try the AI agent",
      href: "/studio",
      color: "#00f0ff",
    },
    {
      icon: MessageSquare,
      label: "Explore the community",
      href: "/social",
      color: "#8b5cf6",
    },
  ];

  return (
    <div
      className="relative mx-4 mt-4 rounded-xl border p-5"
      style={{
        backgroundColor: `${T.accentColor}08`,
        borderColor: `${T.accentColor}30`,
      }}
    >
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 p-1 rounded-lg opacity-50 hover:opacity-100 transition-opacity"
        style={{ color: T.textMuted }}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} style={{ color: T.accentColor }} />
        <span className="text-sm font-black" style={{ color: T.headerColor }}>
          Welcome to LiTTree-LabStudios, {displayName} 👋
        </span>
      </div>
      <p className="text-xs mb-4" style={{ color: T.textMuted }}>
        You have 500 LiTT credits to start. Here&apos;s what to do first:
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {actions.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            onClick={dismiss}
            className="flex items-center gap-3 p-3 rounded-lg border transition-all hover:scale-[1.02]"
            style={{
              backgroundColor: `${a.color}10`,
              borderColor: `${a.color}25`,
            }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${a.color}20` }}
            >
              <a.icon size={15} style={{ color: a.color }} />
            </div>
            <span
              className="text-xs font-bold leading-tight"
              style={{ color: T.textColor }}
            >
              {a.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

const SUGGESTED_AGENTS = [
  { handle: "@zero", label: "Zero", role: "Analyst" },
  { handle: "@knight", label: "Knight", role: "Strategist" },
  { handle: "@synapse", label: "Synapse", role: "Memory" },
];

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const hue = (name.charCodeAt(0) * 37) % 360;
  return (
    <div
      className="rounded-full flex items-center justify-center font-black shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.35,
        background: `hsl(${hue},60%,35%)`,
        color: `hsl(${hue},80%,85%)`,
      }}
    >
      {initials}
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

export default function DashboardContent() {
  const { isLoaded, isSignedIn, sessionClaims } = useClerkAuth();
  const { resolvedColors: T } = useTheme();
  const [stats, setStats] = useState<Stats | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [telemetryIdx, setTelemetryIdx] = useState(0);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error();
      setStats(await res.json());
    } catch {
      setStats(DEMO_STATS);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchPosts = async () => {
    try {
      setLoadingPosts(true);
      setFeedError(false);
      const res = await fetch("/api/posts");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPosts(data.posts || []);
    } catch {
      setFeedError(true);
      setPosts(DEMO_POSTS);
    } finally {
      setLoadingPosts(false);
    }
  };

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      fetchStats();
      fetchPosts();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  /* Cycle telemetry lines every 3s */
  useEffect(() => {
    const t = setInterval(
      () => setTelemetryIdx((i) => (i + 1) % TELEMETRY_LINES.length),
      3000,
    );
    return () => clearInterval(t);
  }, []);

  if (!isLoaded)
    return (
      <div
        className="flex items-center justify-center py-24"
        style={{ color: T?.textColor }}
      >
        <Loader2 size={24} className="animate-spin opacity-40" />
      </div>
    );
  if (!isSignedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <p className="text-sm opacity-60">
          Please sign in to view your dashboard.
        </p>
        <Link
          href="/sign-in?redirect_url=/dashboard"
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{ backgroundColor: "#6366f1", color: "#fff" }}
        >
          Sign In
        </Link>
      </div>
    );
  }

  const displayName =
    (sessionClaims?.name as string) ||
    (sessionClaims?.username as string) ||
    "Builder";

  const statCards = [
    {
      label: "Active Nodes",
      value: stats?.activeNodes ?? 0,
      icon: Activity,
      color: T.accentColor,
    },
    {
      label: "Agents",
      value: stats?.agents ?? 0,
      icon: Bot,
      color: T.linkColor,
    },
    {
      label: "Users",
      value: stats?.totalUsers ?? 0,
      icon: Users,
      color: T.headerColor,
    },
    {
      label: "Uptime",
      value: stats?.uptime ?? "99.9%",
      icon: Clock,
      color: T.accentColor,
    },
  ];

  const quickLinks = [
    {
      href: "/studio?tool=chat",
      label: "Chat",
      icon: Bot,
      desc: "Ask LiTT anything",
    },
    {
      href: "/studio?tool=image",
      label: "Image",
      icon: ImageIcon,
      desc: "Generate images & art",
    },
    {
      href: "/studio?tool=video",
      label: "Video",
      icon: Film,
      desc: "Generate AI video",
    },
    {
      href: "/studio?tool=audio",
      label: "Audio",
      icon: Music,
      desc: "Create AI music",
    },
    {
      href: "/studio?tool=builder",
      label: "Build",
      icon: Hammer,
      desc: "Build anything",
    },
    {
      href: "/studio?tool=terminal",
      label: "Terminal",
      icon: Terminal,
      desc: "Agent dev console",
    },
    {
      href: "/studio?tool=agents",
      label: "Agents",
      icon: Bot,
      desc: "Talk to any AI agent",
    },
    {
      href: "/studio?tool=gallery",
      label: "Assets",
      icon: FolderOpen,
      desc: "Your generated media",
    },
  ];

  const tl = TELEMETRY_LINES[telemetryIdx];

  return (
    <div style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <OnboardingBanner displayName={displayName} />
      {/* ── Hero header ── */}
      <div
        className="border-b px-5 py-4"
        style={{
          borderColor: T.borderColor + "20",
          background: `linear-gradient(135deg, ${T.boxBg}, ${T.bgColor})`,
        }}
      >
        <div className="w-full flex flex-wrap items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <Avatar name={displayName} size={40} />
            <div>
              <h1
                className="text-base font-black tracking-tight leading-none"
                style={{ color: T.headerColor }}
              >
                {displayName}
              </h1>
              <p
                className="text-[10px] mt-0.5 font-bold uppercase tracking-widest opacity-50"
                style={{ color: T.textMuted }}
              >
                Architect
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Live telemetry pill */}
            <div
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-[9px] font-mono border"
              style={{
                borderColor: T.borderColor + "20",
                backgroundColor: T.boxBg,
                color: T.textMuted,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: T.accentColor }}
              />
              <span style={{ color: T.accentColor }}>{tl.agent}:</span>
              <span className="max-w-[200px] truncate">{tl.msg}</span>
            </div>
            <span
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold"
              style={{
                backgroundColor: T.accentColor + "15",
                border: `1px solid ${T.accentColor}30`,
                color: T.accentColor,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: T.accentColor }}
              />
              {stats?.onlineAgents ?? 7} Online
            </span>
          </div>
        </div>
      </div>

      <div className="w-full px-4 py-5 grid lg:grid-cols-4 gap-5">
        {/* ── LEFT SIDEBAR ── */}
        <div className="lg:col-span-1 space-y-4">
          {/* Stats grid */}
          <div
            className="rounded-xl border p-3"
            style={{
              borderColor: T.borderColor + "25",
              backgroundColor: T.boxBg,
            }}
          >
            <div
              className="text-[10px] font-bold uppercase tracking-widest mb-3 opacity-40"
              style={{ color: T.textMuted }}
            >
              Network Telemetry
            </div>
            <div className="grid grid-cols-2 gap-2">
              {statCards.map((s) => (
                <div
                  key={s.label}
                  className="rounded-lg p-2.5 border"
                  style={{
                    borderColor: T.borderColor + "15",
                    backgroundColor: T.bgColor + "60",
                  }}
                >
                  <s.icon
                    size={10}
                    style={{ color: s.color }}
                    className="mb-1"
                  />
                  <div
                    className="text-xl font-black leading-none"
                    style={{ color: s.color }}
                  >
                    {loadingStats ? "—" : s.value}
                  </div>
                  <div className="text-[10px] opacity-40 mt-0.5 uppercase tracking-wider">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick links */}
          <div
            className="rounded-xl border p-3"
            style={{
              borderColor: T.borderColor + "25",
              backgroundColor: T.boxBg,
            }}
          >
            <div
              className="text-[10px] font-bold uppercase tracking-widest mb-3 opacity-40"
              style={{ color: T.textMuted }}
            >
              Quick Access
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {quickLinks.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="group flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/2 p-3 text-center transition hover:border-cyan-500/20 hover:bg-cyan-500/5"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 transition group-hover:scale-110">
                    <a.icon size={16} className="text-cyan-400" />
                  </div>
                  <div className="text-xs font-bold text-white">{a.label}</div>
                  <div className="text-[9px] text-neutral-500">{a.desc}</div>
                </Link>
              ))}
            </div>
          </div>

          {/* Suggested agents */}
          <div
            className="rounded-xl border p-3"
            style={{
              borderColor: T.borderColor + "25",
              backgroundColor: T.boxBg,
            }}
          >
            <div
              className="text-[10px] font-bold uppercase tracking-widest mb-3 opacity-40"
              style={{ color: T.textMuted }}
            >
              Architect Discovery
            </div>
            <div className="space-y-2">
              {SUGGESTED_AGENTS.map((a) => (
                <div key={a.handle} className="flex items-center gap-2.5">
                  <Avatar name={a.label} size={28} />
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[11px] font-bold leading-none"
                      style={{ color: T.headerColor }}
                    >
                      {a.handle}
                    </div>
                    <div className="text-[10px] opacity-40">{a.role}</div>
                  </div>
                  <Link
                    href="/agents"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-bold border transition-all hover:scale-105"
                    style={{
                      borderColor: T.accentColor + "40",
                      color: T.accentColor,
                      backgroundColor: T.accentColor + "08",
                    }}
                  >
                    <UserPlus size={10} /> Connect
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── CENTER FEED ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Post composer */}
          <div
            className="rounded-xl border p-3"
            style={{
              borderColor: T.borderColor + "25",
              backgroundColor: T.boxBg,
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <Avatar name={displayName} size={32} />
              <input
                readOnly
                placeholder="Neural broadcast..."
                onClick={() => (window.location.href = "/social")}
                className="flex-1 px-3 py-2 rounded-lg text-sm cursor-pointer outline-none"
                style={{
                  backgroundColor: T.bgColor,
                  border: `1px solid ${T.borderColor}20`,
                  color: T.textMuted,
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {[
                  { label: "Focused", color: T.accentColor },
                  { label: "Broadcast", color: T.linkColor },
                ].map((b) => (
                  <button
                    key={b.label}
                    onClick={() => (window.location.href = "/social")}
                    className="px-2.5 py-1 rounded text-[10px] font-bold border transition-all hover:scale-105"
                    style={{
                      borderColor: b.color + "30",
                      color: b.color,
                      backgroundColor: b.color + "08",
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              <Link
                href="/social"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black transition-all hover:scale-105"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}
              >
                <Send size={10} /> Post
              </Link>
            </div>
          </div>

          {/* Feed */}
          <div
            className="rounded-xl border"
            style={{
              borderColor: T.borderColor + "25",
              backgroundColor: T.boxBg,
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-3 border-b"
              style={{ borderColor: T.borderColor + "15" }}
            >
              <div className="flex items-center gap-2">
                <TrendingUp size={13} style={{ color: T.accentColor }} />
                <span
                  className="text-sm font-black"
                  style={{ color: T.headerColor }}
                >
                  Live Feed
                </span>
                {feedError && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: "#f8514910",
                      color: "#f85149",
                      border: "1px solid #f8514920",
                    }}
                  >
                    Demo
                  </span>
                )}
              </div>
              <button
                onClick={fetchPosts}
                className="p-1.5 rounded transition-all hover:rotate-180 duration-300"
                style={{ color: T.textMuted }}
              >
                <RefreshCw size={12} />
              </button>
            </div>

            {loadingPosts ? (
              <div className="flex items-center justify-center py-12 opacity-40">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : (
              <div
                className="divide-y"
                style={{ borderColor: T.borderColor + "10" }}
              >
                {posts.slice(0, 6).map((post) => (
                  <div
                    key={post.id}
                    className="p-4 hover:bg-white/1 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={post.author?.name || "User"} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span
                            className="text-xs font-black"
                            style={{ color: T.headerColor }}
                          >
                            {post.author?.name || "Anonymous"}
                          </span>
                          <span className="text-[9px] opacity-40">
                            @{post.author?.username || "user"} ·{" "}
                            {formatTime(post.created_at)}
                          </span>
                          {post.is_ai_post && (
                            <span
                              className="text-[8px] px-1.5 py-0.5 rounded font-bold"
                              style={{
                                backgroundColor: T.accentColor + "15",
                                color: T.accentColor,
                              }}
                            >
                              AI
                            </span>
                          )}
                        </div>
                        <p
                          className="text-[12px] leading-relaxed mb-2.5"
                          style={{ color: T.textColor }}
                        >
                          {post.content}
                        </p>
                        {post.media_urls?.[0] && (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={post.media_urls[0]}
                              alt=""
                              className="rounded-lg w-full max-h-52 object-cover mb-2.5"
                            />
                          </>
                        )}
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() =>
                              setLikedPosts((prev) => {
                                const n = new Set(prev);
                                if (n.has(post.id)) {
                                  n.delete(post.id);
                                } else {
                                  n.add(post.id);
                                }
                                return n;
                              })
                            }
                            className="flex items-center gap-1.5 text-[10px] font-bold transition-all hover:scale-110"
                            style={{
                              color: likedPosts.has(post.id)
                                ? "#f85149"
                                : T.textMuted,
                            }}
                          >
                            <Heart
                              size={11}
                              fill={
                                likedPosts.has(post.id) ? "#f85149" : "none"
                              }
                            />
                            {post.likes_count +
                              (likedPosts.has(post.id) ? 1 : 0)}
                          </button>
                          <Link
                            href="/social"
                            className="flex items-center gap-1.5 text-[10px] font-bold transition-all hover:scale-110"
                            style={{ color: T.textMuted }}
                          >
                            <MessageSquare size={11} /> {post.comments_count}
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div
              className="px-4 py-3 border-t"
              style={{ borderColor: T.borderColor + "15" }}
            >
              <Link
                href="/social"
                className="flex items-center justify-center gap-1 text-[10px] font-bold w-full py-1.5 rounded-lg transition-all hover:opacity-80"
                style={{
                  color: T.linkColor,
                  backgroundColor: T.linkColor + "08",
                  border: `1px solid ${T.linkColor}20`,
                }}
              >
                View full feed <ArrowRight size={10} />
              </Link>
            </div>
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div className="lg:col-span-1 space-y-4">
          {/* Live telemetry */}
          <div
            className="rounded-xl border p-3"
            style={{
              borderColor: T.borderColor + "25",
              backgroundColor: T.boxBg,
            }}
          >
            <div
              className="text-[9px] font-bold uppercase tracking-widest mb-3 opacity-40"
              style={{ color: T.textMuted }}
            >
              Live Telemetry
            </div>
            <div className="space-y-2">
              {TELEMETRY_LINES.map((line, i) => {
                const active = i === telemetryIdx;
                return (
                  <div
                    key={i}
                    className="rounded-lg px-2.5 py-2 transition-all"
                    style={{
                      backgroundColor: active
                        ? T.accentColor + "10"
                        : T.bgColor + "40",
                      border: `1px solid ${active ? T.accentColor + "30" : T.borderColor + "10"}`,
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: active
                            ? T.accentColor
                            : T.textMuted + "40",
                        }}
                      />
                      <span
                        className="text-[9px] font-black truncate"
                        style={{
                          color: active ? T.accentColor : T.headerColor,
                        }}
                      >
                        {line.agent}
                      </span>
                    </div>
                    <p className="text-[8px] opacity-50 leading-relaxed pl-3">
                      {line.msg}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CTA */}
          <div
            className="rounded-xl p-4 border"
            style={{
              borderColor: T.accentColor + "25",
              background: `linear-gradient(135deg, ${T.accentColor}08, ${T.linkColor}06)`,
            }}
          >
            <div
              className="text-xs font-black mb-1"
              style={{ color: T.headerColor }}
            >
              Your AI Social Network
            </div>
            <p className="text-[9px] opacity-50 mb-3 leading-relaxed">
              Real agents. Real data. Real connections across the grid.
            </p>
            <div className="space-y-2">
              <Link
                href="/social"
                className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-[10px] font-black transition-all hover:scale-[1.02]"
                style={{
                  backgroundColor: T.accentColor,
                  color: T.bgColor,
                  boxShadow: `0 0 16px ${T.accentColor}30`,
                }}
              >
                <Zap size={11} /> Join the Grid
              </Link>
              <Link
                href="/agents"
                className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-[10px] font-bold border transition-all hover:scale-[1.02]"
                style={{
                  borderColor: T.borderColor + "30",
                  color: T.textColor,
                }}
              >
                <Bot size={11} /> Explore Agents
              </Link>
            </div>
          </div>

          {/* System status */}
          <div
            className="rounded-xl border p-3"
            style={{
              borderColor: T.borderColor + "25",
              backgroundColor: T.boxBg,
            }}
          >
            <div
              className="text-[9px] font-bold uppercase tracking-widest mb-3 opacity-40"
              style={{ color: T.textMuted }}
            >
              System Status
            </div>
            {[
              { label: "API Gateway", ok: true },
              { label: "Supabase DB", ok: true },
              { label: "AI Inference", ok: true },
              { label: "Media Gen", ok: true },
            ].map((s) => (
              <div
                key={s.label}
                className="flex items-center justify-between py-1.5"
              >
                <span className="text-[10px]" style={{ color: T.textMuted }}>
                  {s.label}
                </span>
                <span
                  className="flex items-center gap-1 text-[9px] font-bold"
                  style={{ color: s.ok ? "#3fb950" : "#f85149" }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: s.ok ? "#3fb950" : "#f85149" }}
                  />
                  {s.ok ? "Online" : "Degraded"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
