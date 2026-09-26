"use client";

import { useState, useCallback, useEffect, useMemo, memo } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { ProductFrame } from "@/components/ProductPageFrame";
import {
  ArrowRight,
  Check,
  Code2,
  FileText,
  Palette,
  Plug,
  Search,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";

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
  // Computed server-side from the capability registry: true only when the
  // capability has a real executor. False for every item today.
  installable: boolean;
};

type Installation = {
  id: string;
  marketplace_item_id: string;
  enabled: boolean;
  installed_at: string;
};

type CtaState = "install" | "installed" | "coming_soon";

// Bounds on first-load waits so a slow/stalled network or auth provider
// can never leave the page spinning forever.
const ITEMS_FETCH_TIMEOUT_MS = 12000;
const AUTH_LOAD_TIMEOUT_MS = 8000;

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
  github: "GitHub",
  terminal: "Terminal access",
  vercel: "Vercel",
  supabase: "Supabase",
};

// --- Helpers ---

function formatPrice(cents: number): string {
  if (!cents || cents <= 0) return "Free";
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function requiresLabel(connections: string[]): string | null {
  if (!connections || connections.length === 0) return null;
  const labels = connections.map((c) => CONNECTION_LABELS[c] || c);
  return `Requires ${labels.join(" · ")}`;
}

/** The one CTA per card. Only "install" performs an install; everything
 *  else is honest about not being installable yet. */
function ctaStateFor(item: MarketplaceItem, installed: boolean): CtaState {
  if (installed) return "installed";
  if (item.installable && item.status !== "coming_soon") return "install";
  return "coming_soon";
}

// --- Page ---

export default function Marketplace() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { resolvedColors: T } = useTheme();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [installations, setInstallations] = useState<Map<string, Installation>>(new Map());
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [view, setView] = useState<"all" | "installed">("all");

  // If the auth provider never reports isLoaded (slow/blocked script,
  // network blip), stop spinning after a bound and offer a retry instead
  // of hanging indefinitely.
  useEffect(() => {
    if (isLoaded) {
      setAuthTimedOut(false);
      return;
    }
    const id = setTimeout(() => setAuthTimedOut(true), AUTH_LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [isLoaded]);

  const showToast = (msg: string, type: "success" | "error" | "info" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load items from /api/marketplace/items. Bounded by a client-side
  // timeout — a stalled network or slow backend must surface the retry
  // UI below instead of spinning forever.
  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ITEMS_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch("/api/marketplace/items", { signal: controller.signal });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setItems(data.items);
      }
    } catch {
      // Covers network failure and the abort-on-timeout case above.
      setLoadError(true);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

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
    loadItems();
    if (isSignedIn) {
      loadInstalled();
    }
  }, [loadItems, loadInstalled, isSignedIn]);

  const installItem = useCallback(async (item: MarketplaceItem) => {
    if (!isSignedIn) {
      showToast("Please sign in to install.", "error");
      return;
    }
    if (item.status === "coming_soon" || !item.installable) {
      showToast("This capability isn't installable yet.", "info");
      return;
    }
    try {
      const res = await fetch("/api/marketplace/installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });
      if (res.ok) {
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

  // --- Filtering ---

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const item of items) seen.add(item.category);
    return ["all", ...Array.from(seen).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (view === "installed" && !installations.has(item.id)) return false;
      if (category !== "all" && item.category !== category) return false;
      if (q && !`${item.name} ${item.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, category, view, installations]);

  // Featured is a discovery affordance: only when the user isn't actively
  // filtering or searching.
  const showFeatured = view === "all" && category === "all" && query.trim() === "";
  const featured = useMemo(
    () => (showFeatured ? items.filter((i) => i.is_featured) : []),
    [items, showFeatured],
  );
  const explore = useMemo(
    () => (showFeatured ? filtered.filter((i) => !i.is_featured) : filtered),
    [filtered, showFeatured],
  );

  const goToDetail = useCallback((slug: string) => {
    router.push(`/marketplace/${slug}`);
  }, [router]);

  if (!isLoaded) {
    if (authTimedOut) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] text-white/50">
          <div className="text-center">
            <p className="text-sm text-white/60">Marketplace is taking longer than expected to load.</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 hover:bg-white/5"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
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
        <ProductFrame>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl" style={{ color: T.headerColor }}>
              Marketplace
            </h1>
            {/* Beta is stated once, at page level — never repeated on cards. */}
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest"
              style={{ backgroundColor: T.accentColor + "1a", color: T.accentColor }}
            >
              Beta
            </span>
          </div>
          <p className="mt-2 max-w-xl text-sm text-white/55">
            Give LiTT new abilities. Find a capability, install it, and LiTT can do more for you.
          </p>

          {/* Search */}
          <div className="relative mt-6 max-w-md">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search capabilities…"
              aria-label="Search capabilities"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none"
            />
          </div>

          {/* Category filters + Installed view */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className="rounded-full px-3.5 py-1.5 text-xs font-bold capitalize transition"
                style={
                  category === c
                    ? { backgroundColor: T.accentColor, color: "#000" }
                    : { backgroundColor: "rgba(255,255,255,0.05)", color: T.textMuted }
                }
              >
                {c === "all" ? "All" : c.replace(/_/g, " ")}
              </button>
            ))}
            <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" aria-hidden="true" />
            <div className="flex overflow-hidden rounded-full border border-white/10" role="group" aria-label="Capability view">
              {(["all", "installed"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className="px-3.5 py-1.5 text-xs font-bold capitalize transition"
                  style={
                    view === v
                      ? { backgroundColor: "rgba(255,255,255,0.12)", color: T.headerColor }
                      : { color: T.textMuted }
                  }
                >
                  {v === "all" ? "Explore" : "Installed"}
                </button>
              ))}
            </div>
          </div>
        </ProductFrame>
      </div>

      {/* === BODY === */}
      <ProductFrame className="py-6">
        {loadError ? (
          <div className="py-12 text-center">
            <p className="text-white/40">Marketplace couldn&rsquo;t load.</p>
            <button
              onClick={() => loadItems()}
              className="mt-3 rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 hover:bg-white/5"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="py-12 text-center">
            <p className="text-white/40">Loading capabilities...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-white/40">No capabilities listed yet. Check back soon.</p>
          </div>
        ) : view === "installed" && !isSignedIn ? (
          <div className="py-12 text-center">
            <p className="text-white/40">Sign in to see the capabilities you&rsquo;ve installed.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-white/40">
              {view === "installed"
                ? "You haven't installed any capabilities yet."
                : "Nothing matches your search."}
            </p>
          </div>
        ) : (
          <>
            {featured.length > 0 && (
              <section aria-label="Featured capabilities" className="mb-8">
                <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-white/40">
                  Featured
                </h2>
                <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
                  {featured.map((item) => (
                    <FeaturedCard
                      key={item.id}
                      item={item}
                      onOpen={() => goToDetail(item.slug)}
                      headerColor={T.headerColor}
                      textMuted={T.textMuted}
                      boxBg={T.boxBg}
                      borderColor={T.borderColor}
                    />
                  ))}
                </div>
              </section>
            )}

            <section aria-label="Explore capabilities">
              <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-white/40">
                Explore
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {explore.map((item) => (
                  <CapabilityCard
                    key={item.id}
                    item={item}
                    installed={installations.has(item.id)}
                    onOpen={() => goToDetail(item.slug)}
                    onInstall={() => installItem(item)}
                    accentColor={T.accentColor}
                    borderColor={T.borderColor}
                    boxBg={T.boxBg}
                    textMuted={T.textMuted}
                    headerColor={T.headerColor}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </ProductFrame>
    </div>
  );
}

// --- Featured (compact horizontal card) ---

const FeaturedCard = memo(function FeaturedCard({
  item,
  onOpen,
  headerColor,
  textMuted,
  boxBg,
  borderColor,
}: {
  item: MarketplaceItem;
  onOpen: () => void;
  headerColor: string;
  textMuted: string;
  boxBg: string;
  borderColor: string;
}) {
  const categoryColor = CATEGORY_COLORS[item.category] || "#fbbf24";
  const TypeIcon = TYPE_ICONS[item.item_type] || Code2;
  return (
    <button
      onClick={onOpen}
      className="flex w-64 shrink-0 snap-start items-center gap-3 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5"
      style={{ borderColor: borderColor + "40", backgroundColor: boxBg }}
      aria-label={`View ${item.name}`}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
        style={{ background: categoryColor + "15", border: `1px solid ${categoryColor}30` }}
      >
        {item.icon || <TypeIcon size={20} style={{ color: categoryColor }} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black" style={{ color: headerColor }}>{item.name}</div>
        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: categoryColor }}>
          {TYPE_LABELS[item.item_type]}
        </div>
      </div>
      <ArrowRight size={16} style={{ color: textMuted }} className="shrink-0" />
    </button>
  );
});

// --- Capability card ---
// Hierarchy: icon + name / capability type / one-line benefit / critical
// dependency only / price / one CTA. Version, compatibility, requirements,
// provider, permissions and changelog live on the detail view.

const CapabilityCard = memo(function CapabilityCard({
  item,
  installed,
  onOpen,
  onInstall,
  accentColor,
  borderColor,
  boxBg,
  textMuted,
  headerColor,
}: {
  item: MarketplaceItem;
  installed: boolean;
  onOpen: () => void;
  onInstall: () => void;
  accentColor: string;
  borderColor: string;
  boxBg: string;
  textMuted: string;
  headerColor: string;
}) {
  const categoryColor = CATEGORY_COLORS[item.category] || "#fbbf24";
  const TypeIcon = TYPE_ICONS[item.item_type] || Code2;
  const cta = ctaStateFor(item, installed);
  const requires = requiresLabel(item.required_connections);

  const handleCta = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cta === "install") onInstall();
    else if (cta === "installed") onOpen();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      if ((e.target as HTMLElement).tagName !== "BUTTON") {
        e.preventDefault();
        onOpen();
      }
    }
  };

  return (
    <article
      onClick={onOpen}
      onKeyDown={handleKey}
      tabIndex={0}
      role="link"
      aria-label={`View ${item.name}`}
      className="group flex cursor-pointer flex-col rounded-2xl border p-5 transition-all hover:-translate-y-1"
      style={{ borderColor: borderColor + "40", backgroundColor: boxBg }}
    >
      {/* 1. icon + capability name */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ background: categoryColor + "15", border: `1px solid ${categoryColor}30` }}
        >
          {item.icon || <TypeIcon size={20} style={{ color: categoryColor }} />}
        </div>
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-black" style={{ color: headerColor }}>
          {item.name}
        </h3>
      </div>

      {/* 2. capability type */}
      <div className="mt-2.5 text-[10px] font-black uppercase tracking-widest" style={{ color: categoryColor }}>
        {TYPE_LABELS[item.item_type]}
      </div>

      {/* 3. one-line benefit-focused description */}
      <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-[13px] leading-relaxed" style={{ color: textMuted }}>
        {item.description}
      </p>

      {/* 4. critical dependency only */}
      {requires && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold" style={{ color: textMuted }}>
          <Plug size={12} className="shrink-0" />
          {requires}
        </div>
      )}

      {/* 5. price / status */}
      <div className="mt-2 text-[11px] font-bold" style={{ color: textMuted }}>
        {formatPrice(item.price_cents)}
      </div>

      {/* 6. one primary CTA */}
      <div className="mt-3 pt-1">
        {cta === "install" && (
          <button
            onClick={handleCta}
            className="w-full rounded-xl py-2.5 text-[13px] font-black text-black transition hover:scale-[1.02]"
            style={{ backgroundColor: accentColor }}
            aria-label={`Install ${item.name}`}
          >
            Install
          </button>
        )}
        {cta === "installed" && (
          <button
            onClick={handleCta}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[13px] font-black transition hover:bg-white/5"
            style={{ borderColor: accentColor + "50", color: accentColor }}
            aria-label={`${item.name} installed — manage`}
          >
            <Check size={14} /> Installed
          </button>
        )}
        {cta === "coming_soon" && (
          <button
            disabled
            className="w-full cursor-not-allowed rounded-xl bg-white/[0.04] py-2.5 text-[13px] font-black text-white/30"
            aria-label={`${item.name} coming soon`}
          >
            Coming Soon
          </button>
        )}
      </div>
    </article>
  );
});
