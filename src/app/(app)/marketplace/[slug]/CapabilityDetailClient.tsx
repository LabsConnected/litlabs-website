"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { ProductFrame } from "@/components/ProductPageFrame";
import {
  ArrowLeft,
  Check,
  Code2,
  FileText,
  Palette,
  Plug,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";

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
  installable: boolean;
};

type Installation = {
  id: string;
  marketplace_item_id: string;
  enabled: boolean;
  installed_at: string;
};

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

const ASSISTANT_LABELS: Record<string, string> = {
  litt: "LiTT",
  spark: "Spark",
};

function formatPrice(cents: number): string {
  if (!cents || cents <= 0) return "Free";
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export default function CapabilityDetailClient({ slug }: { slug: string }) {
  const { isSignedIn } = useClerkAuth();
  const { resolvedColors: T } = useTheme();
  const [item, setItem] = useState<MarketplaceItem | null>(null);
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/marketplace/items");
        const data = await res.json();
        const found = Array.isArray(data.items)
          ? data.items.find((i: MarketplaceItem) => i.slug === slug)
          : null;
        if (cancelled) return;
        if (!found) {
          setNotFound(true);
          return;
        }
        setItem(found);
        if (isSignedIn) {
          try {
            const r2 = await fetch("/api/marketplace/installations");
            const d2 = await r2.json();
            if (cancelled) return;
            const inst = Array.isArray(d2.installations)
              ? d2.installations.find((x: Installation) => x.marketplace_item_id === found.id)
              : null;
            setInstallation(inst || null);
          } catch {
            // silent — install state just stays unknown
          }
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, isSignedIn]);

  const handleInstall = useCallback(async () => {
    if (!item) return;
    if (!isSignedIn) {
      showToast("Please sign in to install.");
      return;
    }
    if (item.status === "coming_soon" || !item.installable) {
      showToast("This capability isn't installable yet.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/marketplace/installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setInstallation({
          id: data.installation?.id || "",
          marketplace_item_id: item.id,
          enabled: true,
          installed_at: new Date().toISOString(),
        });
        showToast(`${item.name} installed`);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Install failed.");
      }
    } catch {
      showToast("Network error during install.");
    } finally {
      setBusy(false);
    }
  }, [item, isSignedIn]);

  const handleUninstall = useCallback(async () => {
    if (!item || !installation) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/marketplace/installations/${installation.id}`, { method: "DELETE" });
      if (res.ok) {
        setInstallation(null);
        showToast(`${item.name} removed`);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || `Could not remove ${item.name}.`);
      }
    } catch {
      showToast(`Network error while removing ${item.name}.`);
    } finally {
      setBusy(false);
    }
  }, [item, installation]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-white/40">
        <p className="text-sm">Loading capability...</p>
      </div>
    );
  }

  if (notFound || !item) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-white/40">This capability doesn&rsquo;t exist.</p>
          <Link href="/marketplace" className="mt-3 inline-block text-sm font-bold" style={{ color: T.accentColor }}>
            Back to Marketplace
          </Link>
        </div>
      </div>
    );
  }

  const categoryColor = CATEGORY_COLORS[item.category] || "#fbbf24";
  const TypeIcon = TYPE_ICONS[item.item_type] || Code2;
  const installed = !!installation;
  const canInstall = item.installable && item.status !== "coming_soon" && !installed;
  const assistants = item.compatible_assistants.map((a) => ASSISTANT_LABELS[a] || a);

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.bgColor + "d0", color: T.textColor }}>
      {toast && (
        <div
          className="fixed right-4 top-20 z-200 max-w-xs rounded-xl border px-4 py-3 text-xs font-bold"
          style={{ backgroundColor: "#0a1a2e", borderColor: T.linkColor, color: T.linkColor }}
        >
          {toast}
        </div>
      )}

      <ProductFrame className="py-8">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-white/40 transition hover:text-white/70"
        >
          <ArrowLeft size={14} /> Back to Marketplace
        </Link>

        {/* Hero */}
        <div className="mt-6 flex items-start gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-3xl"
            style={{ background: categoryColor + "15", border: `1px solid ${categoryColor}30` }}
          >
            {item.icon || <TypeIcon size={28} style={{ color: categoryColor }} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl" style={{ color: T.headerColor }}>
                {item.name}
              </h1>
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest"
                style={{ backgroundColor: T.accentColor + "1a", color: T.accentColor }}
              >
                Beta
              </span>
            </div>
            <div className="mt-1 text-[11px] font-black uppercase tracking-widest" style={{ color: categoryColor }}>
              {TYPE_LABELS[item.item_type]}
            </div>
          </div>
        </div>

        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed" style={{ color: T.textMuted }}>
          {item.description}
        </p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Details */}
          <div className="space-y-6">
            <section>
              <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-white/40">Details</h2>
              <dl className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-white/40">Version</dt>
                  <dd className="font-bold" style={{ color: T.headerColor }}>v{item.version}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-white/40">Works with</dt>
                  <dd className="font-bold" style={{ color: T.headerColor }}>
                    {assistants.length > 0 ? assistants.join(" · ") : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-white/40">Requirements</dt>
                  <dd className="text-right font-bold" style={{ color: T.headerColor }}>
                    {item.required_connections.length > 0
                      ? item.required_connections.map((c) => CONNECTION_LABELS[c] || c).join(" · ")
                      : "None"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-white/40">Provider</dt>
                  <dd className="font-bold" style={{ color: T.headerColor }}>
                    {item.author_name || "LiTTree Labs"}
                    {item.is_official && (
                      <span className="ml-2 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase" style={{ backgroundColor: T.accentColor + "1a", color: T.accentColor }}>
                        Official
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-white/40">Price</dt>
                  <dd className="font-bold" style={{ color: T.headerColor }}>{formatPrice(item.price_cents)}</dd>
                </div>
              </dl>
            </section>

            <section>
              <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-white/40">Changelog</h2>
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <p className="text-sm text-white/40">No changelog published yet.</p>
              </div>
            </section>
          </div>

          {/* Action card */}
          <aside>
            <div className="rounded-2xl border p-6 lg:sticky lg:top-6" style={{ borderColor: T.borderColor + "40", backgroundColor: T.boxBg }}>
              <div className="text-center">
                <div className="text-2xl font-black" style={{ color: T.headerColor }}>
                  {formatPrice(item.price_cents)}
                </div>
                <div className="mt-1 text-xs" style={{ color: T.textMuted }}>
                  {item.status === "coming_soon" ? "Not yet available" : "Free during beta"}
                </div>
              </div>

              <div className="mt-5">
                {installed ? (
                  <div className="space-y-2">
                    <div
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border py-3 text-sm font-black"
                      style={{ borderColor: T.accentColor + "50", color: T.accentColor }}
                    >
                      <Check size={15} /> Installed
                    </div>
                    <button
                      onClick={handleUninstall}
                      disabled={busy}
                      className="w-full rounded-xl border border-rose-400/20 py-2.5 text-xs font-bold text-rose-300/70 transition hover:bg-rose-400/10 disabled:opacity-50"
                    >
                      {busy ? "Working…" : "Remove"}
                    </button>
                  </div>
                ) : canInstall ? (
                  <button
                    onClick={handleInstall}
                    disabled={busy}
                    className="w-full rounded-xl py-3 text-sm font-black text-black transition hover:scale-[1.02] disabled:opacity-50"
                    style={{ backgroundColor: T.accentColor }}
                  >
                    {busy ? "Installing…" : `Install ${item.name}`}
                  </button>
                ) : (
                  <div className="w-full rounded-xl bg-white/[0.04] py-3 text-center text-sm font-black text-white/30">
                    Coming Soon
                  </div>
                )}
              </div>

              {item.required_connections.length > 0 && (
                <div className="mt-4 flex items-start gap-1.5 border-t border-white/5 pt-4 text-[11px] font-bold" style={{ color: T.textMuted }}>
                  <Plug size={12} className="mt-0.5 shrink-0" />
                  Requires {item.required_connections.map((c) => CONNECTION_LABELS[c] || c).join(" · ")}
                </div>
              )}
            </div>
          </aside>
        </div>
      </ProductFrame>
    </div>
  );
}
