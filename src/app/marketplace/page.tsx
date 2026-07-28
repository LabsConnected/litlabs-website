"use client";

import { useState, useCallback, useEffect, useMemo, Suspense, memo } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useSearchParams } from "next/navigation";
import {
  Check,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Search as SearchIcon,
  Wrench,
  Zap,
  FileText,
  Code2,
  Palette,
  Plug,
  Crown,
  Loader2,
  TrendingUp,
  MessageSquare,
  ImageIcon,
} from "lucide-react";

// --- Types ---

type MarketplaceItemType = "skill" | "tool" | "workflow" | "template" | "integration" | "creative_pack";

type MarketplaceItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
  item_type: MarketplaceItemType;
  category: string;
  status: "available" | "coming_soon" | "unavailable" | "beta";
  compatible_assistants: ("litt" | "spark")[];
  capability_key: string;
  version: string;
  icon: string;
  is_featured: boolean;
  is_official: boolean;
  is_beta: boolean;
  price_cents: number;
  required_connections: string[];
};

type Installation = {
  id: string;
  marketplace_item_id: string;
  enabled: boolean;
  installed_at: string;
};

type MarketplaceStats = {
  totalItems: number;
  installedItems: number;
  availableItems: number;
  comingSoonItems: number;
};

type PremiumAgent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  is_featured: boolean;
  is_core: boolean;
  features: string[];
};

// --- Item pricing state ---

const ALL_ITEMS_FREE_DURING_BETA = false;

// --- Category config ---

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "development", label: "Development" },
  { id: "creative", label: "Creative" },
  { id: "automation", label: "Automation" },
  { id: "integration", label: "Integrations" },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  development: "#818cf8",
  creative: "#ec4899",
  automation: "#fbbf24",
  integration: "#22d3ee",
};

const TYPE_LABELS: Record<MarketplaceItemType, string> = {
  skill: "Skill",
  tool: "Tool",
  workflow: "Workflow",
  template: "Template",
  integration: "Integration",
  creative_pack: "Creative Pack",
};

const TYPE_ICONS: Record<MarketplaceItemType, typeof Code2> = {
  skill: Zap,
  tool: Code2,
  workflow: Wrench,
  template: FileText,
  integration: Plug,
  creative_pack: Palette,
};

const CONNECTION_LABELS: Record<string, string> = {
  github: "GitHub repository",
  terminal: "Terminal (PTY)",
  vercel: "Vercel account",
  supabase: "Supabase project",
};

// --- Component ---

