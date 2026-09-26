"use client";

import { useState, useCallback, useEffect, memo } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { ProductFrame } from "@/components/ProductPageFrame";
import {
  Code2,
  FileText,
  Palette,
  Plug,
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

// --- Page ---

export default function Marketplace() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { resolvedColors: T } = useTheme();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [installations, setInstallations] = useState<Map<string, Installation>>(new Map());
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [authTimedOut, setAuthTimedOut] = useState(false);

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

  // Kept for the day items become installable (see `installable` on the
  // item): the installations API stays live, but no install buttons render
  // while nothing is installable.
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

  // Kept for the day items become installable. Not rendered today — see
  // the card below, which only shows an Install button when
  // item.installable is true.
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

  // Kept alongside installItem for the day installs are real. Not rendered
  // today — see the note above.
  const uninstallItem = useCallback(async (item: MarketplaceItem) => {
    const inst = installations.get(item.id);
    if (!inst) return;
    try {
      const res = await fetch(`/api/marketplace/installations/${inst.id}`, { method: "DELETE" });
      if (res.ok) {
        // Server confirmed deletion — state now follows the server truth.
        setInstallations((prev) => {
          const next = new Map(prev);
          next.delete(item.id);
          return next;
        });
        showToast(`${item.name} removed`, "success");
      } else {
        // Server refused the delete: keep the item installed so the list
        // stays truthful, and let the user retry.
        const data = await res.json().catch(() => ({}));
        showToast(
          data.error || `Could not remove ${item.name}. Please try again.`,
          "error",
        );
      }
    } catch {
      // Network failure: the install may still exist server-side, so keep
      // the item in the list and surface a retryable error instead of a
      // fake success.
      showToast(
        `Network error while removing ${item.name}. It is still installed — please try again.`,
        "error",
      );
    }
  }, [installations]);

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
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl" style={{ color: T.headerColor }}>Marketplace</h1>
          <p className="mt-2 max-w-xl text-sm text-white/55">
            Capabilities we&rsquo;re building into LiTT. They&rsquo;ll be installable here the moment they&rsquo;re real.
          </p>
        </ProductFrame>
      </div>

      {/* === ROADMAP LIST === */}
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
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <MarketplaceCard
                key={item.id}
                item={item}
                onInstall={() => installItem(item)}
                accentColor={T.accentColor}
                borderColor={T.borderColor}
                boxBg={T.boxBg}
                textMuted={T.textMuted}
                headerColor={T.headerColor}
              />
            ))}
          </div>
        )}
      </ProductFrame>
    </div>
  );
}

// --- Card ---

const MarketplaceCard = memo(function MarketplaceCard({
  item,
  onInstall,
  accentColor,
  borderColor,
  boxBg,
  textMuted,
  headerColor,
}: {
  item: MarketplaceItem;
  onInstall: () => void;
  accentColor: string;
  borderColor: string;
  boxBg: string;
  textMuted: string;
  headerColor: string;
}) {
  const categoryColor = CATEGORY_COLORS[item.category] || "#fbbf24";
  const TypeIcon = TYPE_ICONS[item.item_type] || Code2;
  const isComingSoon = item.status === "coming_soon";

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

        {/* Status badge + version */}
        <div className="mt-2 flex items-center gap-2 text-[10px]">
          {isComingSoon ? (
            <span className="rounded-md bg-amber-400/10 px-2 py-0.5 font-bold text-amber-300">Coming soon</span>
          ) : (
            <span className="rounded-md bg-white/5 px-2 py-0.5 font-bold" style={{ color: textMuted }}>In development</span>
          )}
          <span className="text-[9px]" style={{ color: textMuted }}>v{item.version}</span>
        </div>

        {/* Install renders only when the capability has a real executor.
            Nothing is installable today, so this stays hidden until then. */}
        {item.installable && (
          <div className="mt-4 border-t pt-3" style={{ borderColor: borderColor + "20" }}>
            <button
              onClick={onInstall}
              className="w-full rounded-xl py-2.5 text-xs font-black text-black transition hover:scale-[1.02]"
              style={{ background: categoryColor }}
              aria-label={`Install ${item.name}`}
            >
              Install
            </button>
          </div>
        )}
      </div>
    </article>
  );
});
