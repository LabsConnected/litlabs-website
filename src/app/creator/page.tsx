"use client";

export const dynamic = "force-dynamic";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import {
  BarChart3,
  Coins,
  Users,
  Folder,
  FileText,
  Megaphone,
  TrendingUp,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";

const TABS = [
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "revenue", label: "Revenue", icon: Coins },
  { id: "subscribers", label: "Subscribers", icon: Users },
  { id: "portfolio", label: "Portfolio", icon: Folder },
  { id: "content", label: "Content", icon: FileText },
  { id: "promote", label: "Promote", icon: Megaphone },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB_CONTENT: Record<TabId, { title: string; body: string; cta?: { href: string; label: string } }> = {
  analytics: {
    title: "Creator Analytics",
    body: "Track views, engagement, and agent usage across your published work.",
    cta: { href: "/dashboard", label: "Open dashboard" },
  },
  revenue: {
    title: "Revenue",
    body: "Monitor LiTBit earnings from agent sales, subscriptions, and marketplace listings.",
    cta: { href: "/wallet", label: "View wallet" },
  },
  subscribers: {
    title: "Subscribers",
    body: "See who follows your work and manages active subscriptions to your agents.",
    cta: { href: "/social?tab=friends", label: "View community" },
  },
  portfolio: {
    title: "Portfolio",
    body: "Showcase your best agents, media, and projects in one creator hub.",
    cta: { href: "/showcase", label: "Open showcase" },
  },
  content: {
    title: "Content",
    body: "Manage posts, gallery uploads, and studio exports from a single place.",
    cta: { href: "/gallery", label: "Open gallery" },
  },
  promote: {
    title: "Promote",
    body: "Share your agents and listings to grow your audience on LiTT Code.",
    cta: { href: "/marketplace?tab=sell", label: "List on marketplace" },
  },
};

export default function CreatorPage() {
  return (
    <Suspense
      fallback={
        <PageShell title="Creator Hub" icon={<BarChart3 size={28} />}>
          <div className="flex justify-center py-12 opacity-60 text-sm">Loading…</div>
        </PageShell>
      }
    >
      <CreatorContent />
    </Suspense>
  );
}

function CreatorContent() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = (searchParams.get("tab") as TabId) || "analytics";
  const content = TAB_CONTENT[activeTab] ?? TAB_CONTENT.analytics;

  const stats = useMemo(
    () => [
      { label: "Views", value: "—", icon: TrendingUp },
      { label: "Followers", value: "—", icon: Users },
      { label: "Earnings", value: "—", icon: Coins },
      { label: "Agents", value: "—", icon: Sparkles },
    ],
    [],
  );

  const cardStyle = {
    backgroundColor: `${T.boxBg}60`,
    borderColor: T.borderColor + "30",
  };

  return (
    <PageShell
      title="Creator Hub"
      subtitle="Analytics, revenue, and growth tools for creators"
      icon={<BarChart3 size={28} />}
    >
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {!isLoaded ? null : !isSignedIn ? (
          <div className="rounded-2xl border p-6 text-center" style={cardStyle}>
            <p className="opacity-70 mb-4">Sign in to access your creator dashboard.</p>
            <Link
              href="/sign-in"
              className="inline-flex px-5 py-2 rounded-xl text-sm font-bold"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              Sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border p-4" style={cardStyle}>
                  <s.icon size={16} style={{ color: T.accentColor }} className="mb-2" />
                  <div className="text-xl font-black" style={{ color: T.headerColor }}>
                    {s.value}
                  </div>
                  <div className="text-xs opacity-55">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => router.push(`/creator?tab=${tab.id}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all"
                  style={{
                    backgroundColor: activeTab === tab.id ? T.accentColor + "20" : "transparent",
                    borderColor: activeTab === tab.id ? T.accentColor + "50" : T.borderColor + "30",
                    color: activeTab === tab.id ? T.accentColor : T.textColor,
                  }}
                >
                  <tab.icon size={14} />
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="rounded-2xl border p-6" style={cardStyle}>
              <h2 className="text-xl font-black mb-2" style={{ color: T.headerColor }}>
                {content.title}
              </h2>
              <p className="text-sm opacity-70 mb-4">{content.body}</p>
              <p className="text-xs opacity-50 mb-4">
                Live metrics sync from Supabase creator_earnings and agent_analytics tables once migrations are applied.
              </p>
              {content.cta && (
                <Link
                  href={content.cta.href}
                  className="inline-flex items-center gap-1 text-sm font-bold"
                  style={{ color: T.accentColor }}
                >
                  {content.cta.label} <ArrowUpRight size={14} />
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
