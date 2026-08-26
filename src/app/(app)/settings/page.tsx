"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerk, useUser } from "@clerk/nextjs";
import { useClerkAuthContext } from "@/context/ClerkAuthContext";

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
import {
  LayoutGrid, User, Palette, Sparkles, Briefcase,
  Cpu, Bot, Mic, Plug, Zap, Bell, Coins, Shield, Gauge, Terminal,
  Search, ChevronRight, Check, Loader2,
  RotateCcw, ArrowLeft, Camera, Volume2,
  Monitor, Moon, Sun,
} from "lucide-react";
import {
  useSettingsStore,
  SETTINGS_SECTIONS,
  MODE_ORDER,
  MODE_META,
  type ControlMode,
  type SettingsSection,
} from "@/stores/useSettingsStore";
import {
  SettingsCard,
  SectionHeader,
  ToggleRow,
  SettingsInput,
  SaveBar,
  StatusBadge,
  type SaveStatus,
} from "@/components/settings/SettingsPrimitives";
import { VisualPackSettings } from "@/components/settings/VisualPackSettings";
import { WallpaperSection } from "@/components/settings/WallpaperSection";
import { LivePreviewPanel } from "@/components/settings/LivePreviewPanel";
import { IntegrationCard, IntegrationSummaryBar } from "@/components/settings/IntegrationCard";
import { MicMixerPanel } from "@/features/voice/components/MicMixerPanel";
import { useIntegrationStatus } from "@/hooks/useIntegrationStatus";
import type { LayoutStyle } from "@/context/ThemeContext";
import { useStudioModelStore, MODELS as STUDIO_MODELS } from "@/app/(app)/studio/stores/useStudioModelStore";
import { useConnectionSummary } from "@/app/(app)/studio/hooks/useConnectionSummary";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { WhatLiTTKnowsSection } from "./litt-knows/WhatLiTTKnowsSection";

/* ── Icon map ──────────────────────────────────────────────────────── */

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  LayoutGrid, User, Palette, Sparkles, Briefcase,
  Cpu, Bot, Mic, Plug, Zap, Bell, Coins, Shield, Gauge, Terminal,
};

/* ── Main page ─────────────────────────────────────────────────────── */

export default function SettingsPage() {
  const { resolvedColors: T } = useTheme();
  const {
    controlMode, activeSection, searchQuery, hasUnsavedChanges,
    setControlMode, setActiveSection, setSearchQuery,
    setUnsaved, visibleSections,
  } = useSettingsStore();

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [mobileSection, setMobileSection] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") || "/studio";

  // Read ?section= from the URL on mount so deep links like
  // /settings?section=connections&returnTo=/dashboard land on the right tab.
  useEffect(() => {
    const section = searchParams.get("section");
    if (section && SETTINGS_SECTIONS.some((s) => s.id === section)) {
      setActiveSection(section);
      setMobileSection(section);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const sections = visibleSections();

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;
    const q = searchQuery.toLowerCase();
    return sections.filter(
      (s) => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [sections, searchQuery]);

  const activeSectionMeta = useMemo(
    () => SETTINGS_SECTIONS.find((s) => s.id === activeSection),
    [activeSection],
  );

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/settings/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlMode }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setSaveStatus("saved");
      setUnsaved(false);
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setUnsaved(false);
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [controlMode, setUnsaved]);

  const handleDiscard = useCallback(() => {
    setUnsaved(false);
    setSaveStatus("idle");
  }, [setUnsaved]);

  const handleSectionClick = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    setMobileSection(sectionId);
  }, [setActiveSection]);

  /* ── Mobile: section list → active section ──────────────────── */
  const isMobileSectionActive = mobileSection !== null;

  return (
    <div
      className="min-h-screen"
      style={{ color: T.textColor }}
    >
      {/* Light veil for text contrast — lets the wallpaper show through */}
      <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: "rgba(5,6,10,0.45)" }} />

      {/* ── Desktop: 260px nav + content, wide shell ─────────────────── */}
      <div className="relative mx-auto flex w-full max-w-375 flex-col lg:flex-row">
        {/* Desktop sidebar */}
        <aside
          className="sticky top-0 z-30 hidden h-screen w-65 shrink-0 border-r lg:block 2xl:w-67.5"
          style={{
            borderColor: "rgba(255,255,255,0.06)",
            backgroundColor: "rgba(9,11,18,0.9)",
            backdropFilter: "blur(20px)",
          }}
        >
          <SettingsNav
            sections={filteredSections}
            allSections={SETTINGS_SECTIONS}
            controlMode={controlMode}
            activeSection={activeSection}
            onSectionClick={handleSectionClick}
            onModeChange={setControlMode}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            T={T}
            returnTo={returnTo}
          />
        </aside>

        {/* Mobile header */}
        <div className="sticky top-0 z-40 flex items-center justify-between border-b px-4 py-3 lg:hidden"
          style={{
            backgroundColor: "rgba(10,12,18,0.9)",
            borderColor: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(14px)",
          }}
        >
          <div className="flex items-center gap-3">
            {isMobileSectionActive ? (
              <button
                type="button"
                onClick={() => setMobileSection(null)}
                className="grid h-9 w-9 place-items-center rounded-lg border"
                style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}
                aria-label="Back to settings list"
              >
                <ArrowLeft size={16} className="pointer-events-none" />
              </button>
            ) : (
              <Link
                href={returnTo}
                className="grid h-9 w-9 place-items-center rounded-lg border"
                style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}
                aria-label="Back to Studio"
              >
                <ArrowLeft size={16} className="pointer-events-none" />
              </Link>
            )}
            <span className="text-sm font-black" style={{ color: "rgba(255,255,255,0.9)" }}>
              {isMobileSectionActive ? activeSectionMeta?.label : "Settings"}
            </span>
          </div>
          <ModeSelector
            controlMode={controlMode}
            onModeChange={setControlMode}
            T={T}
          />
        </div>

        {/* Mobile: section list or active section */}
        {isMobileSectionActive ? (
          <main className="min-w-0 flex-1 px-4 py-4 pb-24 lg:hidden">
            {activeSectionMeta && (
              <>
                <SectionHeader
                  title={activeSectionMeta.label}
                  description={activeSectionMeta.description}
                />
                <SettingsContent section={activeSectionMeta.id} T={T} controlMode={controlMode} />
              </>
            )}
          </main>
        ) : (
          <main className="min-w-0 flex-1 px-4 py-4 pb-24 lg:hidden">
            <MobileSectionList
              sections={filteredSections}
              allSections={SETTINGS_SECTIONS}
              controlMode={controlMode}
              onSectionClick={handleSectionClick}
              onModeChange={setControlMode}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              T={T}
            />
          </main>
        )}

        {/* Desktop main content */}
        <main className="hidden min-w-0 flex-1 px-6 py-8 pb-24 pr-16 xl:pr-20 lg:block lg:px-8 xl:px-10">
          {/* Header with mode selector */}
          <div className="mb-6 flex items-start justify-between gap-4">
            <SectionHeader
              title={activeSectionMeta?.label ?? "Settings"}
              description={activeSectionMeta?.description}
            />
            <ModeSelector
              controlMode={controlMode}
              onModeChange={setControlMode}
              T={T}
            />
          </div>
          {activeSectionMeta && (
            <SettingsContent section={activeSectionMeta.id} T={T} controlMode={controlMode} />
          )}
        </main>
      </div>

      {/* ── Sticky save bar ──────────────────────────────────────── */}
      <SaveBar
        status={saveStatus}
        onSave={handleSave}
        onDiscard={handleDiscard}
        hasChanges={hasUnsavedChanges}
      />
    </div>
  );
}

/* ── Settings navigation (desktop sidebar) ─────────────────────────── */

