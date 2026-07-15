"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTheme, useCrtToggle, ACCENT_MAP } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth, useAppUser } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import CLIBridgeTool from "@/app/studio/tools/CLIBridgeTool";
import { THEMES } from "@/lib/themes";
import type { BackgroundMode } from "@/components/AnimatedBackground";
import type { SkinPreset, AccentColor } from "@/context/ThemeContext";
import {
  User,
  Palette,
  Bell,
  LayoutGrid,
  Save,
  Check,
  Loader2,
  Coins,
  Moon,
  Sun,
  Monitor,
  ScanLine,
  AlertTriangle,
  ExternalLink,
  Terminal,
  ShieldCheck,
  CreditCard,
  Shield,
  LogOut,
  ChevronRight,
  Search,
  Menu,
  X,
  Bot,
  Network,
  Lock,
} from "lucide-react";
import Link from "next/link";

const BACKGROUND_MODES: { id: BackgroundMode; label: string }[] = [
  { id: "constellation", label: "Constellation" },
  { id: "nebula", label: "Nebula" },
  { id: "waves", label: "Waves" },
  { id: "minimal", label: "Minimal" },
  { id: "holo", label: "Holo" },
];

const BYOK_KEYS = [
  { id: "gemini", label: "Google Gemini", env: "GEMINI_API_KEY" },
  { id: "openrouter", label: "OpenRouter", env: "OPENROUTER_API_KEY" },
  { id: "openai", label: "OpenAI", env: "OPENAI_API_KEY" },
] as const;

const SECTIONS = [
  { id: "account", label: "Account", icon: User },
  { id: "personalization", label: "Personalization", icon: Palette },
  { id: "studio", label: "Studio", icon: LayoutGrid },
  { id: "ai-agents", label: "AI & Agents", icon: Bot },
  { id: "connections", label: "Connections", icon: Network },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "billing", label: "Billing", icon: CreditCard },
] as const;

const ADVANCED_SECTIONS = [
  { id: "developer", label: "Developer", icon: Terminal },
  { id: "security", label: "Security", icon: Shield },
  { id: "privacy", label: "Privacy", icon: Lock },
] as const;

type SectionId =
  | (typeof SECTIONS)[number]["id"]
  | (typeof ADVANCED_SECTIONS)[number]["id"];

const ALL_SECTIONS = [...SECTIONS, ...ADVANCED_SECTIONS];

const SECTION_LABELS: Record<SectionId, string> = ALL_SECTIONS.reduce(
  (acc, s) => ({ ...acc, [s.id]: s.label }),
  {} as Record<SectionId, string>,
);

const SECTION_ICONS: Record<SectionId, typeof User> = ALL_SECTIONS.reduce(
  (acc, s) => ({ ...acc, [s.id]: s.icon }),
  {} as Record<SectionId, typeof User>,
);

const SECTION_SEARCH_TERMS: Record<SectionId, string[]> = {
  account: [
    "Account",
    "Profile",
    "Public Profile",
    "Display Name",
    "Username",
    "Website",
    "Location",
    "Avatar URL",
    "Bio",
    "Email",
    "Sign Out",
    "Delete Account",
  ],
  personalization: [
    "Personalization",
    "Theme Presets",
    "Theme Mode",
    "Dark",
    "Light",
    "System",
    "Quick Actions",
    "Save",
    "Reset",
    "Accent Color",
    "Background & Effects",
    "CRT Scanlines",
  ],
  studio: [
    "Studio",
    "Workspace Controls",
    "Auto-save drafts",
    "Auto save drafts",
    "Compact mode",
    "Live preview",
    "Telemetry panel",
    "Default workspace",
    "Save Workspace",
    "Fast Launch",
    "Open Studio",
    "Marketplace",
    "Games",
    "Gallery",
    "Admin",
  ],
  "ai-agents": [
    "AI & Agents",
    "AI and Agents",
    "Bring Your Own Keys",
    "Google Gemini",
    "OpenRouter",
    "OpenAI",
    "API key",
    "Save Keys",
  ],
  connections: [
    "Connections",
    "Integrations",
    "Accounts",
    "Third-party",
    "External accounts",
  ],
  notifications: [
    "Notifications",
    "Notification Channels",
    "Discord Webhook URL",
    "Alexa Voice Monkey",
    "Weekly Email Digest",
    "Save Notifications",
  ],
  billing: [
    "Billing",
    "Membership",
    "Current Plan",
    "Upgrade Plan",
    "Manage Wallet",
  ],
  developer: [
    "Advanced",
    "Developer",
    "CLI Tools",
    "Connected Surfaces",
    "Studio Tools",
    "Admin Terminal",
    "Admin Console",
  ],
  security: [
    "Advanced",
    "Security",
    "Two-factor",
    "Password",
    "Session",
    "Authentication",
  ],
  privacy: ["Advanced", "Privacy", "Data", "Cookies", "Tracking"],
};

function isSectionId(value: string | null): value is SectionId {
  return !!value && ALL_SECTIONS.some((s) => s.id === value);
}

function resolveSectionId(value: string | null): SectionId {
  const legacyMap: Record<string, SectionId> = {
    profile: "account",
    account: "account",
    appearance: "personalization",
    workspace: "studio",
    cli: "developer",
    keys: "ai-agents",
    billing: "billing",
    notifications: "notifications",
  };
  if (!value) return "account";
  if (isSectionId(value)) return value;
  return legacyMap[value] || "account";
}

