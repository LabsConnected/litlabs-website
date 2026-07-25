"use client";

import { useState, useCallback, useEffect, Suspense } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useSearchParams } from "next/navigation";
import {
  Check,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Coins,
  Gamepad2,
  Code2,
  PenTool,
  BarChart3,
  Music,
  Search as SearchIcon,
  Wrench,
  Zap,
  FileText,
  Bot,
} from "lucide-react";

// --- Types ---

type MarketplaceItemType = "skill" | "specialist" | "workflow" | "tool" | "template";

type MarketplaceItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: MarketplaceItemType;
  category: string;
  compatibleWith: ("litt" | "spark")[];
  features: string[];
  is_featured: boolean;
  price_cents: number;
  created_at?: string;
};

type MarketplaceStats = {
  totalItems: number;
  freeItems: number;
  installedItems: number;
  availableItems: number;
};

// --- Beta flags ---

const BETA_MODE = true;
const BILLING_ENABLED = false;
const MARKETPLACE_PURCHASES_ENABLED = false;
const ALL_ITEMS_FREE_DURING_BETA = true;

// --- Category config ---

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "development", label: "Development" },
  { id: "creative", label: "Creative" },
  { id: "research", label: "Research" },
  { id: "automation", label: "Automation" },
  { id: "data", label: "Data" },
  { id: "media", label: "Media" },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  development: "#818cf8",
  creative: "#ec4899",
  research: "#60a5fa",
  automation: "#fbbf24",
  data: "#a78bfa",
  media: "#22d3ee",
};

const TYPE_LABELS: Record<MarketplaceItemType, string> = {
  skill: "Skill",
  specialist: "Specialist",
  workflow: "Workflow",
  tool: "Tool",
  template: "Template",
};

const TYPE_ICONS: Record<MarketplaceItemType, typeof Code2> = {
  skill: Zap,
  specialist: Bot,
  workflow: Wrench,
  tool: Code2,
  template: FileText,
};

// --- Migration map (old agent slug → new marketplace item) ---

const OLD_TO_NEW: Record<string, { name: string; type: MarketplaceItemType; category: string; description: string; compatibleWith: ("litt" | "spark")[]; features: string[] }> = {
  director: {
    name: "Mission Orchestration",
    type: "skill",
    category: "automation",
    description: "Multi-agent workflow orchestration, strategy planning, and task automation.",
    compatibleWith: ["litt"],
    features: ["Workflow orchestration", "Strategy planning", "Task automation"],
  },
  champion: {
    name: "General Productivity",
    type: "skill",
    category: "automation",
    description: "General assistance, task handling, and FAQ documentation.",
    compatibleWith: ["litt", "spark"],
    features: ["Task handling", "FAQ documentation", "General assistance"],
  },
  "code-champion": {
    name: "Software Engineering",
    type: "specialist",
    category: "development",
    description: "Code review, debugging, implementation, and test support.",
    compatibleWith: ["litt"],
    features: ["Code review", "Debugging", "Implementation", "Test support"],
  },
  "social-dominator": {
    name: "Social Growth",
    type: "specialist",
    category: "creative",
    description: "Growth, content, and social scheduling for creators.",
    compatibleWith: ["spark"],
    features: ["Social scheduling", "Growth strategy", "Content planning"],
  },
  "data-slayer": {
    name: "Analytics",
    type: "specialist",
    category: "data",
    description: "Data science, telemetry analysis, and reporting.",
    compatibleWith: ["litt"],
    features: ["Data analysis", "Telemetry", "Reporting"],
  },
  "writing-coach": {
    name: "Writing and Editing",
    type: "skill",
    category: "creative",
    description: "Content writing, editing, and proofreading.",
    compatibleWith: ["spark"],
    features: ["Content writing", "Editing", "Proofreading"],
  },
  "music-producer": {
    name: "Music Creation",
    type: "skill",
    category: "media",
    description: "Audio and music generation tools.",
    compatibleWith: ["spark"],
    features: ["Audio generation", "Music composition", "Sound design"],
  },
};

// --- Convert API agent rows to marketplace items ---

function apiAgentToItem(a: Record<string, unknown>): MarketplaceItem {
  const slug = String(a.slug || "");
  const mapped = OLD_TO_NEW[slug];

  return {
    id: String(a.id || slug),
    slug,
    name: mapped?.name || String(a.display_name || a.name || slug),
    description: mapped?.description || String(a.description || ""),
    type: mapped?.type || "skill",
    category: mapped?.category || String(a.category || a.role || "general"),
    compatibleWith: mapped?.compatibleWith || ["litt"],
    features: mapped?.features || (Array.isArray(a.features) ? (a.features as string[]) : []),
    is_featured: Boolean(a.is_featured ?? false),
    price_cents: typeof a.price_cents === "number" ? a.price_cents : 0,
    created_at: a.created_at ? String(a.created_at) : undefined,
  };
}

// --- Component ---

