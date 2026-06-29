"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Music, Gamepad2, Radio, Clapperboard } from "lucide-react";
import {
  RADIO,
  GAMES,
  WATCH,
  TOOLS,
  type IconComponent,
} from "./dashboard-data";
import dynamic from "next/dynamic";
import SocialFeed from "@/components/SocialFeed";

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
const JarvisTerminal = dynamic(() => import("./JarvisTerminal"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 min-h-0 rounded-xl animate-pulse bg-slate-800/30 border border-slate-700/30" />
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
        background: `linear-gradient(135deg, ${color}10 0%, ${T.boxBg} 100%)`,
        border: `1px solid ${color}25`,
      }}
    >
      <div
        className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          filter: "blur(40px)",
        }}
      />
      <h2
        className="text-2xl lg:text-3xl font-black tracking-tight mb-2"
        style={{ color: T.textColor }}
      >
        {title}
      </h2>
      <p className="text-sm max-w-lg" style={{ color: T.textMuted }}>
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
            className="group flex flex-col items-center gap-3 p-4 rounded-xl transition-all hover:scale-[1.02]"
            style={{
              backgroundColor: `${T.boxBg}80`,
              border: `1px solid ${a.color}20`,
            }}
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
              style={{
                backgroundColor: `${a.color}15`,
                border: `1px solid ${a.color}30`,
              }}
            >
              <Icon size={18} style={{ color: a.color }} />
            </div>
            <span className="text-xs font-bold" style={{ color: T.textColor }}>
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
  Sparkles,
  ShoppingBag,
  Send,
  Image as ImageIcon,
  Video,
  Mic,
  FileText,
} from "lucide-react";

export function CenterStage({
  activeApp,
  displayName,
}: {
  activeApp: string;
  displayName: string;
}) {
  const { resolvedColors: T } = useTheme();

  switch (activeApp) {
    case "studio":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Studio"
            subtitle="Create images, audio, video & code."
            color="#00f0ff"
          />
          <QuickActionGrid
            actions={[
              {
                label: "Image Gen",
                icon: ImageIcon,
                color: "#ff00a0",
                href: "/studio?tab=image",
              },
              {
                label: "Video Gen",
                icon: Video,
                color: "#00f0ff",
                href: "/studio?tab=video",
              },
              {
                label: "Audio Gen",
                icon: Mic,
                color: "#8b5cf6",
                href: "/studio?tab=audio",
              },
              {
                label: "Code Agent",
                icon: Zap,
                color: "#ff9ff3",
                href: "/studio?tab=code",
              },
            ]}
          />
        </div>
      );
    case "social":
      return <SocialPageContent />;
    case "gallery":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Gallery"
            subtitle="Explore community creations."
            color="#ff00a0"
          />
          <QuickActionGrid
            actions={[
              {
                label: "Top Picks",
                icon: Sparkles,
                color: "#ff00a0",
                href: "/gallery?filter=top",
              },
              {
                label: "Recent",
                icon: Zap,
                color: "#00f0ff",
                href: "/gallery?filter=recent",
              },
              {
                label: "Your Drops",
                icon: ImageIcon,
                color: "#ff9ff3",
                href: "/gallery?filter=me",
              },
            ]}
          />
        </div>
      );
    case "marketplace":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Marketplace"
            subtitle="Templates, agents & creator tools."
            color="#ff9ff3"
          />
          <QuickActionGrid
            actions={[
              {
                label: "Agent Packs",
                icon: Zap,
                color: "#00f0ff",
                href: "/marketplace?tab=agents",
              },
              {
                label: "Templates",
                icon: FileText,
                color: "#ff00a0",
                href: "/marketplace?tab=templates",
              },
              {
                label: "Subscriptions",
                icon: ShoppingBag,
                color: "#ff9ff3",
                href: "/marketplace?tab=plans",
              },
            ]}
          />
        </div>
      );
    case "music":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Music"
            subtitle="Playlists, radios & your library."
            color="#ff2d78"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {RADIO.map((s) => (
              <GlossyCard
                key={s.title}
                title={s.title}
                subtitle={`${s.genre} · ${s.listeners} live`}
                color={s.color}
                icon={Music}
              />
            ))}
          </div>
        </div>
      );
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
              <GlossyCard
                key={v.title}
                title={v.title}
                subtitle={`${v.channel} · ${v.views} views`}
                color={v.color}
                icon={Clapperboard}
              />
            ))}
          </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {RADIO.map((s) => (
              <GlossyCard
                key={s.title}
                title={s.title}
                subtitle={`${s.genre} · ${s.listeners} listening`}
                color={s.color}
                icon={Radio}
              />
            ))}
          </div>
        </div>
      );
    case "jarvis":
      return (
        <div className="h-full flex flex-col min-h-0">
          <JarvisTerminal />
        </div>
      );
    case "tools":
      return (
        <div className="space-y-6">
          <HeroCard
            title="Tools"
            subtitle="Quick access to your creator stack."
            color="#f59e0b"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TOOLS.map((t) => (
              <GlossyCard
                key={t.title}
                title={t.title}
                subtitle={t.desc}
                color={t.color}
                icon={t.icon}
              />
            ))}
          </div>
        </div>
      );
    default:
      return (
        <div className="space-y-6">
          <HeroCard
            title={`Welcome back, ${displayName}`}
            subtitle="Your creator OS is live. Ship something today."
            color={T.accentColor}
          />
          <QuickActionGrid
            actions={[
              { label: "New Post", icon: Send, color: "#00f0ff", href: "#" },
              {
                label: "Image Gen",
                icon: ImageIcon,
                color: "#ff00a0",
                href: "/studio?tab=image",
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
          <DashboardContent />
          <SocialFeed embedded />
        </div>
      );
  }
}
