"use client";

import { useState, useEffect, useCallback, memo } from "react";
import Link from "next/link";
import { Check, ArrowRight, Sparkles, Loader2, Ban, Clock } from "lucide-react";
import { useAuthedFetch } from "@/lib/fetch-auth";

type AgentState =
  | "buy"
  | "processing"
  | "install"
  | "open"
  | "disabled"
  | "revoked"
  | "unavailable"
  | "loading";

interface AgentCardProps {
  item: {
    id: string;
    slug: string;
    name: string;
    description: string;
    category: string;
    icon: string;
    version: string;
    author_name: string | null;
    is_official: boolean;
    is_featured: boolean;
    is_beta: boolean;
    price_cents: number;
    compatible_assistants: string[];
    agent_id?: string | null;
    billing_model?: string | null;
    risk_level?: string | null;
  };
  accentColor: string;
  borderColor: string;
  boxBg: string;
  textMuted: string;
  headerColor: string;
  isSignedIn: boolean;
  onSignInRequired: () => void;
  onToast: (msg: string, type: "success" | "error" | "info") => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  development: "#818cf8",
  creative: "#ec4899",
  automation: "#fbbf24",
  integration: "#22d3ee",
  growth: "#34d399",
  social: "#f472b6",
  code: "#818cf8",
  media: "#a78bfa",
  data: "#60a5fa",
  general: "#fbbf24",
};