function MarketplaceInner() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { resolvedColors: T } = useTheme();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [litBitCoins, setLiTTCoins] = useState(500);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [activeTab, setActiveTab] = useState<"marketplace" | "beta">(() =>
    searchParams.get("tab") === "beta" ? "beta" : "marketplace",
  );

  const showToast = (msg: string, type: "success" | "error" | "info" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load items from /api/agents, migrate to marketplace items
  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (Array.isArray(data.agents)) {
        const mapped = data.agents.map(apiAgentToItem);
        setItems(mapped);
      }
    } catch {
      // Keep empty list on error
    }
  }, []);

  // Fetch wallet
  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet");
      const data = await res.json();
      if (typeof data.balance === "number") setLiTTCoins(data.balance);
    } catch {
      // silent
    }
  }, []);

  // Load installed items
  const loadInstalled = async () => {
    try {
      const res = await fetch("/api/user-agents");
      const data = await res.json();
      if (Array.isArray(data.agents)) {
        const ids = new Set<string>();
        for (const ua of data.agents) {
          const agentId = ua.agent?.id || ua.agent_id || "";
          const agentSlug = ua.agent?.slug || "";
          if (agentId) ids.add(agentId);
          if (agentSlug) ids.add(agentSlug);
        }
        setInstalledIds(ids);
      }
    } catch {
      // silent
    }
  };

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      loadItems();
      fetchWallet();
      if (isSignedIn) loadInstalled();
    });
    return () => cancelAnimationFrame(id);
  }, [loadItems, fetchWallet, isSignedIn]);

  const installItem = useCallback(async (item: MarketplaceItem) => {
    if (!isSignedIn) {
      showToast("Please sign in to install.", "error");
      return;
    }
    try {
      const res = await fetch("/api/user-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: item.id }),
      });
      if (res.ok || res.status === 200) {
        setInstalledIds((prev) => new Set([...prev, item.id, item.slug]));
        showToast(`${item.name} installed`, "success");
      } else {
        const data = await res.json();
        showToast(data.error || "Install failed.", "error");
      }
    } catch {
      showToast("Network error during install.", "error");
    }
  }, [isSignedIn]);

  const uninstallItem = useCallback(async (item: MarketplaceItem) => {
    try {
      await fetch(`/api/user-agents?agentId=${item.id}`, { method: "DELETE" });
    } catch {
      // silent
    }
    setInstalledIds((prev) => {
      const n = new Set(prev);
      n.delete(item.id);
      n.delete(item.slug);
      return n;
    });
    showToast(`${item.name} removed`, "info");
  }, []);

  const filteredItems = items
    .filter((item) => selectedCategory === "all" || item.category === selectedCategory)
    .filter(
      (item) =>
        !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase()),
    );

  const featuredItems = filteredItems.filter((item) => item.is_featured);
  const nonFeaturedItems = filteredItems.filter((item) => !item.is_featured);

  const stats: MarketplaceStats = {
    totalItems: items.length,
    freeItems: items.filter((i) => i.price_cents === 0).length,
    installedItems: installedIds.size,
    availableItems: items.length,
  };

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
            Add skills, workflows, and specialist tools to LiTT and Spark. Everything is free during beta.
          </p>

          {/* Stats row */}
          <div className="mt-6 flex flex-wrap gap-3">
            {[
              { label: "Available", value: stats.availableItems, icon: Sparkles },
              { label: "Installed", value: stats.installedItems, icon: Check },
              { label: "Free during beta", value: stats.freeItems, icon: ShieldCheck },
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
          {/* Filters + Search */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
          </div>

          {/* Featured section (unique items only, excluded from main list) */}
          {featuredItems.length > 0 && !searchQuery && selectedCategory === "all" && (
            <div className="mb-8">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[.25em] text-orange-400">Featured</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featuredItems.map((item) => (
                  <MarketplaceCard
                    key={item.id}
                    item={item}
                    isInstalled={installedIds.has(item.id) || installedIds.has(item.slug)}
                    onInstall={() => installItem(item)}
                    onUninstall={() => uninstallItem(item)}
                    accentColor={T.accentColor}
                    borderColor={T.borderColor}
                    boxBg={T.boxBg}
                    textColor={T.textColor}
                    textMuted={T.textMuted}
                    headerColor={T.headerColor}
                  />
                ))}
              </div>
            </div>
          )}

          {/* All items (excluding featured when featured is shown) */}
          <div>
            <p className="mb-3 text-[10px] font-black uppercase tracking-[.25em] text-white/40">
              {searchQuery ? "Search results" : "All tools"}
              <span className="ml-2 text-white/30">({filteredItems.length})</span>
            </p>
            {filteredItems.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-white/40">
                  {items.length === 0
                    ? "No marketplace items available yet. Items will appear here when the database is seeded."
                    : `No items found matching "${searchQuery}".`}
                </p>
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(""); setSelectedCategory("all"); }} className="mt-3 rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 hover:bg-white/5">
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
                    isInstalled={installedIds.has(item.id) || installedIds.has(item.slug)}
                    onInstall={() => installItem(item)}
                    onUninstall={() => uninstallItem(item)}
                    accentColor={T.accentColor}
                    borderColor={T.borderColor}
                    boxBg={T.boxBg}
                    textColor={T.textColor}
                    textMuted={T.textMuted}
                    headerColor={T.headerColor}
                  />
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
          <div className="rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-400/[.06] to-transparent p-6">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🧪</span>
              <div>
                <div className="text-lg font-black text-amber-300">Public Beta</div>
                <div className="text-xs text-white/55">All items are free during beta. No purchases required.</div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/60">
              Welcome to LiTTree Lab Studios Beta. Every skill, specialist, workflow, and tool is available for free
              while we test and improve the platform. Your feedback shapes what we build next.
            </p>
          </div>

          {/* Beta plan */}
          <div className="mt-6 rounded-2xl border-2 border-orange-500/30 bg-white/[.03] p-6 text-center">
            <div className="text-xs font-black uppercase tracking-wider text-orange-400">Beta Plan</div>
            <div className="mt-2 text-3xl font-black text-white">Free</div>
            <div className="mt-1 text-xs text-white/45">Everything unlocked · No credit card needed</div>
            <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">
              {[
                "Full Studio access",
                "LiTT and Spark",
                "All beta specialists",
                "Image, audio, code, and workflows",
                "Beta LiTBits for testing",
                "Feedback rewards",
              ].map((feat) => (
                <div key={feat} className="flex items-center gap-2 text-sm text-white/70">
                  <Check size={14} className="shrink-0 text-orange-400" /> {feat}
                </div>
              ))}
            </div>
          </div>

          {/* Beta LiTBits */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <div className="flex items-center gap-3">
              <Coins size={28} className="text-amber-400" />
              <div>
                <div className="font-bold text-white">{litBitCoins.toLocaleString()} Beta LiTBits</div>
                <div className="text-[11px] text-white/45">Testing credits · No cash value</div>
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  const res = await fetch("/api/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "daily" }) });
                  const data = await res.json();
                  if (res.ok) { setLiTTCoins(data.balance); showToast(`+50 LBC daily bonus claimed`, "success"); }
                  else showToast(data.error || "Failed to claim daily bonus.", "error");
                } catch { showToast("Network error.", "error"); }
              }}
              className="rounded-xl border-2 border-amber-400/40 bg-amber-400/10 px-5 py-2.5 text-sm font-bold text-amber-300 transition hover:bg-amber-400/15"
            >
              Daily Beta Refill
            </button>
          </div>

          {/* Feedback */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[.03] p-5 text-center">
            <div className="font-bold text-white">💬 Beta Feedback</div>
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

function MarketplaceCard({
  item,
  isInstalled,
  onInstall,
  onUninstall,
  accentColor,
  borderColor,
  boxBg,
  textColor,
  textMuted,
  headerColor,
}: {
  item: MarketplaceItem;
  isInstalled: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  accentColor: string;
  borderColor: string;
  boxBg: string;
  textColor: string;
  textMuted: string;
  headerColor: string;
}) {
  const categoryColor = CATEGORY_COLORS[item.category] || "#fbbf24";
  const TypeIcon = TYPE_ICONS[item.type];
  const isInstalled_ = isInstalled;

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border transition-all hover:-translate-y-1"
      style={{ borderColor: borderColor + "40", backgroundColor: boxBg }}
    >
      {/* Category accent */}
      <div className="h-1 w-full" style={{ background: categoryColor }} />

      <div className="flex flex-1 flex-col p-5">
        {/* Header: icon + name + type */}
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ background: categoryColor + "15", border: `1px solid ${categoryColor}30` }}
          >
            <TypeIcon size={20} style={{ color: categoryColor }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-black" style={{ color: headerColor }}>{item.name}</h3>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide" style={{ color: textMuted }}>
              <span style={{ color: categoryColor }}>{TYPE_LABELS[item.type]}</span>
              <span>·</span>
              <span className="capitalize">{item.category}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed" style={{ color: textMuted }}>
          {item.description}
        </p>

        {/* Features */}
        {item.features.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.features.slice(0, 3).map((f, i) => (
              <span
                key={i}
                className="rounded-md px-2 py-0.5 text-[9px] font-medium"
                style={{ background: categoryColor + "10", color: categoryColor, border: `1px solid ${categoryColor}20` }}
              >
                {f}
              </span>
            ))}
          </div>
        )}

        {/* Compatibility */}
        <div className="mt-3 flex items-center gap-2 text-[10px]" style={{ color: textMuted }}>
          <span>Works with:</span>
          {item.compatibleWith.includes("litt") && (
            <span className="rounded-md bg-cyan-400/10 px-1.5 py-0.5 font-bold text-cyan-300">LiTT</span>
          )}
          {item.compatibleWith.includes("spark") && (
            <span className="rounded-md bg-violet-400/10 px-1.5 py-0.5 font-bold text-violet-300">Spark</span>
          )}
        </div>

        {/* Action */}
        <div className="mt-4 pt-3 border-t" style={{ borderColor: borderColor + "20" }}>
          {isInstalled_ ? (
            <div className="flex gap-2">
              <span
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold"
                style={{ background: borderColor + "20", color: textMuted }}
              >
                <Check size={12} /> Installed
              </span>
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
              {ALL_ITEMS_FREE_DURING_BETA ? "Install — Free during beta" : "Install"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

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