function SettingsNav({
  sections,
  allSections,
  controlMode,
  activeSection,
  onSectionClick,
  onModeChange,
  searchQuery,
  onSearchChange,
  T,
  returnTo,
}: {
  sections: SettingsSection[];
  allSections: SettingsSection[];
  controlMode: ControlMode;
  activeSection: string;
  onSectionClick: (id: string) => void;
  onModeChange: (m: ControlMode) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  returnTo: string;
}) {
  const modeIdx = MODE_ORDER.indexOf(controlMode);
  const hasSearch = searchQuery.trim().length > 0;
  const displaySections = hasSearch ? sections : allSections;

  return (
    <div className="flex h-full flex-col">
      {/* Back link */}
      <div className="border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <Link
          href={returnTo}
          className="flex items-center gap-2 text-xs font-bold text-white/50 hover:text-white/80"
        >
          <ArrowLeft size={14} className="pointer-events-none" />
          Back to Studio
        </Link>
      </div>

      {/* Search */}
      <div className="border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search settings…"
            className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none transition-all focus:ring-2"
            style={{
              backgroundColor: "rgba(10,12,18,0.6)",
              borderColor: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.88)",
            }}
            aria-label="Search settings"
          />
        </div>
      </div>

      {/* Section list — shows ALL sections, locked ones greyed out */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {displaySections.map((section) => {
          const Icon = ICONS[section.icon] ?? LayoutGrid;
          const isActive = activeSection === section.id;
          const sIdx = MODE_ORDER.indexOf(section.minMode);
          const isLocked = sIdx > modeIdx;
          const lockedMode = MODE_META[section.minMode];

          if (isLocked && !hasSearch) {
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onModeChange(section.minMode)}
                className="flex min-h-13 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-white/3"
                style={{ opacity: 0.5 }}
                aria-label={`${section.label} — switch to ${lockedMode.label} mode to unlock`}
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                  style={{
                    backgroundColor: `${lockedMode.color}10`,
                    color: `${lockedMode.color}80`,
                  }}
                >
                  <Icon size={14} className="pointer-events-none" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-white/50">{section.label}</span>
                    <span className="text-[10px] text-white/30">🔒</span>
                  </div>
                  <div className="truncate text-[10px] text-white/25">
                    {section.description}
                  </div>
                </div>
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider"
                  style={{ color: lockedMode.color, backgroundColor: `${lockedMode.color}15` }}
                >
                  {lockedMode.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSectionClick(section.id)}
              className="flex min-h-13 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-white/5"
              style={{
                backgroundColor: isActive ? `${T.accentColor}10` : "transparent",
              }}
              aria-current={isActive ? "page" : undefined}
            >
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                style={{
                  backgroundColor: isActive ? `${T.accentColor}15` : "rgba(255,255,255,0.04)",
                  color: isActive ? T.accentColor : "rgba(255,255,255,0.4)",
                }}
              >
                <Icon size={14} className="pointer-events-none" />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="text-[13px] font-bold"
                  style={{ color: isActive ? T.accentColor : "rgba(255,255,255,0.7)" }}
                >
                  {section.label}
                </div>
                <div className="truncate text-[10px] text-white/35">
                  {section.description}
                </div>
              </div>
              <ChevronRight size={12} className="pointer-events-none text-white/20" />
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ── Mode selector (compact, top-right) ────────────────────────────── */

function ModeSelector({
  controlMode,
  onModeChange,
  T: _T,
}: {
  controlMode: ControlMode;
  onModeChange: (m: ControlMode) => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [open, setOpen] = useState(false);
  const meta = MODE_META[controlMode];

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all"
        style={{
          borderColor: `${meta.color}40`,
          backgroundColor: `${meta.color}10`,
          color: meta.color,
        }}
        aria-label={`Control mode: ${meta.label}`}
        aria-expanded={open}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
        {meta.label}
        <ChevronRight size={10} className={`pointer-events-none transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-label="Close mode selector" />
          <div
            className="absolute right-0 top-full z-41 mt-1 w-64 rounded-xl border shadow-2xl"
            style={{
              backgroundColor: "rgba(10,12,18,0.98)",
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            {MODE_ORDER.map((mode) => {
              const m = MODE_META[mode];
              const isActive = controlMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { onModeChange(mode); setOpen(false); }}
                  className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-all hover:bg-white/5"
                >
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold" style={{ color: isActive ? m.color : "rgba(255,255,255,0.8)" }}>
                        {m.label}
                      </span>
                      {isActive && <Check size={10} style={{ color: m.color }} />}
                    </div>
                    <p className="text-[9px] text-white/40">{m.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Mobile section list ───────────────────────────────────────────── */

function MobileSectionList({
  sections,
  allSections,
  controlMode,
  onSectionClick,
  onModeChange,
  searchQuery,
  onSearchChange,
  T: _T,
}: {
  sections: SettingsSection[];
  allSections: SettingsSection[];
  controlMode: ControlMode;
  onSectionClick: (id: string) => void;
  onModeChange: (m: ControlMode) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const modeIdx = MODE_ORDER.indexOf(controlMode);
  const hasSearch = searchQuery.trim().length > 0;

  // When searching, show filtered results. Otherwise show ALL sections
  // with locked ones greyed out so users can see what exists.
  const displaySections = hasSearch ? sections : allSections;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search settings…"
          className="w-full rounded-xl border py-3 pl-10 pr-3 text-sm outline-none"
          style={{
            backgroundColor: "rgba(10,12,18,0.6)",
            borderColor: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.88)",
          }}
          aria-label="Search settings"
        />
      </div>

      {/* Mode banner — shows current mode and lets user switch */}
      {!hasSearch && (
        <div
          className="flex items-center justify-between rounded-xl border px-3 py-2.5"
          style={{
            borderColor: `${MODE_META[controlMode].color}30`,
            backgroundColor: `${MODE_META[controlMode].color}08`,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: MODE_META[controlMode].color }} />
            <span className="text-xs font-bold" style={{ color: MODE_META[controlMode].color }}>
              {MODE_META[controlMode].label}
            </span>
            <span className="text-[10px] text-white/40">{MODE_META[controlMode].description}</span>
          </div>
          <ModeSelector
            controlMode={controlMode}
            onModeChange={onModeChange}
            T={_T}
          />
        </div>
      )}

      <div className="space-y-1">
        {displaySections.map((section) => {
          const Icon = ICONS[section.icon] ?? LayoutGrid;
          const sIdx = MODE_ORDER.indexOf(section.minMode);
          const isLocked = sIdx > modeIdx;
          const lockedMode = MODE_META[section.minMode];

          if (isLocked && !hasSearch) {
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onModeChange(section.minMode)}
                className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all hover:bg-white/3"
                style={{
                  borderColor: "rgba(255,255,255,0.04)",
                  backgroundColor: "rgba(255,255,255,0.01)",
                  opacity: 0.55,
                }}
                aria-label={`${section.label} — switch to ${lockedMode.label} mode to unlock`}
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                  style={{
                    backgroundColor: `${lockedMode.color}10`,
                    color: `${lockedMode.color}80`,
                  }}
                >
                  <Icon size={16} className="pointer-events-none" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white/60">{section.label}</span>
                    <span className="text-[10px] text-white/30">🔒</span>
                  </div>
                  <div className="truncate text-[10px] text-white/30">{section.description}</div>
                </div>
                <span
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider"
                  style={{ color: lockedMode.color, backgroundColor: `${lockedMode.color}15` }}
                >
                  {lockedMode.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSectionClick(section.id)}
              className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all"
              style={{
                borderColor: "rgba(255,255,255,0.06)",
                backgroundColor: "rgba(255,255,255,0.02)",
              }}
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                style={{
                  backgroundColor: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                <Icon size={16} className="pointer-events-none" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-white/80">{section.label}</div>
                <div className="truncate text-[10px] text-white/35">{section.description}</div>
              </div>
              <ChevronRight size={14} className="pointer-events-none text-white/20" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Section content router ────────────────────────────────────────── */

function SettingsContent({
  section,
  T,
  controlMode,
}: {
  section: string;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  controlMode: ControlMode;
}) {
  switch (section) {
    case "overview":
      return <OverviewSection T={T} controlMode={controlMode} />;
    case "account":
      return <AccountSection T={T} />;
    case "appearance":
      return <AppearanceSection T={T} />;
    case "workspace":
      return <WorkspaceSection T={T} />;
    case "ai-models":
      return <AIModelsSection T={T} />;
    case "agents":
      return <AgentsSection T={T} />;
    case "voice-camera":
      return <VoiceCameraSection T={T} />;
    case "connections":
      return <ConnectionsSection T={T} />;
    case "automation":
      return <AutomationSection T={T} />;
    case "notifications":
      return <NotificationsSection T={T} />;
    case "billing":
      return <BillingSection T={T} />;
    case "privacy":
      return <PrivacySection T={T} />;
    case "litt-knows":
      return <WhatLiTTKnowsSection T={T} />;
    case "performance":
      return <PerformanceSection T={T} />;
    case "advanced":
      return <AdvancedSection T={T} />;
    default:
      return null;
  }
}

/* ── Overview ──────────────────────────────────────────────────────── */

function OverviewSection({ T, controlMode }: { T: ReturnType<typeof useTheme>["resolvedColors"]; controlMode: ControlMode }) {
  const { isSignedIn, sessionClaims } = useClerkAuthContext();
  const { capabilities } = useConnectionSummary();
  const { selectedModel } = useStudioModelStore();
  const { setActiveSection } = useSettingsStore();
  const [micStatus, setMicStatus] = useState<"unknown" | "available" | "denied" | "error">("unknown");

  // Read existing permission state via Permissions API (no prompt).
  // Never call getUserMedia automatically on mount — that would trigger
  // a browser permission popup just by opening Settings.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    let active = true;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        if (!active) return;
        if (result.state === "granted") setMicStatus("available");
        else if (result.state === "denied") setMicStatus("denied");
        else setMicStatus("unknown");
      })
      .catch(() => {
        // Permissions API not supported — leave as "unknown"
      });
    return () => { active = false; };
  }, []);

  // Only called when the user explicitly clicks "Test microphone"
  const checkMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicStatus("available");
    } catch {
      setMicStatus("denied");
    }
  }, []);

  const connectedProviders = capabilities.connectedProviders;
  const hasGitHub = connectedProviders.includes("repository");
  const hasTerminal = capabilities.terminalStatus === "connected";

  const overviewCards = [
    {
      label: "Account",
      value: isSignedIn ? `Signed in as ${sessionClaims?.name || sessionClaims?.username || "User"}` : "Not signed in",
      action: "Manage account",
      section: "account",
      icon: <User size={14} />,
    },
    {
      label: "Appearance",
      value: "Dark mode · " + T.accentColor,
      action: "Customize",
      section: "appearance",
      icon: <Palette size={14} />,
    },
    {
      label: "AI & Models",
      value: selectedModel?.name || "Auto Best",
      action: "Manage models",
      section: "ai-models",
      icon: <Cpu size={14} />,
    },
    {
      label: "Voice & Camera",
      value: micStatus === "available" ? "Microphone available" : micStatus === "denied" ? "Microphone denied" : "Microphone unknown",
      action: "Open diagnostics",
      section: "voice-camera",
      icon: <Mic size={14} />,
    },
    {
      label: "Connections",
      value: hasGitHub ? "GitHub connected" : "GitHub disconnected",
      action: "Manage connections",
      section: "connections",
      icon: <Plug size={14} />,
    },
    {
      label: "Workspace",
      value: hasTerminal ? "Terminal connected" : "No active session",
      action: "Open workspace settings",
      section: "workspace",
      icon: <Briefcase size={14} />,
    },
    {
      label: "Security",
      value: "2FA status · Last sign-in",
      action: "Review security",
      section: "privacy",
      icon: <Shield size={14} />,
    },
  ];

  const quickActions: { label: string; onClick: () => void; show: boolean }[] = [
    { label: "Test microphone", onClick: checkMic, show: micStatus !== "available" },
    { label: "Connect GitHub", onClick: () => setActiveSection("connections"), show: !hasGitHub },
    { label: "Change model", onClick: () => setActiveSection("ai-models"), show: true },
    { label: "Manage account", onClick: () => setActiveSection("account"), show: isSignedIn },
    { label: "Review usage", onClick: () => setActiveSection("billing"), show: true },
  ].filter((a) => a.show);

  return (
    <div className="w-full space-y-6">
      {/* Status cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {overviewCards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={() => setActiveSection(card.section)}
            className="flex min-h-23 items-center justify-between rounded-2xl border px-5 py-4 text-left transition-all hover:bg-white/5"
            style={{ borderColor: "rgba(255,255,255,0.06)", backgroundColor: "rgba(255,255,255,0.02)" }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)" }}>
                {card.icon}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-white/80">{card.label}</div>
                <div className="mt-1 truncate text-xs leading-5 text-white/40">{card.value}</div>
              </div>
            </div>
            <span className="shrink-0 text-xs font-bold" style={{ color: T.accentColor }}>{card.action} →</span>
          </button>
        ))}
      </div>

      {/* Quick actions */}
      {quickActions.length > 0 && (
        <SettingsCard title="Quick actions" description="Based on current system state">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((action, i) => (
              <button
                key={i}
                type="button"
                onClick={action.onClick}
                className="flex items-center justify-between rounded-xl border px-4 py-3 text-xs font-bold transition-all hover:bg-white/5"
                style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}
              >
                {action.label}
                <ChevronRight size={14} className="pointer-events-none text-white/30" />
              </button>
            ))}
          </div>
        </SettingsCard>
      )}

      {/* Current mode */}
      <section className="rounded-2xl border border-white/10 bg-black/30 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: MODE_META[controlMode].color }} />
            <div>
              <div className="text-sm font-bold" style={{ color: MODE_META[controlMode].color }}>{MODE_META[controlMode].label}</div>
              <p className="mt-0.5 text-xs text-white/40">{MODE_META[controlMode].description}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── Account ──────────────────────────────────────────────────────── */

function AccountSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  if (!clerkConfigured) {
    return (
      <SettingsCard title="Account" description="Sign in to manage your profile" icon={<User size={16} />}>
        <Link href="/sign-in" className="text-xs font-bold" style={{ color: T.accentColor }}>Sign in →</Link>
      </SettingsCard>
    );
  }
  return <AccountSectionClerk T={T} />;
}

function AccountSectionClerk({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const { user, isLoaded } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [picError, setPicError] = useState<string | null>(null);

  const handleProfilePicUpload = useCallback(async (file: File) => {
    if (!user) return;
    setPicError(null);

    // Validate file
    if (!file.type.startsWith("image/")) {
      setPicError("Please select an image file (JPEG, PNG, WebP, or GIF).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPicError("Image must be under 10 MB.");
      return;
    }

    setUploadingPic(true);
    try {
      await user.setProfileImage({ file });
    } catch (err) {
      setPicError(err instanceof Error ? err.message : "Failed to upload profile picture.");
    } finally {
      setUploadingPic(false);
    }
  }, [user]);

  if (!isLoaded) {
    return <div className="flex items-center gap-2 text-xs text-white/40"><Loader2 size={14} className="animate-spin" /> Loading account…</div>;
  }

  if (!user) {
    return (
      <SettingsCard title="Account" description="Sign in to manage your profile" icon={<User size={16} />}>
        <Link href="/sign-in" className="text-xs font-bold" style={{ color: T.accentColor }}>Sign in →</Link>
      </SettingsCard>
    );
  }

  const name = user.firstName || user.username || "User";
  const email = user.primaryEmailAddress?.emailAddress || "No email";
  const imageUrl = user.imageUrl;
  const identities = user.externalAccounts ?? [];

  return (
    <div className="space-y-4">
      {/* Profile */}
      <SettingsCard title="Profile" description="Your account information" icon={<User size={16} />}>
        <div className="flex items-center gap-4">
          {/* Profile picture with upload overlay */}
          <div className="relative group shrink-0">
            {/* Clerk avatar URL — not optimisable by next/image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={name}
              className="h-16 w-16 rounded-full border border-white/10 object-cover"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPic}
              className="absolute inset-0 grid place-items-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-60"
              aria-label="Upload profile picture"
              title="Upload profile picture"
            >
              {uploadingPic ? (
                <Loader2 size={18} className="animate-spin text-white" />
              ) : (
                <Camera size={18} className="text-white" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              disabled={uploadingPic}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleProfilePicUpload(file);
                // Reset so the same file can be selected again
                e.target.value = "";
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-white">{name}</div>
            <div className="text-xs text-white/40">{email}</div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPic}
              className="mt-1.5 text-[10px] font-bold text-white/50 hover:text-white/80 disabled:opacity-50"
            >
              {uploadingPic ? "Uploading…" : "Change photo"}
            </button>
          </div>
        </div>
        {picError && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-medium text-red-400">
            {picError}
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-white/2.5 px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Display name</div>
            <div className="mt-1 text-xs font-semibold text-white/85">{name}</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/2.5 px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Primary email</div>
            <div className="mt-1 truncate text-xs font-semibold text-white/85">{email}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openUserProfile()}
            className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all hover:opacity-90"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            Manage account & security
          </button>
          <button
            type="button"
            onClick={() => void signOut({ redirectUrl: "/" })}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/60 hover:bg-white/5"
          >
            Sign out
          </button>
        </div>
      </SettingsCard>

      {/* Connected identities */}
      <SettingsCard title="Connected identities" description="Linked accounts and providers">
        {identities.length > 0 ? (
          <div className="space-y-2">
            {identities.map((id) => (
              <div key={id.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/2 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">{id.provider}</span>
                </div>
                <StatusBadge label="Connected" color="#22c55e" />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/40">No external identities linked.</p>
        )}
      </SettingsCard>

      {/* Plan & usage */}
      <SettingsCard title="Plan" description="Current subscription">
        <div className="flex items-center justify-between rounded-xl border px-4 py-3"
          style={{ borderColor: `${T.accentColor}30`, backgroundColor: `${T.accentColor}08` }}
        >
          <div>
            <div className="text-sm font-black" style={{ color: T.accentColor }}>Free Plan</div>
            <div className="text-[10px] text-white/40">Beta access</div>
          </div>
          <Link href="/settings?section=billing" className="text-xs font-bold" style={{ color: T.accentColor }}
            onClick={() => useSettingsStore.getState().setActiveSection("billing")}>
            Manage →
          </Link>
        </div>
      </SettingsCard>

      {/* Security */}
      <SettingsCard title="Security" description="Password and authentication">
        <button
          type="button"
          onClick={() => openUserProfile()}
          className="flex min-h-12 w-full items-center justify-between rounded-xl border border-white/8 bg-white/2.5 px-3 text-left transition hover:border-white/15 hover:bg-white/5"
        >
          <span className="flex items-center gap-3">
            <Shield size={15} className="text-violet-300" />
            <span>
              <span className="block text-xs font-bold text-white">Password, passkeys & 2FA</span>
              <span className="block text-[10px] text-white/45">Managed securely by Clerk</span>
            </span>
          </span>
          <ChevronRight size={15} className="text-white/35" />
        </button>
      </SettingsCard>
    </div>
  );
}

/* ── Appearance ────────────────────────────────────────────────────── */

function AppearanceSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const { theme, setMode, setSkin, setAccent, setBackgroundMode, setLayoutStyle, resetTheme } = useTheme();

  const modeOptions: { id: "dark" | "light" | "system"; label: string; icon: React.ReactNode }[] = [
    { id: "dark", label: "Dark", icon: <Moon size={14} /> },
    { id: "light", label: "Light", icon: <Sun size={14} /> },
    { id: "system", label: "System", icon: <Monitor size={14} /> },
  ];

  const accentOptions: { id: string; label: string }[] = [
    { id: "neon-green", label: "Neon Green" },
    { id: "hot-pink", label: "Hot Pink" },
    { id: "electric-blue", label: "Electric Blue" },
    { id: "cyber-yellow", label: "Cyber Yellow" },
    { id: "matrix-green", label: "Matrix Green" },
    { id: "sunset-orange", label: "Sunset Orange" },
    { id: "ocean-blue", label: "Ocean Blue" },
    { id: "purple-haze", label: "Purple Haze" },
  ];

  const skinOptions = [
    "cyberpunk", "retro", "ocean", "sunset", "matrix", "pink",
    "synthwave", "volcanic", "gold", "arctic", "emerald", "midnight",
    "neon", "blood", "cosmic", "miami", "honeycomb",
  ];

  const bgOptions: { id: string; label: string }[] = [
    { id: "constellation", label: "Constellation" },
    { id: "nebula", label: "Nebula" },
    { id: "waves", label: "Waves" },
    { id: "minimal", label: "Minimal" },
    { id: "holo", label: "Holo" },
  ];

  const layoutOptions: { id: LayoutStyle; label: string; desc: string }[] = [
    { id: "classic", label: "Classic", desc: "Standard panels with solid surfaces" },
    { id: "glass", label: "Glass", desc: "Frosted blur with translucent layers" },
    { id: "honeycomb", label: "Honeycomb", desc: "Hexagonal accents with warm glow" },
    { id: "minimal", label: "Minimal", desc: "Ultra-clean with maximum whitespace" },
    { id: "terminal", label: "Terminal", desc: "Monospace energy with sharp edges" },
    { id: "arcade", label: "Arcade", desc: "Bold retro blocks with pixel flair" },
  ];

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      {/* Left: settings controls */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* 1. Quick presets */}
        <SettingsCard title="Quick presets" description="One-click visual packs — applies a complete look" icon={<Sparkles size={16} />}>
          <VisualPackSettings />
        </SettingsCard>

        {/* 2. Theme mode */}
        <SettingsCard title="Theme mode" description="Light, dark, or system" icon={<Palette size={16} />}>
          <div className="grid grid-cols-3 gap-2">
            {modeOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMode(opt.id)}
                className="flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-bold transition-all"
                style={{
                  borderColor: theme.mode === opt.id ? `${T.accentColor}40` : "rgba(255,255,255,0.06)",
                  backgroundColor: theme.mode === opt.id ? `${T.accentColor}10` : "transparent",
                  color: theme.mode === opt.id ? T.accentColor : "rgba(255,255,255,0.5)",
                }}
                aria-pressed={theme.mode === opt.id}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
        </SettingsCard>

        {/* 3. Layout style */}
        <SettingsCard title="Layout style" description="Controls visual structure and component shape language">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {layoutOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setLayoutStyle(opt.id)}
                className="rounded-xl border p-3 text-left transition-all"
                style={{
                  borderColor: theme.layoutStyle === opt.id ? `${T.accentColor}40` : "rgba(255,255,255,0.06)",
                  backgroundColor: theme.layoutStyle === opt.id ? `${T.accentColor}08` : "transparent",
                }}
                aria-pressed={theme.layoutStyle === opt.id}
              >
                <div className="text-xs font-bold" style={{ color: theme.layoutStyle === opt.id ? T.accentColor : "rgba(255,255,255,0.7)" }}>
                  {opt.label}
                </div>
                <p className="mt-0.5 text-[10px] leading-4 text-white/40">{opt.desc}</p>
              </button>
            ))}
          </div>
        </SettingsCard>

        {/* 4. Skin */}
        <SettingsCard title="Skin" description="Full color palette preset">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {skinOptions.map((skin) => (
              <button
                key={skin}
                type="button"
                onClick={() => setSkin(skin as never)}
                className="rounded-lg border px-2 py-2 text-[10px] font-bold capitalize transition-all"
                style={{
                  borderColor: theme.skin === skin ? T.accentColor : "rgba(255,255,255,0.08)",
                  backgroundColor: theme.skin === skin ? `${T.accentColor}10` : "transparent",
                  color: theme.skin === skin ? T.accentColor : "rgba(255,255,255,0.5)",
                }}
                aria-pressed={theme.skin === skin}
              >
                {skin}
              </button>
            ))}
          </div>
        </SettingsCard>

        {/* 5. Accent color */}
        <SettingsCard title="Accent color" description="Primary highlight color">
          <div className="flex flex-wrap gap-2">
            {accentOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAccent(opt.id as never)}
                className="rounded-lg border px-3 py-1.5 text-[10px] font-bold transition-all"
                style={{
                  borderColor: theme.accent === opt.id ? T.accentColor : "rgba(255,255,255,0.08)",
                  backgroundColor: theme.accent === opt.id ? `${T.accentColor}10` : "transparent",
                  color: theme.accent === opt.id ? T.accentColor : "rgba(255,255,255,0.5)",
                }}
                aria-pressed={theme.accent === opt.id}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </SettingsCard>

        {/* 6. Wallpaper */}
        <SettingsCard title="Wallpaper" description="Background artwork used across supported pages" icon={<LayoutGrid size={16} />}>
          <WallpaperSection />
        </SettingsCard>

        {/* 7. Background effects */}
        <SettingsCard title="Background effects" description="Animated backgrounds and canvas effects">
          <div className="flex flex-wrap gap-2">
            {bgOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setBackgroundMode(opt.id as never)}
                className="rounded-lg border px-3 py-1.5 text-[10px] font-bold transition-all"
                style={{
                  borderColor: theme.backgroundMode === opt.id ? T.accentColor : "rgba(255,255,255,0.08)",
                  backgroundColor: theme.backgroundMode === opt.id ? `${T.accentColor}10` : "transparent",
                  color: theme.backgroundMode === opt.id ? T.accentColor : "rgba(255,255,255,0.5)",
                }}
                aria-pressed={theme.backgroundMode === opt.id}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </SettingsCard>

        {/* 11. Reset */}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={resetTheme}
            className="flex items-center gap-1.5 rounded-lg border border-red-400/20 px-3 py-2 text-xs font-bold text-red-300 transition-all hover:bg-red-400/10"
          >
            <RotateCcw size={12} className="pointer-events-none" />
            Reset appearance
          </button>
        </div>
      </div>

      {/* Right: live preview (desktop only) */}
      <div className="hidden w-85 shrink-0 xl:block">
        <LivePreviewPanel />
      </div>
    </div>
  );
}

/* ── Workspace ─────────────────────────────────────────────────────── */

function WorkspaceSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const fallbackDefaults = {
    defaultView: "chat",
    defaultTool: "chat",
    autosave: true,
    restoreSession: true,
    terminalBehavior: "auto",
    previewBehavior: "auto",
    filePanelDefault: "left",
    mobileLayout: "compact",
    compactDensity: false,
    overlayEffects: true,
  };
  const [defaults, setDefaults] = useState<typeof fallbackDefaults>(() => {
    if (typeof window === "undefined") return fallbackDefaults;
    try {
      const saved = localStorage.getItem("littree:workspace-preferences");
      return saved ? { ...fallbackDefaults, ...JSON.parse(saved) } : fallbackDefaults;
    } catch {
      return fallbackDefaults;
    }
  });

  useEffect(() => {
    localStorage.setItem("littree:workspace-preferences", JSON.stringify(defaults));
  }, [defaults]);

  const workspaceProfiles = [
    {
      name: "Creator",
      description: "Chat-first with automatic preview and spacious controls",
      values: { defaultView: "chat", defaultTool: "chat", previewBehavior: "auto", terminalBehavior: "manual", compactDensity: false, overlayEffects: true, mobileLayout: "comfortable" },
    },
    {
      name: "Builder",
      description: "Code-first with terminal ready and dense information",
      values: { defaultView: "code", defaultTool: "code", previewBehavior: "auto", terminalBehavior: "auto", compactDensity: true, overlayEffects: false, mobileLayout: "compact" },
    },
    {
      name: "Focus",
      description: "Quiet chat workspace with fewer automatic panels",
      values: { defaultView: "chat", defaultTool: "chat", previewBehavior: "manual", terminalBehavior: "manual", compactDensity: false, overlayEffects: false, mobileLayout: "comfortable" },
    },
  ] as const;

  return (
    <div className="space-y-4">
      <SettingsCard title="Workspace profiles" description="Coordinated layouts that set sensible Studio defaults" icon={<LayoutGrid size={16} />}>
        <div className="grid gap-2 md:grid-cols-3">
          {workspaceProfiles.map((profile) => (
            <button
              key={profile.name}
              type="button"
              onClick={() => setDefaults((current) => ({ ...current, ...profile.values }))}
              className="rounded-xl border border-white/8 bg-white/2 p-3 text-left transition hover:border-white/15 hover:bg-white/5"
            >
              <span className="text-xs font-black" style={{ color: T.accentColor }}>{profile.name}</span>
              <span className="mt-1 block text-[10px] leading-4 text-white/45">{profile.description}</span>
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Studio defaults" description="What opens when you enter Studio" icon={<Briefcase size={16} />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Default view</span>
            <div className="mt-1 flex gap-2">
              {["chat", "code", "preview"].map((v) => (
                <button key={v} type="button" onClick={() => setDefaults({ ...defaults, defaultView: v })}
                  className="rounded-lg border px-3 py-1.5 text-[10px] font-bold capitalize"
                  style={{ borderColor: defaults.defaultView === v ? T.accentColor : "rgba(255,255,255,0.08)", color: defaults.defaultView === v ? T.accentColor : "rgba(255,255,255,0.5)" }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Default tool</span>
            <div className="mt-1 flex gap-2">
              {["chat", "code", "agents"].map((v) => (
                <button key={v} type="button" onClick={() => setDefaults({ ...defaults, defaultTool: v })}
                  className="rounded-lg border px-3 py-1.5 text-[10px] font-bold capitalize"
                  style={{ borderColor: defaults.defaultTool === v ? T.accentColor : "rgba(255,255,255,0.08)", color: defaults.defaultTool === v ? T.accentColor : "rgba(255,255,255,0.5)" }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Session behavior" description="Autosave and restore">
        <div className="space-y-3">
          <ToggleRow title="Autosave" description="Save changes automatically" checked={defaults.autosave} onChange={(v) => setDefaults({ ...defaults, autosave: v })} />
          <ToggleRow title="Restore last session" description="Reopen previous tabs and tools" checked={defaults.restoreSession} onChange={(v) => setDefaults({ ...defaults, restoreSession: v })} />
        </div>
      </SettingsCard>

      <SettingsCard title="Terminal & preview" description="How these tools behave">
        <div className="space-y-3">
          <ToggleRow title="Auto-connect terminal" description="Connect terminal on Studio open" checked={defaults.terminalBehavior === "auto"} onChange={(v) => setDefaults({ ...defaults, terminalBehavior: v ? "auto" : "manual" })} />
          <ToggleRow title="Auto-open preview" description="Open preview after build" checked={defaults.previewBehavior === "auto"} onChange={(v) => setDefaults({ ...defaults, previewBehavior: v ? "auto" : "manual" })} />
        </div>
      </SettingsCard>

      <SettingsCard title="Layout" description="Density and mobile">
        <div className="space-y-3">
          <ToggleRow title="Compact density" description="Reduce padding and spacing" checked={defaults.compactDensity} onChange={(v) => setDefaults({ ...defaults, compactDensity: v })} />
          <ToggleRow title="Overlay effects" description="Blur and transparency" checked={defaults.overlayEffects} onChange={(v) => setDefaults({ ...defaults, overlayEffects: v })} />
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Mobile layout</span>
            <div className="mt-1 flex gap-2">
              {["compact", "comfortable"].map((v) => (
                <button key={v} type="button" onClick={() => setDefaults({ ...defaults, mobileLayout: v })}
                  className="rounded-lg border px-3 py-1.5 text-[10px] font-bold capitalize"
                  style={{ borderColor: defaults.mobileLayout === v ? T.accentColor : "rgba(255,255,255,0.08)", color: defaults.mobileLayout === v ? T.accentColor : "rgba(255,255,255,0.5)" }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── AI & Models ───────────────────────────────────────────────────── */

function AIModelsSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const { selectedModel, selectModel, providerHealth } = useStudioModelStore();
  const [spend, updateSpend] = useLocalSettings("spend-limits", {
    dailyLimit: "5",
    monthlyLimit: "50",
  });

  const categoryLabels: Record<string, string> = {
    auto: "Auto Best",
    free: "Free AI",
    fast: "Fast",
    code: "Coding",
    creative: "Creative",
    vision: "Vision",
    byok: "BYOK",
  };

  const activeCategory = STUDIO_MODELS.find((m) => m.id === selectedModel.id)?.category ?? "auto";
  const fallbackModel = STUDIO_MODELS.find((m) => m.category === "free" && m.id !== selectedModel.id);

  return (
    <div className="space-y-4">
      {/* Active model summary */}
      <SettingsCard title="Active model" description="Currently selected for chat" icon={<Cpu size={16} />}>
        <div className="rounded-xl border p-3" style={{ borderColor: `${T.accentColor}30`, backgroundColor: `${T.accentColor}08` }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-black" style={{ color: T.accentColor }}>{selectedModel?.name || "Auto Best"}</div>
              <div className="text-[10px] text-white/40">{categoryLabels[activeCategory] ?? "Auto"} · {selectedModel?.provider || "Auto"}</div>
            </div>
            <StatusBadge label={selectedModel?.cost === "free" ? "Free" : "Paid"} color={selectedModel?.cost === "free" ? "#22c55e" : "#f59e0b"} />
          </div>
        </div>
        {fallbackModel && (
          <div className="mt-2 text-[10px] text-white/40">
            Fallback: <span className="text-white/60">{fallbackModel.name}</span>
          </div>
        )}
        <div className="mt-2 text-[10px] text-white/40">
          Voice transcription: <span className="text-white/60">Groq Whisper</span>
        </div>
      </SettingsCard>

      {/* Model categories */}
      <SettingsCard title="Model selection" description="Choose a category or specific model">
        <div className="space-y-1">
          {STUDIO_MODELS.map((m) => {
            const isSelected = selectedModel.id === m.id;
            const health = providerHealth[m.provider] ?? "available";
            const healthColor = health === "available" ? "#22c55e" : health === "degraded" ? "#f59e0b" : health === "unavailable" ? "#ef4444" : "#6b7280";
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => selectModel(m)}
                className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all"
                style={{
                  borderColor: isSelected ? `${T.accentColor}40` : "rgba(255,255,255,0.06)",
                  backgroundColor: isSelected ? `${T.accentColor}10` : "transparent",
                }}
                aria-pressed={isSelected}
              >
                <span className="text-base">{m.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold" style={{ color: isSelected ? T.accentColor : "rgba(255,255,255,0.8)" }}>{m.name}</div>
                  <div className="text-[9px] text-white/35">{categoryLabels[m.category ?? "auto"]} · {m.provider}</div>
                </div>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: healthColor }} title={health} />
                {isSelected && <Check size={12} style={{ color: T.accentColor }} />}
              </button>
            );
          })}
        </div>
      </SettingsCard>

      {/* Spend limits */}
      <SettingsCard title="Spending limits" description="Control AI costs">
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Daily spend limit ($)" value={spend.dailyLimit} onChange={(v) => updateSpend("dailyLimit", v)} type="number" />
          <SettingsInput label="Monthly spend limit ($)" value={spend.monthlyLimit} onChange={(v) => updateSpend("monthlyLimit", v)} type="number" />
        </div>
      </SettingsCard>

      {/* Provider diagnostics */}
      <SettingsCard title="Provider diagnostics" description="Health and availability">
        <div className="space-y-2">
          {[
            { name: "Google AI Studio", key: "gemini" },
            { name: "Groq", key: "groq" },
            { name: "OpenRouter", key: "openrouter" },
          ].map((p) => {
            const health = providerHealth[p.key] ?? "available";
            const color = health === "available" ? "#22c55e" : health === "degraded" ? "#f59e0b" : health === "unavailable" ? "#ef4444" : "#6b7280";
            return (
              <div key={p.key} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/2 px-3 py-2.5">
                <span className="text-xs font-bold text-white/80">{p.name}</span>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[10px] font-bold capitalize" style={{ color }}>{health}</span>
                </div>
              </div>
            );
          })}
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── LiTT & Spark ──────────────────────────────────────────────────── */

const AGENT_DEFAULT_SETTINGS = {
  defaultAgent: "litt",
  responseStyle: "concise",
  spokenLength: "medium",
  approvalRequired: true,
  projectAwareness: true,
  memoryUsage: true,
  proactiveSuggestions: false,
  terminalAccess: true,
  fileWrite: false,
  githubAccess: false,
  deployApproval: true,
};

function AgentsSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const STORAGE_KEY = "litlabs:agent-settings";

  const [settings, setSettings] = useState(AGENT_DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState(AGENT_DEFAULT_SETTINGS);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loaded, setLoaded] = useState(false);

  // Load saved settings from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const merged = { ...AGENT_DEFAULT_SETTINGS, ...parsed };
        setSettings(merged);
        setSavedSettings(merged);
      }
    } catch {
      // ignore parse errors
    }
    setLoaded(true);
  }, []);

  // Track unsaved changes
  const hasUnsavedChanges = loaded && JSON.stringify(settings) !== JSON.stringify(savedSettings);

  const updateSetting = useCallback(<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      // Save to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

      // Also try to persist server-side (fire-and-forget — works if migration is applied)
      try {
        await fetch("/api/settings/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        });
      } catch {
        // Server-side save is best-effort — localStorage is the source of truth for now
      }

      setSavedSettings(settings);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [settings]);

  const handleDiscard = useCallback(() => {
    setSettings(savedSettings);
    setSaveStatus("idle");
  }, [savedSettings]);

  return (
    <div className="space-y-4">
      <SettingsCard title="Default agent" description="Who responds first" icon={<Bot size={16} />}>
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: "litt", name: "LiTT", desc: "Operating agent" },
            { id: "spark", name: "Spark", desc: "Creative agent" },
          ].map((a) => (
            <button key={a.id} type="button" onClick={() => updateSetting("defaultAgent", a.id)}
              className="rounded-xl border p-3 text-left transition-all"
              style={{ borderColor: settings.defaultAgent === a.id ? `${T.accentColor}40` : "rgba(255,255,255,0.06)", backgroundColor: settings.defaultAgent === a.id ? `${T.accentColor}10` : "transparent" }}>
              <div className="text-sm font-bold" style={{ color: settings.defaultAgent === a.id ? T.accentColor : "rgba(255,255,255,0.8)" }}>{a.name}</div>
              <div className="text-[10px] text-white/40">{a.desc}</div>
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Response style" description="How agents communicate">
        <div className="space-y-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Response style</span>
            <div className="mt-1 flex gap-2">
              {["concise", "detailed", "casual"].map((v) => (
                <button key={v} type="button" onClick={() => updateSetting("responseStyle", v)}
                  className="rounded-lg border px-3 py-1.5 text-[10px] font-bold capitalize"
                  style={{ borderColor: settings.responseStyle === v ? T.accentColor : "rgba(255,255,255,0.08)", color: settings.responseStyle === v ? T.accentColor : "rgba(255,255,255,0.5)" }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Spoken response length</span>
            <div className="mt-1 flex gap-2">
              {["short", "medium", "long"].map((v) => (
                <button key={v} type="button" onClick={() => updateSetting("spokenLength", v)}
                  className="rounded-lg border px-3 py-1.5 text-[10px] font-bold capitalize"
                  style={{ borderColor: settings.spokenLength === v ? T.accentColor : "rgba(255,255,255,0.08)", color: settings.spokenLength === v ? T.accentColor : "rgba(255,255,255,0.5)" }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Behavior" description="Agent autonomy and awareness">
        <div className="space-y-3">
          <ToggleRow title="Require approval for actions" description="Ask before executing" checked={settings.approvalRequired} onChange={(v) => updateSetting("approvalRequired", v)} />
          <ToggleRow title="Project awareness" description="Agents know your project context" checked={settings.projectAwareness} onChange={(v) => updateSetting("projectAwareness", v)} />
          <ToggleRow title="Memory usage" description="Use conversation history and memory" checked={settings.memoryUsage} onChange={(v) => updateSetting("memoryUsage", v)} />
          <ToggleRow title="Proactive suggestions" description="Agents suggest next steps" checked={settings.proactiveSuggestions} onChange={(v) => updateSetting("proactiveSuggestions", v)} />
        </div>
      </SettingsCard>

      <SettingsCard title="Tool permissions" description="What agents are allowed to do">
        <div className="space-y-3">
          <ToggleRow title="Terminal execution" description="Allow agents to run commands" checked={settings.terminalAccess} onChange={(v) => updateSetting("terminalAccess", v)} />
          <ToggleRow title="File write access" description="Allow agents to modify files" checked={settings.fileWrite} onChange={(v) => updateSetting("fileWrite", v)} />
          <ToggleRow title="GitHub access" description="Allow agents to push and create PRs" checked={settings.githubAccess} onChange={(v) => updateSetting("githubAccess", v)} />
          <ToggleRow title="Deployment approval" description="Require approval before deploying" checked={settings.deployApproval} onChange={(v) => updateSetting("deployApproval", v)} />
        </div>
      </SettingsCard>

      {/* Save / Discard bar */}
      <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-xl border p-3"
        style={{
          borderColor: hasUnsavedChanges ? `${T.accentColor}40` : "rgba(255,255,255,0.06)",
          backgroundColor: "rgba(10,10,15,0.95)",
          backdropFilter: "blur(8px)",
        }}>
        <div className="flex items-center gap-2">
          {saveStatus === "saved" && <Check size={14} style={{ color: T.accentColor }} />}
          {saveStatus === "saving" && <Loader2 size={14} className="animate-spin" style={{ color: T.accentColor }} />}
          <span className="text-[11px]" style={{
            color: saveStatus === "error" ? "#ef4444"
              : saveStatus === "saved" ? T.accentColor
              : hasUnsavedChanges ? "rgba(255,255,255,0.6)"
              : "rgba(255,255,255,0.3)",
          }}>
            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Save failed" : hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
          </span>
        </div>
        <div className="flex gap-2">
          {hasUnsavedChanges && (
            <button type="button" onClick={handleDiscard}
              className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all"
              style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
              Discard
            </button>
          )}
          <button type="button" onClick={handleSave} disabled={!hasUnsavedChanges || saveStatus === "saving"}
            className="rounded-lg px-4 py-1.5 text-[11px] font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
            {saveStatus === "saving" ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Voice & Camera ────────────────────────────────────────────────── */

function VoiceCameraSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [micStatus, setMicStatus] = useState<"unknown" | "available" | "denied" | "error">("unknown");
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>("default");
  const [cameraStatus, setCameraStatus] = useState<"unknown" | "available" | "denied" | "error" | "unsupported">("unknown");
  const [voiceSettings, setVoiceSettings] = useState({
    autoSend: false,
    silenceTimeout: 2000,
    bargeIn: true,
    playbackSpeed: "normal",
    spokenLength: "medium",
  });
  const [voicePreviewing, setVoicePreviewing] = useState<string | null>(null);
  const [inworldStatus, setInworldStatus] = useState<{
    configured: boolean;
    apiKey: boolean;
    littVoice: boolean;
    sparkVoice: boolean;
    wsUrl: boolean;
  } | null>(null);
  const [connectionTest, setConnectionTest] = useState<{
    state: "idle" | "testing" | "ok" | "fail";
    message: string;
    latencyMs?: number;
  }>({ state: "idle", message: "" });

  useEffect(() => {
    fetch("/api/voice/token", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (data.details) {
          setInworldStatus({
            configured: data.configured ?? false,
            apiKey: data.details.apiKey ?? false,
            littVoice: data.details.littVoice ?? false,
            sparkVoice: data.details.sparkVoice ?? false,
            wsUrl: data.details.wsUrl ?? false,
          });
        }
      })
      .catch(() => {});
  }, []);

  const testMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicStatus("available");
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(devices.filter((d) => d.kind === "audioinput"));
    } catch (err) {
      setMicStatus(err instanceof DOMException && err.name === "NotAllowedError" ? "denied" : "error");
    }
  }, []);

  const testCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      setCameraStatus("available");
    } catch (err) {
      setCameraStatus(err instanceof DOMException && err.name === "NotAllowedError" ? "denied" : "error");
    }
  }, []);

  // Read existing permission state via Permissions API (no prompt).
  // Never call getUserMedia automatically on mount — that would trigger
  // both mic and camera permission popups just by rendering this section.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    let active = true;
    const queryMic = navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((r) => {
        if (!active) return;
        if (r.state === "granted") setMicStatus("available");
        else if (r.state === "denied") setMicStatus("denied");
      })
      .catch(() => {});
    const queryCam = navigator.permissions
      .query({ name: "camera" as PermissionName })
      .then((r) => {
        if (!active) return;
        if (r.state === "granted") setCameraStatus("available");
        else if (r.state === "denied") setCameraStatus("denied");
      })
      .catch(() => {});
    return () => {
      active = false;
      void queryMic;
      void queryCam;
    };
  }, []);

  const previewVoice = useCallback(async (agentId: "litt" | "spark") => {
    setVoicePreviewing(agentId);
    try {
      const sampleText = agentId === "litt"
        ? "Connection established. I'm scanning the project now."
        : "Oh, that's clean. The preview is live.";

      // Use browser speechSynthesis for preview — the real voice is Inworld's
      // live realtime API, which can't be previewed with a simple TTS call.
      // This browser preview gives a rough idea of pacing/tone.
      if (typeof window !== "undefined" && window.speechSynthesis) {
        const { pickBrowserVoice, getBrowserVoiceConfig } = await import("@/features/voice/lib/voiceConfig");
        const synth = window.speechSynthesis;
        const config = getBrowserVoiceConfig(agentId);
        const speak = () => {
          const voice = pickBrowserVoice(synth.getVoices(), agentId);
          const utt = new SpeechSynthesisUtterance(sampleText);
          utt.rate = config.rate;
          utt.pitch = config.pitch;
          utt.volume = config.volume;
          if (voice) { utt.voice = voice; utt.lang = voice.lang; }
          utt.onend = () => setVoicePreviewing(null);
          utt.onerror = () => setVoicePreviewing(null);
          synth.cancel();
          synth.speak(utt);
        };
        if (synth.getVoices().length > 0) speak();
        else {
          synth.onvoiceschanged = () => { synth.onvoiceschanged = null; speak(); };
          setTimeout(() => { if (synth.getVoices().length > 0) speak(); else setVoicePreviewing(null); }, 1000);
        }
      } else {
        setVoicePreviewing(null);
      }
    } catch {
      setVoicePreviewing(null);
    }
  }, []);

  const testConnection = useCallback(async () => {
    setConnectionTest({ state: "testing", message: "Connecting to voice proxy…" });
    const startTime = Date.now();
    try {
      // 1. Get auth token
      const tokenRes = await fetch("/api/voice/token", { cache: "no-store" });
      if (!tokenRes.ok) {
        setConnectionTest({ state: "fail", message: `Auth failed (${tokenRes.status})` });
        return;
      }
      const { token } = await tokenRes.json();
      if (!token) {
        setConnectionTest({ state: "fail", message: "No voice token returned" });
        return;
      }

      // 2. Open WebSocket to the proxy
      const wsUrl = process.env.NEXT_PUBLIC_VOICE_WS_URL;
      if (!wsUrl) {
        setConnectionTest({ state: "fail", message: "NEXT_PUBLIC_VOICE_WS_URL not set" });
        return;
      }
      const fullUrl = wsUrl + (wsUrl.includes("?") ? "&" : "?") + `token=${encodeURIComponent(token)}`;

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(fullUrl);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Connection timed out (10s)"));
        }, 10_000);

        let gotSessionCreated = false;

        ws.onopen = () => {
          setConnectionTest({ state: "testing", message: "WebSocket open — waiting for Inworld session…" });
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "session.created") {
              gotSessionCreated = true;
              setConnectionTest({ state: "testing", message: "Session created — configuring voice…" });
              // Send a minimal session.update to verify the full round-trip
              ws.send(JSON.stringify({
                type: "session.update",
                session: {
                  type: "realtime",
                  model: "inworld/models/gemma-4-26b-a4b-it",
                  instructions: "You are a test. Reply with: ok.",
                  output_modalities: ["audio"],
                  audio: {
                    input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: "assemblyai/u3-rt-pro" }, turn_detection: { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false } },
                    output: { format: { type: "audio/pcm", rate: 24000 }, model: "inworld-tts-2", voice: "inworld_tts_pro" },
                  },
                },
              }));
            } else if (data.type === "session.updated" && gotSessionCreated) {
              const latency = Date.now() - startTime;
              clearTimeout(timeout);
              ws.close(1000, "Test complete");
              setConnectionTest({ state: "ok", message: "Voice connection verified end-to-end", latencyMs: latency });
              resolve();
            } else if (data.type === "error") {
              clearTimeout(timeout);
              ws.close();
              reject(new Error(data.message || data.error || "Inworld session error"));
            }
          } catch {
            // Non-JSON — ignore
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket error"));
        };

        ws.onclose = (event) => {
          clearTimeout(timeout);
          if (!gotSessionCreated) {
            reject(new Error(`Connection closed (code ${event.code}) before session was created`));
          } else {
            resolve();
          }
        };
      });
    } catch (err) {
      setConnectionTest({
        state: "fail",
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    }
  }, []);

  const resetVoice = useCallback(() => {
    if (typeof window !== "undefined") {
      try { localStorage.removeItem("litt-voice-browser-selection"); } catch { /* non-fatal */ }
    }
  }, []);

  const micStatusInfo = {
    available: { color: "#22c55e", label: "Available", desc: "Microphone is ready" },
    denied: { color: "#ef4444", label: "Permission denied", desc: "Allow microphone access in your browser" },
    error: { color: "#ef4444", label: "Error", desc: "Microphone test failed. Check your device." },
    unknown: { color: "#6b7280", label: "Unknown", desc: "Testing…" },
  }[micStatus];

  const camStatusInfo = {
    available: { color: "#22c55e", label: "Available", desc: "Camera is ready" },
    denied: { color: "#ef4444", label: "Permission denied", desc: "Allow camera access in your browser" },
    error: { color: "#ef4444", label: "Error", desc: "Camera test failed. Check your device." },
    unsupported: { color: "#6b7280", label: "Unsupported", desc: "Camera API not available on this device" },
    unknown: { color: "#6b7280", label: "Unknown", desc: "Testing…" },
  }[cameraStatus];

  return (
    <div className="space-y-4">
      {/* Microphone */}
      <SettingsCard title="Microphone" description="Input device and permission" icon={<Mic size={16} />}>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/2 px-3 py-2.5">
            <div>
              <div className="text-xs font-bold text-white/80">Status: {micStatusInfo.label}</div>
              <div className="text-[10px] text-white/40">{micStatusInfo.desc}</div>
            </div>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: micStatusInfo.color }} />
          </div>
          {micDevices.length > 0 && (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Selected device</span>
              <select
                value={selectedMic}
                onChange={(e) => setSelectedMic(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none"
              >
                {micDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0, 8)}`}</option>
                ))}
              </select>
            </div>
          )}
          <button type="button" onClick={testMic}
            className="rounded-lg border px-3 py-1.5 text-xs font-bold transition-all"
            style={{ borderColor: `${T.accentColor}40`, color: T.accentColor }}>
            Test microphone
          </button>
        </div>
      </SettingsCard>

      {/* Mic & mixer */}
      <SettingsCard title="Mic & mixer" description="Input device, gain, mute, and output volume" icon={<Volume2 size={16} />}>
        <MicMixerPanel accentColor={T.accentColor} />
      </SettingsCard>

      {/* Camera */}
      <SettingsCard title="Camera" description="Camera device and permission" icon={<Camera size={16} />}>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/2 px-3 py-2.5">
            <div>
              <div className="text-xs font-bold text-white/80">Status: {camStatusInfo.label}</div>
              <div className="text-[10px] text-white/40">{camStatusInfo.desc}</div>
            </div>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: camStatusInfo.color }} />
          </div>
          <button type="button" onClick={testCamera}
            className="rounded-lg border px-3 py-1.5 text-xs font-bold transition-all"
            style={{ borderColor: `${T.accentColor}40`, color: T.accentColor }}>
            Test camera
          </button>
        </div>
      </SettingsCard>

      {/* Agent voice */}
      <SettingsCard title="Agent voice" description="LiTT and Spark voice identity" icon={<Volume2 size={16} />}>
        <div className="space-y-3">
          <p className="text-[10px] text-white/40">
            Voice is powered by Inworld realtime API. Preview uses your browser&apos;s built-in speech synthesis for a rough demo — the actual voice in the Studio is Inworld&apos;s neural voice.
          </p>
          {[
            { id: "litt" as const, name: "LiTT", style: "Deep · Calm · Precise", color: "#06b6d4", sample: "Connection established. I'm scanning the project now." },
            { id: "spark" as const, name: "Spark", style: "Bright · Warm · Expressive", color: "#22c55e", sample: "Oh, that's clean. The preview is live." },
          ].map((agent) => (
            <div key={agent.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5"
              style={{ borderColor: `${agent.color}30`, backgroundColor: `${agent.color}08` }}>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-black" style={{ color: agent.color }}>{agent.name}</div>
                <div className="text-[10px] text-white/40">{agent.style}</div>
              </div>
              <button
                type="button"
                onClick={() => previewVoice(agent.id)}
                disabled={voicePreviewing === agent.id}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80 disabled:opacity-40"
                style={{ backgroundColor: `${agent.color}20`, color: agent.color }}
              >
                {voicePreviewing === agent.id ? "Playing…" : "Preview"}
              </button>
            </div>
          ))}

          {inworldStatus && (
            <div className="rounded-lg border border-white/5 bg-black/30 px-3 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Voice provider status (Inworld)</div>
              <div className="mt-1.5 space-y-1 text-[10px] text-white/60">
                <div>API Key: <span className={inworldStatus.apiKey ? "text-emerald-400" : "text-red-400"}>{inworldStatus.apiKey ? "Set" : "Missing"}</span></div>
                <div>LiTT Voice: <span className={inworldStatus.littVoice ? "text-emerald-400" : "text-red-400"}>{inworldStatus.littVoice ? "Set" : "Missing"}</span></div>
                <div>Spark Voice: <span className={inworldStatus.sparkVoice ? "text-emerald-400" : "text-red-400"}>{inworldStatus.sparkVoice ? "Set" : "Missing"}</span></div>
                <div>WebSocket URL: <span className={inworldStatus.wsUrl ? "text-emerald-400" : "text-red-400"}>{inworldStatus.wsUrl ? "Set" : "Missing"}</span></div>
                {inworldStatus.configured ? (
                  <div className="mt-1.5 text-emerald-400">Inworld realtime voice is configured and ready.</div>
                ) : (
                  <div className="mt-1.5 text-amber-400">
                    Inworld is not configured. Set INWORLD_API_KEY, INWORLD_LITT_VOICE, and INWORLD_SPARK_VOICE in Vercel env.
                  </div>
                )}
              </div>

              {/* Connection test button + result */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={connectionTest.state === "testing"}
                  className="rounded-lg border px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-40"
                  style={{
                    borderColor: connectionTest.state === "ok" ? "#22c55e40" : connectionTest.state === "fail" ? "#ef444440" : `${T.accentColor}40`,
                    color: connectionTest.state === "ok" ? "#22c55e" : connectionTest.state === "fail" ? "#ef4444" : T.accentColor,
                  }}
                >
                  {connectionTest.state === "testing" ? (
                    <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Testing…</span>
                  ) : connectionTest.state === "ok" ? (
                    <span className="flex items-center gap-1.5"><Check size={12} /> Test again</span>
                  ) : connectionTest.state === "fail" ? (
                    <span className="flex items-center gap-1.5"><Zap size={12} /> Retry test</span>
                  ) : (
                    <span className="flex items-center gap-1.5"><Zap size={12} /> Test voice connection</span>
                  )}
                </button>
                {connectionTest.state !== "idle" && connectionTest.state !== "testing" && (
                  <span
                    className="text-[10px] font-medium"
                    style={{ color: connectionTest.state === "ok" ? "#22c55e" : "#ef4444" }}
                  >
                    {connectionTest.message}
                    {connectionTest.latencyMs ? ` (${connectionTest.latencyMs}ms)` : ""}
                  </span>
                )}
                {connectionTest.state === "testing" && (
                  <span className="text-[10px] font-medium text-white/50">{connectionTest.message}</span>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={resetVoice}
            className="flex items-center gap-1.5 rounded-lg border border-red-400/20 px-3 py-1.5 text-xs font-bold text-red-300 transition-all hover:bg-red-400/10"
          >
            <RotateCcw size={12} className="pointer-events-none" />
            Reset LiTT voice to official default
          </button>
        </div>
      </SettingsCard>

      {/* Voice settings */}
      <SettingsCard title="Voice" description="Speech and playback" icon={<Volume2 size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Auto-send" description="Send message when you stop speaking" checked={voiceSettings.autoSend} onChange={(v) => setVoiceSettings({ ...voiceSettings, autoSend: v })} />
          <ToggleRow title="Barge-in" description="Speak to interrupt AI response" checked={voiceSettings.bargeIn} onChange={(v) => setVoiceSettings({ ...voiceSettings, bargeIn: v })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Silence timeout (ms)</span>
              <input type="number" value={voiceSettings.silenceTimeout} onChange={(e) => setVoiceSettings({ ...voiceSettings, silenceTimeout: +e.target.value })}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Playback speed</span>
              <div className="mt-1 flex gap-2">
                {["slow", "normal", "fast"].map((v) => (
                  <button key={v} type="button" onClick={() => setVoiceSettings({ ...voiceSettings, playbackSpeed: v })}
                    className="rounded-lg border px-3 py-1.5 text-[10px] font-bold capitalize"
                    style={{ borderColor: voiceSettings.playbackSpeed === v ? T.accentColor : "rgba(255,255,255,0.08)", color: voiceSettings.playbackSpeed === v ? T.accentColor : "rgba(255,255,255,0.5)" }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Spoken response length</span>
            <div className="mt-1 flex gap-2">
              {["short", "medium", "long"].map((v) => (
                <button key={v} type="button" onClick={() => setVoiceSettings({ ...voiceSettings, spokenLength: v })}
                  className="rounded-lg border px-3 py-1.5 text-[10px] font-bold capitalize"
                  style={{ borderColor: voiceSettings.spokenLength === v ? T.accentColor : "rgba(255,255,255,0.08)", color: voiceSettings.spokenLength === v ? T.accentColor : "rgba(255,255,255,0.5)" }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Connections ───────────────────────────────────────────────────── */

function ConnectionsSection({ T: _T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const { status, loading, error } = useIntegrationStatus();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/40">
        <Loader2 size={14} className="animate-spin" />
        Checking integration status…
      </div>
    );
  }

  if (error && status.integrations.length === 0) {
    return (
      <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">
        Failed to load integration status: {error}
      </div>
    );
  }

  const required = status.integrations.filter((i) => i.category === "required");
  const code = status.integrations.filter((i) => i.category === "code");
  const ai = status.integrations.filter((i) => i.category === "ai");
  const optional = status.integrations.filter((i) => i.category === "optional");
  const runtime = status.integrations.filter((i) => i.category === "runtime");

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {status.summary && <IntegrationSummaryBar summary={status.summary} />}

      {/* Required */}
      {required.length > 0 && (
        <SettingsCard title="Platform services" description="Required for core Studio operation">
          <div className="grid gap-3 sm:grid-cols-2">
            {required.map((i) => (
              <IntegrationCard key={i.id} integration={i} />
            ))}
          </div>
        </SettingsCard>
      )}

      {/* Code workspace */}
      {code.length > 0 && (
        <SettingsCard title="Code workspace" description="Required for repository and terminal features">
          <div className="grid gap-3 sm:grid-cols-2">
            {code.map((i) => (
              <IntegrationCard key={i.id} integration={i} />
            ))}
          </div>
        </SettingsCard>
      )}

      {/* Runtime */}
      {runtime.length > 0 && (
        <SettingsCard title="Runtime" description="Terminal and workspace execution">
          <div className="grid gap-3 sm:grid-cols-2">
            {runtime.map((i) => (
              <IntegrationCard key={i.id} integration={i} />
            ))}
          </div>
        </SettingsCard>
      )}

      {/* AI providers */}
      {ai.length > 0 && (
        <SettingsCard title="AI providers" description="At least one required for chat and generation">
          <div className="grid gap-3 sm:grid-cols-2">
            {ai.map((i) => (
              <IntegrationCard key={i.id} integration={i} />
            ))}
          </div>
        </SettingsCard>
      )}

      {/* Optional */}
      {optional.length > 0 && (
        <SettingsCard title="Optional services" description="Add-on integrations — not required for core operation">
          <div className="grid gap-3 sm:grid-cols-2">
            {optional.map((i) => (
              <IntegrationCard key={i.id} integration={i} />
            ))}
          </div>
        </SettingsCard>
      )}
    </div>
  );
}

/* ── Automation ────────────────────────────────────────────────────── */

function AutomationSection({ T: _T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [s, update] = useLocalSettings("automation", {
    autoRunTests: false,
    autoOpenPreview: true,
    autoSave: true,
    requireDeployApproval: true,
    requireFileWriteApproval: false,
    autoRetry: true,
    maxRetries: 3,
  });

  return (
    <div className="space-y-4">
      <SettingsCard title="Workflow automation" description="Auto-run rules and triggers" icon={<Zap size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Auto-run tests" description="Run tests on file changes" checked={s.autoRunTests} onChange={(v) => update("autoRunTests", v)} />
          <ToggleRow title="Auto-open preview" description="Open preview after build" checked={s.autoOpenPreview} onChange={(v) => update("autoOpenPreview", v)} />
          <ToggleRow title="Auto-save" description="Save changes automatically" checked={s.autoSave} onChange={(v) => update("autoSave", v)} />
        </div>
      </SettingsCard>
      <SettingsCard title="Approval rules" description="When to ask before acting">
        <div className="space-y-3">
          <ToggleRow title="Require deployment approval" description="Ask before deploying to production" checked={s.requireDeployApproval} onChange={(v) => update("requireDeployApproval", v)} />
          <ToggleRow title="Require file write approval" description="Ask before modifying files" checked={s.requireFileWriteApproval} onChange={(v) => update("requireFileWriteApproval", v)} />
        </div>
      </SettingsCard>
      <SettingsCard title="Failure recovery" description="What happens when things go wrong">
        <div className="space-y-3">
          <ToggleRow title="Auto-retry on failure" description="Retry failed operations" checked={s.autoRetry} onChange={(v) => update("autoRetry", v)} />
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Max retries</span>
            <div className="mt-1 flex gap-2">
              {[1, 2, 3, 5].map((n) => (
                <button key={n} type="button" onClick={() => update("maxRetries", n)}
                  className="rounded-lg border px-3 py-1.5 text-[10px] font-bold"
                  style={{ borderColor: s.maxRetries === n ? _T.accentColor : "rgba(255,255,255,0.08)", color: s.maxRetries === n ? _T.accentColor : "rgba(255,255,255,0.5)" }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Notifications ─────────────────────────────────────────────────── */

function NotificationsSection({ T: _T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [s, update] = useLocalSettings("notifications", {
    browserNotifications: true,
    emailNotifications: false,
    missionCompletion: true,
    deploymentFailures: true,
    connectionErrors: true,
    billingUsage: false,
    securityAlerts: true,
    quietHoursEnabled: false,
    quietStart: "22:00",
    quietEnd: "08:00",
  });

  return (
    <div className="space-y-4">
      <SettingsCard title="Alerts" description="What you get notified about" icon={<Bell size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Browser notifications" description="Show desktop notifications" checked={s.browserNotifications} onChange={(v) => update("browserNotifications", v)} />
          <ToggleRow title="Email notifications" description="Send alerts to your email" checked={s.emailNotifications} onChange={(v) => update("emailNotifications", v)} />
          <ToggleRow title="Mission completion" description="When a mission finishes" checked={s.missionCompletion} onChange={(v) => update("missionCompletion", v)} />
          <ToggleRow title="Deployment failures" description="When a deployment fails" checked={s.deploymentFailures} onChange={(v) => update("deploymentFailures", v)} />
          <ToggleRow title="Connection errors" description="When a service disconnects" checked={s.connectionErrors} onChange={(v) => update("connectionErrors", v)} />
          <ToggleRow title="Billing usage" description="When you approach spend limits" checked={s.billingUsage} onChange={(v) => update("billingUsage", v)} />
          <ToggleRow title="Security alerts" description="Suspicious activity on your account" checked={s.securityAlerts} onChange={(v) => update("securityAlerts", v)} />
        </div>
      </SettingsCard>
      <SettingsCard title="Quiet hours" description="Mute notifications during specific times">
        <div className="space-y-3">
          <ToggleRow title="Enable quiet hours" description="Mute notifications during a time window" checked={s.quietHoursEnabled} onChange={(v) => update("quietHoursEnabled", v)} />
          {s.quietHoursEnabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <SettingsInput label="Start" value={s.quietStart} onChange={(v) => update("quietStart", v)} type="time" />
              <SettingsInput label="End" value={s.quietEnd} onChange={(v) => update("quietEnd", v)} type="time" />
            </div>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Billing & LiTTBits ─────────────────────────────────────────────── */

type BillingData = {
  plan: {
    id: string;
    name: string;
    monthlyPriceCents: number | null;
    monthlyCredits: number;
    beta: boolean;
  } | null;
  subscription: {
    status: string;
    stripe_customer_id: string | null;
    current_period_end: string | null;
  } | null;
  balances: {
    monthly: number;
    purchased: number;
    beta_promotional: number;
    total: number;
  } | null;
};

function BillingSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/subscription", { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setData(json);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePortal = useCallback(async () => {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
    } catch {
      // silent
    } finally {
      setPortalLoading(false);
    }
  }, []);

  const planName = data?.plan?.name ?? "Starter";
  const planPrice = data?.plan?.monthlyPriceCents ?? 0;
  const isPaid = planPrice !== null && planPrice > 0;
  const balances = data?.balances;
  const totalBalance = balances?.total ?? 0;
  const monthlyBalance = balances?.monthly ?? 0;
  const purchasedBalance = balances?.purchased ?? 0;
  const betaBalance = balances?.beta_promotional ?? 0;
  const subStatus = data?.subscription?.status ?? "none";
  const periodEnd = data?.subscription?.current_period_end;

  return (
    <div className="space-y-4">
      {/* Current Plan */}
      <SettingsCard title="Plan" description="Current subscription" icon={<Coins size={16} />}>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-xl border px-4 py-3"
              style={{ borderColor: `${T.accentColor}30`, backgroundColor: `${T.accentColor}08` }}>
              <div>
                <div className="text-sm font-black" style={{ color: T.accentColor }}>{planName}</div>
                <div className="text-[10px] text-white/40">
                  {isPaid ? `$${(planPrice / 100).toFixed(0)}/month` : "Free"}
                  {data?.plan?.beta && " · Beta"}
                </div>
                {subStatus === "active" && periodEnd && (
                  <div className="mt-1 text-[10px] text-white/30">
                    Renews {new Date(periodEnd).toLocaleDateString()}
                  </div>
                )}
                {subStatus === "canceled" && (
                  <div className="mt-1 text-[10px] text-amber-400/70">Canceled — access until period end</div>
                )}
                {subStatus === "past_due" && (
                  <div className="mt-1 text-[10px] text-red-400/70">Payment past due</div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Link href="/pricing" className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-bold text-white/70 transition hover:bg-white/5">
                  {isPaid ? "Change plan" : "Upgrade"}
                </Link>
                {isPaid && (
                  <button
                    onClick={handlePortal}
                    disabled={portalLoading}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-bold text-white/70 transition hover:bg-white/5 disabled:opacity-50"
                  >
                    {portalLoading ? "Loading…" : "Manage billing"}
                  </button>
                )}
              </div>
            </div>
            {subStatus === "canceled" && (
              <p className="mt-2 text-[10px] text-white/40">
                Your projects and data are preserved. You can resubscribe anytime.
              </p>
            )}
          </>
        )}
      </SettingsCard>

      {/* AI Credits Balance */}
      <SettingsCard title="AI Credits" description="Platform credits for AI actions">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="rounded-xl border p-4" style={{ borderColor: `${T.accentColor}30`, backgroundColor: `${T.accentColor}08` }}>
              <div className="text-2xl font-black" style={{ color: T.accentColor }}>{totalBalance.toLocaleString()} credits</div>
              <p className="mt-1 text-xs text-white/40">
                {betaBalance > 0 && `Includes ${betaBalance.toLocaleString()} Beta credits (no cash value)`}
                {betaBalance === 0 && "Available balance"}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-white/5 bg-white/2 px-3 py-2 text-center">
                <div className="text-sm font-bold text-white/80">{monthlyBalance.toLocaleString()}</div>
                <div className="text-[9px] uppercase tracking-wider text-white/40">Monthly</div>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/2 px-3 py-2 text-center">
                <div className="text-sm font-bold text-white/80">{purchasedBalance.toLocaleString()}</div>
                <div className="text-[9px] uppercase tracking-wider text-white/40">Purchased</div>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/2 px-3 py-2 text-center">
                <div className="text-sm font-bold text-white/80">{betaBalance.toLocaleString()}</div>
                <div className="text-[9px] uppercase tracking-wider text-white/40">Beta</div>
              </div>
            </div>
            {betaBalance > 0 && (
              <p className="mt-2 text-[10px] text-white/30">
                Beta credits are consumed after paid credits. Expiration is defined per grant.
              </p>
            )}
          </>
        )}
      </SettingsCard>

      {/* Usage */}
      <SettingsCard title="Usage" description="Model consumption and activity">
        <div className="space-y-2">
          {[
            { label: "Chat messages", value: "0 this month" },
            { label: "Image generations", value: "0 this month" },
            { label: "Agent tasks", value: "0 this month" },
          ].map((u) => (
            <div key={u.label} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/2 px-3 py-2.5">
              <span className="text-xs font-bold text-white/80">{u.label}</span>
              <span className="text-[10px] text-white/40">{u.value}</span>
            </div>
          ))}
        </div>
        <Link href="/pricing" className="mt-3 inline-block text-xs font-bold" style={{ color: T.accentColor }}>
          View plans and pricing →
        </Link>
      </SettingsCard>
    </div>
  );
}

/* ── Privacy & Security ────────────────────────────────────────────── */

function PrivacySection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [privacy, updatePrivacy] = useLocalSettings("privacy", {
    analyticsOptIn: false,
    publicProfile: true,
    conversationStorage: true,
    memoryUsage: true,
  });

  const handleExport = async () => {
    setExporting(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/account/export", { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "litlabs-data-export.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMsg("Your data has been exported.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Delete failed");
      }
      setStatusMsg("Your data has been deleted. You will be signed out shortly.");
      // Give the user a moment to read the message, then sign out
      setTimeout(() => {
        window.location.href = "/";
      }, 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <SettingsCard title="Data privacy" description="Control your data" icon={<Shield size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Analytics opt-in" description="Share usage data to improve LiTTree" checked={privacy.analyticsOptIn} onChange={(v) => updatePrivacy("analyticsOptIn", v)} />
          <ToggleRow title="Public profile" description="Make your profile visible to others" checked={privacy.publicProfile} onChange={(v) => updatePrivacy("publicProfile", v)} />
          <ToggleRow title="Conversation storage" description="Save conversations to your account" checked={privacy.conversationStorage} onChange={(v) => updatePrivacy("conversationStorage", v)} />
          <ToggleRow title="Memory usage" description="Allow agents to remember context" checked={privacy.memoryUsage} onChange={(v) => updatePrivacy("memoryUsage", v)} />
        </div>
      </SettingsCard>

      <SettingsCard title="Active sessions" description="Devices logged into your account">
        <p className="text-xs text-white/40">Manage your active sessions across devices. Sign out remotely from the Clerk account page.</p>
        <Link href="/account" className="mt-2 inline-block text-xs font-bold" style={{ color: T.accentColor }}>Manage sessions →</Link>
      </SettingsCard>

      <SettingsCard title="Data management" description="Export or delete your data (GDPR)">
        {statusMsg && (
          <div className="mb-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-2.5 text-xs text-emerald-300">
            {statusMsg}
          </div>
        )}
        {errorMsg && (
          <div className="mb-3 rounded-lg border border-red-400/20 bg-red-400/5 p-2.5 text-xs text-red-300">
            {errorMsg}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || deleting}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/60 hover:bg-white/5 disabled:opacity-50"
          >
            {exporting && <Loader2 size={12} className="animate-spin" />}
            {exporting ? "Exporting..." : "Export data"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(!confirmDelete)}
            disabled={exporting || deleting}
            className="rounded-lg border border-red-400/20 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-400/10 disabled:opacity-50"
          >
            Delete all data
          </button>
        </div>
        {confirmDelete && (
          <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/5 p-3">
            <p className="text-xs text-red-300">
              This permanently deletes all your conversations, memories, project data, and credit history from our database.
              Your Clerk auth account must be deleted separately via the Clerk dashboard. This cannot be undone.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {deleting && <Loader2 size={12} className="animate-spin" />}
                {deleting ? "Deleting..." : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/60 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Audit log" description="Recent account activity">
        <p className="text-xs text-white/40">No recent activity logged.</p>
      </SettingsCard>
    </div>
  );
}

/* ── Performance ───────────────────────────────────────────────────── */

function PerformanceSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [s, update] = useLocalSettings("performance", {
    perfMode: "auto" as "battery" | "balanced" | "high" | "auto",
    reduceAnimation: false,
    reduceBackgroundEffects: false,
    lazyLoadTools: true,
    pauseInBackground: true,
    lowerPreviewQuality: false,
  });

  const perfOptions = [
    { id: "battery" as const, label: "Battery", desc: "Minimize effects and animations" },
    { id: "balanced" as const, label: "Balanced", desc: "Recommended for most devices" },
    { id: "high" as const, label: "High", desc: "Full effects and animations" },
    { id: "auto" as const, label: "Auto", desc: "Detect based on device" },
  ];

  return (
    <div className="space-y-4">
      <SettingsCard title="Performance mode" description="Adjust visual effects and speed" icon={<Gauge size={16} />}>
        <div className="space-y-2">
          {perfOptions.map((opt) => (
            <button key={opt.id} type="button" onClick={() => update("perfMode", opt.id)}
              className="flex w-full items-center justify-between rounded-xl border p-3 text-left transition-all"
              style={{ borderColor: s.perfMode === opt.id ? `${T.accentColor}40` : "rgba(255,255,255,0.06)", backgroundColor: s.perfMode === opt.id ? `${T.accentColor}10` : "transparent" }}>
              <div>
                <div className="text-xs font-bold" style={{ color: s.perfMode === opt.id ? T.accentColor : "rgba(255,255,255,0.8)" }}>{opt.label}</div>
                <div className="text-[10px] text-white/40">{opt.desc}</div>
              </div>
              {s.perfMode === opt.id && <Check size={14} style={{ color: T.accentColor }} />}
            </button>
          ))}
        </div>
        <div className="mt-3 rounded-lg border border-white/5 bg-white/2 px-3 py-2">
          <span className="text-[10px] text-white/40">Recommended: </span>
          <span className="text-[10px] font-bold text-white/60">Balanced</span>
        </div>
      </SettingsCard>

      <SettingsCard title="Controls" description="Fine-tune performance">
        <div className="space-y-3">
          <ToggleRow title="Reduce animation" description="Minimize motion and transitions" checked={s.reduceAnimation || s.perfMode === "battery"} onChange={(v) => update("reduceAnimation", v)} />
          <ToggleRow title="Reduce background effects" description="Disable particles and animated backgrounds" checked={s.reduceBackgroundEffects || s.perfMode === "battery"} onChange={(v) => update("reduceBackgroundEffects", v)} />
          <ToggleRow title="Lazy-load heavy tools" description="Defer loading Studio tools until needed" checked={s.lazyLoadTools} onChange={(v) => update("lazyLoadTools", v)} />
          <ToggleRow title="Pause effects in background" description="Stop animations when tab is not visible" checked={s.pauseInBackground} onChange={(v) => update("pauseInBackground", v)} />
          <ToggleRow title="Lower preview quality" description="Reduce preview rendering quality" checked={s.lowerPreviewQuality} onChange={(v) => update("lowerPreviewQuality", v)} />
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Advanced ──────────────────────────────────────────────────────── */

function AdvancedSection({ T: _T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [dev, updateDev] = useLocalSettings("developer", {
    debugMode: false,
    verboseLogging: false,
    experimentalFeatures: false,
  });
  const [flags, updateFlag] = useLocalSettings("feature-flags", {
    maintenanceMode: false,
    newRegistration: true,
    marketplace: true,
    betaMode: true,
    billingEnabled: false,
  });

  return (
    <div className="space-y-4">
      <SettingsCard title="Developer options" description="Advanced overrides" icon={<Terminal size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Debug mode" description="Show debug information in UI" checked={dev.debugMode} onChange={(v) => updateDev("debugMode", v)} />
          <ToggleRow title="Verbose logging" description="Detailed console output" checked={dev.verboseLogging} onChange={(v) => updateDev("verboseLogging", v)} />
          <ToggleRow title="Experimental features" description="Enable beta features" checked={dev.experimentalFeatures} onChange={(v) => updateDev("experimentalFeatures", v)} />
        </div>
      </SettingsCard>

      <SettingsCard title="Feature flags" description="Enable or disable platform features">
        <div className="space-y-3">
          <ToggleRow title="Maintenance mode" description="Take the platform offline" checked={flags.maintenanceMode} onChange={(v) => updateFlag("maintenanceMode", v)} />
          <ToggleRow title="New user registration" description="Allow new signups" checked={flags.newRegistration} onChange={(v) => updateFlag("newRegistration", v)} />
          <ToggleRow title="Marketplace" description="Enable marketplace" checked={flags.marketplace} onChange={(v) => updateFlag("marketplace", v)} />
          <ToggleRow title="Beta mode" description="Show beta features to all users" checked={flags.betaMode} onChange={(v) => updateFlag("betaMode", v)} />
          <ToggleRow title="Billing enablement" description="Allow purchases (disabled in beta)" checked={flags.billingEnabled} onChange={(v) => updateFlag("billingEnabled", v)} />
        </div>
      </SettingsCard>

      <SettingsCard title="Provider fallback" description="AI model fallback chain">
        <div className="space-y-2">
          {["Gemini 2.5 Flash", "Groq Llama 70B", "OpenRouter Free"].map((p, i) => (
            <div key={p} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/2 px-3 py-2.5">
              <span className="text-[10px] font-bold text-white/30">{i + 1}.</span>
              <span className="text-xs font-bold text-white/80">{p}</span>
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Diagnostics" description="System health and capability states">
        <div className="space-y-2">
          {["Raw capability states", "Debug logs", "API configuration", "Terminal diagnostics", "Worker status", "Queue status", "Cache controls", "Database tools"].map((item) => (
            <button key={item} type="button"
              className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-bold transition-all hover:bg-white/5"
              style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}>
              {item}
              <ChevronRight size={12} className="pointer-events-none text-white/30" />
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Reset" description="Reset all settings">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Reset current section", scope: "section" },
            { label: "Reset current page", scope: "page" },
            { label: "Reset all settings", scope: "all" },
          ].map((reset) => (
            <button key={reset.scope} type="button"
              className="flex items-center gap-1.5 rounded-lg border border-red-400/20 px-3 py-1.5 text-xs font-bold text-red-300 transition-all hover:bg-red-400/10">
              <RotateCcw size={12} className="pointer-events-none" />
              {reset.label}
            </button>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── System Control removed — feature flags and system health
       moved into Advanced section ─────────────────────────────────── */

