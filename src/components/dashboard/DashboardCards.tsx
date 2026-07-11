"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { Gamepad2, Clapperboard, Play, ExternalLink } from "lucide-react";
import {
  GAMES,
  WATCH,
  TOOLS,
  type IconComponent,
} from "./dashboard-data";
import dynamic from "next/dynamic";
import { useState } from "react";
import SocialFeed from "@/components/SocialFeed";
import MusicPlayer from "./MusicPlayer";
import RadioPanel from "./RadioPanel";
import AudioTool from "./AudioTool";

const SpotifyPlayer = dynamic(() => import("./SpotifyPlayer"), { ssr: false });


/* Lazy-load heavy dashboard panes so the initial dashboard bundle stays small */
const DashboardContent = dynamic(() => import("./DashboardContent"), {
  ssr: false,
  loading: () => (
    <div className="h-48 rounded-xl animate-pulse bg-slate-800/30 border border-slate-700/30" />
  ),
});
const SocialPageContent = dynamic(
  () => import("@/components/SocialPageContent"),
  {
    ssr: false,
    loading: () => (
      <div className="h-96 rounded-xl animate-pulse bg-slate-800/30 border border-slate-700/30" />
    ),
  },
);
const LiTTTerminal = dynamic(() => import("./LiTTTerminal"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 min-h-0 rounded-xl animate-pulse bg-slate-800/30 border border-slate-700/30" />
  ),
});
const GalleryTool = dynamic(() => import("@/app/studio/tools/GalleryTool"), {
  ssr: false,
  loading: () => (
    <div className="h-96 rounded-xl animate-pulse bg-slate-800/30 border border-slate-700/30" />
  ),
});
const MarketplacePreview = dynamic(() => import("./MarketplacePreview"), {
  ssr: false,
  loading: () => (
    <div className="h-96 rounded-xl animate-pulse bg-slate-800/30 border border-slate-700/30" />
  ),
});

export function HeroCard({
  title,
  subtitle,
  color,
}: {
  title: string;
  subtitle: string;
  color: string;
}) {
  const { resolvedColors: T } = useTheme();
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-6 lg:p-8"
      style={{
        background: `linear-gradient(135deg, ${color}18 0%, ${T.boxBg} 60%, ${T.bgColor} 100%)`,
        border: `1px solid ${color}35`,
      }}
    >
      <div
        className="absolute -top-20 -right-20 w-80 h-80 rounded-full opacity-20 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
          filter: "blur(48px)",
        }}
      />
      <div
        className="absolute bottom-0 left-0 w-48 h-48 rounded-full opacity-10 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          filter: "blur(40px)",
        }}
      />
      <h2
        className="relative text-2xl lg:text-3xl font-black tracking-tight mb-2"
        style={{ color: T.textColor }}
      >
        {title}
      </h2>
      <p className="relative text-sm max-w-lg font-medium" style={{ color: T.textMuted }}>
        {subtitle}
      </p>
    </div>
  );
}

export function QuickActionGrid({
  actions,
}: {
  actions: {
    label: string;
    icon: IconComponent;
    color: string;
    href: string;
  }[];
}) {
  const { resolvedColors: T } = useTheme();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.label}
            href={a.href}
            className="group relative flex flex-col items-center gap-3 p-4 rounded-xl transition-all hover:scale-[1.02] hover:-translate-y-0.5 overflow-hidden"
            style={{
              backgroundColor: `${T.boxBg}80`,
              border: `1px solid ${a.color}25`,
            }}
          >
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{
                background: `radial-gradient(circle at top center, ${a.color}10 0%, transparent 60%)`,
              }}
            />
            <div
              className="relative w-11 h-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 group-hover:rotate-3"
              style={{
                backgroundColor: `${a.color}15`,
                border: `1px solid ${a.color}35`,
                boxShadow: `0 4px 20px ${a.color}15`,
              }}
            >
              <Icon size={20} style={{ color: a.color }} />
            </div>
            <span className="relative text-xs font-black" style={{ color: T.textColor }}>
              {a.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function GlossyCard({
  title,
  subtitle,
  color,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  color: string;
  icon: IconComponent;
}) {
  const { resolvedColors: T } = useTheme();
  return (
    <div
      className="group relative overflow-hidden rounded-xl p-5 transition-all hover:scale-[1.01] cursor-pointer"
      style={{
        backgroundColor: `${T.boxBg}60`,
        border: `1px solid ${color}20`,
      }}
    >
      <div
        className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          filter: "blur(30px)",
        }}
      />
      <div className="flex items-start gap-4">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{
            backgroundColor: `${color}15`,
            border: `1px solid ${color}30`,
          }}
        >
          <Icon size={18} style={{ color }} />
        </div>
        <div className="min-w-0">
          <div
            className="text-sm font-bold mb-0.5"
            style={{ color: T.textColor }}
          >
            {title}
          </div>
          <div className="text-[11px]" style={{ color: T.textMuted }}>
            {subtitle}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Center Stage — switches based on active app                        */
/* ------------------------------------------------------------------ */
import {
  Zap,
  ShoppingBag,
  Send,
  Image as ImageIcon,
  Video,
  Mic,
  Plus,
} from "lucide-react";

