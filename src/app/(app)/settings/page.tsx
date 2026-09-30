"use client";

import Image from "next/image";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerk, useUser } from "@clerk/nextjs";
import { useClerkAuthContext } from "@/context/ClerkAuthContext";
import { brand } from "@/lib/design/litt-tokens";

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
import {
  LayoutGrid, User, Palette, Sparkles, Briefcase,
  Cpu, Bot, Mic, Plug, Zap, Bell, Coins, Shield, Gauge, Terminal,
  Search, ChevronRight, Check, Loader2, X,
  RotateCcw, ArrowLeft, Camera, Volume2,
  Monitor, Moon, Sun,
} from "lucide-react";
import {
  useSettingsStore,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/stores/useSettingsStore";
import {
  accentLabel,
  themeModeLabel,
  accountCardValue,
  securityCardValue,
  micCardValue,
  resetAllLocalSettings,
} from "./settingsHelpers";
import {
  SettingsCard,
  SectionHeader,
  ToggleRow,
  SettingsInput,
  StatusBadge,
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
    activeSection, searchQuery,
    setActiveSection, setSearchQuery,
  } = useSettingsStore();

  const [mobileSection, setMobileSection] = useState<string | null>(null);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
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

  const sections = SETTINGS_SECTIONS;

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

  const handleSectionClick = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    setMobileSection(sectionId);
    setMobileSettingsOpen(false);
  }, [setActiveSection]);

  const handleMobileBack = useCallback(() => {
    setMobileSection(null);
    setActiveSection("overview");
  }, [setActiveSection]);

  return (
    <div
      className="min-h-screen overflow-x-clip"
      style={{ color: T.textColor }}
    >
      {/* Light veil for text contrast — lets the wallpaper show through */}
      <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: "rgba(5,6,10,0.45)" }} />

      {/* ── Section tab strip — sticky under the AppShell top bar ────────
          Replaces the old 260px desktop sidebar: section tabs and search
          live here on every viewport. The strip sticks below the AppShell
          header (56px bar + 48px mobile nav strip on small screens, 56px
          bar alone on md+). */}
      <div className="relative">
        <SettingsTabStrip
          sections={filteredSections}
          allSections={SETTINGS_SECTIONS}
          activeSection={activeSection}
          onSectionClick={handleSectionClick}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          T={T}
          returnTo={returnTo}
          mobileSettingsOpen={mobileSettingsOpen}
          onOpenMobileSettings={() => setMobileSettingsOpen(true)}
          mobileSearchOpen={mobileSearchOpen}
          onToggleMobileSearch={() => setMobileSearchOpen((open) => !open)}
        />
      </div>

      {/* ── Content — full width below the tab strip ───────────────────── */}
      <div className="relative mx-auto w-full max-w-375 overflow-x-clip">
        {/* Mobile: one active category at a time. Category discovery lives in
            the All settings sheet, so content starts immediately below the
            compact toolbar instead of below a second navigation list. */}
        <div className="min-w-0 px-3 py-4 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:px-4 lg:hidden" data-testid="mobile-settings-content">
          {mobileSection && (
            <button
              type="button"
              onClick={() => { handleMobileBack(); setMobileSettingsOpen(true); }}
              className="mb-3 inline-flex min-h-9 items-center gap-2 rounded-lg px-1 text-xs font-bold text-white/65 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              aria-label="Back to all settings"
            >
              <ArrowLeft size={14} className="pointer-events-none" />
              All settings
            </button>
          )}
          {activeSectionMeta && (
            <>
              <SectionHeader
                title={activeSectionMeta.label}
                description={activeSectionMeta.description}
              />
              <SettingsContent section={activeSectionMeta.id} T={T} />
            </>
          )}
        </div>

        {/* Desktop: active section content */}
        <div className="hidden min-w-0 px-6 py-8 pb-24 pr-16 lg:block lg:px-8 xl:px-10 xl:pr-20">
          <div className="mb-6">
            <SectionHeader
              title={activeSectionMeta?.label ?? "Settings"}
              description={activeSectionMeta?.description}
            />
          </div>
          {activeSectionMeta && (
            <SettingsContent section={activeSectionMeta.id} T={T} />
          )}
        </div>
      </div>

      {mobileSettingsOpen && (
        <MobileSettingsSheet
          sections={filteredSections}
          allSections={SETTINGS_SECTIONS}
          activeSection={activeSection}
          searchQuery={searchQuery}
          onSectionClick={handleSectionClick}
          onClose={() => setMobileSettingsOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Settings section tabs (horizontal strip under the AppShell top bar) ──
 * Replaces the old 260px desktop sidebar. Sticky on every viewport:
 * sticks below the AppShell header — 56px bar + 48px mobile nav strip on
 * small screens (top-[104px]), 56px bar alone on md+ (md:top-14).
 * Tabs show icon + label; the active section is highlighted. Search
 * lives in the strip so it is always in reach. */

function SettingsTabStrip({
  sections,
  allSections,
  activeSection,
  onSectionClick,
  searchQuery,
  onSearchChange,
  T,
  returnTo,
  mobileSettingsOpen,
  onOpenMobileSettings,
  mobileSearchOpen,
  onToggleMobileSearch,
}: {
  sections: SettingsSection[];
  allSections: SettingsSection[];
  activeSection: string;
  onSectionClick: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  returnTo: string;
  mobileSettingsOpen: boolean;
  onOpenMobileSettings: () => void;
  mobileSearchOpen: boolean;
  onToggleMobileSearch: () => void;
}) {
  const hasSearch = searchQuery.trim().length > 0;
  const displaySections = hasSearch ? sections : allSections;

  return (
    <div
      className="sticky top-[104px] z-30 border-b md:top-14"
      style={{
        borderColor: "rgba(255,255,255,0.06)",
        backgroundColor: "rgba(9,11,18,0.92)",
        backdropFilter: "blur(20px)",
      }}
    >
      {/* Desktop and mobile share this toolbar, while category discovery is
          intentionally different: desktop keeps its established strip and
          mobile uses the compact selector below. */}
      <div className="flex items-center gap-2 px-3 py-2.5 md:gap-3 md:px-4">
        <Link
          href={returnTo}
          className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-lg border transition-colors hover:bg-white/5"
          style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}
          aria-label="Back to Studio"
        >
          <ArrowLeft size={16} className="pointer-events-none" />
        </Link>
        <span className="shrink-0 text-sm font-black" style={{ color: "rgba(255,255,255,0.9)" }}>
          Settings
        </span>
        <div className="relative hidden min-w-0 flex-1 md:block md:max-w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search settings…"
            className="w-full rounded-xl border py-2 pl-9 pr-3 text-sm outline-none transition-all focus:ring-2"
            style={{
              backgroundColor: "rgba(10,12,18,0.6)",
              borderColor: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.88)",
            }}
            aria-label="Search settings"
            data-testid="desktop-settings-search"
          />
        </div>
        <button
          type="button"
          onClick={onToggleMobileSearch}
          className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-lg border border-white/10 text-white/70 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 md:hidden"
          aria-label={mobileSearchOpen ? "Close settings search" : "Search settings"}
          aria-expanded={mobileSearchOpen}
        >
          <Search size={15} className="pointer-events-none" />
        </button>
      </div>

      <div className="px-3 pb-2.5 md:hidden">
        <button
          type="button"
          onClick={onOpenMobileSettings}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-accent/20 bg-accent/[0.07] px-3 text-left transition hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          aria-label="Open all settings"
          aria-expanded={mobileSettingsOpen}
          data-testid="mobile-settings-selector"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
            <LayoutGrid size={15} className="pointer-events-none" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-accent/75">All settings</span>
            <span className="block truncate text-sm font-bold text-white">{SETTINGS_SECTIONS.find((s) => s.id === activeSection)?.label ?? "Overview"}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-accent/80" />
        </button>
      </div>

      {mobileSearchOpen && (
        <div className="px-3 pb-2.5 md:hidden">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/55" />
            <input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search settings…"
              className="min-h-10 w-full rounded-xl border border-white/12 bg-black/40 py-2 pl-9 pr-3 text-sm text-white outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
              aria-label="Search settings"
              data-testid="mobile-settings-search"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Desktop category tabs. Mobile uses the full-screen selector sheet. */}
      <nav
        className="hidden items-center gap-1 overflow-x-auto px-3 py-2.5 md:px-4 lg:flex"
        aria-label="Settings sections"
        data-testid="desktop-settings-sections"
        style={{ scrollbarWidth: "none" }}
      >
        {displaySections.map((section) => {
          const Icon = ICONS[section.icon] ?? LayoutGrid;
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSectionClick(section.id)}
              className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-bold transition-all"
              style={{
                backgroundColor: isActive ? `${T.accentColor}14` : "transparent",
                color: isActive ? T.accentColor : "rgba(255,255,255,0.55)",
                boxShadow: isActive ? `inset 0 -2px 0 ${T.accentColor}` : "none",
              }}
              aria-current={isActive ? "page" : undefined}
              title={section.description}
            >
              <Icon size={14} className="pointer-events-none" />
              <span className="whitespace-nowrap">{section.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function MobileSettingsSheet({
  sections,
  allSections,
  activeSection,
  searchQuery,
  onSectionClick,
  onClose,
}: {
  sections: SettingsSection[];
  allSections: SettingsSection[];
  activeSection: string;
  searchQuery: string;
  onSectionClick: (id: string) => void;
  onClose: () => void;
}) {
  const hasSearch = searchQuery.trim().length > 0;
  const displaySections = hasSearch ? sections : allSections;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] lg:hidden" role="dialog" aria-modal="true" aria-label="All settings">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Close all settings" />
      <section className="absolute inset-0 flex flex-col overflow-hidden border border-white/10 bg-[#090b12] pb-[env(safe-area-inset-bottom)] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 text-white/75 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            aria-label="Close all settings"
          >
            <X size={17} className="pointer-events-none" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-black text-white">All settings</h2>
            <p className="text-xs text-white/60">Choose a category</p>
          </div>
        </header>
        <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-4" aria-label="Settings sections">
          {displaySections.map((section) => {
            const Icon = ICONS[section.icon] ?? LayoutGrid;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  onSectionClick(section.id);
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                style={{
                  borderColor: isActive ? "color-mix(in srgb, var(--color-accent) 45%, transparent)" : "rgba(255,255,255,0.1)",
                  backgroundColor: isActive ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "rgba(255,255,255,0.025)",
                }}
                aria-current={isActive ? "page" : undefined}
                aria-label={section.label}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-accent/90">
                  <Icon size={16} className="pointer-events-none" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-bold ${isActive ? "text-accent" : "text-white/90"}`}>{section.label}</span>
                  <span className="block truncate text-xs text-white/60">{section.description}</span>
                </span>
                {isActive ? <Check size={16} className="shrink-0 text-accent" /> : <ChevronRight size={15} className="shrink-0 text-white/45" />}
              </button>
            );
          })}
        </nav>
      </section>
    </div>
  );
}

/* ── Section content router ────────────────────────────────────────── */

function SettingsContent({
  section,
  T,
}: {
  section: string;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  switch (section) {
    case "overview":
      return <OverviewSection T={T} />;
    case "account":
      return <AccountSection T={T} />;
    case "appearance":
      return <AppearanceSection T={T} />;
    case "workspace":
      return <WorkspaceSection T={T} />;
    case "ai-models":
      return <AIModelsSection T={T} />;
    case "voice-camera":
      return <VoiceCameraSection T={T} />;
    case "connections":
      return <ConnectionsSection T={T} />;
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

function OverviewSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const { isSignedIn } = useClerkAuthContext();
  const { user, isLoaded: userLoaded } = useUser();
  const { theme } = useTheme();
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

  const goToSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
  }, [setActiveSection]);

  const overviewCards = [
    {
      label: "Account",
      value: accountCardValue({ isSignedIn, userLoaded, firstName: user?.firstName, username: user?.username }),
      action: "Manage account",
      section: "account",
      icon: <User size={14} />,
    },
    {
      label: "Appearance",
      value: `${themeModeLabel(theme.mode)} · ${accentLabel(theme.accent)}`,
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
      value: micCardValue(micStatus),
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
      value: securityCardValue({ userLoaded, twoFactorEnabled: user?.twoFactorEnabled, lastSignInAt: user?.lastSignInAt }),
      action: "Review security",
      section: "privacy",
      icon: <Shield size={14} />,
    },
  ];

  const quickActions: { label: string; onClick: () => void; show: boolean }[] = [
    { label: "Test microphone", onClick: checkMic, show: micStatus !== "available" },
    { label: "Connect GitHub", onClick: () => goToSection("connections"), show: !hasGitHub },
    { label: "Change model", onClick: () => goToSection("ai-models"), show: true },
    { label: "Manage account", onClick: () => goToSection("account"), show: isSignedIn },
    { label: "Review usage", onClick: () => goToSection("billing"), show: true },
  ].filter((a) => a.show);

  return (
    <div className="w-full space-y-6">
      {/* Status cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {overviewCards.map((card) => {
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => goToSection(card.section)}
              className="flex min-h-23 items-center justify-between rounded-2xl border px-5 py-4 text-left transition-all hover:bg-white/5"
              style={{ borderColor: "rgba(255,255,255,0.06)", backgroundColor: "rgba(255,255,255,0.02)" }}
              aria-label={`${card.label}: ${card.value}. ${card.action}.`}
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
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold" style={{ color: T.accentColor }}>
                <>{card.action} →</>
              </span>
            </button>
          );
        })}
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
  const { data: billing, loading: billingLoading } = useBillingSummary();
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
            <Image
              src={imageUrl}
              alt={name}
              width={64}
              height={64}
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

      {/* Plan & usage — real plan from billing, same source as the Billing section */}
      <SettingsCard title="Plan" description="Current subscription">
        <div className="flex items-center justify-between rounded-xl border px-4 py-3"
          style={{ borderColor: `${T.accentColor}30`, backgroundColor: `${T.accentColor}08` }}
        >
          <div>
            <div className="text-sm font-black" style={{ color: T.accentColor }}>
              {billingLoading ? "Loading…" : (billing?.plan?.name ?? "Starter")}
            </div>
            <div className="text-[10px] text-white/40">
              {billing?.plan && billing.plan.monthlyPriceCents ? `$${(billing.plan.monthlyPriceCents / 100).toFixed(0)}/month` : "Free"}
              {billing?.plan?.beta && " · Beta"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => useSettingsStore.getState().setActiveSection("billing")}
            className="text-xs font-bold"
            style={{ color: T.accentColor }}
          >
            Manage →
          </button>
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
    { id: "lime", label: "LiTT Lime (default)" },
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

  const selectedProfile = workspaceProfiles.find((profile) =>
    Object.entries(profile.values).every(([key, value]) => defaults[key as keyof typeof defaults] === value),
  )?.name;

  return (
    <div className="space-y-4">
      <SettingsCard title="Workspace profiles" description="Coordinated layouts that set sensible Studio defaults" icon={<LayoutGrid size={16} />}>
        <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Workspace profiles">
          {workspaceProfiles.map((profile) => (
            <button
              key={profile.name}
              type="button"
              onClick={() => setDefaults((current) => ({ ...current, ...profile.values }))}
              role="radio"
              aria-checked={selectedProfile === profile.name}
              aria-label={`${profile.name} workspace profile`}
              className="relative rounded-xl border p-3 pr-10 text-left transition hover:border-accent/45 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              style={{
                borderColor: selectedProfile === profile.name ? `${T.accentColor}80` : "rgba(255,255,255,0.1)",
                backgroundColor: selectedProfile === profile.name ? `${T.accentColor}12` : "rgba(255,255,255,0.02)",
              }}
            >
              <span className="text-xs font-black" style={{ color: selectedProfile === profile.name ? T.accentColor : "rgba(255,255,255,0.9)" }}>{profile.name}</span>
              <span className="mt-1 block text-[10px] leading-4 text-white/60">{profile.description}</span>
              {selectedProfile === profile.name && (
                <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-accent/15 text-accent" aria-hidden="true">
                  <Check size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Studio defaults" description="What opens when you enter Studio" icon={<Briefcase size={16} />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="rounded-xl border border-accent/15 bg-accent/[0.03] p-3">
            <legend className="px-1 text-[10px] font-black uppercase tracking-[0.14em] text-accent/80">Default view</legend>
            <p className="mt-1 text-[11px] text-white/60">The workspace surface opened first.</p>
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Default view">
              {["chat", "code", "preview"].map((v) => (
                <button key={v} type="button" onClick={() => setDefaults((current) => ({ ...current, defaultView: v }))}
                  role="radio" aria-checked={defaults.defaultView === v}
                  className="rounded-lg border px-3 py-2 text-[10px] font-bold capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  style={{ borderColor: defaults.defaultView === v ? T.accentColor : "rgba(255,255,255,0.12)", backgroundColor: defaults.defaultView === v ? `${T.accentColor}12` : "transparent", color: defaults.defaultView === v ? T.accentColor : "rgba(255,255,255,0.75)" }}>
                  {v}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="rounded-xl border border-accent/15 bg-accent/[0.03] p-3">
            <legend className="px-1 text-[10px] font-black uppercase tracking-[0.14em] text-accent/80">Default tool</legend>
            <p className="mt-1 text-[11px] text-white/60">The tool selected inside that surface.</p>
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Default tool">
              {["chat", "code", "agents"].map((v) => (
                <button key={v} type="button" onClick={() => setDefaults((current) => ({ ...current, defaultTool: v }))}
                  role="radio" aria-checked={defaults.defaultTool === v}
                  className="rounded-lg border px-3 py-2 text-[10px] font-bold capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  style={{ borderColor: defaults.defaultTool === v ? "var(--color-accent)" : "rgba(255,255,255,0.12)", backgroundColor: defaults.defaultTool === v ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : "transparent", color: defaults.defaultTool === v ? "var(--color-accent)" : "rgba(255,255,255,0.75)" }}>
                  {v}
                </button>
              ))}
            </div>
          </fieldset>
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
  const [livekitStatus, setLivekitStatus] = useState<{
    configured: boolean;
    url: boolean;
    apiKey: boolean;
    apiSecret: boolean;
  } | null>(null);
  const [connectionTest, setConnectionTest] = useState<{
    state: "idle" | "testing" | "ok" | "fail";
    message: string;
    latencyMs?: number;
  }>({ state: "idle", message: "" });

  useEffect(() => {
    fetch("/api/voice/health", { cache: "no-store" })
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
          if (data.details.livekit) {
            setLivekitStatus({
              configured: data.details.livekit.configured ?? false,
              url: data.details.livekit.url ?? false,
              apiKey: data.details.livekit.apiKey ?? false,
              apiSecret: data.details.livekit.apiSecret ?? false,
            });
          }
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

  const previewVoice = useCallback(async (agentId: "litt") => {
    setVoicePreviewing(agentId);
    try {
      const sampleText = "Connection established. I'm scanning the project now.";

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
    unknown: { color: "#6b7280", label: "Not tested", desc: "Tap “Test microphone” below to check — nothing runs until you do." },
  }[micStatus];

  const camStatusInfo = {
    available: { color: "#22c55e", label: "Available", desc: "Camera is ready" },
    denied: { color: "#ef4444", label: "Permission denied", desc: "Allow camera access in your browser" },
    error: { color: "#ef4444", label: "Error", desc: "Camera test failed. Check your device." },
    unsupported: { color: "#6b7280", label: "Unsupported", desc: "Camera API not available on this device" },
    unknown: { color: "#6b7280", label: "Not tested", desc: "Tap “Test camera” below to check — nothing runs until you do." },
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
      <SettingsCard title="Agent voice" description="LiTT voice identity" icon={<Volume2 size={16} />}>
        <div className="space-y-3">
          <p className="text-[10px] text-white/40">
            Voice is powered by Inworld realtime API. Preview uses your browser&apos;s built-in speech synthesis for a rough demo — the actual voice in the Studio is Inworld&apos;s neural voice.
          </p>
          {[
            { id: "litt" as const, name: "LiTT", style: "Deep · Calm · Precise", color: brand.primary.DEFAULT, sample: "Connection established. I'm scanning the project now." },
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
                <div>WebSocket URL: <span className={inworldStatus.wsUrl ? "text-emerald-400" : "text-red-400"}>{inworldStatus.wsUrl ? "Set" : "Missing"}</span></div>
                {inworldStatus.configured ? (
                  <div className="mt-1.5 text-emerald-400">Inworld realtime voice is configured and ready.</div>
                ) : (
                  <div className="mt-1.5 text-amber-400">
                    Inworld is not configured. Set INWORLD_API_KEY and INWORLD_LITT_VOICE in Vercel env.
                  </div>
                )}
              </div>

              {/* LiveKit status — the newer preferred realtime transport */}
              {livekitStatus && (
                <div className="mt-3 border-t border-white/5 pt-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Realtime transport (LiveKit)</div>
                  <div className="mt-1.5 space-y-1 text-[10px] text-white/60">
                    <div>LIVEKIT_URL: <span className={livekitStatus.url ? "text-emerald-400" : "text-red-400"}>{livekitStatus.url ? "Set" : "Missing"}</span></div>
                    <div>LIVEKIT_API_KEY: <span className={livekitStatus.apiKey ? "text-emerald-400" : "text-red-400"}>{livekitStatus.apiKey ? "Set" : "Missing"}</span></div>
                    <div>LIVEKIT_API_SECRET: <span className={livekitStatus.apiSecret ? "text-emerald-400" : "text-red-400"}>{livekitStatus.apiSecret ? "Set" : "Missing"}</span></div>
                    {livekitStatus.configured ? (
                      <div className="mt-1.5 text-emerald-400">LiveKit realtime voice is configured and ready. This is the preferred transport for Studio voice sessions.</div>
                    ) : (
                      <div className="mt-1.5 text-amber-400">
                        LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in Vercel env to enable realtime voice in the Studio.
                      </div>
                    )}
                  </div>
                </div>
              )}

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

type UsageData = {
  summary: {
    totalCreditsUsed: number;
    totalCreditsRefunded: number;
    totalRuns: number;
  };
  modelUsage: Array<{ model: string; calls: number; credits: number }>;
};

/* Shared subscription fetch — Account and Billing show the same real plan. */
function useBillingSummary() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/subscription", { cache: "no-store" });
        if (res.ok && !cancelled) setData(await res.json());
      } catch {
        // silent — callers fall back to neutral labels
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { data, loading };
}

function BillingSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const { data, loading } = useBillingSummary();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/litt/usage?range=month", { cache: "no-store" });
        if (res.ok && !cancelled) setUsage(await res.json());
      } catch {
        // silent
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
          {(() => {
            const modelCalls = usage?.modelUsage.reduce((s, m) => s + m.calls, 0) ?? 0;
            const rows = [
              { label: "LiTTBits used", value: usage ? `${usage.summary.totalCreditsUsed.toLocaleString()} this month` : "—" },
              { label: "Model calls", value: usage ? `${modelCalls.toLocaleString()} this month` : "—" },
              { label: "Agent runs", value: usage ? `${usage.summary.totalRuns.toLocaleString()} this month` : "—" },
            ];
            if (usage && usage.summary.totalCreditsRefunded > 0) {
              rows.push({ label: "Refunded", value: `${usage.summary.totalCreditsRefunded.toLocaleString()} LiTTBits` });
            }
            return rows.map((u) => (
              <div key={u.label} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/2 px-3 py-2.5">
                <span className="text-xs font-bold text-white/80">{u.label}</span>
                <span className="text-[10px] text-white/40">{u.value}</span>
              </div>
            ));
          })()}
        </div>
        <Link href="/pricing" className="mt-3 inline-block text-xs font-bold" style={{ color: T.accentColor }}>
          View plans and pricing →
        </Link>
      </SettingsCard>
    </div>
  );
}

/* ── Privacy & Security ────────────────────────────────────────────── */

function PrivacySection({ T: _T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<Array<{
    id: string;
    action?: string;
    provider?: string;
    status?: string;
    createdAt?: string;
  }> | null>(null);
  const [auditFailed, setAuditFailed] = useState(false);

  // Real audit entries — "No recent activity" only shows when the API
  // actually returns an empty list, never as a hardcoded placeholder.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/audit-log?limit=5", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (!cancelled) setAuditEntries(Array.isArray(json.entries) ? json.entries : []);
      })
      .catch(() => {
        if (!cancelled) setAuditFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

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
      <SettingsCard title="Active sessions" description="Devices logged into your account">
        <p className="text-xs text-white/40">Session management is coming soon — for now, sign out directly on each device.</p>
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
        {auditEntries === null && !auditFailed && (
          <p className="text-xs text-white/40">Loading activity…</p>
        )}
        {auditFailed && (
          <p className="text-xs text-white/40">Couldn&apos;t load activity right now.</p>
        )}
        {auditEntries !== null && auditEntries.length === 0 && (
          <p className="text-xs text-white/40">No recent activity.</p>
        )}
        {auditEntries !== null && auditEntries.length > 0 && (
          <div className="space-y-2">
            {auditEntries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-white/80">{entry.action || "Activity"}</div>
                  <div className="text-[10px] text-white/40">
                    {[entry.provider, entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                </div>
                {entry.status && (
                  <span className="shrink-0 text-[10px] font-bold capitalize text-white/50">{entry.status}</span>
                )}
              </div>
            ))}
          </div>
        )}
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
  const { setActiveSection } = useSettingsStore();
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const goToSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
  }, [setActiveSection]);

  const handleResetAll = useCallback(() => {
    const removed = resetAllLocalSettings();
    setResetMsg(`Removed ${removed} local setting${removed === 1 ? "" : "s"}. Reloading…`);
    setTimeout(() => window.location.reload(), 1200);
  }, []);

  return (
    <div className="space-y-4">
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

      <SettingsCard title="Diagnostics" description="Real health checks — every row opens a working surface">
        <div className="space-y-2">
          <Link
            href="/settings/connections/diagnostics"
            className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-bold transition-all hover:bg-white/5"
            style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}
          >
            <span>
              Connection diagnostics
              <span className="block text-[10px] font-medium text-white/35">Live integration health checks</span>
            </span>
            <ChevronRight size={12} className="pointer-events-none shrink-0 text-white/30" />
          </Link>
          {[
            { label: "Voice connection test", desc: "End-to-end mic → voice pipeline test", section: "voice-camera" },
            { label: "AI provider health", desc: "Model provider availability", section: "ai-models" },
            { label: "Integration status", desc: "GitHub, AI keys, runtime services", section: "connections" },
          ].map((item) => {
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => goToSection(item.section)}
                className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-bold transition-all hover:bg-white/5"
                style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}
                aria-label={item.label}
              >
                <span className="text-left">
                  {item.label}
                  <span className="block text-[10px] font-medium text-white/35">
                    {item.desc}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <ChevronRight size={12} className="pointer-events-none text-white/30" />
                </span>
              </button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="Reset" description="Reset settings to defaults">
        <div className="flex flex-wrap gap-2">
          {confirmResetAll ? (
            <>
              <button
                type="button"
                onClick={handleResetAll}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-red-600"
              >
                Confirm — erase all local settings
              </button>
              <button
                type="button"
                onClick={() => setConfirmResetAll(false)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/60 transition-all hover:bg-white/5"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmResetAll(true)}
              className="flex items-center gap-1.5 rounded-lg border border-red-400/20 px-3 py-1.5 text-xs font-bold text-red-300 transition-all hover:bg-red-400/10"
            >
              <RotateCcw size={12} className="pointer-events-none" />
              Reset all settings
            </button>
          )}
        </div>
        {resetMsg && <p className="mt-2 text-[10px] text-white/40">{resetMsg}</p>}
      </SettingsCard>
    </div>
  );
}

/* ── System Control removed — feature flags and system health
       moved into Advanced section ─────────────────────────────────── */
