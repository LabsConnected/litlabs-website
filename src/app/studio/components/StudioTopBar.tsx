"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import {
  Bell,
  Home,
  Play,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Eye,
  X,
  ChevronDown,
  Check,
  Cpu,
  Lock,
} from "lucide-react";
import {
  useStudioModelStore,
  MODELS,
  type SelectedModel,
  type ProviderHealth,
} from "../stores/useStudioModelStore";

const HEALTH_DOT: Record<ProviderHealth, { color: string; label: string }> = {
  available: { color: "#22c55e", label: "Available" },
  degraded: { color: "#f59e0b", label: "Degraded" },
  unavailable: { color: "#ef4444", label: "Unavailable" },
  locked: { color: "#6b7280", label: "Not configured" },
};

/**
 * StudioTopBar — single clean Studio top bar.
 *
 *  [LiTT Studio] [Project] [Branch] [Workspace: Ready] [Model ▾]  ...  [Run] [Preview] [Deploy] [health] [notif] [settings] [user]
 */
export default function StudioTopBar({
  search,
  onSearchChange,
  selectedModel: _selectedModel,
  onModelChange: _onModelChange,
  onMenuToggle: _onMenuToggle,
  T,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  selectedModel: string;
  onModelChange: (m: string) => void;
  onMenuToggle?: () => void;
  onInspectorToggle?: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const { balance, isLoading: walletLoading } = useWallet();
  const { capabilities } = useConnectionSummary();
  const [notifOpen, setNotifOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);

  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const selectModel = useStudioModelStore((s) => s.selectModel);
  const providerHealth = useStudioModelStore((s) => s.providerHealth);
  const fallbackNotice = useStudioModelStore((s) => s.fallbackNotice);

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3"
      style={{
        backgroundColor: "rgba(7,8,13,0.96)",
        borderColor: "rgba(255,255,255,0.08)",
        backdropFilter: "blur(14px) saturate(180%)",
      }}
    >
      {/* Logo + Studio label */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
          }}
        >
          <Sparkles size={10} className="text-white" />
        </div>
        <span
          className="hidden sm:inline text-[11px] font-black uppercase tracking-[0.15em]"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          LiTT Studio
        </span>
      </div>

      {/* Dashboard exit button */}
      <a
        href="/dashboard"
        className="hidden md:flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-all hover:bg-white/5 shrink-0"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.55)",
        }}
        title="Back to Dashboard"
        aria-label="Back to Dashboard"
      >
        <Home size={11} className="pointer-events-none" />
        <span className="pointer-events-none">Dashboard</span>
      </a>

      {/* Connection status — truthful */}
      <div className="hidden md:flex items-center gap-1.5 shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-bold" title={capabilities.connectionSummary} style={{ backgroundColor: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)" }}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden style={{ backgroundColor: capabilities.connectedProviders.length ? "#22c55e" : "#6b7280", boxShadow: capabilities.connectedProviders.length ? `0 0 4px ${T.success}` : "none" }} />
        {capabilities.connectedProviders.length ? `Connected · ${capabilities.connectedProviders.length}` : "No services connected"}
      </div>

      {/* Model selector dropdown */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setModelOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all hover:bg-white/5"
          style={{
            backgroundColor: "rgba(255,255,255,0.04)",
            borderColor: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.8)",
          }}
          aria-label="Select model"
          title="Select AI model"
        >
          <Cpu size={11} className="pointer-events-none" style={{ color: T.accentColor }} />
          <span
            className="pointer-events-none h-1.5 w-1.5 rounded-full"
            aria-hidden
            style={{
              backgroundColor: HEALTH_DOT[providerHealth[selectedModel.provider] ?? "available"].color,
              boxShadow: `0 0 4px ${HEALTH_DOT[providerHealth[selectedModel.provider] ?? "available"].color}`,
            }}
          />
          <span className="pointer-events-none hidden sm:inline">{selectedModel.label}</span>
          <ChevronDown size={10} className="pointer-events-none hidden sm:inline" style={{ color: "rgba(255,255,255,0.4)" }} />
        </button>
        {modelOpen && (
          <>
            <button className="fixed inset-0 z-10000" onClick={() => setModelOpen(false)} aria-label="Close model selector" />
            <div
              className="absolute left-0 top-full mt-1 z-10001 w-56 max-h-80 overflow-auto rounded-xl border py-1.5 shadow-2xl"
              style={{
                backgroundColor: "rgba(10,12,18,0.98)",
                borderColor: "rgba(255,255,255,0.08)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
              }}
            >
              {[
                { label: "Auto Best", filter: (m: SelectedModel) => m.id === "auto" },
                { label: "Free AI", filter: (m: SelectedModel) => MODELS.find((sm) => sm.id === m.id)?.category === "free" },
                { label: "Fast", filter: (m: SelectedModel) => MODELS.find((sm) => sm.id === m.id)?.category === "fast" },
                { label: "Coding", filter: (m: SelectedModel) => MODELS.find((sm) => sm.id === m.id)?.category === "code" },
                { label: "Creative", filter: (m: SelectedModel) => MODELS.find((sm) => sm.id === m.id)?.category === "creative" },
                { label: "Vision", filter: (m: SelectedModel) => MODELS.find((sm) => sm.id === m.id)?.category === "vision" },
                { label: "BYOK", filter: (m: SelectedModel) => MODELS.find((sm) => sm.id === m.id)?.category === "byok" },
              ].map(({ label, filter }, idx) => {
                const models = MODELS.filter(filter);
                if (models.length === 0) return null;
                return (
                  <div key={label}>
                    {idx > 0 && <div className="my-1 border-t border-white/5" />}
                    <div className="px-3 py-1 text-[8px] font-black uppercase tracking-[0.15em] text-white/60">
                      {label}
                    </div>
                    {models.map((m) => (
                      <ModelRow
                        key={m.id}
                        model={m}
                        selected={selectedModel.id === m.id}
                        health={providerHealth[m.provider] ?? "available"}
                        onSelect={() => { selectModel(m); setModelOpen(false); }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Fallback notice */}
      {fallbackNotice && (
        <span className="hidden md:inline text-[9px] font-bold text-amber-300" title={fallbackNotice}>
          ⚠ Fallback
        </span>
      )}

      {/* Search */}
      <div
        className="relative flex-1 max-w-xs min-w-0 hidden sm:block"
        style={{ color: "rgba(255,255,255,0.4)" }}
      >
        <Search
          size={12}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
        />
        <input
          id="studio-search-input"
          name="studio-search-input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="w-full rounded-lg border pl-7 pr-7 py-1.5 text-[11px] outline-none transition-all focus:ring-1"
          style={{
            backgroundColor: "rgba(255,255,255,0.03)",
            borderColor: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.85)",
            // @ts-expect-error custom css var
            "--tw-ring-color": T.accentColor + "60",
          }}
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded transition-colors hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.4)" }}
            aria-label="Clear search"
            title="Clear search"
          >
            <X size={11} className="pointer-events-none" />
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* Action buttons */}
      <div className="hidden md:flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          disabled={!capabilities.connectedProviders.length}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: "rgba(255,255,255,0.08)",
            color: capabilities.connectedProviders.length ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.35)",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
          title="Run project"
          aria-label="Run project"
        >
          <Play size={11} className="pointer-events-none" style={{ color: capabilities.connectedProviders.length ? T.success : "#6b7280" }} />
          <span className="pointer-events-none">Run</span>
        </button>
        <button
          type="button"
          disabled={!capabilities.connectedProviders.length}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: "rgba(255,255,255,0.08)",
            color: capabilities.connectedProviders.length ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.35)",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
          title="Preview"
          aria-label="Preview"
        >
          <Eye size={11} className="pointer-events-none" style={{ color: capabilities.connectedProviders.length ? "rgba(255,255,255,0.7)" : "#6b7280" }} />
          <span className="pointer-events-none">Preview</span>
        </button>
        <button
          type="button"
          disabled={!capabilities.connectedProviders.length}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            backgroundColor: capabilities.connectedProviders.length ? T.accentColor : "#374151",
            color: capabilities.connectedProviders.length ? "#000" : "rgba(255,255,255,0.45)",
            boxShadow: capabilities.connectedProviders.length ? `0 4px 16px ${T.accentColor}30` : "none",
          }}
          title="Deploy"
          aria-label="Deploy"
        >
          <Rocket size={11} className="pointer-events-none" />
          <span className="pointer-events-none">Deploy</span>
        </button>
      </div>

      {/* Health removed — no fake percentage */}

      {/* Wallet */}
      <div
        className="hidden sm:flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold"
        title="LiTTBits balance"
        style={{
          backgroundColor: "rgba(255,255,255,0.03)",
          borderColor: "rgba(255,255,255,0.06)",
          color: "rgba(255,255,255,0.8)",
        }}
      >
        <span style={{ color: T.accentColor }}>
          {walletLoading ? "—" : balance.toLocaleString()}
        </span>
        <span className="opacity-50 text-[9px] uppercase tracking-wider">LBC</span>
      </div>

      {/* Notifications */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setNotifOpen((v) => !v)}
          className="grid h-9 w-9 place-items-center rounded-lg transition-all hover:bg-white/10"
          style={{ color: "rgba(255,255,255,0.5)" }}
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell size={14} className="pointer-events-none" />
          <span
            className="pointer-events-none absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
            aria-hidden
            style={{ backgroundColor: "#ff3a3a", boxShadow: "0 0 4px #ff3a3a" }}
          />
        </button>
        {notifOpen &&
          createPortal(
            <NotifPanel onClose={() => setNotifOpen(false)} />,
            document.body,
          )}
      </div>

      {/* Settings — mobile (visible, links to /settings with return context) */}
      <Link
        href={`/settings?returnTo=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/studio")}`}
        className="grid h-9 w-9 place-items-center rounded-lg transition-all hover:bg-white/10 md:hidden"
        style={{ color: "rgba(255,255,255,0.5)" }}
        aria-label="Open settings"
        title="Settings"
      >
        <Settings size={16} className="pointer-events-none" />
      </Link>

      {/* Settings — desktop */}
      <Link
        href={`/settings?returnTo=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/studio")}`}
        className="hidden md:grid h-9 w-9 place-items-center rounded-lg transition-all hover:bg-white/10"
        style={{ color: "rgba(255,255,255,0.5)" }}
        aria-label="Open settings"
        title="Settings"
      >
        <Settings size={14} className="pointer-events-none" />
      </Link>

      {/* User avatar — Clerk UserButton with styled profile card for dark theme */}
      <div className="shrink-0">
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: "w-7 h-7 rounded-full",
              userButtonPopoverCard: "bg-[#0a0b12] border border-white/10 shadow-2xl",
              userButtonPopoverActionButton: "text-white/85 hover:bg-white/8",
              userButtonPopoverActionButtonText: "text-white/85",
              userButtonPopoverFooter: "text-white/40",
              userButtonPopoverHeaderTitle: "text-white/90",
              userButtonPopoverHeaderSubtitle: "text-white/55",
              userButtonPopoverProfile: "text-white/85",
              userButtonPopoverProfilePrimaryText: "text-white/90",
              userButtonPopoverProfileSecondaryText: "text-white/55",
            },
          }}
        />
      </div>
    </header>
  );
}