function AgentCardInner({
  item,
  accentColor,
  borderColor,
  boxBg,
  textMuted,
  headerColor,
  isSignedIn,
  onSignInRequired,
  onToast,
}: AgentCardProps) {
  const [state, setState] = useState<AgentState>("loading");
  const [busy, setBusy] = useState(false);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const authedFetch = useAuthedFetch();

  const categoryColor = CATEGORY_COLORS[item.category] || "#fbbf24";
  const agentId = item.agent_id ?? null;

  const loadState = useCallback(async () => {
    if (!agentId || !isSignedIn) {
      setState(item.price_cents === 0 ? "install" : "buy");
      return;
    }
    try {
      const res = await authedFetch(`/api/marketplace/agents/${agentId}/state`);
      if (res.ok) {
        const data = await res.json();
        setState(data.state as AgentState);
        setInstanceId(data.agentInstanceId ?? null);
      } else {
        setState(item.price_cents === 0 ? "install" : "buy");
      }
    } catch {
      setState(item.price_cents === 0 ? "install" : "buy");
    }
  }, [agentId, isSignedIn, item.price_cents, authedFetch]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const handleInstall = useCallback(async () => {
    if (!isSignedIn) { onSignInRequired(); return; }
    if (!agentId) return;
    setBusy(true);
    try {
      const res = await authedFetch(`/api/marketplace/agents/${agentId}/install`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setState("open"); onToast(`${item.name} installed`, "success"); }
      else { onToast(data.error || "Install failed", "error"); }
    } catch { onToast("Network error during install", "error"); }
    finally { setBusy(false); }
  }, [agentId, isSignedIn, item.name, onSignInRequired, onToast, authedFetch]);

  const handleUninstall = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const res = await authedFetch(`/api/marketplace/agents/${agentId}/install`, { method: "DELETE" });
      if (res.ok) { setState("install"); onToast(`${item.name} removed`, "info"); }
      else { const data = await res.json().catch(() => ({})); onToast(data.error || "Uninstall failed", "error"); }
    } catch { onToast("Network error", "error"); }
    finally { setBusy(false); }
  }, [agentId, item.name, onToast, authedFetch]);

  const handleToggle = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const res = await authedFetch(`/api/marketplace/agents/${agentId}/install`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: state === "open" ? "disable" : "enable" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setState(data.state === "open" ? "open" : "disabled");
        onToast(`${item.name} ${data.state === "open" ? "enabled" : "disabled"}`, "info");
      } else { onToast(data.error || "Failed to update", "error"); }
    } catch { onToast("Network error", "error"); }
    finally { setBusy(false); }
  }, [agentId, state, item.name, onToast, authedFetch]);

  const handleBuy = useCallback(async () => {
    if (!isSignedIn) { onSignInRequired(); return; }
    if (!agentId) return;
    setBusy(true);
    try {
      const res = await authedFetch(`/api/marketplace/agents/${agentId}/checkout`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) { window.location.href = data.url; }
      else { onToast(data.error || "Checkout failed", "error"); setBusy(false); }
    } catch { onToast("Network error", "error"); setBusy(false); }
  }, [agentId, isSignedIn, onSignInRequired, onToast, authedFetch]);

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border transition-all hover:-translate-y-1"
      style={{ borderColor: borderColor + "40", backgroundColor: boxBg }}
    >
      <div className="h-1 w-full" style={{ background: categoryColor }} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
            style={{ background: categoryColor + "15", border: `1px solid ${categoryColor}30` }}
          >
            {item.icon || <Sparkles size={20} style={{ color: categoryColor }} />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-black" style={{ color: headerColor }}>{item.name}</h3>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide" style={{ color: textMuted }}>
              <span style={{ color: categoryColor }}>Agent</span>
              <span>·</span>
              <span className="capitalize">{item.category}</span>
              {item.is_official && (<><span>·</span><span style={{ color: accentColor }}>Official</span></>)}
            </div>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 text-xs leading-relaxed" style={{ color: textMuted }}>{item.description}</p>

        {item.author_name && (
          <div className="mt-2 text-[10px]" style={{ color: textMuted }}>
            by <span className="font-bold" style={{ color: headerColor }}>{item.author_name}</span>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 text-[10px]" style={{ color: textMuted }}>
          <span>Works with:</span>
          {item.compatible_assistants.includes("litt") && (
            <span className="rounded-md bg-cyan-400/10 px-1.5 py-0.5 font-bold text-cyan-300">LiTT</span>
          )}
          {item.compatible_assistants.includes("spark") && (
            <span className="rounded-md bg-violet-400/10 px-1.5 py-0.5 font-bold text-violet-300">Spark</span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2 text-[10px]">
          <StateBadge state={state} />
          <span className="text-[9px]" style={{ color: textMuted }}>v{item.version}</span>
          <span
            className="ml-auto rounded-md px-2 py-0.5 font-bold"
            style={{
              backgroundColor: item.price_cents === 0 ? "#10b98115" : `${categoryColor}15`,
              color: item.price_cents === 0 ? "#34d399" : categoryColor,
            }}
          >
            {item.price_cents === 0 ? "Free" : `$${(item.price_cents / 100).toFixed(2)}`}
          </span>
        </div>

        <div className="mt-4 border-t pt-3" style={{ borderColor: borderColor + "20" }}>
          <ActionButton
            state={state} busy={busy} categoryColor={categoryColor}
            borderColor={borderColor} textMuted={textMuted} itemSlug={item.slug}
            onBuy={handleBuy} onInstall={handleInstall}
            onUninstall={handleUninstall} onToggle={handleToggle}
          />
        </div>
      </div>
    </article>
  );
}

function StateBadge({ state }: { state: AgentState }) {
  switch (state) {
    case "open": return <span className="flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-0.5 font-bold text-emerald-300"><Check size={10} /> Installed</span>;
    case "disabled": return <span className="flex items-center gap-1 rounded-md bg-amber-400/10 px-2 py-0.5 font-bold text-amber-300">Disabled</span>;
    case "processing": return <span className="flex items-center gap-1 rounded-md bg-blue-400/10 px-2 py-0.5 font-bold text-blue-300"><Clock size={10} /> Processing</span>;
    case "revoked": return <span className="flex items-center gap-1 rounded-md bg-rose-400/10 px-2 py-0.5 font-bold text-rose-300"><Ban size={10} /> Revoked</span>;
    case "unavailable": return <span className="rounded-md bg-white/5 px-2 py-0.5 font-bold text-white/40">Unavailable</span>;
    case "install": return <span className="rounded-md bg-cyan-400/10 px-2 py-0.5 font-bold text-cyan-300">Owned</span>;
    case "buy": return <span className="rounded-md bg-white/5 px-2 py-0.5 font-bold text-white/60">Available</span>;
    default: return <span className="rounded-md bg-white/5 px-2 py-0.5 font-bold text-white/40">...</span>;
  }
}

function ActionButton({
  state, busy, categoryColor, borderColor, textMuted, itemSlug,
  onBuy, onInstall, onUninstall, onToggle,
}: {
  state: AgentState; busy: boolean; categoryColor: string; borderColor: string;
  textMuted: string; itemSlug: string;
  onBuy: () => void; onInstall: () => void; onUninstall: () => void; onToggle: () => void;
}) {
  if (busy) {
    return (
      <div className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: borderColor + "10", color: textMuted }}>
        <Loader2 size={12} className="animate-spin" /> Working...
      </div>
    );
  }

  switch (state) {
    case "buy": return <button onClick={onBuy} className="w-full rounded-xl py-2.5 text-xs font-black text-black transition hover:scale-[1.02]" style={{ background: categoryColor }}>Buy Now</button>;
    case "processing": return <div className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: borderColor + "10", color: textMuted }}><Clock size={12} /> Processing payment...</div>;
    case "install": return <button onClick={onInstall} className="w-full rounded-xl py-2.5 text-xs font-black text-black transition hover:scale-[1.02]" style={{ background: categoryColor }}>Install</button>;
    case "open": return (
      <div className="flex gap-2">
        <Link href={instanceId ? `/studio?tool=chat&agentInstance=${instanceId}` : `/studio?tool=chat&agent=${itemSlug}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition hover:scale-[1.02]" style={{ background: categoryColor + "20", color: categoryColor }}>
          <ArrowRight size={12} /> Open in Studio
        </Link>
        <button onClick={onToggle} className="rounded-xl border px-3 py-2.5 text-xs font-bold transition hover:bg-white/5" style={{ borderColor: borderColor + "30", color: textMuted }}>Disable</button>
        <button onClick={onUninstall} className="rounded-xl border border-rose-400/30 px-3 py-2.5 text-xs font-bold text-rose-300 transition hover:bg-rose-400/10">Remove</button>
      </div>
    );
    case "disabled": return (
      <div className="flex gap-2">
        <button onClick={onToggle} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: categoryColor + "20", color: categoryColor }}>Enable</button>
        <button onClick={onUninstall} className="rounded-xl border border-rose-400/30 px-3 py-2.5 text-xs font-bold text-rose-300 transition hover:bg-rose-400/10">Remove</button>
      </div>
    );
    case "revoked": return <div className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: "#ff444415", color: "#ff4444" }}><Ban size={12} /> Access revoked</div>;
    case "unavailable": return <div className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: borderColor + "10", color: textMuted }}>Unavailable</div>;
    default: return <div className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: borderColor + "10", color: textMuted }}><Loader2 size={12} className="animate-spin" /> Loading...</div>;
  }
}

export const AgentCard = memo(AgentCardInner);
