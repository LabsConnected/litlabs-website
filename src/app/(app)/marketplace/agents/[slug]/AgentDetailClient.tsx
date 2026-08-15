"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Loader2, ArrowRight, Ban, Clock } from "lucide-react";
import type { PlanId } from "@/config/plans";
import { isFeatureEnabled } from "@/config/feature-flags";

type AgentState =
  | "buy"
  | "processing"
  | "install"
  | "open"
  | "disabled"
  | "revoked"
  | "unavailable"
  | "loading";

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
      await fetch(`/api/marketplace/agents/${agentId}/install`, { method: "DELETE" });
      setState("install");
    } catch { /* network */ }
    finally { setBusy(false); }
  }, [agentId]);

  if (busy) {
    return (
      <div className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white/40">
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
          <div className="w-full rounded-xl border border-white/10 py-3 text-center text-sm font-bold text-white/50">
            Included with Creator &amp; Pro plans
          </div>
        )
      )}
      {state === "processing" && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white/40">
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
          <div className="w-full rounded-xl border border-white/10 py-3 text-center text-sm font-bold text-white/50">
            Included with Creator &amp; Pro plans
          </div>
        )
      )}
      {state === "open" && (
        <div className="space-y-2">
          <Link
            href={instanceId ? `/studio?agentInstance=${instanceId}&agent=${slug}` : `/studio?agent=${slug}`}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition hover:scale-[1.02]"
            style={{ background: color + "20", color }}
          >
            <ArrowRight size={14} /> Open in Studio
          </Link>
          <div className="flex gap-2">
            <button
              onClick={handleToggle}
              className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-bold text-white/50 transition hover:bg-white/5"
            >
              Pause
            </button>
            <button
              onClick={handleUninstall}
              className="flex-1 rounded-xl border border-rose-400/20 py-2.5 text-xs font-bold text-rose-300/70 transition hover:bg-rose-400/10"
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
            style={{ background: color + "20", color }}
          >
            Enable {name}
          </button>
          <button
            onClick={handleUninstall}
            className="w-full rounded-xl border border-rose-400/20 py-2.5 text-xs font-bold text-rose-300/70 transition hover:bg-rose-400/10"
          >
            Remove
          </button>
        </div>
      )}
      {state === "revoked" && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-rose-400">
          <Ban size={14} /> Access revoked
        </div>
      )}
      {state === "unavailable" && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white/40">
          Unavailable
        </div>
      )}
      {state === "loading" && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white/40">
          <Loader2 size={14} className="animate-spin" /> Loading...
        </div>
      )}
    </div>
  );
}
