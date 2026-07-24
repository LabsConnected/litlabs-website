"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useCapabilities } from "@/app/studio/hooks/useCapabilities";
import { Boxes, ExternalLink, FolderGit2, RefreshCw, Rocket, ShieldCheck, Terminal, Waypoints } from "lucide-react";
import type { CapabilityStatus } from "@/lib/capabilities/types";

type CheckState = "checking" | "ready" | "warning" | "offline";

const terminalUrl = () => {
  const explicit = process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const ws = process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
  return ws?.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "") || "";
};

export default function SystemTopologyPanel({ compact = false, terminalHttpUrl }: { compact?: boolean; terminalHttpUrl?: string }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { summary, refresh: refreshCaps } = useCapabilities();
  const endpoint = useMemo(() => (terminalHttpUrl || terminalUrl()).replace(/\/$/, ""), [terminalHttpUrl]);
  const [terminalHealth, setTerminalHealth] = useState<{ ok?: boolean; docker?: boolean } | null>(null);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setChecking(true);
    setMessage("");
    if (!endpoint) { setTerminalHealth(null); setChecking(false); return; }
    try {
      const response = await fetch(`${endpoint}/health`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error("Gateway unavailable");
      setTerminalHealth(await response.json());
    } catch { setTerminalHealth(null); }
    finally { setChecking(false); }
    void refreshCaps();
  }, [endpoint, refreshCaps]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const capMap = useMemo(() => {
    const m = new Map<string, { status: CapabilityStatus; name: string; error?: string }>();
    for (const cap of summary.capabilities) {
      m.set(cap.id, { status: cap.status, name: cap.name, error: cap.error });
    }
    return m;
  }, [summary]);

  const gateway: CheckState = checking ? "checking" : terminalHealth?.ok ? "ready" : endpoint ? "offline" : "warning";

  const capToCheckState = (status: CapabilityStatus): CheckState => {
    if (status === "ready" || status === "running") return "ready";
    if (status === "connecting" || status === "validating") return "checking";
    if (status === "unavailable" || status === "error") return "offline";
    return "warning";
  };

  const items: Array<{ label: string; value: string; state: CheckState; icon: typeof Terminal; action?: () => void; actionLabel?: string }> = [
    { label: "Frontend", value: "Connected", state: "ready", icon: Waypoints },
    { label: "Auth", value: !isLoaded ? "Checking" : isSignedIn ? "Verified" : "Missing", state: !isLoaded ? "checking" : isSignedIn ? "ready" : "warning", icon: ShieldCheck, action: !isSignedIn ? () => router.push("/sign-in") : undefined, actionLabel: !isSignedIn ? "Sign in" : undefined },
    { label: "Terminal", value: gateway === "ready" ? "Online" : gateway === "checking" ? "Checking" : endpoint ? "Offline" : "Not configured", state: gateway, icon: Terminal, action: () => router.push("/studio?tool=terminal"), actionLabel: "Open terminal" },
    { label: "Docker", value: checking ? "Checking" : terminalHealth?.docker ? "Ready" : "Not configured", state: checking ? "checking" : terminalHealth?.docker ? "ready" : "warning", icon: Boxes, action: () => router.push("/settings#workspace"), actionLabel: "Configure runtime" },
    { label: "Workspace", value: capMap.get("runtime.sandbox")?.status === "ready" ? "Loaded" : "No project loaded", state: capToCheckState(capMap.get("runtime.sandbox")?.status ?? "not_configured"), icon: FolderGit2, action: () => router.push("/studio?tool=plugins"), actionLabel: "Start a project" },
    { label: "Preview", value: capMap.get("runtime.sandbox")?.status === "running" ? "Running" : "No server running", state: capToCheckState(capMap.get("runtime.sandbox")?.status ?? "not_configured"), icon: Rocket, action: () => router.push("/studio?tool=terminal"), actionLabel: "Start preview" },
    { label: "Logs", value: capMap.get("terminal")?.status === "running" ? "Streaming" : "Not started", state: capToCheckState(capMap.get("terminal")?.status ?? "not_configured"), icon: ExternalLink, action: () => router.push("/studio?tool=terminal"), actionLabel: "Open logs" },
  ];
  const color: Record<CheckState, string> = { ready: "#22c55e", warning: "#f59e0b", offline: "#ef4444", checking: "#38bdf8" };

  return (
    <section className="rounded-2xl border border-white/10 bg-black/35 p-3 text-white shadow-xl backdrop-blur-xl" aria-label="System topology">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-[9px] font-black uppercase tracking-[0.24em] text-cyan-300">Control Tower</p><h2 className="text-sm font-black">System topology</h2></div>
        <button onClick={() => void refresh()} disabled={checking} className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] font-bold disabled:opacity-50"><RefreshCw size={11} className={checking ? "animate-spin" : ""} /> Refresh</button>
      </div>
      <div className={compact ? "grid grid-cols-2 gap-1.5" : "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"}>
        {items.map(({ label, value, state, icon: Icon, action, actionLabel }) => (
          <div key={label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.035] p-2">
            <div className="mb-1 flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color[state], boxShadow: `0 0 7px ${color[state]}` }} /><Icon size={11} className="text-white/45" /><span className="truncate text-[9px] font-bold uppercase tracking-wider text-white/45">{label}</span></div>
            <p className="truncate text-[10px] font-bold">{value}</p>
            {action && actionLabel && state !== "ready" && (
              <button onClick={action} className="mt-1 text-[8px] font-bold text-cyan-300 hover:text-cyan-200">{actionLabel} →</button>
            )}
          </div>
        ))}
      </div>

      {/* Readiness groups */}
      {summary.readiness.length > 0 && !compact && (
        <div className="mt-3 space-y-1.5">
          {summary.readiness.map((rg) => (
            <div key={rg.group.id} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/2 px-2 py-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: rg.isReady ? "#22c55e" : "#f59e0b" }} />
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">{rg.group.name}</span>
              <span className="text-[9px] text-white/40">{rg.satisfied.length}/{rg.group.requirements.length}</span>
              {rg.missing.length > 0 && (
                <span className="truncate text-[9px] text-white/30">Missing: {rg.missing.map((m) => m.label).join(", ")}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => router.push("/studio?tool=plugins")} className="rounded-lg bg-cyan-400 px-2.5 py-1.5 text-[10px] font-black text-slate-950">Start a project</button>
        <button onClick={() => router.push("/studio?tool=terminal")} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold">Open terminal</button>
        <button onClick={() => router.push("/studio?tool=build")} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold">Open builder</button>
        {message && <span className="text-[10px] text-white/60">{message}</span>}
      </div>
    </section>
  );
}