export function CenterStage({
  activeApp,
  displayName,
  onAppChange,
}: {
  activeApp: string;
  displayName: string;
  onAppChange?: (app: string) => void;
}) {
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  void onAppChange;

  switch (activeApp) {
    case "studio":
      return (
        <div className="space-y-4 md:space-y-6">
          {/* Mobile: Compact welcome card */}
          <div className="md:hidden">
            <div className="mb-3">
              <p className="text-sm font-bold" style={{ color: T.textColor }}>
                👋 Welcome back, {displayName}
              </p>
              <p className="text-xs" style={{ color: T.textMuted }}>
                Ship something today.
              </p>
            </div>
            <Link
              href="/studio?tool=image"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-bold transition-all"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              <Plus size={16} /> Create
            </Link>
          </div>

          {/* Desktop: Full HeroCard */}
          <div className="hidden md:block">
            <HeroCard
              title="Studio"
              subtitle="Create images, audio, video & code."
              color="#00f0ff"
            />
          </div>

          {/* Mobile: Compact quick actions */}
          <div className="md:hidden grid grid-cols-4 gap-2">
            {[
              { label: "AI", icon: Zap, href: "/agents", color: "#ff9ff3" },
              { label: "Post", icon: Send, href: "/social", color: "#00f0ff" },
              { label: "Img", icon: ImageIcon, href: "/studio?tool=image", color: "#ff00a0" },
              { label: "Music", icon: Mic, href: "/dashboard?app=music", color: "#8b5cf6" },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.label}
                  href={action.href}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-lg transition-all"
                  style={{ backgroundColor: `${T.boxBg}60`, border: `1px solid ${action.color}20` }}
                >
                  <Icon size={16} style={{ color: action.color }} />
                  <span className="text-[9px] font-bold" style={{ color: T.textColor }}>
                    {action.label}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Desktop: Full QuickActionGrid */}
          <div className="hidden md:block">
            <QuickActionGrid
              actions={[
                {
                  label: "Image Gen",
                  icon: ImageIcon,
                  color: "#ff00a0",
                  href: "/studio?tool=image",
                },
                {
                  label: "Video Gen",
                  icon: Video,
                  color: "#00f0ff",
                  href: "/studio?tool=video",
                },
                {
                  label: "Audio Gen",
                  icon: Mic,
                  color: "#8b5cf6",
                  href: "/studio?tool=audio",
                },
                {
                  label: "Code Agent",
                  icon: Zap,
                  color: "#ff9ff3",
                  href: "/studio?tool=agents",
                },
              ]}
            />
          </div>

          {/* Mobile: Continue Working */}
          <div className="md:hidden">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold" style={{ color: "#ff6b35" }}>
                🔥 Continue Working
              </span>
            </div>
            <div className="space-y-2">
              {[
                { label: "Image #42", href: "/gallery" },
                { label: "Agent Forge", href: "/studio?tool=agents" },
                { label: "Music Project", href: "/dashboard?app=music" },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all"
                  style={{ backgroundColor: `${T.boxBg}60`, color: T.textColor }}
                >
                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: T.accentColor }} />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Mobile: Stats */}
          <div className="md:hidden">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold" style={{ color: T.textMuted }}>
                📊 Stats
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "3 Nodes", value: "8 Agents" },
                { label: "42 Users", value: "99.9%" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="px-3 py-2 rounded-lg text-xs"
                  style={{ backgroundColor: `${T.boxBg}60`, color: T.textColor }}
                >
                  <div className="font-bold">{stat.label}</div>
                  <div className="opacity-60" style={{ color: T.textMuted }}>{stat.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    case "social":
      return <SocialPageContent />;
    case "gallery":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Gallery"
            subtitle="Your creations and community drops."
            color="#ff00a0"
          />
          <GalleryTool />
        </div>
      );
    case "marketplace":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Marketplace"
            subtitle="Agents, templates & coin packs."
            color="#ff9ff3"
          />
          <MarketplacePreview />
        </div>
      );
    case "music":
      return <MusicHub />;

    case "games":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Games Hub"
            subtitle="Arcade, quests & leaderboards."
            color="#8b5cf6"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {GAMES.map((g) => (
              <GlossyCard
                key={g.title}
                title={g.title}
                subtitle={`${g.genre} · ${g.players} playing`}
                color={g.color}
                icon={Gamepad2}
              />
            ))}
          </div>
        </div>
      );
    case "watch":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Watch Room"
            subtitle="Tutorials, streams & creator content."
            color="#3b82f6"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {WATCH.map((v) => (
              <div
                key={v.title}
                className="group relative rounded-xl border overflow-hidden transition-all hover:scale-[1.01] cursor-pointer"
                style={{ backgroundColor: `${T.boxBg}80`, borderColor: `${v.color}20` }}
                onClick={() => router.push("/showcase")}
              >
                <div
                  className="h-28 flex items-center justify-center relative"
                  style={{ background: `linear-gradient(135deg, ${v.color}20, ${T.boxBg})` }}
                >
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center transition-transform group-hover:scale-110"
                    style={{ backgroundColor: `${v.color}25`, border: `1px solid ${v.color}40` }}
                  >
                    <Play size={20} style={{ color: v.color }} />
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-sm font-bold truncate" style={{ color: T.textColor }}>{v.title}</div>
                  <div className="text-[11px] mt-0.5 flex items-center justify-between" style={{ color: T.textMuted }}>
                    <span>{v.channel}</span>
                    <span>{v.views} views</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Link
            href="/showcase"
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-bold transition-all hover:bg-white/5"
            style={{ borderColor: T.borderColor + "30", color: T.textMuted }}
          >
            <Clapperboard size={13} /> Browse more <ExternalLink size={11} />
          </Link>
        </div>
      );
    case "radio":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Radio"
            subtitle="Live stations curated for focus & flow."
            color="#10b981"
          />
          <RadioPanel mode="full" />
        </div>
      );
    case "audio-tools":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Audio Studio"
            subtitle="Generate speech and AI music."
            color="#8b5cf6"
          />
          <AudioTool />
        </div>
      );
    case "jarvis":
      return (
        <div className="h-full flex flex-col min-h-0">
          <LiTTTerminal />
        </div>
      );
    case "tools": {
      const TOOL_ROUTES: Record<string, string> = {
        "Prompt Vault": "/studio?tool=agents",
        "Asset Locker": "/studio?tool=gallery",
        "Quick Notes": "/studio?tool=agents",
        "Batch Gen": "/studio?tool=image",
      };
      return (
        <div className="space-y-6">
          <HeroCard
            title="Tools"
            subtitle="Quick access to your creator stack."
            color="#f59e0b"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TOOLS.map((t) => {
              const href = TOOL_ROUTES[t.title] || "/studio";
              const Icon = t.icon;
              return (
                <Link
                  key={t.title}
                  href={href}
                  className="group flex items-start gap-3 p-4 rounded-xl border transition-all hover:scale-[1.01]"
                  style={{ backgroundColor: `${T.boxBg}80`, borderColor: `${t.color}20` }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
                    style={{ backgroundColor: `${t.color}15`, border: `1px solid ${t.color}30` }}
                  >
                    <Icon size={16} style={{ color: t.color }} />
                  </div>
                  <div>
                    <div className="text-sm font-bold" style={{ color: T.textColor }}>{t.title}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: T.textMuted }}>{t.desc}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      );
    }
    default:
      return (
        <div className="space-y-6 md:space-y-8">
          <HeroCard
            title={`Welcome back, ${displayName}`}
            subtitle="Your creator OS is live. Ship something today."
            color={T.accentColor}
          />

          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ backgroundColor: T.accentColor }} />
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
                Quick Actions
              </span>
            </div>
            <QuickActionGrid
              actions={[
                { label: "New Post", icon: Send, color: "#00f0ff", href: "/social" },
                {
                  label: "Image Gen",
                  icon: ImageIcon,
                  color: "#ff00a0",
                  href: "/studio?tool=image",
                },
                {
                  label: "Agent Chat",
                  icon: Zap,
                  color: "#8b5cf6",
                  href: "/agent-chat",
                },
                {
                  label: "Marketplace",
                  icon: ShoppingBag,
                  color: "#ff9ff3",
                  href: "/marketplace",
                },
              ]}
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ backgroundColor: T.accentColor }} />
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
                Overview
              </span>
            </div>
            <DashboardContent />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ backgroundColor: T.accentColor }} />
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
                Community Feed
              </span>
            </div>
            <SocialFeed embedded />
          </div>
        </div>
      );
  }
}

