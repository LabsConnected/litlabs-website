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
} from "lucide-react";
import { AgentCard } from "./_components/AgentCard";

// --- Types ---

type MarketplaceItemType = "skill" | "tool" | "workflow" | "template" | "integration" | "creative_pack" | "agent";

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
  author_name: string | null;
  is_featured: boolean;
  is_official: boolean;
  is_beta: boolean;
  price_cents: number;
  required_connections: string[];
  // Agent-specific fields (null for non-agent items)
  agent_id?: string | null;
  agent_version_id?: string | null;
  billing_model?: string | null;
  risk_level?: string | null;
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
  agent: "Agent",
};

type SortOption = "featured" | "name" | "newest" | "price-low" | "price-high";

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: "featured", label: "Featured" },
  { id: "name", label: "Name A-Z" },
  { id: "newest", label: "Newest" },
  { id: "price-low", label: "Price: Low to High" },
  { id: "price-high", label: "Price: High to Low" },
];

const TYPE_ICONS: Record<MarketplaceItemType, typeof Code2> = {
  skill: Zap,
  tool: Code2,
  workflow: Wrench,
  template: FileText,
  integration: Plug,
  creative_pack: Palette,
  agent: Sparkles,
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
  const [selectedType, setSelectedType] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("featured");
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"marketplace" | "beta">("marketplace");

  // Sync tab from URL after hydration to avoid SSR/client mismatch (React #418)
  useEffect(() => {
    if (searchParams.get("tab") === "beta") setActiveTab("beta");
  }, [searchParams]);

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

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      loadItems();
      if (isSignedIn) loadInstalled();
    });
    return () => cancelAnimationFrame(id);
  }, [loadItems, loadInstalled, isSignedIn]);

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

  const filteredItems = useMemo(() => {
    const filtered = items
      .filter((item) => selectedCategory === "all" || item.category === selectedCategory)
      .filter((item) => selectedType === "all" || item.item_type === selectedType)
      .filter(
        (item) =>
          !searchQuery ||
          item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (item.author_name || "").toLowerCase().includes(searchQuery.toLowerCase()),
      );

    // Sort
    switch (sortBy) {
      case "name":
        return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
      case "newest":
        // No created_at in the type; featured-first as fallback
        return [...filtered].sort((a, b) => Number(b.is_featured) - Number(a.is_featured));
      case "price-low":
        return [...filtered].sort((a, b) => (a.price_cents || 0) - (b.price_cents || 0));
      case "price-high":
        return [...filtered].sort((a, b) => (b.price_cents || 0) - (a.price_cents || 0));
      case "featured":
      default:
        return [...filtered].sort((a, b) => Number(b.is_featured) - Number(a.is_featured));
    }
  }, [items, selectedCategory, selectedType, sortBy, searchQuery]);

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
    <div className="min-h-screen bg-[#070812] text-white" style={{ backgroundColor: T.bgColor + "d0", color: T.textColor }}>
      {/* Toast */}
      {toast && (
        <div
          className="fixed right-4 top-20 z-200 max-w-xs rounded-xl border px-4 py-3 text-xs font-bold"
          style={{
            backgroundColor: toast.type === "success" ? "#0a2e0a" : toast.type === "error" ? "#2e0a0a" : "#0a1a2e",
            borderColor: toast.type === "success" ? T.accentColor : toast.type === "error" ? "#ff4444" : T.linkColor,
            color: toast.type === "success" ? T.accentColor : toast.type === "error" ? "#ff4444" : T.linkColor,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* === HEADER === */}
      <div className="border-b border-white/10 bg-gradient-to-b from-white/[.03] to-transparent px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl" style={{ color: T.headerColor }}>Marketplace</h1>
            <span className="rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">Beta</span>
          </div>
          <p className="mt-2 max-w-xl text-sm text-white/55">
            Extend LiTT and Spark with real tools, workflows, integrations, and creative packs.
          </p>

          {/* Stats row */}
          <div className="mt-6 flex flex-wrap gap-3">
            {[
              { label: "Available", value: stats.availableItems, icon: Sparkles },
              { label: "Installed", value: stats.installedItems, icon: Check },
              { label: "Coming soon", value: stats.comingSoonItems, icon: ShieldCheck },
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[.03] px-4 py-2.5">
                  <Icon size={16} className="text-white/40" />
                  <span className="text-lg font-black" style={{ color: T.headerColor }}>{stat.value}</span>
                  <span className="text-[10px] uppercase tracking-wider text-white/40">{stat.label}</span>
                </div>
              );
            })}
          </div>

          {/* LiTT and Spark explainer */}
          <div className="mt-5 flex flex-wrap gap-4 text-xs text-white/45">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              LiTT uses installed engineering, research, automation, and project tools
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-violet-400" />
              Spark uses installed creative, media, branding, and content tools
            </span>
          </div>

          <div className="mt-5 flex gap-3">
            <Link href="/studio" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-black transition hover:bg-white/90">
              Open in Studio <ArrowRight size={14} />
            </Link>
            <button onClick={() => setActiveTab("beta")} className="inline-flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm font-bold text-amber-300 transition hover:bg-amber-400/15">
              Beta Access
            </button>
          </div>
        </div>
      </div>

      {/* === TAB BAR === */}
      <div className="border-b border-white/10 px-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl gap-2">
          <button
            onClick={() => setActiveTab("marketplace")}
            className={`border-b-2 px-4 py-3 text-sm font-bold transition ${
              activeTab === "marketplace" ? "border-orange-500 text-orange-400" : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            Browse
          </button>
          <button
            onClick={() => setActiveTab("beta")}
            className={`border-b-2 px-4 py-3 text-sm font-bold transition ${
              activeTab === "beta" ? "border-amber-400 text-amber-300" : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            Beta Access
          </button>
        </div>
      </div>

      {/* === MARKETPLACE TAB === */}
      {activeTab === "marketplace" && (
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          {/* Filters + Search + Sort */}
          <div className="mb-6 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {/* Category filters */}
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
                      selectedCategory === cat.id ? "border-orange-500/50 bg-orange-500/10 text-orange-400" : "border-white/10 text-white/45 hover:bg-white/5 hover:text-white/70"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              {/* Search + Sort */}
              <div className="flex items-center gap-2">
                <div className="relative w-full max-w-48">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" size={14} />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-orange-500/40"
                  />
                </div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="rounded-xl border border-white/10 bg-white/5 py-2 pl-3 pr-7 text-xs font-bold text-white/70 outline-none focus:border-orange-500/40"
                  aria-label="Sort by"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id} className="bg-[#0a0a0f] text-white">{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {/* Type filter chips */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">Type:</span>
              <button
                onClick={() => setSelectedType("all")}
                className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                  selectedType === "all" ? "bg-white/15 text-white" : "text-white/40 hover:bg-white/5 hover:text-white/70"
                }`}
              >
                All
              </button>
              {(Object.keys(TYPE_LABELS) as MarketplaceItemType[]).map((type) => {
                const Icon = TYPE_ICONS[type];
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                      selectedType === type ? "bg-white/15 text-white" : "text-white/40 hover:bg-white/5 hover:text-white/70"
                    }`}
                  >
                    <Icon size={10} /> {TYPE_LABELS[type]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Featured section (unique items only, excluded from main list) */}
          {featuredItems.length > 0 && !searchQuery && selectedCategory === "all" && (
            <div className="mb-8">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[.25em] text-orange-400">Featured</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featuredItems.map((item) => (
                  item.item_type === "agent" ? (
                    <AgentCard
                      key={item.id}
                      item={item}
                      accentColor={T.accentColor}
                      borderColor={T.borderColor}
                      boxBg={T.boxBg}
                      textMuted={T.textMuted}
                      headerColor={T.headerColor}
                      isSignedIn={isSignedIn}
                      onSignInRequired={() => window.location.href = "/sign-in?redirect=/marketplace"}
                      onToast={showToast}
                    />
                  ) : (
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
                  )
                ))}
              </div>
            </div>
          )}

          {/* All items (excluding featured when featured is shown) */}
          <div>
            <p className="mb-3 text-[10px] font-black uppercase tracking-[.25em] text-white/40">
              {searchQuery ? "Search results" : "All capabilities"}
              <span className="ml-2 text-white/30">({filteredItems.length})</span>
            </p>
            {filteredItems.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-white/40">
                  {loading
                    ? "Loading capabilities..."
                    : items.length === 0
                      ? "No marketplace items available yet. Run the database migration to seed items."
                      : `No items found matching "${searchQuery}".`}
                </p>
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(""); setSelectedCategory("all"); setSelectedType("all"); }} className="mt-3 rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 hover:bg-white/5">
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(searchQuery ? filteredItems : nonFeaturedItems).map((item) => (
                  item.item_type === "agent" ? (
                    <AgentCard
                      key={item.id}
                      item={item}
                      accentColor={T.accentColor}
                      borderColor={T.borderColor}
                      boxBg={T.boxBg}
                      textMuted={T.textMuted}
                      headerColor={T.headerColor}
                      isSignedIn={isSignedIn}
                      onSignInRequired={() => window.location.href = "/sign-in?redirect=/marketplace"}
                      onToast={showToast}
                    />
                  ) : (
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
                  )
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === BETA TAB === */}
      {activeTab === "beta" && (
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          {/* Beta status */}
          <div className="rounded-2xl border border-amber-400/20 bg-linear-to-br from-amber-400/6 to-transparent p-6">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🧪</span>
              <div>
                <div className="text-lg font-black text-amber-300">Founder Beta Access</div>
                <div className="text-xs text-white/55">Core tools remain free while testing. Paid beta plans unlock higher limits and features.</div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/60">
              Welcome to LiTTree Lab Studios Beta. Your feedback shapes what we build next.
              Paid plans are available at founder pricing — well below future standard rates.
            </p>
          </div>

          {/* Plan cards */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {/* Starter */}
            <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
              <div className="text-xs font-black uppercase tracking-wider text-white/50">Starter</div>
              <div className="mt-1 text-2xl font-black text-white">Free</div>
              <div className="text-[10px] text-white/40">Free forever</div>
              <div className="mt-3 space-y-1">
                {["1 active project", "500 starter AI credits", "LiTT and Spark", "Basic tools"].map((f) => (
                  <div key={f} className="flex items-center gap-1.5 text-[11px] text-white/60">
                    <Check size={11} className="shrink-0 text-emerald-400" /> {f}
                  </div>
                ))}
              </div>
              <Link href="/studio" className="mt-4 flex w-full items-center justify-center rounded-xl border border-white/10 py-2 text-xs font-bold text-white/60 transition hover:bg-white/5">
                Get Started
              </Link>
            </div>

            {/* Creator Beta */}
            <div className="rounded-2xl border-2 border-cyan-400/30 bg-cyan-400/5 p-5">
              <div className="text-xs font-black uppercase tracking-wider text-cyan-400">Creator Beta</div>
              <div className="mt-1 text-2xl font-black text-white">$7/month</div>
              <div className="text-[10px] text-white/40">Founder pricing · later $15</div>
              <div className="mt-3 space-y-1">
                {["5 active projects", "6,000 monthly AI credits", "GitHub connection", "Voice mode"].map((f) => (
                  <div key={f} className="flex items-center gap-1.5 text-[11px] text-white/60">
                    <Check size={11} className="shrink-0 text-cyan-400" /> {f}
                  </div>
                ))}
              </div>
              <Link href="/pricing" className="mt-4 flex w-full items-center justify-center rounded-xl bg-cyan-400 py-2 text-xs font-black text-black transition hover:scale-[1.02]">
                Subscribe
              </Link>
            </div>

            {/* Pro Builder Beta */}
            <div className="rounded-2xl border-2 border-violet-400/30 bg-violet-400/5 p-5">
              <div className="text-xs font-black uppercase tracking-wider text-violet-400">Pro Builder Beta</div>
              <div className="mt-1 text-2xl font-black text-white">$19/month</div>
              <div className="text-[10px] text-white/40">Founder pricing · later $39</div>
              <div className="mt-3 space-y-1">
                {["25 active projects", "20,000 monthly AI credits", "Terminal runtime", "Vercel deployment"].map((f) => (
                  <div key={f} className="flex items-center gap-1.5 text-[11px] text-white/60">
                    <Check size={11} className="shrink-0 text-violet-400" /> {f}
                  </div>
                ))}
              </div>
              <Link href="/pricing" className="mt-4 flex w-full items-center justify-center rounded-xl bg-violet-400 py-2 text-xs font-black text-black transition hover:scale-[1.02]">
                Subscribe
              </Link>
            </div>

            {/* Founding Member */}
            <div className="rounded-2xl border-2 border-amber-400/40 bg-amber-400/5 p-5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-black uppercase tracking-wider text-amber-400">Founding Member</div>
                <span className="rounded-md bg-amber-400 px-1.5 py-0.5 text-[8px] font-black uppercase text-black">Limited</span>
              </div>
              <div className="mt-1 text-2xl font-black text-white">$149</div>
              <div className="text-[10px] text-white/40">One-time · permanent Creator-level access</div>
              <div className="mt-3 space-y-1">
                {["Permanent Creator-level access", "Founder badge"].map((f) => (
                  <div key={f} className="flex items-center gap-1.5 text-[11px] text-white/60">
                    <Check size={11} className="shrink-0 text-amber-400" /> {f}
                  </div>
                ))}
              </div>
              <Link href="/pricing" className="mt-4 flex w-full items-center justify-center rounded-xl bg-amber-400 py-2 text-xs font-black text-black transition hover:scale-[1.02]">
                Currently Unavailable
              </Link>
            </div>
          </div>

          {/* Marketplace item states */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/3 p-5">
            <div className="text-xs font-black uppercase tracking-wider text-white/50">How Marketplace Items Work</div>
            <div className="mt-3 space-y-2">
              {[
                { state: "Free", desc: "Core skills and tools — no charge", color: "text-emerald-300" },
                { state: "Included", desc: "Included with Creator or Pro plan", color: "text-cyan-300" },
                { state: "Credit usage", desc: "External-cost tools charge AI credits per use", color: "text-violet-300" },
                { state: "Coming soon", desc: "Not yet available", color: "text-amber-300" },
              ].map((item) => (
                <div key={item.state} className="flex items-center gap-2 text-[11px]">
                  <span className={`font-bold ${item.color}`}>{item.state}</span>
                  <span className="text-white/40">— {item.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Feedback */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/3 p-5 text-center">
            <div className="font-bold text-white">Beta Feedback</div>
            <p className="mt-1 text-xs text-white/45">Found a bug? Have a feature request? Let us know.</p>
            <div className="mt-4 flex justify-center gap-3">
              <Link href="/studio?tool=chat" className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-black transition hover:bg-orange-400">
                <Sparkles size={14} /> Report via LiTT
              </Link>
              <a href="mailto:beta@litlabs.net" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-white/60 transition hover:bg-white/5">
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
      className="group flex flex-col overflow-hidden rounded-2xl border transition-all hover:-translate-y-1"
      style={{ borderColor: borderColor + "40", backgroundColor: boxBg, opacity: isComingSoon ? 0.65 : 1 }}
    >
      {/* Category accent */}
      <div className="h-1 w-full" style={{ background: categoryColor }} />

      <div className="flex flex-1 flex-col p-5">
        {/* Header: icon + name + type */}
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
            style={{ background: categoryColor + "15", border: `1px solid ${categoryColor}30` }}
          >
            {item.icon || <TypeIcon size={20} style={{ color: categoryColor }} />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-black" style={{ color: headerColor }}>{item.name}</h3>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide" style={{ color: textMuted }}>
              <span style={{ color: categoryColor }}>{TYPE_LABELS[item.item_type]}</span>
              <span>·</span>
              <span className="capitalize">{item.category}</span>
              {item.is_official && (
                <>
                  <span>·</span>
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

        {/* Author */}
        {item.author_name && (
          <div className="mt-2 text-[10px]" style={{ color: textMuted }}>
            by <span className="font-bold" style={{ color: headerColor }}>{item.author_name}</span>
          </div>
        )}

        {/* Compatibility */}
        <div className="mt-3 flex items-center gap-2 text-[10px]" style={{ color: textMuted }}>
          <span>Works with:</span>
          {item.compatible_assistants.includes("litt") && (
            <span className="rounded-md bg-cyan-400/10 px-1.5 py-0.5 font-bold text-cyan-300">LiTT</span>
          )}
          {item.compatible_assistants.includes("spark") && (
            <span className="rounded-md bg-violet-400/10 px-1.5 py-0.5 font-bold text-violet-300">Spark</span>
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

        {/* Status badge + price */}
        <div className="mt-2 flex items-center gap-2 text-[10px]">
          {isComingSoon ? (
            <span className="rounded-md bg-amber-400/10 px-2 py-0.5 font-bold text-amber-300">Coming soon</span>
          ) : isInstalled ? (
            <span className="flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-0.5 font-bold text-emerald-300">
              <Check size={10} /> {isEnabled ? "Installed" : "Disabled"}
            </span>
          ) : item.is_beta ? (
            <span className="rounded-md bg-rose-400/10 px-2 py-0.5 font-bold text-rose-300">Beta</span>
          ) : (
            <span className="rounded-md bg-white/5 px-2 py-0.5 font-bold" style={{ color: textMuted }}>Available</span>
          )}
          <span className="text-[9px]" style={{ color: textMuted }}>v{item.version}</span>
          {/* Price badge */}
          {!isComingSoon && (
            <span className="ml-auto rounded-md px-2 py-0.5 font-bold" style={{
              backgroundColor: (item.price_cents || 0) === 0 ? "#10b98115" : `${categoryColor}15`,
              color: (item.price_cents || 0) === 0 ? "#34d399" : categoryColor,
            }}>
              {(item.price_cents || 0) === 0
                ? (ALL_ITEMS_FREE_DURING_BETA ? "Free (Beta)" : "Free")
                : `$${(item.price_cents / 100).toFixed(2)}`}
            </span>
          )}
        </div>

        {/* Action */}
        <div className="mt-4 border-t pt-3" style={{ borderColor: borderColor + "20" }}>
          {item.item_type === "agent" ? (
            <Link
              href={`/marketplace/agents/${item.slug}`}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-black text-black transition hover:scale-[1.02]"
              style={{ background: categoryColor }}
            >
              <ArrowRight size={12} /> View Agent
            </Link>
          ) : isComingSoon ? (
            <span
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold"
              style={{ background: borderColor + "10", color: textMuted }}
            >
              Coming soon
            </span>
          ) : isInstalled ? (
            <div className="flex gap-2">
              {isEnabled ? (
                <Link
                  href={`/studio?tool=chat&capability=${item.capability_key}`}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition hover:scale-[1.02]"
                  style={{ background: categoryColor + "20", color: categoryColor }}
                >
                  <ArrowRight size={12} /> Use in Studio
                </Link>
              ) : (
                <button
                  onClick={onToggleEnabled}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold"
                  style={{ background: borderColor + "20", color: textMuted }}
                >
                  Enable
                </button>
              )}
              <button
                onClick={onToggleEnabled}
                className="rounded-xl border px-3 py-2.5 text-xs font-bold transition hover:bg-white/5"
                style={{ borderColor: borderColor + "30", color: textMuted }}
                aria-label={`Toggle ${item.name}`}
              >
                {isEnabled ? "Disable" : "Enable"}
              </button>
              <button
                onClick={onUninstall}
                className="rounded-xl border border-rose-400/30 px-3 py-2.5 text-xs font-bold text-rose-300 transition hover:bg-rose-400/10"
                aria-label={`Uninstall ${item.name}`}
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              onClick={onInstall}
              className="w-full rounded-xl py-2.5 text-xs font-black text-black transition hover:scale-[1.02]"
              style={{ background: categoryColor }}
              aria-label={`Install ${item.name}`}
            >
              {(item.price_cents || 0) === 0
                ? (ALL_ITEMS_FREE_DURING_BETA ? "Install — Free during beta" : "Install Free")
                : `Install — $${(item.price_cents / 100).toFixed(2)}`}
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
        <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f]">
          <div className="text-center">
            <div className="mb-4 animate-pulse text-3xl">⚡</div>
            <div className="text-sm font-bold text-white/50">Loading Marketplace...</div>
          </div>
        </div>
      }
    >
      <MarketplaceInner />
    </Suspense>
  );
}