function MarketplaceInner() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { resolvedColors: T } = useTheme();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [installations, setInstallations] = useState<Map<string, Installation>>(new Map());
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"marketplace" | "agents" | "beta">(() => {
    const tab = searchParams.get("tab");
    if (tab === "beta") return "beta";
    if (tab === "agents") return "agents";
    return "marketplace";
  });
  const [premiumAgents, setPremiumAgents] = useState<PremiumAgent[]>([]);
  const [entitlements, setEntitlements] = useState<Map<string, boolean>>(new Map());
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  const showToast = (msg: string, type: "success" | "error" | "info" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load items from /api/marketplace/items
  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/marketplace/items");
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setItems(data.items);
      }
    } catch {
      // Keep empty list on error
    } finally {
      setLoading(false);
    }
  }, []);

  // Load installed items from /api/marketplace/installations
  const loadInstalled = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const res = await fetch("/api/marketplace/installations");
      const data = await res.json();
      if (Array.isArray(data.installations)) {
        const map = new Map<string, Installation>();
        for (const inst of data.installations) {
          map.set(inst.marketplace_item_id, inst);
        }
        setInstallations(map);
      }
    } catch {
      // silent
    }
  }, [isSignedIn]);

  // Load premium agents + entitlements
  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (Array.isArray(data.agents)) {
        const paid = data.agents.filter((a: PremiumAgent) => a.price_cents > 0 || a.is_featured);
        setPremiumAgents(paid);
      }
    } catch {
      // silent
    }
  }, []);

  const loadEntitlements = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const res = await fetch("/api/marketplace/agents/entitlements");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.entitlements)) {
          const map = new Map<string, boolean>();
          for (const e of data.entitlements) {
            if (e.status === "active") map.set(e.agent_slug, true);
          }
          setEntitlements(map);
        }
      }
    } catch {
      // silent
    }
  }, [isSignedIn]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      loadItems();
      if (isSignedIn) loadInstalled();
      loadAgents();
      if (isSignedIn) loadEntitlements();
    });
    return () => cancelAnimationFrame(id);
  }, [loadItems, loadInstalled, isSignedIn, loadAgents, loadEntitlements]);

  // Check for purchase/cancel URL params
  useEffect(() => {
    const purchased = searchParams.get("purchased");
    const canceled = searchParams.get("canceled");
    if (purchased) {
      showToast(`${purchased} purchased successfully!`, "success");
      loadEntitlements();
    } else if (canceled) {
      showToast("Purchase canceled.", "info");
    }
  }, [searchParams, loadEntitlements]);

  const buyAgent = useCallback(async (agent: PremiumAgent) => {
    if (!isSignedIn) {
      showToast("Please sign in to purchase.", "error");
      return;
    }
    setPurchasing(agent.id);
    try {
      const res = await fetch(`/api/marketplace/agents/${agent.id}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || "Checkout failed.", "error");
      }
    } catch {
      showToast("Network error during checkout.", "error");
    } finally {
      setPurchasing(null);
    }
  }, [isSignedIn]);

  const installItem = useCallback(async (item: MarketplaceItem) => {
    if (!isSignedIn) {
      showToast("Please sign in to install.", "error");
      return;
    }
    if (item.status === "coming_soon") {
      showToast("This capability is coming soon.", "info");
      return;
    }
    try {
      const res = await fetch("/api/marketplace/installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });
      if (res.ok || res.status === 200) {
        const data = await res.json();
        setInstallations((prev) => {
          const next = new Map(prev);
          next.set(item.id, {
            id: data.installation?.id || "",
            marketplace_item_id: item.id,
            enabled: true,
            installed_at: new Date().toISOString(),
          });
          return next;
        });
        showToast(`${item.name} installed`, "success");
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Install failed.", "error");
      }
    } catch {
      showToast("Network error during install.", "error");
    }
  }, [isSignedIn]);

  const uninstallItem = useCallback(async (item: MarketplaceItem) => {
    const inst = installations.get(item.id);
    if (!inst) return;
    try {
      await fetch(`/api/marketplace/installations/${inst.id}`, { method: "DELETE" });
    } catch {
      // silent
    }
    setInstallations((prev) => {
      const next = new Map(prev);
      next.delete(item.id);
      return next;
    });
    showToast(`${item.name} removed`, "info");
  }, [installations]);

  const toggleEnabled = useCallback(async (item: MarketplaceItem) => {
    const inst = installations.get(item.id);
    if (!inst) return;
    try {
      const res = await fetch(`/api/marketplace/installations/${inst.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !inst.enabled }),
      });
      if (res.ok) {
        setInstallations((prev) => {
          const next = new Map(prev);
          next.set(item.id, { ...inst, enabled: !inst.enabled });
          return next;
        });
        showToast(`${item.name} ${!inst.enabled ? "enabled" : "disabled"}`, "info");
      }
    } catch {
      showToast("Failed to update.", "error");
    }
  }, [installations]);

  const filteredItems = useMemo(() =>
    items
      .filter((item) => selectedCategory === "all" || item.category === selectedCategory)
      .filter(
        (item) =>
          !searchQuery ||
          item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [items, selectedCategory, searchQuery],
  );

  const featuredItems = useMemo(() => filteredItems.filter((item) => item.is_featured), [filteredItems]);
  const nonFeaturedItems = useMemo(() => filteredItems.filter((item) => !item.is_featured), [filteredItems]);

  const stats = useMemo<MarketplaceStats>(() => ({
    totalItems: items.length,
    installedItems: installations.size,
    availableItems: items.filter((i) => i.status === "available" || i.status === "beta").length,
    comingSoonItems: items.filter((i) => i.status === "coming_soon").length,
  }), [items, installations]);

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] text-white/50">
        <div className="text-center">
          <div className="mb-4 animate-pulse text-3xl">⚡</div>
          <div className="text-sm">Loading marketplace...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: "#060713", color: T.textColor }}>
      {/* Ambient gradient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(249,115,22,0.08), transparent 70%)" }} />
        <div className="absolute right-0 top-20 h-[400px] w-[400px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(34,211,238,0.08), transparent 70%)" }} />
        <div className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(139,92,246,0.06), transparent 70%)" }} />
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed right-4 top-20 z-200 max-w-xs rounded-2xl border px-4 py-3 text-xs font-bold backdrop-blur-xl"
          style={{
            backgroundColor: toast.type === "success" ? "#0a2e0a99" : toast.type === "error" ? "#2e0a0a99" : "#0a1a2e99",
            borderColor: toast.type === "success" ? T.accentColor + "60" : toast.type === "error" ? "#ff444460" : T.linkColor + "60",
            color: toast.type === "success" ? T.accentColor : toast.type === "error" ? "#ff4444" : T.linkColor,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* === HEADER === */}
      <div className="relative px-4 pt-10 pb-6 sm:px-6 sm:pt-14">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl" style={{ color: T.headerColor }}>Marketplace</h1>
            <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300 backdrop-blur-sm">Beta</span>
          </div>
          <p className="mt-2 max-w-xl text-sm text-white/50">
            Extend LiTT and Spark with real tools, workflows, integrations, and creative packs.
          </p>

          {/* Stats row — glassmorphism pills */}
          <div className="mt-6 flex flex-wrap gap-3">
            {[
              { label: "Available", value: stats.availableItems, icon: Sparkles, color: "#f97316" },
              { label: "Installed", value: stats.installedItems, icon: Check, color: "#22d3ee" },
              { label: "Coming soon", value: stats.comingSoonItems, icon: ShieldCheck, color: "#a78bfa" },
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="flex items-center gap-2.5 rounded-2xl border border-white/8 bg-white/[.03] px-4 py-2.5 backdrop-blur-xl transition hover:border-white/15 hover:bg-white/[.05]">
                  <Icon size={15} style={{ color: stat.color }} />
                  <span className="text-lg font-black" style={{ color: T.headerColor }}>{stat.value}</span>
                  <span className="text-[10px] uppercase tracking-wider text-white/35">{stat.label}</span>
                </div>
              );
            })}
          </div>

          {/* LiTT and Spark explainer */}
          <div className="mt-5 flex flex-wrap gap-4 text-xs text-white/40">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
              LiTT uses installed engineering, research, automation, and project tools
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.5)]" />
              Spark uses installed creative, media, branding, and content tools
            </span>
          </div>

          <div className="mt-5 flex gap-3">
            <Link href="/studio" className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-2.5 text-sm font-black text-black transition hover:scale-[1.03] hover:shadow-lg hover:shadow-white/10">
              Open in Studio <ArrowRight size={14} />
            </Link>
            <button onClick={() => setActiveTab("beta")} className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/8 px-5 py-2.5 text-sm font-bold text-amber-300 backdrop-blur-sm transition hover:scale-[1.03] hover:bg-amber-400/12">
              Beta Access
            </button>
          </div>
        </div>
      </div>

      {/* === TAB BAR — pill segmented control === */}
      <div className="sticky top-0 z-50 px-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl">
          <div className="flex w-full gap-1 rounded-2xl border border-white/8 bg-black/40 p-1 backdrop-blur-xl">
            {[
              { id: "marketplace", label: "Browse", color: "#f97316" },
              { id: "agents", label: "Agents", color: "#22d3ee" },
              { id: "beta", label: "Beta Access", color: "#fbbf24" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as "marketplace" | "agents" | "beta")}
                className={`relative flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                  activeTab === tab.id ? "text-black" : "text-white/40 hover:text-white/70"
                }`}
                style={
                  activeTab === tab.id
                    ? { background: tab.color }
                    : undefined
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* === MARKETPLACE TAB === */}
      {activeTab === "marketplace" && (
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          {/* Filters + Search */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => {
                const isActive = selectedCategory === cat.id;
                return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={isActive
                    ? "rounded-xl border border-orange-500/40 bg-orange-500/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-orange-400 transition"
                    : "rounded-xl border border-white/8 bg-white/[.02] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40 backdrop-blur-sm transition hover:border-white/15 hover:bg-white/[.05] hover:text-white/70"
                  }
                >
                  {cat.label}
                </button>
                );
              })}
            </div>
            <div className="relative w-full max-w-48">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={14} />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-white/8 bg-white/[.03] py-2 pl-9 pr-3 text-sm text-white outline-none backdrop-blur-sm placeholder:text-white/20 transition focus:border-orange-500/40 focus:bg-white/[.05]"
              />
            </div>
          </div>

          {/* Featured section */}
          {featuredItems.length > 0 && !searchQuery && selectedCategory === "all" && (
            <div className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles size={12} className="text-orange-400" />
                <p className="text-[10px] font-black uppercase tracking-[.25em] text-orange-400">Featured</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featuredItems.map((item) => (
                  <MarketplaceCard
                    key={item.id}
                    item={item}
                    installation={installations.get(item.id)}
                    onInstall={() => installItem(item)}
                    onUninstall={() => uninstallItem(item)}
                    onToggleEnabled={() => toggleEnabled(item)}
                    accentColor={T.accentColor}
                    borderColor={T.borderColor}
                    boxBg={T.boxBg}
                    textMuted={T.textMuted}
                    headerColor={T.headerColor}
                  />
                ))}
              </div>
            </div>
          )}

          {/* All items */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <p className="text-[10px] font-black uppercase tracking-[.25em] text-white/35">
                {searchQuery ? "Search results" : "All capabilities"}
              </p>
              <span className="text-[10px] text-white/25">({filteredItems.length})</span>
            </div>
            {filteredItems.length === 0 ? (
              <div className="py-16 text-center">
                <div className="mb-3 text-3xl opacity-30">🔍</div>
                <p className="text-sm text-white/35">
                  {loading
                    ? "Loading capabilities..."
                    : items.length === 0
                      ? "No marketplace items available yet."
                      : `No items found matching "${searchQuery}".`}
                </p>
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(""); setSelectedCategory("all"); }} className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm text-white/50 transition hover:bg-white/5">
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(searchQuery ? filteredItems : nonFeaturedItems).map((item) => (
                  <MarketplaceCard
                    key={item.id}
                    item={item}
                    installation={installations.get(item.id)}
                    onInstall={() => installItem(item)}
                    onUninstall={() => uninstallItem(item)}
                    onToggleEnabled={() => toggleEnabled(item)}
                    accentColor={T.accentColor}
                    borderColor={T.borderColor}
                    boxBg={T.boxBg}
                    textMuted={T.textMuted}
                    headerColor={T.headerColor}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === AGENTS TAB === */}
      {activeTab === "agents" && (
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          {/* Hero banner */}
          <div className="mb-8 overflow-hidden rounded-3xl border border-cyan-400/15 bg-gradient-to-br from-cyan-500/8 via-transparent to-violet-500/5 p-6 backdrop-blur-xl sm:p-8">
            <div className="flex items-center gap-2">
              <Crown size={18} className="text-cyan-400" />
              <h2 className="text-lg font-black" style={{ color: T.headerColor }}>Premium Agents</h2>
            </div>
            <p className="mt-1.5 text-sm text-white/50">
              One-time founder access. Buy once, use forever.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-3 py-2 text-xs text-cyan-300">
                <MessageSquare size={13} /> Free chat with your agent
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-violet-400/15 bg-violet-400/5 px-3 py-2 text-xs text-violet-300">
                <ImageIcon size={13} /> 50% off media generation
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-300">
                <TrendingUp size={13} /> Permanent ownership
              </div>
            </div>
          </div>

          {premiumAgents.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mb-3 text-3xl opacity-20">👑</div>
              <p className="text-sm text-white/35">
                {agentsLoading ? "Loading agents..." : "No premium agents available yet."}
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {premiumAgents.map((agent) => {
                const owned = entitlements.get(agent.slug);
                const priceDisplay = agent.price_cents > 0
                  ? `$${(agent.price_cents / 100).toFixed(0)}`
                  : "Free";
                return (
                  <article
                    key={agent.id}
                    className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/8 bg-white/[.02] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400/20 hover:shadow-xl hover:shadow-cyan-500/5"
                  >
                    {/* Gradient glow on hover */}
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <div className="relative h-1.5 w-full bg-gradient-to-r from-cyan-400 via-cyan-300 to-violet-400" />
                    <div className="relative flex flex-1 flex-col p-6">
                      <div className="flex items-start gap-3">
                        <div
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/5"
                        >
                          <Crown size={22} className="text-cyan-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-base font-black" style={{ color: T.headerColor }}>{agent.name}</h3>
                          <div className="mt-0.5 text-[10px] uppercase tracking-wide" style={{ color: T.textMuted }}>
                            <span className="text-cyan-400">Agent</span>
                            <span> · </span>
                            <span className="capitalize">{agent.category}</span>
                          </div>
                        </div>
                      </div>
                      <p className="mt-4 line-clamp-2 text-sm leading-relaxed" style={{ color: T.textMuted }}>
                        {agent.description}
                      </p>
                      {agent.features.length > 0 && (
                        <div className="mt-4 space-y-1.5">
                          {agent.features.slice(0, 4).map((f) => (
                            <div key={f} className="flex items-center gap-2 text-xs" style={{ color: T.textMuted }}>
                              <Check size={12} className="shrink-0 text-cyan-400" /> {f}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-5 border-t border-white/5 pt-4">
                        {owned ? (
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 rounded-xl bg-emerald-400/10 px-3.5 py-2.5 text-xs font-bold text-emerald-300">
                              <Check size={13} /> Owned
                            </span>
                            <Link
                              href={`/studio?tool=chat`}
                              className="flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-bold transition hover:scale-[1.03]"
                              style={{ background: "#22d3ee15", color: "#22d3ee" }}
                            >
                              <ArrowRight size={13} /> Use in Studio
                            </Link>
                          </div>
                        ) : (
                          <button
                            onClick={() => buyAgent(agent)}
                            disabled={purchasing === agent.id}
                            className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 py-3 text-sm font-black text-black transition hover:scale-[1.02] hover:shadow-lg hover:shadow-cyan-500/20 disabled:opacity-50"
                            aria-label={`Buy ${agent.name}`}
                          >
                            {purchasing === agent.id ? (
                              <span className="flex items-center justify-center gap-1.5">
                                <Loader2 size={14} className="animate-spin" /> Processing...
                              </span>
                            ) : (
                              `Buy — ${priceDisplay}`
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* === BETA TAB === */}
      {activeTab === "beta" && (
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          {/* Beta status */}
          <div className="overflow-hidden rounded-3xl border border-amber-400/15 bg-gradient-to-br from-amber-400/6 to-transparent p-6 backdrop-blur-xl sm:p-8">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🧪</span>
              <div>
                <div className="text-lg font-black text-amber-300">Founder Beta Access</div>
                <div className="text-xs text-white/50">Core tools remain free while testing. Paid beta plans unlock higher limits and features.</div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/55">
              Welcome to LiTTree Lab Studios Beta. Your feedback shapes what we build next.
              Paid plans are available at founder pricing — well below future standard rates.
            </p>
          </div>

          {/* Plan cards */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {/* Starter */}
            <div className="rounded-3xl border border-white/8 bg-white/[.02] p-6 backdrop-blur-xl transition hover:border-white/15">
              <div className="text-xs font-black uppercase tracking-wider text-white/40">Starter</div>
              <div className="mt-1 text-3xl font-black text-white">Free</div>
              <div className="text-[10px] text-white/30">Free forever</div>
              <div className="mt-4 space-y-1.5">
                {["1 active project", "500 monthly LiTTBits", "LiTT and Spark", "Basic tools"].map((f) => (
                  <div key={f} className="flex items-center gap-2 text-xs text-white/55">
                    <Check size={12} className="shrink-0 text-emerald-400" /> {f}
                  </div>
                ))}
              </div>
              <Link href="/studio" className="mt-5 flex w-full items-center justify-center rounded-xl border border-white/10 py-2.5 text-xs font-bold text-white/50 transition hover:bg-white/5">
                Get Started
              </Link>
            </div>

            {/* Creator Beta */}
            <div className="rounded-3xl border-2 border-cyan-400/25 bg-cyan-400/[.03] p-6 backdrop-blur-xl transition hover:border-cyan-400/35 hover:shadow-lg hover:shadow-cyan-500/5">
              <div className="text-xs font-black uppercase tracking-wider text-cyan-400">Creator Beta</div>
              <div className="mt-1 text-3xl font-black text-white">$7<span className="text-base font-bold text-white/40">/month</span></div>
              <div className="text-[10px] text-white/30">Founder pricing · later $15</div>
              <div className="mt-4 space-y-1.5">
                {["5 active projects", "6,000 monthly LiTTBits", "GitHub connection", "Voice mode"].map((f) => (
                  <div key={f} className="flex items-center gap-2 text-xs text-white/55">
                    <Check size={12} className="shrink-0 text-cyan-400" /> {f}
                  </div>
                ))}
              </div>
              <Link href="/pricing" className="mt-5 flex w-full items-center justify-center rounded-xl bg-cyan-400 py-2.5 text-xs font-black text-black transition hover:scale-[1.02]">
                Subscribe
              </Link>
            </div>

            {/* Pro Builder Beta */}
            <div className="rounded-3xl border-2 border-violet-400/25 bg-violet-400/[.03] p-6 backdrop-blur-xl transition hover:border-violet-400/35 hover:shadow-lg hover:shadow-violet-500/5">
              <div className="text-xs font-black uppercase tracking-wider text-violet-400">Pro Builder Beta</div>
              <div className="mt-1 text-3xl font-black text-white">$19<span className="text-base font-bold text-white/40">/month</span></div>
              <div className="text-[10px] text-white/30">Founder pricing · later $39</div>
              <div className="mt-4 space-y-1.5">
                {["25 active projects", "20,000 monthly LiTTBits", "Terminal runtime", "Vercel deployment"].map((f) => (
                  <div key={f} className="flex items-center gap-2 text-xs text-white/55">
                    <Check size={12} className="shrink-0 text-violet-400" /> {f}
                  </div>
                ))}
              </div>
              <Link href="/pricing" className="mt-5 flex w-full items-center justify-center rounded-xl bg-violet-400 py-2.5 text-xs font-black text-black transition hover:scale-[1.02]">
                Subscribe
              </Link>
            </div>

            {/* Founding Member */}
            <div className="relative overflow-hidden rounded-3xl border-2 border-amber-400/30 bg-amber-400/[.03] p-6 backdrop-blur-xl transition hover:border-amber-400/40 hover:shadow-lg hover:shadow-amber-500/5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-black uppercase tracking-wider text-amber-400">Founding Member</div>
                <span className="rounded-md bg-amber-400 px-1.5 py-0.5 text-[8px] font-black uppercase text-black">Limited</span>
              </div>
              <div className="mt-1 text-3xl font-black text-white">$149</div>
              <div className="text-[10px] text-white/30">One-time · permanent benefits</div>
              <div className="mt-4 space-y-1.5">
                {["Permanent Creator account", "Founder badge", "20% off credit packs", "Price protection"].map((f) => (
                  <div key={f} className="flex items-center gap-2 text-xs text-white/55">
                    <Check size={12} className="shrink-0 text-amber-400" /> {f}
                  </div>
                ))}
              </div>
              <Link href="/pricing" className="mt-5 flex w-full items-center justify-center rounded-xl bg-amber-400 py-2.5 text-xs font-black text-black transition hover:scale-[1.02]">
                Become a Founder
              </Link>
            </div>
          </div>

          {/* Marketplace item states */}
          <div className="mt-6 rounded-3xl border border-white/8 bg-white/[.02] p-6 backdrop-blur-xl">
            <div className="text-xs font-black uppercase tracking-wider text-white/40">How Marketplace Items Work</div>
            <div className="mt-3 space-y-2">
              {[
                { state: "Free", desc: "Core skills and tools — no charge", color: "text-emerald-300" },
                { state: "Included", desc: "Included with Creator or Pro plan", color: "text-cyan-300" },
                { state: "LiTTBit usage", desc: "External-cost tools charge LiTTBits per use", color: "text-violet-300" },
                { state: "Coming soon", desc: "Not yet available", color: "text-amber-300" },
              ].map((item) => (
                <div key={item.state} className="flex items-center gap-2 text-xs">
                  <span className={`font-bold ${item.color}`}>{item.state}</span>
                  <span className="text-white/35">— {item.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Feedback */}
          <div className="mt-6 rounded-3xl border border-white/8 bg-white/[.02] p-6 text-center backdrop-blur-xl">
            <div className="font-bold text-white/80">Beta Feedback</div>
            <p className="mt-1 text-xs text-white/40">Found a bug? Have a feature request? Let us know.</p>
            <div className="mt-4 flex justify-center gap-3">
              <Link href="/studio?tool=chat" className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2 text-sm font-bold text-black transition hover:scale-[1.03] hover:bg-orange-400">
                <Sparkles size={14} /> Report via LiTT
              </Link>
              <a href="mailto:beta@litlabs.net" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2 text-sm font-bold text-white/50 transition hover:bg-white/5">
                Email Feedback
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Card component ---

const MarketplaceCard = memo(function MarketplaceCard({
  item,
  installation,
  onInstall,
  onUninstall,
  onToggleEnabled,
  accentColor,
  borderColor,
  boxBg,
  textMuted,
  headerColor,
}: {
  item: MarketplaceItem;
  installation: Installation | undefined;
  onInstall: () => void;
  onUninstall: () => void;
  onToggleEnabled: () => void;
  accentColor: string;
  borderColor: string;
  boxBg: string;
  textMuted: string;
  headerColor: string;
}) {
  const categoryColor = CATEGORY_COLORS[item.category] || "#fbbf24";
  const TypeIcon = TYPE_ICONS[item.item_type] || Code2;
  const isInstalled = !!installation;
  const isEnabled = installation?.enabled ?? false;
  const isComingSoon = item.status === "coming_soon";
  const needsSetup = item.required_connections.length > 0;

  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/8 bg-white/[.02] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/15 hover:shadow-xl hover:shadow-black/20"
      style={{ opacity: isComingSoon ? 0.55 : 1 }}
    >
      {/* Category accent gradient bar */}
      <div className="h-1 w-full" style={{ background: `linear-gradient(to right, ${categoryColor}, ${categoryColor}80)` }} />

      {/* Hover glow */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(ellipse at top, ${categoryColor}08, transparent 70%)` }}
      />

      <div className="relative flex flex-1 flex-col p-5">
        {/* Header: icon + name + type */}
        <div className="flex items-start gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl transition-transform duration-300 group-hover:scale-110"
            style={{ background: categoryColor + "12", border: `1px solid ${categoryColor}25` }}
          >
            {item.icon || <TypeIcon size={22} style={{ color: categoryColor }} />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-black" style={{ color: headerColor }}>{item.name}</h3>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide" style={{ color: textMuted }}>
              <span style={{ color: categoryColor }}>{TYPE_LABELS[item.item_type]}</span>
              <span className="text-white/20">·</span>
              <span className="capitalize">{item.category}</span>
              {item.is_official && (
                <>
                  <span className="text-white/20">·</span>
                  <span style={{ color: accentColor }}>Official</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed" style={{ color: textMuted }}>
          {item.description}
        </p>

        {/* Compatibility */}
        <div className="mt-3 flex items-center gap-2 text-[10px]" style={{ color: textMuted }}>
          <span>Works with:</span>
          {item.compatible_assistants.includes("litt") && (
            <span className="rounded-lg bg-cyan-400/10 px-2 py-0.5 font-bold text-cyan-300">LiTT</span>
          )}
          {item.compatible_assistants.includes("spark") && (
            <span className="rounded-lg bg-violet-400/10 px-2 py-0.5 font-bold text-violet-300">Spark</span>
          )}
        </div>

        {/* Requirements */}
        {needsSetup && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px]" style={{ color: textMuted }}>
            <span>Requires:</span>
            <span className="font-medium" style={{ color: isInstalled && !isEnabled ? "#fbbf24" : textMuted }}>
              {item.required_connections.map((c) => CONNECTION_LABELS[c] || c).join(", ")}
            </span>
          </div>
        )}

        {/* Status badge */}
        <div className="mt-2 flex items-center gap-2 text-[10px]">
          {isComingSoon ? (
            <span className="rounded-lg bg-amber-400/10 px-2 py-0.5 font-bold text-amber-300">Coming soon</span>
          ) : isInstalled ? (
            <span className="flex items-center gap-1 rounded-lg bg-emerald-400/10 px-2 py-0.5 font-bold text-emerald-300">
              <Check size={10} /> {isEnabled ? "Installed" : "Disabled"}
            </span>
          ) : item.is_beta ? (
            <span className="rounded-lg bg-rose-400/10 px-2 py-0.5 font-bold text-rose-300">Beta</span>
          ) : (
            <span className="rounded-lg bg-white/5 px-2 py-0.5 font-bold" style={{ color: textMuted }}>Available</span>
          )}
          <span className="text-[9px]" style={{ color: textMuted }}>v{item.version}</span>
        </div>

        {/* Action */}
        <div className="mt-4 border-t border-white/5 pt-3">
          {isComingSoon ? (
            <span
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold"
              style={{ background: borderColor + "0a", color: textMuted }}
            >
              Coming soon
            </span>
          ) : isInstalled ? (
            <div className="flex gap-2">
              {isEnabled ? (
                <Link
                  href={`/studio?tool=chat&capability=${item.capability_key}`}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition hover:scale-[1.02]"
                  style={{ background: categoryColor + "18", color: categoryColor }}
                >
                  <ArrowRight size={12} /> Use in Studio
                </Link>
              ) : (
                <button
                  onClick={onToggleEnabled}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold"
                  style={{ background: borderColor + "15", color: textMuted }}
                >
                  Enable
                </button>
              )}
              <button
                onClick={onToggleEnabled}
                className="rounded-xl border px-3 py-2.5 text-xs font-bold transition hover:bg-white/5"
                style={{ borderColor: borderColor + "25", color: textMuted }}
                aria-label={`Toggle ${item.name}`}
              >
                {isEnabled ? "Disable" : "Enable"}
              </button>
              <button
                onClick={onUninstall}
                className="rounded-xl border border-rose-400/25 px-3 py-2.5 text-xs font-bold text-rose-300 transition hover:bg-rose-400/8"
                aria-label={`Uninstall ${item.name}`}
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              onClick={onInstall}
              className="w-full rounded-xl py-2.5 text-xs font-black text-black transition hover:scale-[1.02] hover:shadow-lg"
              style={{ background: categoryColor, boxShadow: `0 0 0 0 ${categoryColor}40` }}
              aria-label={`Install ${item.name}`}
            >
              {ALL_ITEMS_FREE_DURING_BETA ? "Install — Free during beta" : "Install"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
});

export default function Marketplace() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#060713]">
          <div className="text-center">
            <div className="mb-4 animate-pulse text-3xl">⚡</div>
            <div className="text-sm font-bold text-white/40">Loading Marketplace...</div>
          </div>
        </div>
      }
    >
      <MarketplaceInner />
    </Suspense>
  );
}