/* ── Model row ───────────────────────────────────────────────── */
function ModelRow({
  model,
  selected,
  health,
  onSelect,
}: {
  model: SelectedModel;
  selected: boolean;
  health: ProviderHealth;
  onSelect: () => void;
}) {
  const dot = HEALTH_DOT[health];
  const isLocked = health === "locked";
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={isLocked}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-[11px] font-bold transition-colors hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        color: selected ? "#06b6d4" : "rgba(255,255,255,0.7)",
      }}
    >
      <span
        className="pointer-events-none h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: dot.color, boxShadow: `0 0 4px ${dot.color}` }}
        title={dot.label}
      />
      <span className="pointer-events-none flex-1 text-left">{model.label}</span>
      {isLocked && <Lock size={10} className="pointer-events-none text-white/60" />}
      {selected && <Check size={12} className="pointer-events-none" />}
    </button>
  );
}

/* ── Notifications panel ──────────────────────────────────────── */
function NotifPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <>
      <button className="fixed inset-0 z-10000" onClick={onClose} aria-label="Close notifications" />
      <div
        className="fixed right-4 top-14 z-10001 w-72 rounded-2xl border p-3 shadow-2xl"
        style={{
          backgroundColor: "rgba(10,12,18,0.98)",
          borderColor: "rgba(255,255,255,0.08)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-[10px] font-black uppercase tracking-[0.18em]"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            Notifications
          </span>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.4)" }}
            aria-label="Close notifications"
            title="Close"
          >
            <X size={12} className="pointer-events-none" />
          </button>
        </div>
        <div className="space-y-1">
          <div className="rounded-xl p-3 text-center text-[11px] font-medium text-white/65">
            No new notifications
          </div>
        </div>
      </div>
    </>
  );
}
