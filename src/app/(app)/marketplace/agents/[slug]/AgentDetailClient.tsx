"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Loader2, ArrowRight, Ban, Clock } from "lucide-react";
import type { PlanId } from "@/config/plans";
import { isFeatureEnabled } from "@/config/feature-flags";
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

/** Registry agent colors are pastel hues tuned for dark surfaces; as TEXT
 *  on the light theme they fall to 1.5-3.3:1 contrast. Derive a
 *  light-legible variant (same hue scaled toward black) for text uses
 *  only — solid fills keep the original color, where black bold text
 *  carries the contrast. The registry is shared with Studio and is not
 *  presentation-local, so the variant is derived here instead of editing
 *  the data (the showcase lane darkened its hues the same way). */
function legibleOnLight(hex: string): string {
  const raw = hex.replace("#", "");
  const n = parseInt(raw, 16);
  if (Number.isNaN(n) || raw.length !== 6) return hex;
  const scale = (v: number) => Math.round(v * 0.5);
  const r = scale((n >> 16) & 255);
  const g = scale((n >> 8) & 255);
  const b = scale(n & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

interface Props {
  slug: string;
  name: string;
  color: string;
  minimumPlan: PlanId;
}

export function AgentDetailClient({ slug, name, color, minimumPlan }: Props) {
  const [state, setState] = useState<AgentState>("loading");
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const authedFetch = useAuthedFetch();

  useEffect(() => {
    // Resolve agent DB ID from slug via the marketplace items API
    fetch(`/api/marketplace/agents/entitlements?slug=${slug}`)
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.agentId) setAgentId(data.agentId);
        if (data.agentInstanceId) setInstanceId(data.agentInstanceId);
        if (data.state) setState(data.state as AgentState);
        else setState(minimumPlan === "starter" ? "install" : "buy");
      })
      .catch(() => setState(minimumPlan === "starter" ? "install" : "buy"));
  }, [slug, minimumPlan]);

  const handleInstall = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/marketplace/agents/${agentId}/install`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setState("open"); }
      else { console.error(data.error); }
    } catch { /* network */ }
    finally { setBusy(false); }
  }, [agentId]);

  const handleBuy = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/marketplace/agents/${agentId}/checkout`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) { window.location.href = data.url; }
      else { setBusy(false); }
    } catch { setBusy(false); }
  }, [agentId]);

  const handleToggle = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/marketplace/agents/${agentId}/install`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: state === "open" ? "disable" : "enable" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setState(data.state === "open" ? "open" : "disabled"); }
    } catch { /* network */ }
    finally { setBusy(false); }
  }, [agentId, state]);

  const handleUninstall = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      // P1-4: auth the request like the other handlers, and only flip the
      // UI state to "install" when the server confirms the uninstall.
      const res = await authedFetch(`/api/marketplace/agents/${agentId}/install`, { method: "DELETE" });
      if (res.ok) {
        setState("install");
      } else {
        const data = await res.json().catch(() => ({}));
        console.error("Uninstall failed:", data.error ?? res.status);
      }
    } catch { /* network */ }
    finally { setBusy(false); }
  }, [agentId, authedFetch]);

  if (busy) {
    return (
      <div className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-[#0e1510]/50">
        <Loader2 size={14} className="animate-spin" /> Working...
      </div>
    );
  }

  return (
    <div className="mt-5">
      {state === "buy" && (
        isFeatureEnabled("individualAgentPurchases") ? (
          <button
            onClick={handleBuy}
            className="w-full rounded-xl py-3 text-sm font-black text-black transition hover:scale-[1.02]"
            style={{ background: color }}
          >
            Unlock {name}
          </button>
        ) : (
          <div className="w-full rounded-xl border border-[#cfdec4] py-3 text-center text-sm font-bold text-[#0e1510]/60">
            Included with Creator &amp; Pro plans
          </div>
        )
      )}
      {state === "processing" && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-[#0e1510]/50">
          <Clock size={14} /> Processing payment...
        </div>
      )}
      {state === "install" && (
        isFeatureEnabled("marketplaceAgentInstall") ? (
          <button
            onClick={handleInstall}
            className="w-full rounded-xl py-3 text-sm font-black text-black transition hover:scale-[1.02]"
            style={{ background: color }}
          >
            Add {name}
          </button>
        ) : (
          <div className="w-full rounded-xl border border-[#cfdec4] py-3 text-center text-sm font-bold text-[#0e1510]/60">
            Included with Creator &amp; Pro plans
          </div>
        )
      )}
      {state === "open" && (
        <div className="space-y-2">
          <Link
            href={instanceId ? `/studio?agentInstance=${instanceId}&agent=${slug}` : `/studio?agent=${slug}`}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition hover:scale-[1.02]"
            style={{ background: color + "20", color: legibleOnLight(color) }}
          >
            <ArrowRight size={14} /> Open in Studio
          </Link>
          <div className="flex gap-2">
            <button
              onClick={handleToggle}
              className="flex-1 rounded-xl border border-[#cfdec4] py-2.5 text-xs font-bold text-[#0e1510]/60 transition hover:bg-[#0e1510]/[0.04]"
            >
              Pause
            </button>
            <button
              onClick={handleUninstall}
              className="flex-1 rounded-xl border border-rose-600/25 py-2.5 text-xs font-bold text-rose-700/80 transition hover:bg-rose-600/10"
            >
              Remove
            </button>
          </div>
        </div>
      )}
      {state === "disabled" && (
        <div className="space-y-2">
          <button
            onClick={handleToggle}
            className="w-full rounded-xl py-3 text-sm font-bold transition hover:scale-[1.02]"
            style={{ background: color + "20", color: legibleOnLight(color) }}
          >
            Enable {name}
          </button>
          <button
            onClick={handleUninstall}
            className="w-full rounded-xl border border-rose-600/25 py-2.5 text-xs font-bold text-rose-700/80 transition hover:bg-rose-600/10"
          >
            Remove
          </button>
        </div>
      )}
      {state === "revoked" && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-rose-600">
          <Ban size={14} /> Access revoked
        </div>
      )}
      {state === "unavailable" && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-[#0e1510]/50">
          Unavailable
        </div>
      )}
      {state === "loading" && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-[#0e1510]/50">
          <Loader2 size={14} className="animate-spin" /> Loading...
        </div>
      )}
    </div>
  );
}
