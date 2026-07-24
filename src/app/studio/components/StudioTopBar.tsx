"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import {
  Activity,
  Bell,
  GitBranch,
  HeartPulse,
  Menu,
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
  RECOMMENDED_IDS,
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
  onMenuToggle,
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
      {/* Mobile menu */}
      {onMenuToggle && (
        <button
          type="button"
          onClick={onMenuToggle}
          className="md:hidden grid h-9 w-9 place-items-center rounded-lg transition-all hover:bg-white/10"
          style={{ color: "rgba(255,255,255,0.5)" }}
          aria-label="Open menu"
          title="Open menu"
        >
          <Menu size={16} className="pointer-events-none" />
        </button>
      )}

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

      {/* Divider */}
      <div className="hidden md:block h-5 w-px" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />

      {/* Project name */}
      <div className="hidden md:flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>
          Project:
        </span>
        <span className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.85)" }}>
          litlabs-website
        </span>
      </div>

      {/* Branch */}
      <div className="hidden lg:flex items-center gap-1 shrink-0">
        <GitBranch size={11} style={{ color: "rgba(255,255,255,0.4)" }} />
        <span className="text-[10px] font-mono" style={{ color: T.accentColor }}>
          main
        </span>
      </div>

      {/* Workspace status */}
      <div className="hidden lg:flex items-center gap-1.5 shrink-0">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            backgroundColor: T.success,
            boxShadow: `0 0 4px ${T.success}`,
          }}
        />
        <span className="text-[10px] font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>
          Workspace: Ready
        </span>
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
            style={{
              backgroundColor: HEALTH_DOT[providerHealth[selectedModel.provider] ?? "available"].color,
              boxShadow: `0 0 4px ${HEALTH_DOT[providerHealth[selectedModel.provider] ?? "available"].color}`,
            }}
          />
          <span className="pointer-events-none">{selectedModel.label}</span>
          <ChevronDown size={10} className="pointer-events-none" style={{ color: "rgba(255,255,255,0.4)" }} />
        </button>
        {modelOpen && (
          <>
            <div className="fixed inset-0 z-10000" onClick={() => setModelOpen(false)} aria-hidden />
            <div
              className="absolute left-0 top-full mt-1 z-10001 w-56 rounded-xl border py-1.5 shadow-2xl"
              style={{
                backgroundColor: "rgba(10,12,18,0.98)",
                borderColor: "rgba(255,255,255,0.08)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
              }}
            >
              {/* Recommended section */}
              <div className="px-3 py-1 text-[8px] font-black uppercase tracking-[0.15em] text-white/40">
                Recommended
              </div>
              {MODELS.filter((m) => RECOMMENDED_IDS.includes(m.id)).map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  selected={selectedModel.id === m.id}
                  health={providerHealth[m.provider] ?? "available"}
                  onSelect={() => { selectModel(m); setModelOpen(false); }}
                />
              ))}
              {/* Other providers */}
              <div className="mt-1 border-t border-white/5 px-3 py-1 text-[8px] font-black uppercase tracking-[0.15em] text-white/40">
                Other providers
              </div>
              {MODELS.filter((m) => !RECOMMENDED_IDS.includes(m.id)).map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  selected={selectedModel.id === m.id}
                  health={providerHealth[m.provider] ?? "available"}
                  onSelect={() => { selectModel(m); setModelOpen(false); }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Fallback notice */}
      {fallbackNotice && (
        <span className="hidden md:inline text-[9px] font-bold text-amber-300/80" title={fallbackNotice}>
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
            borderColor: "rgba(255,255,255,0.06)",
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

      {/* Action buttons: Run, Preview, Deploy */}
      <div className="hidden md:flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all hover:bg-white/5"
          style={{
            borderColor: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.7)",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
          title="Run project"
          aria-label="Run project"
        >
          <Play size={11} className="pointer-events-none" style={{ color: T.success }} />
          <span className="pointer-events-none">Run</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all hover:bg-white/5"
          style={{
            borderColor: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.7)",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
          title="Preview"
          aria-label="Preview"
        >
          <Eye size={11} className="pointer-events-none" style={{ color: "rgba(255,255,255,0.5)" }} />
          <span className="pointer-events-none">Preview</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black transition-all hover:opacity-90"
          style={{
            backgroundColor: T.accentColor,
            color: "#000",
            boxShadow: `0 4px 16px ${T.accentColor}30`,
          }}
          title="Deploy"
          aria-label="Deploy"
        >
          <Rocket size={11} className="pointer-events-none" />
          <span className="pointer-events-none">Deploy</span>
        </button>
      </div>

      {/* Health */}
      <HealthPulse T={T} />

      {/* Wallet */}
      <div
        className="hidden sm:flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold"
        title="LiTBit Coins balance"
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
            style={{ backgroundColor: "#ff3a3a", boxShadow: "0 0 4px #ff3a3a" }}
          />
        </button>
        {notifOpen &&
          createPortal(
            <NotifPanel onClose={() => setNotifOpen(false)} T={T} />,
            document.body,
          )}
      </div>

      {/* Settings */}
      <button
        type="button"
        className="hidden md:block grid h-9 w-9 place-items-center rounded-lg transition-all hover:bg-white/10"
        style={{ color: "rgba(255,255,255,0.5)" }}
        aria-label="Settings"
        title="Settings"
      >
        <Settings size={14} className="pointer-events-none" />
      </button>

      {/* User avatar */}
      <div
        className="w-7 h-7 rounded-full shrink-0"
        style={{
          background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
        }}
        title="User profile"
      />
    </header>
  );
}

/* ── Health pulse ─────────────────────────────────────────────── */
function HealthPulse({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div
      className="hidden md:flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold"
      title="System health"
      style={{
        backgroundColor: "rgba(255,255,255,0.03)",
        borderColor: "rgba(255,255,255,0.06)",
        color: "rgba(255,255,255,0.7)",
      }}
    >
      <HeartPulse size={11} style={{ color: T.success }} />
      <span style={{ color: T.success }}>99.9%</span>
    </div>
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
      {isLocked && <Lock size={10} className="pointer-events-none text-white/30" />}
      {selected && <Check size={12} className="pointer-events-none" />}
    </button>
  );
}

/* ── Notifications panel ──────────────────────────────────────── */
function NotifPanel({
  onClose,
  T,
}: {
  onClose: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const items = [
    { icon: Sparkles, label: "Copilot finished planning", time: "now" },
    { icon: Activity, label: "Code Champion deployed v1.2", time: "2m" },
    { icon: Rocket, label: "Wallet claimed 250 LBC", time: "12m" },
  ];
  return (
    <>
      <div className="fixed inset-0 z-10000" onClick={onClose} aria-hidden />
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
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <div
                key={i}
                className="flex items-start gap-2 rounded-xl p-2 transition-colors hover:bg-white/5 cursor-pointer"
                style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
              >
                <Icon
                  size={12}
                  style={{ color: T.accentColor, marginTop: 1 }}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[11px] font-bold"
                    style={{ color: "rgba(255,255,255,0.85)" }}
                  >
                    {it.label}
                  </div>
                  <div
                    className="text-[9px] uppercase tracking-wider mt-0.5"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  >
                    {it.time}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
