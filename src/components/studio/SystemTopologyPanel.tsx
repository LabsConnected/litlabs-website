"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  Boxes,
  ExternalLink,
  FolderGit2,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Terminal,
  Waypoints,
} from "lucide-react";

type CheckState = "checking" | "ready" | "warning" | "offline";
type Health = {
  docker?: boolean;
  supabase?: boolean;
  workspace?: { repoCloned?: boolean; packageJson?: boolean };
  preview?: { running?: boolean; url?: string };
};

const terminalUrl = () => {
  const explicit = process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const ws = process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
  return (
    ws
      ?.replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:")
      .replace(/\/$/, "") || ""
  );
};

export default function SystemTopologyPanel({
  compact = false,
  terminalHttpUrl,
}: {
  compact?: boolean;
  terminalHttpUrl?: string;
}) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const endpoint = useMemo(
    () => (terminalHttpUrl || terminalUrl()).replace(/\/$/, ""),
    [terminalHttpUrl],
  );
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setChecking(true);
    setMessage("");
    if (!endpoint) {
      setHealth(null);
      setChecking(false);
      return;
    }
    try {
      const response = await fetch(`${endpoint}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error("Gateway unavailable");
      setHealth(await response.json());
    } catch {
      setHealth(null);
    } finally {
      setChecking(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const initialize = async () => {
    if (!endpoint) {
      setMessage("Configure NEXT_PUBLIC_TERMINAL_HTTP_URL first.");
      return;
    }
    setInitializing(true);
    setMessage("Initializing workspace…");
    try {
      const response = await fetch(`${endpoint}/api/terminal/init-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: "https://github.com/LabsConnected/litlabs-website.git",
          branch: "main",
          install: true,
        }),
      });
      if (!response.ok) throw new Error("Initialization failed");
      setMessage("Workspace ready.");
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Initialization failed",
      );
    } finally {
      setInitializing(false);
    }
  };

  const gateway: CheckState = checking
    ? "checking"
    : health
      ? "ready"
      : endpoint
        ? "offline"
        : "warning";
  const items: Array<{
    label: string;
    value: string;
    state: CheckState;
    icon: typeof Terminal;
  }> = [
    { label: "Frontend", value: "Connected", state: "ready", icon: Waypoints },
    {
      label: "Auth",
      value: !isLoaded ? "Checking" : isSignedIn ? "Verified" : "Missing",
      state: !isLoaded ? "checking" : isSignedIn ? "ready" : "warning",
      icon: ShieldCheck,
    },
    {
      label: "Terminal",
      value:
        gateway === "ready"
          ? "Online"
          : gateway === "checking"
            ? "Checking"
            : endpoint
              ? "Offline"
              : "Not configured",
      state: gateway,
      icon: Terminal,
    },
    {
      label: "Docker",
      value: checking ? "Checking" : health?.docker ? "Ready" : "Not ready",
      state: checking ? "checking" : health?.docker ? "ready" : "warning",
      icon: Boxes,
    },
    {
      label: "Workspace",
      value: checking
        ? "Checking"
        : health?.workspace?.repoCloned
          ? "Cloned"
          : "Empty",
      state: checking
        ? "checking"
        : health?.workspace?.repoCloned
          ? "ready"
          : "warning",
      icon: FolderGit2,
    },
    {
      label: "Preview",
      value: health?.preview?.running ? "Running" : "Stopped",
      state: health?.preview?.running ? "ready" : "warning",
      icon: Rocket,
    },
    {
      label: "Logs",
      value: checking ? "Checking" : health?.supabase ? "Syncing" : "Unknown",
      state: checking ? "checking" : health?.supabase ? "ready" : "warning",
      icon: ExternalLink,
    },
  ];
  const color: Record<CheckState, string> = {
    ready: "#22c55e",
    warning: "#f59e0b",
    offline: "#ef4444",
    checking: "#38bdf8",
  };
  const [expanded, setExpanded] = useState(false);
  const showExpanded = expanded || !compact;
  const visibleItems = compact && !expanded ? items.slice(0, 4) : items;

  return (
    <section
      className="rounded-2xl border border-white/10 bg-black/35 p-3 text-white shadow-xl backdrop-blur-xl"
      aria-label="System topology"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.24em] text-cyan-300">
            Control Tower
          </p>
          <h2 className="text-sm font-black">System topology</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {compact && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="rounded-lg border border-white/10 px-2 py-1 text-[9px] font-bold"
              aria-expanded={expanded}
              aria-label={
                expanded ? "Hide system details" : "Show all system details"
              }
            >
              {expanded ? "Less" : "More"}
            </button>
          )}
          <button
            onClick={() => void refresh()}
            disabled={checking}
            className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] font-bold disabled:opacity-50"
            aria-label="Refresh system status"
            title="Refresh system status"
          >
            <RefreshCw
              size={11}
              aria-hidden="true"
              className={checking ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>
      <div
        className={
          compact
            ? "grid grid-cols-2 gap-1.5 sm:grid-cols-4"
            : "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
        }
      >
        {visibleItems.map(({ label, value, state, icon: Icon }) => (
          <div
            key={label}
            className="min-w-0 rounded-xl border border-white/10 bg-white/[0.035] p-2"
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: color[state],
                  boxShadow: `0 0 7px ${color[state]}`,
                }}
              />
              <Icon size={11} aria-hidden="true" className="text-white/45" />
              <span className="truncate text-[9px] font-bold uppercase tracking-wider text-white/45">
                {label}
              </span>
            </div>
            <p className="truncate text-[10px] font-bold">{value}</p>
          </div>
        ))}
      </div>
      {showExpanded && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void initialize()}
            disabled={initializing || checking}
            className="rounded-lg bg-cyan-400 px-2.5 py-1.5 text-[10px] font-black text-slate-950 disabled:opacity-50"
          >
            {initializing ? "Initializing…" : "Initialize project"}
          </button>
          <button
            onClick={() => router.push("/studio")}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold"
          >
            Open terminal
          </button>
          <button
            onClick={() => router.push("/studio")}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold"
          >
            Open builder
          </button>
          {message && (
            <span className="text-[10px] text-white/60">{message}</span>
          )}
        </div>
      )}
    </section>
  );
}