/* ------------------------------------------------------------------ */
/*  MusicHub — tabbed music section                                    */
/* ------------------------------------------------------------------ */
const MUSIC_TABS = [
  { id: "spotify", label: "Spotify", color: "#1DB954" },
  { id: "player",  label: "LiTTree LabStudios Player", color: "#ff00a0" },
  { id: "radio",   label: "Radio", color: "#00f0ff" },
  { id: "tools",   label: "Audio Tools", color: "#8b5cf6" },
] as const;

type MusicTab = (typeof MUSIC_TABS)[number]["id"];

function MusicHub() {
  const { resolvedColors: T } = useTheme();
  const [tab, setTab] = useState<MusicTab>("spotify");

  return (
    <div className="space-y-4">
      <HeroCard title="Music" subtitle="Stream, create & broadcast." color="#1DB954" />

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: `${T.boxBg}60`, border: `1px solid ${T.borderColor}20` }}>
        {MUSIC_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex-1 py-2 rounded-lg text-xs font-bold transition-all"
            style={{
              backgroundColor: tab === t.id ? `${t.color}20` : "transparent",
              color: tab === t.id ? t.color : T.textMuted,
              border: tab === t.id ? `1px solid ${t.color}30` : "1px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "spotify"  && <SpotifyPlayer />}
      {tab === "player"   && <MusicPlayer mode="full" />}
      {tab === "radio"    && <RadioPanel mode="full" />}
      {tab === "tools"    && <AudioTool />}
    </div>
  );
}