export default function SettingsPage() {
  const {
    theme,
    resolvedColors: T,
    setMode,
    setSkin,
    setAccent,
    setBackgroundMode,
  } = useTheme();
  const { profile, updateProfile } = useProfile();
  const { crtEnabled, toggleCrt } = useCrtToggle();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user } = useAppUser();
  const [activeTab, setActiveTab] = useState<SectionId>("account");
  const [search, setSearch] = useState("");

  /* Billing state */
  const [plan, setPlan] = useState<{
    plan: string;
    status?: string;
    current_period_end?: string | null;
  }>({
    plan: "free",
    status: "active",
    current_period_end: null,
  });
  const [planLoading, setPlanLoading] = useState(false);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    const section = resolveSectionId(requestedTab);
    const timeout = window.setTimeout(() => setActiveTab(section), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const changeTab = useCallback((section: SectionId) => {
    setActiveTab(section);
    setSearch("");
    const url = new URL(window.location.href);
    url.searchParams.set("tab", section);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  /* Profile state */
  const [name, setName] = useState(profile.displayName || "");
  const [username, setUsername] = useState(profile.username || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [website, setWebsite] = useState(profile.website || "");
  const [location, setLocation] = useState(profile.location || "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl || "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  /* BYOK state — seeded from localStorage */
  const [keys, setKeys] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    const loaded: Record<string, string> = {};
    BYOK_KEYS.forEach((k) => {
      loaded[k.id] = localStorage.getItem(`litlabs-byok-${k.id}`) || "";
    });
    return loaded;
  });
  const [keysSaved, setKeysSaved] = useState(false);

  /* Notifications state — seeded from localStorage */
  const [discordWebhook, setDiscordWebhook] = useState(() =>
    typeof window === "undefined"
      ? ""
      : localStorage.getItem("litlabs-notify-discord") || "",
  );
  const [alexaEnabled, setAlexaEnabled] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("litlabs-notify-alexa") === "true",
  );
  const [emailDigest, setEmailDigest] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("litlabs-notify-email") === "true",
  );
  const [notifSaved, setNotifSaved] = useState(false);

  /* Workspace preferences — seeded from localStorage */
  const [autoSaveDrafts, setAutoSaveDrafts] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("litlabs-workspace-autosave") !== "false",
  );
  const [compactMode, setCompactMode] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("litlabs-workspace-compact") === "true",
  );
  const [livePreview, setLivePreview] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("litlabs-workspace-live-preview") !== "false",
  );
  const [showTelemetry, setShowTelemetry] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("litlabs-workspace-telemetry") !== "false",
  );
  const [defaultWorkspace, setDefaultWorkspace] = useState(
    () =>
      (typeof window !== "undefined" &&
        localStorage.getItem("litlabs-workspace-default")) ||
      "studio",
  );
  const [workspaceSaved, setWorkspaceSaved] = useState(false);
  const [themeSaved, setThemeSaved] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);

  const savePreferences = useCallback(
    async (updates: Record<string, unknown>) => {
      setPreferenceError(null);
      const response = await fetch("/api/settings/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save preferences");
      }
    },
    [],
  );

  /* Load server preferences for signed-in users; localStorage remains an offline fallback. */
  useEffect(() => {
    if (!isSignedIn) return;
    fetch("/api/settings/preferences")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const prefs = data?.preferences;
        if (!prefs) return;
        if (typeof prefs.notify_discord === "string")
          setDiscordWebhook(prefs.notify_discord);
        if (typeof prefs.notify_alexa === "boolean")
          setAlexaEnabled(prefs.notify_alexa);
        if (typeof prefs.notify_email === "boolean")
          setEmailDigest(prefs.notify_email);
        if (typeof prefs.workspace_autosave === "boolean")
          setAutoSaveDrafts(prefs.workspace_autosave);
        if (typeof prefs.workspace_compact === "boolean")
          setCompactMode(prefs.workspace_compact);
        if (typeof prefs.workspace_live_preview === "boolean")
          setLivePreview(prefs.workspace_live_preview);
        if (typeof prefs.workspace_telemetry === "boolean")
          setShowTelemetry(prefs.workspace_telemetry);
        if (typeof prefs.workspace_default === "string")
          setDefaultWorkspace(prefs.workspace_default);
      })
      .catch(() => {
        // Keep the localStorage-seeded values when the database is unavailable.
      });
  }, [isSignedIn]);

  /* Load remote profile once */
  useEffect(() => {
    if (!isSignedIn) return;
    fetch("/api/settings/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.user) return;
        const u = data.user;
        setName(u.name || "");
        setUsername(u.username || "");
        setBio(u.bio || "");
        setWebsite(u.website || "");
        setLocation(u.location || "");
        setAvatarUrl(u.avatar_url || "");
      })
      .catch(() => {});
  }, [isSignedIn]);

  /* Load current plan */
  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    setPlanLoading(true);
    fetch(`/api/users/${user.id}/plan`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.plan) setPlan(data);
      })
      .catch(() => {})
      .finally(() => setPlanLoading(false));
  }, [isSignedIn, user?.id]);

  const saveProfile = useCallback(async () => {
    setProfileSaved(false);
    setProfileError(null);
    setProfileLoading(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim(),
          bio: bio.trim(),
          website: website.trim(),
          location: location.trim(),
          avatar_url: avatarUrl.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save profile");
      updateProfile({
        displayName: name.trim(),
        username: username.trim(),
        bio: bio.trim(),
        website: website.trim(),
        location: location.trim(),
        avatarUrl: avatarUrl.trim(),
      });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setProfileLoading(false);
    }
  }, [name, username, bio, website, location, avatarUrl, updateProfile]);

  const saveKeys = useCallback(() => {
    if (typeof window === "undefined") return;
    BYOK_KEYS.forEach((k) => {
      localStorage.setItem(`litlabs-byok-${k.id}`, keys[k.id] || "");
    });
    setKeysSaved(true);
    setTimeout(() => setKeysSaved(false), 2000);
  }, [keys]);

  const saveNotifications = useCallback(async () => {
    if (typeof window === "undefined") return;
    try {
      await savePreferences({
        notify_discord: discordWebhook,
        notify_alexa: alexaEnabled,
        notify_email: emailDigest,
      });
      localStorage.setItem("litlabs-notify-discord", discordWebhook);
      localStorage.setItem("litlabs-notify-alexa", String(alexaEnabled));
      localStorage.setItem("litlabs-notify-email", String(emailDigest));
      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 2000);
    } catch (error) {
      setPreferenceError(
        error instanceof Error ? error.message : "Failed to save notifications",
      );
    }
  }, [discordWebhook, alexaEnabled, emailDigest, savePreferences]);

  const saveWorkspace = useCallback(async () => {
    if (typeof window === "undefined") return;
    try {
      await savePreferences({
        workspace_autosave: autoSaveDrafts,
        workspace_compact: compactMode,
        workspace_live_preview: livePreview,
        workspace_telemetry: showTelemetry,
        workspace_default: defaultWorkspace,
      });
      localStorage.setItem(
        "litlabs-workspace-autosave",
        String(autoSaveDrafts),
      );
      localStorage.setItem("litlabs-workspace-compact", String(compactMode));
      localStorage.setItem(
        "litlabs-workspace-live-preview",
        String(livePreview),
      );
      localStorage.setItem(
        "litlabs-workspace-telemetry",
        String(showTelemetry),
      );
      localStorage.setItem("litlabs-workspace-default", defaultWorkspace);
      setWorkspaceSaved(true);
      setTimeout(() => setWorkspaceSaved(false), 2000);
    } catch (error) {
      setPreferenceError(
        error instanceof Error
          ? error.message
          : "Failed to save workspace preferences",
      );
    }
  }, [
    autoSaveDrafts,
    compactMode,
    livePreview,
    showTelemetry,
    defaultWorkspace,
    savePreferences,
  ]);

  const inputStyle = {
    backgroundColor: `${T.boxBg}80`,
    borderColor: `${T.borderColor}40`,
    color: T.textColor,
  };

  const cardStyle = {
    backgroundColor: `${T.boxBg}60`,
    borderColor: `${T.borderColor}30`,
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const query = search.trim().toLowerCase();
  const allSectionIds = useMemo(() => ALL_SECTIONS.map((s) => s.id), []);

  const visibleSectionIds = useMemo(() => {
    if (!query) return allSectionIds;
    return allSectionIds.filter((id) =>
      SECTION_SEARCH_TERMS[id].some((term) =>
        term.toLowerCase().includes(query),
      ),
    );
  }, [query, allSectionIds]);

  const visibleMainSections = useMemo(
    () => SECTIONS.filter((s) => visibleSectionIds.includes(s.id)),
    [visibleSectionIds],
  );

  const visibleAdvancedSections = useMemo(
    () => ADVANCED_SECTIONS.filter((s) => visibleSectionIds.includes(s.id)),
    [visibleSectionIds],
  );

  const showSection = useCallback(
    (id: SectionId) => {
      if (!query) return activeTab === id;
      return visibleSectionIds.includes(id);
    },
    [query, activeTab, visibleSectionIds],
  );

  const currentSectionLabel = query
    ? "Search results"
    : SECTION_LABELS[activeTab];
  const CurrentSectionIcon = SECTION_ICONS[activeTab];

  useEffect(() => {
    if (query && visibleAdvancedSections.length > 0) {
      setAdvancedOpen(true);
    }
  }, [query, visibleAdvancedSections.length]);

  if (!isLoaded) {
    return (
      <PageShell
        title="Settings"
        subtitle="Loading your preferences..."
        icon="⚙️"
      >
        <div className="p-8 flex items-center justify-center">
          <Loader2 className="animate-spin" style={{ color: T.accentColor }} />
        </div>
      </PageShell>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell
        title="Settings"
        subtitle="Sign in to manage your account"
        icon="⚙️"
      >
        <div className="p-8 max-w-md mx-auto text-center">
          <p className="mb-4 opacity-70" style={{ color: T.textMuted }}>
            You need to be signed in to view settings.
          </p>
          <Link
            href="/sign-in?redirect_url=/settings"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            Sign In <ExternalLink size={14} />
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Settings"
      subtitle="Manage your account, preferences, and workspace"
      icon="⚙️"
    >
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <aside
            className="hidden lg:flex w-[250px] shrink-0 flex-col rounded-2xl border p-3 overflow-y-auto"
            style={{
              backgroundColor: `${T.boxBg}60`,
              borderColor: `${T.borderColor}30`,
            }}
          >
            {/* Search */}
            <div className="mb-3">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: T.textMuted }}
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search settings..."
                  className="w-full rounded-lg border px-3 py-2 pl-9 text-sm outline-none placeholder:text-(--text-muted)"
                  style={{
                    backgroundColor: `${T.boxBg}60`,
                    borderColor: `${T.borderColor}30`,
                    color: T.textColor,
                  }}
                />
              </div>
            </div>
            <nav className="space-y-1">
              {visibleMainSections.map((section) => {
                const Icon = section.icon;
                const active = activeTab === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => changeTab(section.id)}
                    className="group relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold transition-all"
                    style={{
                      backgroundColor: active
                        ? `${T.accentColor}20`
                        : "transparent",
                      borderLeft: active
                        ? `3px solid ${T.accentColor}`
                        : "3px solid transparent",
                      color: active ? T.accentColor : T.textColor,
                    }}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="flex-1">{section.label}</span>
                    {active && <ChevronRight size={16} className="shrink-0" />}
                  </button>
                );
              })}
              <div className="mt-2">
                <button
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold transition-all"
                  style={{ color: T.textColor }}
                >
                  <ChevronRight
                    size={16}
                    className={`shrink-0 transition-transform ${advancedOpen ? "rotate-90" : ""}`}
                    style={{ color: T.textMuted }}
                  />
                  <span className="flex-1">Advanced</span>
                </button>
                {advancedOpen && (
                  <div
                    className="ml-4 mt-1 space-y-1 border-l pl-3"
                    style={{ borderColor: `${T.borderColor}30` }}
                  >
                    {visibleAdvancedSections.map((section) => {
                      const Icon = section.icon;
                      const active = activeTab === section.id;
                      return (
                        <button
                          key={section.id}
                          onClick={() => changeTab(section.id)}
                          className="group relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold transition-all"
                          style={{
                            backgroundColor: active
                              ? `${T.accentColor}20`
                              : "transparent",
                            borderLeft: active
                              ? `3px solid ${T.accentColor}`
                              : "3px solid transparent",
                            color: active ? T.accentColor : T.textColor,
                          }}
                        >
                          <Icon size={16} className="shrink-0" />
                          <span className="flex-1">{section.label}</span>
                          {active && (
                            <ChevronRight size={16} className="shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </nav>
            {visibleMainSections.length === 0 &&
              visibleAdvancedSections.length === 0 && (
                <div
                  className="mt-4 px-3 text-sm"
                  style={{ color: T.textMuted }}
                >
                  No settings found
                </div>
              )}
          </aside>

          <main className="flex-1 min-w-0">
            {/* Mobile top bar */}
            <div className="lg:hidden flex items-center justify-between gap-3 mb-4">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold"
                style={{
                  borderColor: `${T.borderColor}30`,
                  color: T.textColor,
                }}
              >
                <Menu size={16} />
              </button>
              <span
                className="flex items-center gap-2 text-sm font-bold"
                style={{ color: T.headerColor }}
              >
                {CurrentSectionIcon && <CurrentSectionIcon size={16} />}
                {currentSectionLabel}
              </span>
              <div className="w-10" />
            </div>

            {/* Mobile sheet */}
            {mobileMenuOpen && (
              <div className="fixed inset-0 z-50 lg:hidden">
                <button
                  className="absolute inset-0 h-full w-full cursor-default bg-black/60"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close menu"
                />
                <div className="absolute left-0 top-0 h-full w-[85%] max-w-[280px]">
                  <aside
                    className="flex h-full flex-col border-r p-4"
                    style={{
                      backgroundColor: T.boxBg + "90",
                      borderColor: T.borderColor + "30",
                      backdropFilter: "blur(20px) saturate(180%)",
                    }}
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <span
                        className="text-sm font-black"
                        style={{ color: T.headerColor }}
                      >
                        Settings
                      </span>
                      <button
                        onClick={() => setMobileMenuOpen(false)}
                        className="rounded-md p-2"
                        style={{ color: T.textMuted }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="mb-3">
                      <div className="relative">
                        <Search
                          size={14}
                          className="absolute left-3 top-1/2 -translate-y-1/2"
                          style={{ color: T.textMuted }}
                        />
                        <input
                          type="text"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search settings..."
                          className="w-full rounded-lg border px-3 py-2 pl-9 text-sm outline-none placeholder:text-(--text-muted)"
                          style={{
                            backgroundColor: `${T.boxBg}60`,
                            borderColor: `${T.borderColor}30`,
                            color: T.textColor,
                          }}
                        />
                      </div>
                    </div>
                    <nav className="space-y-1 overflow-y-auto">
                      {visibleMainSections.map((section) => {
                        const Icon = section.icon;
                        const active = activeTab === section.id;
                        return (
                          <button
                            key={section.id}
                            onClick={() => changeTab(section.id)}
                            className="group relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold transition-all"
                            style={{
                              backgroundColor: active
                                ? `${T.accentColor}20`
                                : "transparent",
                              borderLeft: active
                                ? `3px solid ${T.accentColor}`
                                : "3px solid transparent",
                              color: active ? T.accentColor : T.textColor,
                            }}
                          >
                            <Icon size={16} className="shrink-0" />
                            <span className="flex-1">{section.label}</span>
                            {active && (
                              <ChevronRight size={16} className="shrink-0" />
                            )}
                          </button>
                        );
                      })}
                      <div className="mt-2">
                        <button
                          onClick={() => setAdvancedOpen((v) => !v)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold transition-all"
                          style={{ color: T.textColor }}
                        >
                          <ChevronRight
                            size={16}
                            className={`shrink-0 transition-transform ${advancedOpen ? "rotate-90" : ""}`}
                            style={{ color: T.textMuted }}
                          />
                          <span className="flex-1">Advanced</span>
                        </button>
                        {advancedOpen && (
                          <div
                            className="ml-4 mt-1 space-y-1 border-l pl-3"
                            style={{ borderColor: `${T.borderColor}30` }}
                          >
                            {visibleAdvancedSections.map((section) => {
                              const Icon = section.icon;
                              const active = activeTab === section.id;
                              return (
                                <button
                                  key={section.id}
                                  onClick={() => changeTab(section.id)}
                                  className="group relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold transition-all"
                                  style={{
                                    backgroundColor: active
                                      ? `${T.accentColor}20`
                                      : "transparent",
                                    borderLeft: active
                                      ? `3px solid ${T.accentColor}`
                                      : "3px solid transparent",
                                    color: active ? T.accentColor : T.textColor,
                                  }}
                                >
                                  <Icon size={16} className="shrink-0" />
                                  <span className="flex-1">
                                    {section.label}
                                  </span>
                                  {active && (
                                    <ChevronRight
                                      size={16}
                                      className="shrink-0"
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </nav>
                    {visibleMainSections.length === 0 &&
                      visibleAdvancedSections.length === 0 && (
                        <div
                          className="mt-4 px-3 text-sm"
                          style={{ color: T.textMuted }}
                        >
                          No settings found
                        </div>
                      )}
                  </aside>
                </div>
              </div>
            )}

            {preferenceError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border px-3 py-2 text-sm"
                style={{
                  color: "#fca5a5",
                  borderColor: "#ef444466",
                  backgroundColor: "#7f1d1d33",
                }}
              >
                {preferenceError}
              </div>
            )}

            {/* Profile Tab */}
            {showSection("account") && (
              <div className="space-y-6">
                <div
                  className="rounded-2xl border p-4 sm:p-6"
                  style={cardStyle}
                >
                  <h2
                    className="text-lg font-black mb-1"
                    style={{ color: T.headerColor }}
                  >
                    Public Profile
                  </h2>
                  <p
                    className="text-xs mb-5 opacity-70"
                    style={{ color: T.textMuted }}
                  >
                    This is what other creators see across the platform.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      {
                        label: "Display Name",
                        value: name,
                        set: setName,
                        placeholder: "Your name",
                      },
                      {
                        label: "Username",
                        value: username,
                        set: setUsername,
                        placeholder: "username",
                      },
                      {
                        label: "Website",
                        value: website,
                        set: setWebsite,
                        placeholder: "https://yoursite.com",
                      },
                      {
                        label: "Location",
                        value: location,
                        set: setLocation,
                        placeholder: "City, Country",
                      },
                    ].map((field) => (
                      <div key={field.label} className="space-y-1">
                        <label
                          className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                          style={{ color: T.textMuted }}
                        >
                          {field.label}
                        </label>
                        <input
                          id="settings-display-name"
                          name="displayName"
                          value={field.value}
                          onChange={(e) => field.set(e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                          style={inputStyle}
                        />
                      </div>
                    ))}
                    <div className="sm:col-span-2 space-y-1">
                      <label
                        className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                        style={{ color: T.textMuted }}
                      >
                        Avatar URL
                      </label>
                      <input
                        id="settings-avatar-url"
                        name="avatarUrl"
                        value={avatarUrl}
                        onChange={(e) => setAvatarUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                        style={inputStyle}
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <label
                        className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                        style={{ color: T.textMuted }}
                      >
                        Bio
                      </label>
                      <textarea
                        id="settings-bio"
                        name="bio"
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="Tell the community who you are..."
                        rows={4}
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all resize-none"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      onClick={saveProfile}
                      disabled={profileLoading}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
                      style={{
                        backgroundColor: T.accentColor,
                        color: T.bgColor,
                      }}
                    >
                      {profileLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : profileSaved ? (
                        <Check size={14} />
                      ) : (
                        <Save size={14} />
                      )}
                      {profileSaved ? "Saved" : "Save Profile"}
                    </button>
                    {profileError && (
                      <span className="text-xs" style={{ color: "#ef4444" }}>
                        {profileError}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Appearance Tab */}
            {showSection("personalization") && (
              <div className="space-y-6">
                <section className="grid lg:grid-cols-[1.15fr_0.85fr] gap-6">
                  <div
                    className="rounded-3xl border p-4 sm:p-6"
                    style={cardStyle}
                  >
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <h2
                          className="text-xl font-black"
                          style={{ color: T.headerColor }}
                        >
                          Theme Presets
                        </h2>
                        <p
                          className="text-xs mt-1"
                          style={{ color: T.textMuted }}
                        >
                          Five premium directions designed as real visual
                          systems, not color chips.
                        </p>
                      </div>
                      <div
                        className="rounded-full border px-3 py-1 text-[10px] font-black uppercase"
                        style={{
                          borderColor: T.borderColor + "30",
                          color: T.accentColor,
                          backgroundColor: T.accentColor + "10",
                        }}
                      >
                        {theme.skin}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {THEMES.map((preset) => {
                        const active = preset.id === theme.skin;
                        const isDark = theme.mode !== "light";
                        const previewBg = isDark ? preset.bg : "#f8fafc";
                        const previewSurface = isDark
                          ? preset.surface
                          : "#ffffff";
                        return (
                          <button
                            key={preset.id}
                            onClick={() => setSkin(preset.id as SkinPreset)}
                            className="group relative overflow-hidden rounded-2xl border p-4 text-left transition-all hover:scale-[1.01]"
                            style={{
                              background: active
                                ? `linear-gradient(180deg, ${preset.accent}18, ${previewBg})`
                                : `linear-gradient(180deg, ${previewSurface}, ${previewBg})`,
                              borderColor: active
                                ? preset.accent
                                : T.borderColor + "30",
                              boxShadow: active
                                ? `0 0 0 1px ${preset.accent}30, 0 18px 40px ${preset.accent}12`
                                : "none",
                            }}
                          >
                            <div
                              className="h-24 rounded-xl border overflow-hidden"
                              style={{
                                backgroundColor: previewBg,
                                borderColor: preset.border,
                              }}
                            >
                              <div className="flex h-full">
                                <div
                                  className="w-1/3 p-2 border-r"
                                  style={{
                                    borderColor: preset.border,
                                    backgroundColor: previewSurface,
                                  }}
                                >
                                  <div
                                    className="h-2 w-8 rounded-full mb-2"
                                    style={{ backgroundColor: preset.accent }}
                                  />
                                  <div className="space-y-1">
                                    <div
                                      className="h-1.5 rounded-full"
                                      style={{
                                        backgroundColor: preset.accent + "88",
                                      }}
                                    />
                                    <div
                                      className="h-1.5 rounded-full w-3/4"
                                      style={{ backgroundColor: preset.border }}
                                    />
                                    <div
                                      className="h-1.5 rounded-full w-1/2"
                                      style={{ backgroundColor: preset.border }}
                                    />
                                  </div>
                                </div>
                                <div className="flex-1 p-2">
                                  <div
                                    className="h-3 w-20 rounded-full mb-2"
                                    style={{
                                      backgroundColor: preset.accent + "55",
                                    }}
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <div
                                      className="h-10 rounded-lg border"
                                      style={{
                                        backgroundColor: preset.surface,
                                        borderColor: preset.border,
                                      }}
                                    />
                                    <div
                                      className="h-10 rounded-lg border"
                                      style={{
                                        background: `linear-gradient(135deg, ${preset.accent}44, ${preset.linkColor}33)`,
                                        borderColor: preset.border,
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 flex items-start justify-between gap-2">
                              <div>
                                <div
                                  className="text-sm font-black capitalize"
                                  style={{ color: T.textColor }}
                                >
                                  {preset.id.replace("-", " ")}
                                </div>
                                <div
                                  className="text-[11px] mt-1"
                                  style={{ color: T.textMuted }}
                                >
                                  {preset.id === "volcanic"
                                    ? "Command-center energy"
                                    : preset.id === "neon"
                                      ? "Electric control room"
                                      : preset.id === "midnight"
                                        ? "Luxury space dashboard"
                                        : preset.id === "emerald"
                                          ? "Operational clarity"
                                          : "Premium glass depth"}
                                </div>
                              </div>
                              {active && (
                                <Check
                                  size={14}
                                  style={{ color: preset.accent }}
                                />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div
                      className="rounded-3xl border p-4 sm:p-6"
                      style={cardStyle}
                    >
                      <h2
                        className="text-xl font-black mb-1"
                        style={{ color: T.headerColor }}
                      >
                        Theme Mode
                      </h2>
                      <p
                        className="text-xs mb-4 opacity-70"
                        style={{ color: T.textMuted }}
                      >
                        Daytime mode now uses deep navy (#1a1a2e) text for crisp
                        contrast.
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            { id: "dark", label: "Dark", icon: Moon },
                            { id: "light", label: "Light", icon: Sun },
                            { id: "system", label: "System", icon: Monitor },
                          ] as const
                        ).map((m) => {
                          const Icon = m.icon;
                          const active = theme.mode === m.id;
                          return (
                            <button
                              key={m.id}
                              onClick={() => setMode(m.id)}
                              className="flex flex-col items-start gap-2 px-4 py-3 rounded-2xl text-sm font-bold transition-all"
                              style={{
                                backgroundColor: active
                                  ? `${T.accentColor}18`
                                  : `${T.bgColor}50`,
                                border: active
                                  ? `1px solid ${T.accentColor}45`
                                  : `1px solid ${T.borderColor}30`,
                                color: active ? T.accentColor : T.textColor,
                              }}
                            >
                              <Icon size={16} />
                              {m.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div
                      className="rounded-3xl border p-4 sm:p-6"
                      style={cardStyle}
                    >
                      <h2
                        className="text-xl font-black mb-4"
                        style={{ color: T.headerColor }}
                      >
                        Quick Actions
                      </h2>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => {
                            if (typeof window === "undefined") return;
                            localStorage.setItem(
                              "litlabs-theme-saved",
                              JSON.stringify(theme),
                            );
                            setThemeSaved(true);
                            setTimeout(() => setThemeSaved(false), 2000);
                          }}
                          className="rounded-2xl border px-4 py-3 text-left transition-all"
                          style={{
                            backgroundColor: T.accentColor + "12",
                            borderColor: T.accentColor + "30",
                            color: T.textColor,
                          }}
                        >
                          <div
                            className="text-xs uppercase tracking-[0.18em]"
                            style={{ color: T.textMuted }}
                          >
                            {themeSaved ? "Saved" : "Save"}
                          </div>
                          <div className="mt-1 text-sm font-bold">
                            {themeSaved
                              ? "Current look stored"
                              : "Store current look"}
                          </div>
                        </button>
                        <button
                          className="rounded-2xl border px-4 py-3 text-left"
                          style={{
                            backgroundColor: T.boxBg + "55",
                            borderColor: T.borderColor + "30",
                            color: T.textColor,
                          }}
                          onClick={() => {
                            setMode("dark");
                            setSkin("volcanic");
                            setAccent("sunset-orange");
                          }}
                        >
                          <div
                            className="text-xs uppercase tracking-[0.18em]"
                            style={{ color: T.textMuted }}
                          >
                            Reset
                          </div>
                          <div className="mt-1 text-sm font-bold">
                            Return to base theme
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="grid lg:grid-cols-2 gap-6">
                  <div
                    className="rounded-3xl border p-4 sm:p-6"
                    style={cardStyle}
                  >
                    <h2
                      className="text-xl font-black mb-4"
                      style={{ color: T.headerColor }}
                    >
                      Accent Color
                    </h2>
                    <div className="flex flex-wrap gap-3">
                      {(Object.keys(ACCENT_MAP) as AccentColor[]).map(
                        (accent) => {
                          const active = theme.accent === accent;
                          return (
                            <button
                              key={accent}
                              onClick={() => setAccent(accent)}
                              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all"
                              style={{
                                backgroundColor: active
                                  ? `${ACCENT_MAP[accent].hex}20`
                                  : `${T.bgColor}45`,
                                border: active
                                  ? `1px solid ${ACCENT_MAP[accent].hex}`
                                  : `1px solid ${T.borderColor}30`,
                                color: active
                                  ? ACCENT_MAP[accent].hex
                                  : T.textColor,
                              }}
                            >
                              <span
                                className="w-3 h-3 rounded-full"
                                style={{
                                  backgroundColor: ACCENT_MAP[accent].hex,
                                }}
                              />
                              {accent.replace("-", " ")}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>

                  <div
                    className="rounded-3xl border p-4 sm:p-6"
                    style={cardStyle}
                  >
                    <h2
                      className="text-xl font-black mb-4"
                      style={{ color: T.headerColor }}
                    >
                      Background & Effects
                    </h2>
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {BACKGROUND_MODES.map((mode) => {
                          const active = theme.backgroundMode === mode.id;
                          return (
                            <button
                              key={mode.id}
                              onClick={() => setBackgroundMode(mode.id)}
                              className="px-3 py-2 rounded-xl text-xs font-bold transition-all"
                              style={{
                                backgroundColor: active
                                  ? `${T.accentColor}20`
                                  : `${T.bgColor}45`,
                                border: active
                                  ? `1px solid ${T.accentColor}50`
                                  : `1px solid ${T.borderColor}30`,
                                color: active ? T.accentColor : T.textColor,
                              }}
                            >
                              {mode.label}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => toggleCrt()}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all"
                        style={{
                          backgroundColor: crtEnabled
                            ? `${T.accentColor}20`
                            : `${T.bgColor}45`,
                          border: `1px solid ${crtEnabled ? T.accentColor : T.borderColor}50`,
                          color: crtEnabled ? T.accentColor : T.textColor,
                        }}
                      >
                        <ScanLine size={14} />
                        CRT Scanlines {crtEnabled ? "On" : "Off"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* Workspace Tab */}
            {showSection("studio") && (
              <div className="space-y-6">
                <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
                  <div
                    className="rounded-3xl border p-4 sm:p-6"
                    style={cardStyle}
                  >
                    <h2
                      className="text-xl font-black mb-1"
                      style={{ color: T.headerColor }}
                    >
                      Workspace Controls
                    </h2>
                    <p className="text-xs mb-5" style={{ color: T.textMuted }}>
                      Tune how the site behaves so the whole platform feels like
                      your command center.
                    </p>
                    <div className="space-y-3">
                      {[
                        {
                          title: "Auto-save drafts",
                          desc: "Keep prompt drafts, layouts, and form state saved while you work.",
                          value: autoSaveDrafts,
                          set: setAutoSaveDrafts,
                        },
                        {
                          title: "Compact mode",
                          desc: "Tighter spacing for denser dashboards and faster scanning.",
                          value: compactMode,
                          set: setCompactMode,
                        },
                        {
                          title: "Live preview",
                          desc: "Render changes instantly in settings, studio, and builders.",
                          value: livePreview,
                          set: setLivePreview,
                        },
                        {
                          title: "Telemetry panel",
                          desc: "Show live stats, activity, and system hints in premium surfaces.",
                          value: showTelemetry,
                          set: setShowTelemetry,
                        },
                      ].map((item) => (
                        <button
                          key={item.title}
                          onClick={() => item.set((v) => !v)}
                          className="w-full flex items-center justify-between gap-4 rounded-2xl border px-4 py-4 text-left transition-all"
                          style={{
                            backgroundColor: item.value
                              ? `${T.accentColor}12`
                              : `${T.boxBg}55`,
                            borderColor: item.value
                              ? `${T.accentColor}40`
                              : `${T.borderColor}30`,
                          }}
                        >
                          <div>
                            <div
                              className="text-sm font-black"
                              style={{ color: T.textColor }}
                            >
                              {item.title}
                            </div>
                            <div
                              className="text-xs mt-1 max-w-xl"
                              style={{ color: T.textMuted }}
                            >
                              {item.desc}
                            </div>
                          </div>
                          <div
                            className="h-6 w-11 rounded-full border p-0.5 transition-all"
                            style={{
                              backgroundColor: item.value
                                ? T.accentColor
                                : T.bgColor,
                              borderColor: item.value
                                ? T.accentColor
                                : T.borderColor,
                            }}
                          >
                            <div
                              className="h-full w-5 rounded-full bg-white transition-transform"
                              style={{
                                transform: item.value
                                  ? "translateX(18px)"
                                  : "translateX(0)",
                              }}
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="mt-5 grid sm:grid-cols-2 gap-3">
                      <label className="space-y-1">
                        <span
                          className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                          style={{ color: T.textMuted }}
                        >
                          Default workspace
                        </span>
                        <select
                          id="settings-workspace"
                          name="workspace"
                          value={defaultWorkspace}
                          onChange={(e) => setDefaultWorkspace(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                          style={inputStyle}
                        >
                          <option value="studio">Studio</option>
                          <option value="marketplace">Marketplace</option>
                          <option value="games">Games</option>
                          <option value="gallery">Gallery</option>
                          <option value="dashboard">Dashboard</option>
                        </select>
                      </label>
                      <div className="flex items-end">
                        <button
                          onClick={saveWorkspace}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                          style={{
                            backgroundColor: T.accentColor,
                            color: T.bgColor,
                          }}
                        >
                          {workspaceSaved ? (
                            <Check size={14} />
                          ) : (
                            <Save size={14} />
                          )}
                          {workspaceSaved ? "Saved" : "Save Workspace"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div
                    className="rounded-3xl border p-4 sm:p-6"
                    style={cardStyle}
                  >
                    <h2
                      className="text-xl font-black mb-4"
                      style={{ color: T.headerColor }}
                    >
                      Fast Launch
                    </h2>
                    <div className="grid gap-3">
                      {[
                        {
                          href: "/studio",
                          label: "Open Studio",
                          desc: "Build agents, media, and workflows.",
                        },
                        {
                          href: "/marketplace",
                          label: "Open Marketplace",
                          desc: "Discover installs, templates, and assets.",
                        },
                        {
                          href: "/games",
                          label: "Open Games",
                          desc: "Browse entertainment and relax tools.",
                        },
                        {
                          href: "/gallery",
                          label: "Open Gallery",
                          desc: "Review recent creations and saved work.",
                        },
                        {
                          href: "/admin",
                          label: "Open Admin",
                          desc: "Inspect live telemetry and site health.",
                        },
                      ].map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="rounded-2xl border px-4 py-3 transition-all hover:opacity-90"
                          style={{
                            backgroundColor: `${T.boxBg}55`,
                            borderColor: `${T.borderColor}30`,
                          }}
                        >
                          <div
                            className="text-sm font-black"
                            style={{ color: T.textColor }}
                          >
                            {item.label}
                          </div>
                          <div
                            className="text-xs mt-1"
                            style={{ color: T.textMuted }}
                          >
                            {item.desc}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* CLI Tools Tab */}
            {showSection("developer") && (
              <div className="space-y-6">
                <section className="grid xl:grid-cols-[0.75fr_1.25fr] gap-6">
                  <div className="space-y-4">
                    <div
                      className="rounded-3xl border p-4 sm:p-6"
                      style={cardStyle}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="h-10 w-10 shrink-0 rounded-2xl flex items-center justify-center border"
                          style={{
                            backgroundColor: `${T.accentColor}14`,
                            borderColor: `${T.accentColor}35`,
                            color: T.accentColor,
                          }}
                        >
                          <Terminal size={18} />
                        </div>
                        <div>
                          <h2
                            className="text-xl font-black"
                            style={{ color: T.headerColor }}
                          >
                            CLI Tools
                          </h2>
                          <p
                            className="text-xs mt-1 leading-relaxed"
                            style={{ color: T.textMuted }}
                          >
                            Launch Qwen, Hermes, Gemini, OpenClaw, or a shell
                            from the same bridge used in Studio. Access is
                            limited to authorized admin accounts.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div
                      className="rounded-3xl border p-4 sm:p-6"
                      style={cardStyle}
                    >
                      <h3
                        className="text-sm font-black mb-3"
                        style={{ color: T.headerColor }}
                      >
                        Connected Surfaces
                      </h3>
                      <div className="grid gap-3">
                        {[
                          {
                            href: "/studio",
                            label: "Studio Tools",
                            desc: "Open the full creative workspace.",
                            icon: LayoutGrid,
                          },
                          {
                            href: "/admin/terminal",
                            label: "Admin Terminal",
                            desc: "Jump to the dedicated terminal view.",
                            icon: Terminal,
                          },
                          {
                            href: "/admin",
                            label: "Admin Console",
                            desc: "Review health, live activity, and platform controls.",
                            icon: ShieldCheck,
                          },
                        ].map((item) => {
                          const Icon = item.icon;
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              className="flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all hover:opacity-90"
                              style={{
                                backgroundColor: `${T.boxBg}55`,
                                borderColor: `${T.borderColor}30`,
                              }}
                            >
                              <Icon
                                size={16}
                                style={{ color: T.accentColor }}
                              />
                              <span className="min-w-0">
                                <span
                                  className="block text-sm font-black"
                                  style={{ color: T.textColor }}
                                >
                                  {item.label}
                                </span>
                                <span
                                  className="block text-xs mt-0.5"
                                  style={{ color: T.textMuted }}
                                >
                                  {item.desc}
                                </span>
                              </span>
                              <ExternalLink
                                size={14}
                                className="ml-auto shrink-0 opacity-60"
                                style={{ color: T.textMuted }}
                              />
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div
                    className="min-h-[560px] overflow-hidden rounded-3xl border"
                    style={{
                      backgroundColor: `${T.boxBg}60`,
                      borderColor: `${T.borderColor}30`,
                    }}
                  >
                    <CLIBridgeTool />
                  </div>
                </section>
              </div>
            )}

            {/* BYOK Tab */}
            {showSection("ai-agents") && (
              <div className="space-y-6">
                <div
                  className="rounded-2xl border p-4 sm:p-6"
                  style={cardStyle}
                >
                  <div className="flex items-start gap-3 mb-5">
                    <AlertTriangle size={18} style={{ color: "#f59e0b" }} />
                    <div>
                      <h2
                        className="text-lg font-black"
                        style={{ color: T.headerColor }}
                      >
                        Bring Your Own Keys
                      </h2>
                      <p
                        className="text-xs opacity-70 max-w-2xl"
                        style={{ color: T.textMuted }}
                      >
                        Keys are stored in your browser and sent to LiTT Code
                        servers when you use agent features. Never commit keys
                        to a repo.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {BYOK_KEYS.map((k) => (
                      <div key={k.id} className="space-y-1">
                        <label
                          className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                          style={{ color: T.textMuted }}
                        >
                          {k.label} ({k.env})
                        </label>
                        <input
                          id="settings-api-key"
                          name="apiKey"
                          type="password"
                          value={keys[k.id] || ""}
                          onChange={(e) =>
                            setKeys((prev) => ({
                              ...prev,
                              [k.id]: e.target.value,
                            }))
                          }
                          placeholder={`Paste your ${k.label} key`}
                          className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                          style={inputStyle}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-5">
                    <button
                      onClick={saveKeys}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                      style={{
                        backgroundColor: T.accentColor,
                        color: T.bgColor,
                      }}
                    >
                      {keysSaved ? <Check size={14} /> : <Save size={14} />}
                      {keysSaved ? "Saved" : "Save Keys"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Notifications Tab */}
            {showSection("notifications") && (
              <div className="space-y-6">
                <div
                  className="rounded-2xl border p-4 sm:p-6"
                  style={cardStyle}
                >
                  <h2
                    className="text-lg font-black mb-1"
                    style={{ color: T.headerColor }}
                  >
                    Notification Channels
                  </h2>
                  <p
                    className="text-xs mb-5 opacity-70"
                    style={{ color: T.textMuted }}
                  >
                    Connect how you want to be alerted.
                  </p>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label
                        className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                        style={{ color: T.textMuted }}
                      >
                        Discord Webhook URL
                      </label>
                      <input
                        id="settings-discord-webhook"
                        name="discordWebhook"
                        value={discordWebhook}
                        onChange={(e) => setDiscordWebhook(e.target.value)}
                        placeholder="https://discord.com/api/webhooks/..."
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                        style={inputStyle}
                      />
                    </div>
                    <div
                      className="flex items-center justify-between p-3 rounded-lg border"
                      style={inputStyle}
                    >
                      <div>
                        <div
                          className="text-sm font-bold"
                          style={{ color: T.textColor }}
                        >
                          Alexa Voice Monkey
                        </div>
                        <div
                          className="text-[10px] opacity-70"
                          style={{ color: T.textMuted }}
                        >
                          Announce alerts on your Echo devices.
                        </div>
                      </div>
                      <button
                        onClick={() => setAlexaEnabled((v) => !v)}
                        className="w-12 h-6 rounded-full transition-colors relative"
                        style={{
                          backgroundColor: alexaEnabled
                            ? T.accentColor
                            : `${T.borderColor}50`,
                        }}
                      >
                        <span
                          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                          style={{
                            transform: alexaEnabled
                              ? "translateX(24px)"
                              : "translateX(0)",
                          }}
                        />
                      </button>
                    </div>
                    <div
                      className="flex items-center justify-between p-3 rounded-lg border"
                      style={inputStyle}
                    >
                      <div>
                        <div
                          className="text-sm font-bold"
                          style={{ color: T.textColor }}
                        >
                          Weekly Email Digest
                        </div>
                        <div
                          className="text-[10px] opacity-70"
                          style={{ color: T.textMuted }}
                        >
                          Summary of your agent activity and coin balance.
                        </div>
                      </div>
                      <button
                        onClick={() => setEmailDigest((v) => !v)}
                        className="w-12 h-6 rounded-full transition-colors relative"
                        style={{
                          backgroundColor: emailDigest
                            ? T.accentColor
                            : `${T.borderColor}50`,
                        }}
                      >
                        <span
                          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                          style={{
                            transform: emailDigest
                              ? "translateX(24px)"
                              : "translateX(0)",
                          }}
                        />
                      </button>
                    </div>
                  </div>
                  <div className="mt-5">
                    <button
                      onClick={saveNotifications}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                      style={{
                        backgroundColor: T.accentColor,
                        color: T.bgColor,
                      }}
                    >
                      {notifSaved ? <Check size={14} /> : <Save size={14} />}
                      {notifSaved ? "Saved" : "Save Notifications"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Billing Tab */}
            {showSection("billing") && (
              <div className="space-y-6">
                <div
                  className="rounded-2xl border p-4 sm:p-6"
                  style={cardStyle}
                >
                  <h2
                    className="text-lg font-black mb-1"
                    style={{ color: T.headerColor }}
                  >
                    Membership
                  </h2>
                  <p
                    className="text-xs mb-5 opacity-70"
                    style={{ color: T.textMuted }}
                  >
                    Your current plan.
                  </p>
                  <div className="grid grid-cols-1 gap-4">
                    <div
                      className="rounded-xl border p-4"
                      style={{
                        backgroundColor: `${T.boxBg}80`,
                        borderColor: `${T.borderColor}40`,
                      }}
                    >
                      <div
                        className="text-[10px] font-mono uppercase tracking-wider opacity-70 mb-1"
                        style={{ color: T.textMuted }}
                      >
                        Current Plan
                      </div>
                      <div
                        className="text-2xl font-black capitalize"
                        style={{ color: T.headerColor }}
                      >
                        {planLoading ? "Loading..." : plan.plan}
                      </div>
                      <div
                        className="text-xs mt-1"
                        style={{ color: T.textMuted }}
                      >
                        {plan.status
                          ? `${plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}`
                          : ""}
                        {plan.current_period_end
                          ? ` · Renews ${new Date(plan.current_period_end).toLocaleDateString()}`
                          : ""}
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      href="/marketplace"
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                      style={{
                        backgroundColor: T.accentColor,
                        color: T.bgColor,
                      }}
                    >
                      <Coins size={14} /> Upgrade Plan
                    </Link>
                    <Link
                      href="/wallet"
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90 border"
                      style={{
                        borderColor: `${T.borderColor}40`,
                        color: T.textColor,
                      }}
                    >
                      <CreditCard size={14} /> Manage Wallet
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Account Tab */}
            {showSection("account") && (
              <div className="space-y-6">
                <div
                  className="rounded-2xl border p-4 sm:p-6"
                  style={cardStyle}
                >
                  <h2
                    className="text-lg font-black mb-1"
                    style={{ color: T.headerColor }}
                  >
                    Account Security
                  </h2>
                  <p
                    className="text-xs mb-5 opacity-70"
                    style={{ color: T.textMuted }}
                  >
                    Manage your session and account details.
                  </p>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label
                        className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                        style={{ color: T.textMuted }}
                      >
                        Email
                      </label>
                      <input
                        id="settings-email"
                        name="email"
                        value={user?.primaryEmailAddress?.emailAddress || ""}
                        readOnly
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                        style={inputStyle}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3 pt-2">
                      <form action="/api/auth/logout" method="POST">
                        <button
                          type="submit"
                          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90 border"
                          style={{
                            borderColor: `${T.borderColor}40`,
                            color: T.textColor,
                          }}
                        >
                          <LogOut size={14} /> Sign Out
                        </button>
                      </form>
                    </div>
                  </div>
                </div>

                <div
                  className="rounded-2xl border p-4 sm:p-6"
                  style={{
                    ...cardStyle,
                    borderColor: "#ef444450",
                    backgroundColor: "#7f1d1d15",
                  }}
                >
                  <h2
                    className="text-lg font-black mb-1"
                    style={{ color: "#fca5a5" }}
                  >
                    Danger Zone
                  </h2>
                  <p
                    className="text-xs mb-5 opacity-70"
                    style={{ color: "#fca5a5" }}
                  >
                    These actions are permanent. Contact support to delete your
                    account.
                  </p>
                  <button
                    disabled
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all opacity-50 cursor-not-allowed"
                    style={{ backgroundColor: "#ef4444", color: "#ffffff" }}
                  >
                    <AlertTriangle size={14} /> Delete Account (contact support)
                  </button>
                </div>
              </div>
            )}
            {/* Connections Section */}
            {showSection("connections") && (
              <div className="space-y-6">
                <div
                  className="rounded-2xl border p-4 sm:p-6"
                  style={cardStyle}
                >
                  <h2
                    className="text-lg font-black mb-1"
                    style={{ color: T.headerColor }}
                  >
                    Connections
                  </h2>
                  <p
                    className="text-xs mb-5 opacity-70"
                    style={{ color: T.textMuted }}
                  >
                    Connect third-party accounts, integrations, and APIs.
                  </p>
                  <div className="text-sm" style={{ color: T.textMuted }}>
                    Integrations will appear here.
                  </div>
                </div>
              </div>
            )}

            {/* Security Section */}
            {showSection("security") && (
              <div className="space-y-6">
                <div
                  className="rounded-2xl border p-4 sm:p-6"
                  style={cardStyle}
                >
                  <h2
                    className="text-lg font-black mb-1"
                    style={{ color: T.headerColor }}
                  >
                    Security
                  </h2>
                  <p
                    className="text-xs mb-5 opacity-70"
                    style={{ color: T.textMuted }}
                  >
                    Two-factor authentication, password changes, and session
                    management.
                  </p>
                  <div className="text-sm" style={{ color: T.textMuted }}>
                    Security settings will appear here.
                  </div>
                </div>
              </div>
            )}

            {/* Privacy Section */}
            {showSection("privacy") && (
              <div className="space-y-6">
                <div
                  className="rounded-2xl border p-4 sm:p-6"
                  style={cardStyle}
                >
                  <h2
                    className="text-lg font-black mb-1"
                    style={{ color: T.headerColor }}
                  >
                    Privacy
                  </h2>
                  <p
                    className="text-xs mb-5 opacity-70"
                    style={{ color: T.textMuted }}
                  >
                    Data export, cookie preferences, and privacy controls.
                  </p>
                  <div className="text-sm" style={{ color: T.textMuted }}>
                    Privacy settings will appear here.
                  </div>
                </div>
              </div>
            )}

            {visibleSectionIds.length === 0 && query && (
              <div className="text-sm" style={{ color: T.textMuted }}>
                No settings found
              </div>
            )}
          </main>
        </div>
      </div>
    </PageShell>
  );
}
