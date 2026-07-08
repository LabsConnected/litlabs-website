"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { CORE_AGENTS } from "@/lib/agent-data";
import { AGENT_AVATAR_META } from "@/lib/avatars";
import {
  Wallet,
  Crown,
  Bot,
  Image as ImageIcon,
  MessageSquare,
  Terminal,
  Zap,
  ArrowRight,
  Sparkles,
  Activity,
  TrendingUp,
  Clock,
  CheckCircle2,
  LayoutDashboard,
  Store,
  User,
  Menu,
  X,
  Settings,
  Gamepad2,
  Images,
} from "lucide-react";

const QUICK_ACTIONS = [
  { label: "Open Studio", href: "/studio?tool=chat", icon: MessageSquare, color: "#22d3ee" },
  { label: "Generate Image", href: "/studio?tool=image", icon: ImageIcon, color: "#e879f9" },
  { label: "Create Post", href: "/dashboard/social-agent", icon: Zap, color: "#fb923c" },
  { label: "Install Agent", href: "/marketplace", icon: Bot, color: "#a3f546" },
  { label: "Open Terminal", href: "/studio?tool=terminal", icon: Terminal, color: "#4ade80" },
];

const MOBILE_NAV_ACTIONS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, color: "#22d3ee" },
  { label: "Studio", href: "/studio?tool=chat", icon: Sparkles, color: "#fb923c" },
  { label: "Agents", href: "/studio?tool=agents", icon: Bot, color: "#a3f546" },
  { label: "Market", href: "/marketplace", icon: Store, color: "#e879f9" },
  { label: "Profile", href: "/profile", icon: User, color: "#94a3b8" },
];

const MOBILE_MENU_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "LiTTree", href: "/studio?tool=chat", icon: Bot },
  { label: "Studio", href: "/studio", icon: Sparkles },
  { label: "Agents", href: "/studio?tool=agents", icon: Bot },
  { label: "Gallery", href: "/gallery", icon: Images },
  { label: "Marketplace", href: "/marketplace", icon: Store },
  { label: "Games", href: "/games/cloud", icon: Gamepad2 },
  { label: "Profile", href: "/profile", icon: User },
  { label: "Settings", href: "/settings", icon: Settings },
];

const RECENT_ACTIVITY = [
  { id: "1", type: "image", title: "Generated hero image", time: "2h ago", credits: 50 },
  { id: "2", type: "chat", title: "Chat with Forge", time: "4h ago", credits: 12 },
  { id: "3", type: "post", title: "Scheduled social post", time: "6h ago", credits: 0 },
  { id: "4", type: "agent", title: "Installed Visionary", time: "1d ago", credits: 0 },
];

const USAGE_STATS = [
  { label: "Credits used", value: "312", change: "+12%", color: "#fbbf24" },
  { label: "Images generated", value: "8", change: "+3", color: "#e879f9" },
  { label: "Chat messages", value: "47", change: "+9", color: "#22d3ee" },
  { label: "Social posts", value: "3", change: "+1", color: "#fb923c" },
];

export default function DashboardPage() {
  const { resolvedColors: T } = useTheme();
  const { balance, isLoading: walletLoading } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);

  const currentPlan = "Free";
  const activeAgents = CORE_AGENTS.slice(0, 3);

  return (
    <main className="min-h-screen pb-24" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <div className="max-w-6xl mx-auto px-3 py-5 sm:px-4 md:py-10">
        {/* Header */}
        <div className="mb-5 md:mb-8">
          <div className="mb-1 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: T.accentColor, boxShadow: `0 0 8px ${T.accentColor}` }} />
              <span className="truncate text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: T.accentColor }}>LiT OS Dashboard</span>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition active:scale-95 md:hidden"
              style={{
                backgroundColor: T.boxBg,
                borderColor: `${T.borderColor}35`,
                color: T.accentColor,
              }}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
          <h1 className="text-2xl md:text-3xl font-black" style={{ color: T.textColor }}>Welcome back</h1>
          <p className="text-sm mt-1" style={{ color: T.textMuted }}>Your creator command center.</p>
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setMenuOpen(false)}
            />
            <div
              className="relative flex h-full w-[82vw] max-w-[320px] flex-col border-r shadow-2xl"
              style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}35` }}
            >
              <div
                className="flex h-12 items-center justify-between border-b px-4"
                style={{ borderColor: `${T.borderColor}30` }}
              >
                <span
                  className="text-[11px] font-black uppercase tracking-[0.18em]"
                  style={{ color: T.accentColor }}
                >
                  Navigation
                </span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg p-1.5 transition-colors hover:bg-white/5"
                  style={{ color: T.textMuted }}
                  aria-label="Hide navigation"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto p-2">
                {MOBILE_MENU_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold transition-colors hover:bg-white/5"
                      style={{ color: T.textColor }}
                    >
                      <Icon className="h-4 w-4" style={{ color: T.accentColor }} />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        )}

        <div className="mb-6 md:hidden">
          <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: T.accentColor }}>
            Navigation
          </div>
          <div className="grid grid-cols-5 gap-2">
            {MOBILE_NAV_ACTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-xl border px-1 text-center transition active:scale-95"
                  style={{
                    backgroundColor: `${item.color}10`,
                    borderColor: `${item.color}25`,
                    color: item.color,
                  }}
                >
                  <Icon className="h-4 w-4" />
                  <span className="max-w-full truncate text-[9px] font-black">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Top cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 md:gap-4 mb-6 md:mb-8">
          <div className="rounded-2xl border p-4 md:p-5" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}>
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="h-4 w-4" style={{ color: "#fbbf24" }} />
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>Balance</span>
            </div>
            <div className="text-3xl font-black mb-0.5" style={{ color: T.textColor }}>
              {walletLoading ? "—" : balance.toLocaleString()}
            </div>
            <div className="text-[10px]" style={{ color: T.textMuted }}>LBC available</div>
          </div>

          <div className="rounded-2xl border p-4 md:p-5" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}>
            <div className="flex items-center gap-2 mb-3">
              <Crown className="h-4 w-4" style={{ color: "#a3f546" }} />
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>Current Plan</span>
            </div>
            <div className="text-3xl font-black mb-0.5" style={{ color: T.textColor }}>{currentPlan}</div>
            <div className="text-[10px]" style={{ color: T.textMuted }}>500 LBC included</div>
          </div>

          <div className="rounded-2xl border p-4 md:p-5" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}>
            <div className="flex items-center gap-2 mb-3">
              <Bot className="h-4 w-4" style={{ color: "#22d3ee" }} />
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>Active Agents</span>
            </div>
            <div className="text-3xl font-black mb-0.5" style={{ color: T.textColor }}>{activeAgents.length}</div>
            <div className="text-[10px]" style={{ color: T.textMuted }}>of 6 core agents</div>
          </div>

          <div className="rounded-2xl border p-4 md:p-5" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4" style={{ color: "#f472b6" }} />
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>Usage</span>
            </div>
            <div className="text-3xl font-black mb-0.5" style={{ color: T.textColor }}>312</div>
            <div className="text-[10px]" style={{ color: T.textMuted }}>LBC used this month</div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="mb-6 md:mb-8">
          <div className="text-xs font-black uppercase tracking-[0.15em] mb-4" style={{ color: T.accentColor }}>Quick Actions</div>
          <div className="grid grid-cols-2 gap-2 min-[430px]:grid-cols-3 md:flex md:flex-wrap md:gap-3">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.label}
                  href={action.href}
                  className="flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-bold transition hover:scale-[1.02] md:px-4 md:text-sm"
                  style={{ backgroundColor: `${action.color}12`, color: action.color, border: `1px solid ${action.color}30` }}
                >
                  <Icon className="h-4 w-4" />
                  {action.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Active agents */}
          <div className="lg:col-span-2">
            <div className="text-xs font-black uppercase tracking-[0.15em] mb-4" style={{ color: T.accentColor }}>Active Agents</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
              {activeAgents.map((agent) => {
                const av = AGENT_AVATAR_META[agent.slug] || AGENT_AVATAR_META["director"];
                return (
                  <Link
                    key={agent.slug}
                    href={`/agents/${agent.slug}`}
                    className="flex items-center gap-3 p-4 rounded-2xl border transition hover:scale-[1.02]"
                    style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}
                  >
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: av.bg }}>
                      {av.emoji}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-black truncate" style={{ color: T.textColor }}>{agent.name}</div>
                      <div className="text-[10px] truncate" style={{ color: T.textMuted }}>{agent.role}</div>
                    </div>
                    <div className="ml-auto w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: agent.color, boxShadow: `0 0 6px ${agent.color}` }} />
                  </Link>
                );
              })}
            </div>

            {/* Recent activity */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}>
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-black uppercase tracking-[0.15em]" style={{ color: T.accentColor }}>Recent Activity</div>
                <Link href="/gallery" className="text-[10px] font-bold flex items-center gap-1 transition hover:opacity-80" style={{ color: T.textMuted }}>
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="space-y-3">
                {RECENT_ACTIVITY.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-b-0" style={{ borderColor: `${T.borderColor}20` }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${T.accentColor}12`, color: T.accentColor }}>
                        {item.type === "image" ? <ImageIcon className="h-4 w-4" /> : item.type === "chat" ? <MessageSquare className="h-4 w-4" /> : item.type === "post" ? <Zap className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                      </div>
                      <div>
                        <div className="text-sm font-bold" style={{ color: T.textColor }}>{item.title}</div>
                        <div className="text-[10px]" style={{ color: T.textMuted }}>{item.time}</div>
                      </div>
                    </div>
                    <div className="text-xs font-black" style={{ color: item.credits > 0 ? "#fbbf24" : "#6b7280" }}>
                      {item.credits > 0 ? `-${item.credits} LBC` : "Free"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Usage stats */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}>
              <div className="text-xs font-black uppercase tracking-[0.15em] mb-4" style={{ color: T.accentColor }}>Usage Stats</div>
              <div className="space-y-4">
                {USAGE_STATS.map((stat) => (
                  <div key={stat.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm" style={{ color: T.textMuted }}>
                      <TrendingUp className="h-4 w-4" style={{ color: stat.color }} />
                      {stat.label}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black" style={{ color: T.textColor }}>{stat.value}</span>
                      <span className="text-[10px] font-bold" style={{ color: "#4ade80" }}>{stat.change}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Approval queue teaser */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}>
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-black uppercase tracking-[0.15em]" style={{ color: T.accentColor }}>Approval Queue</div>
                <Link href="/dashboard/social-agent" className="text-[10px] font-bold transition hover:opacity-80" style={{ color: T.textMuted }}>Open</Link>
              </div>
              <div className="flex items-center gap-3 py-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: "#a3f54612", color: "#a3f546" }}>
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-bold" style={{ color: T.textColor }}>2 posts pending</div>
                  <div className="text-[10px]" style={{ color: T.textMuted }}>Awaiting your approval</div>
                </div>
              </div>
            </div>

            {/* Upgrade card */}
            <div className="rounded-2xl border p-5" style={{ backgroundColor: `${T.accentColor}08`, borderColor: `${T.accentColor}30` }}>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4" style={{ color: T.accentColor }} />
                <span className="text-sm font-black" style={{ color: T.textColor }}>Upgrade to Starter</span>
              </div>
              <p className="text-xs mb-3 leading-relaxed" style={{ color: T.textMuted }}>
                Get 500 LBC every month and unlock more agent slots for $5/mo.
              </p>
              <Link
                href="/marketplace"
                className="inline-flex items-center gap-2 w-full justify-center rounded-xl py-2.5 text-xs font-black transition hover:scale-[1.02]"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}
              >
                <Clock className="h-4 w-4" /> View plans
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
