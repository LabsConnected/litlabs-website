"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useTheme, useCrtToggle, ACCENT_MAP } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useWallet } from "@/context/WalletContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import { THEMES } from "@/lib/themes";

const CLIBridgeTool = dynamic(
  () => import("@/app/studio/tools/CLIBridgeTool"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-48 items-center justify-center text-xs text-slate-400">
        Loading CLI Bridge…
      </div>
    ),
  },
);
import type { BackgroundMode } from "@/components/AnimatedBackground";
import type { SkinPreset, AccentColor } from "@/context/ThemeContext";
import {
  User,
  Palette,
  Key,
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
  GitBranch,
  Plus,
  BarChart3,
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

const TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "workspace", label: "Workspace", icon: LayoutGrid },
  { id: "integrations", label: "Integrations", icon: GitBranch },
  { id: "cli", label: "CLI Tools", icon: Terminal },
  { id: "keys", label: "BYOK", icon: Key },
  { id: "usage", label: "Usage", icon: BarChart3 },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

type TabId = (typeof TABS)[number]["id"];

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
  const { balance } = useWallet();
  const { crtEnabled, toggleCrt } = useCrtToggle();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window === "undefined") return "profile";
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab && TABS.some((t) => t.id === tab) ? (tab as TabId) : "profile";
  });

  /* Integrations state */
  const [installations, setInstallations] = useState<
    { id: number; account: string | null }[]
  >([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [integrationsError, setIntegrationsError] = useState<string | null>(
    () => {
      if (typeof window === "undefined") return null;
      return new URLSearchParams(window.location.search).get("error");
    },
  );

  // Load GitHub integration status when the integrations tab is active
  useEffect(() => {
    if (!isSignedIn || activeTab !== "integrations") return;
    const taskId = setTimeout(() => setIntegrationsLoading(true), 0);
    fetch("/api/github/installations")
      .finally(() => clearTimeout(taskId))
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text();
          let message = `GitHub API error (${r.status})`;
          try {
            const json = JSON.parse(text);
            if (json.error) message = json.error;
          } catch {
            // keep status message
          }
          throw new Error(message);
        }
        return r.json();
      })
      .then((data) => {
        setInstallations(data.installations || []);
        setIntegrationsError(null);
      })
      .catch((err) => {
        setIntegrationsError(
          err instanceof Error ? err.message : "Failed to load GitHub status",
        );
      })
      .finally(() => setIntegrationsLoading(false));
  }, [isSignedIn, activeTab]);

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

  /* Usage state */
  type UsageDaily = {
    date: string;
    commands: number;
    agentTasks: number;
    generations: number;
  };
  type UsageSummary = {
    totalCommands: number;
    totalAgentTasks: number;
    totalGenerations: number;
    hourlyUsed: number;
    hourlyLimit: number;
    role: string;
    plan: string;
  };
  const [usageDaily, setUsageDaily] = useState<UsageDaily[]>([]);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageDemo, setUsageDemo] = useState(false);

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

  /* Load remote preferences once */
  useEffect(() => {
    if (!isSignedIn) return;
    fetch("/api/settings/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.preferences) return;
        const p = data.preferences;
        setDiscordWebhook(p.notify_discord || "");
        setAlexaEnabled(Boolean(p.notify_alexa));
        setEmailDigest(Boolean(p.notify_email));
        setAutoSaveDrafts(p.workspace_autosave ?? true);
        setCompactMode(Boolean(p.workspace_compact));
        setLivePreview(p.workspace_live_preview ?? true);
        setShowTelemetry(Boolean(p.workspace_telemetry));
        setDefaultWorkspace(p.workspace_default || "studio");
      })
      .catch(() => {});
  }, [isSignedIn]);

  /* Load usage stats when the usage tab is active */
  useEffect(() => {
    if (!isSignedIn || activeTab !== "usage") return;
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      setUsageLoading(true);
      fetch("/api/usage/stats")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data) return;
          setUsageDaily(data.daily || []);
          setUsageSummary(data.summary || null);
          setUsageDemo(Boolean(data.demo));
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setUsageLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [isSignedIn, activeTab]);

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
    const payload = {
      notify_discord: discordWebhook,
      notify_alexa: alexaEnabled,
      notify_email: emailDigest,
    };
    const fallback = () => {
      localStorage.setItem("litlabs-notify-discord", discordWebhook);
      localStorage.setItem("litlabs-notify-alexa", String(alexaEnabled));
      localStorage.setItem("litlabs-notify-email", String(emailDigest));
    };
    try {
      const res = await fetch("/api/settings/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) fallback();
    } catch {
      fallback();
    }
    setNotifSaved(true);
    setTimeout(() => setNotifSaved(false), 2000);
  }, [discordWebhook, alexaEnabled, emailDigest]);

  const saveWorkspace = useCallback(async () => {
    if (typeof window === "undefined") return;
    const payload = {
      workspace_autosave: autoSaveDrafts,
      workspace_compact: compactMode,
      workspace_live_preview: livePreview,
      workspace_telemetry: showTelemetry,
      workspace_default: defaultWorkspace,
    };
    const fallback = () => {
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
    };
    try {
      const res = await fetch("/api/settings/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) fallback();
    } catch {
      fallback();
    }
    setWorkspaceSaved(true);
    setTimeout(() => setWorkspaceSaved(false), 2000);
  }, [
    autoSaveDrafts,
    compactMode,
    livePreview,
    showTelemetry,
    defaultWorkspace,
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
          <p
            className="mb-4 opacity-70"
            style={{ color: T.textColor, opacity: 0.7 }}
          >
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
      subtitle="Profile, appearance, keys, and notifications — all in one place."
      icon="⚙️"
    >
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Wallet strip */}
        <div
          className="mb-6 flex flex-wrap items-center gap-3 p-3 rounded-xl border text-sm"
          style={cardStyle}
        >
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold"
            style={{
              backgroundColor: `${T.accentColor}15`,
              color: T.accentColor,
            }}
          >
            <Coins size={14} /> {balance.toLocaleString()} LiTBits
          </div>
          <span
            className="opacity-60"
            style={{ color: T.textColor, opacity: 0.7 }}
          >
            Your balance is synced across every page.
          </span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-2 mb-6 scrollbar-hide">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-current={active ? "true" : undefined}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap transition-all"
                style={{
                  backgroundColor: active
                    ? `${T.accentColor}20`
                    : `${T.boxBg}40`,
                  border: active
                    ? `1px solid ${T.accentColor}50`
                    : `1px solid ${T.borderColor}30`,
                  color: active ? T.accentColor : T.textColor,
                  opacity: active ? 1 : 0.7,
                }}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div className="space-y-6">
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2
                className="text-lg font-black mb-1"
                style={{ color: T.headerColor }}
              >
                Public Profile
              </h2>
              <p
                className="text-xs mb-5 opacity-70"
                style={{ color: T.textColor, opacity: 0.7 }}
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
                ].map((field) => {
                  const id = `profile-${field.label.toLowerCase().replace(/\s+/g, "-")}`;
                  return (
                    <div key={field.label} className="space-y-1">
                      <label
                        htmlFor={id}
                        className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                        style={{ color: T.textColor, opacity: 0.7 }}
                      >
                        {field.label}
                      </label>
                      <input
                        id={id}
                        name={id}
                        value={field.value}
                        onChange={(e) => field.set(e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                        style={inputStyle}
                      />
                    </div>
                  );
                })}
                <div className="sm:col-span-2 space-y-1">
                  <label
                    htmlFor="profile-avatar-url"
                    className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                    style={{ color: T.textColor, opacity: 0.7 }}
                  >
                    Avatar URL
                  </label>
                  <input
                    id="profile-avatar-url"
                    name="profile-avatar-url"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                    style={inputStyle}
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label
                    htmlFor="profile-bio"
                    className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                    style={{ color: T.textColor, opacity: 0.7 }}
                  >
                    Bio
                  </label>
                  <textarea
                    id="profile-bio"
                    name="profile-bio"
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
                  style={{ backgroundColor: T.accentColor, color: T.bgColor }}
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
        {activeTab === "appearance" && (
          <div className="space-y-6">
            <section className="grid lg:grid-cols-[1.15fr_0.85fr] gap-6">
              <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
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
                      style={{ color: T.textColor, opacity: 0.7 }}
                    >
                      Five premium directions designed as real visual systems,
                      not color chips.
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
                    const previewSurface = isDark ? preset.surface : "#ffffff";
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
                              style={{ color: T.textColor, opacity: 0.7 }}
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
                            <Check size={14} style={{ color: preset.accent }} />
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
                    style={{ color: T.textColor, opacity: 0.7 }}
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
                        style={{ color: T.textColor, opacity: 0.7 }}
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
                        style={{ color: T.textColor, opacity: 0.7 }}
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
              <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
                <h2
                  className="text-xl font-black mb-4"
                  style={{ color: T.headerColor }}
                >
                  Accent Color
                </h2>
                <div className="flex flex-wrap gap-3">
                  {(Object.keys(ACCENT_MAP) as AccentColor[]).map((accent) => {
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
                          color: active ? ACCENT_MAP[accent].hex : T.textColor,
                        }}
                      >
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: ACCENT_MAP[accent].hex }}
                        />
                        {accent.replace("-", " ")}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
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
        {activeTab === "workspace" && (
          <div className="space-y-6">
            <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
              <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
                <h2
                  className="text-xl font-black mb-1"
                  style={{ color: T.headerColor }}
                >
                  Workspace Controls
                </h2>
                <p
                  className="text-xs mb-5"
                  style={{ color: T.textColor, opacity: 0.7 }}
                >
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
                      aria-pressed={item.value}
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
                          style={{ color: T.textColor, opacity: 0.7 }}
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
                  <div className="space-y-1">
                    <label
                      htmlFor="workspace-default"
                      className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                      style={{ color: T.textColor, opacity: 0.7 }}
                    >
                      Default workspace
                    </label>
                    <select
                      id="workspace-default"
                      name="workspace-default"
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
                  </div>
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

              <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
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
                        style={{ color: T.textColor, opacity: 0.7 }}
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
        {activeTab === "cli" && (
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
                        style={{ color: T.textColor, opacity: 0.7 }}
                      >
                        Launch Qwen, Hermes, Gemini, OpenClaw, or a shell from
                        the same bridge used in Studio. Access is limited to
                        authorized admin accounts.
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
                          <Icon size={16} style={{ color: T.accentColor }} />
                          <span className="min-w-0">
                            <span
                              className="block text-sm font-black"
                              style={{ color: T.textColor }}
                            >
                              {item.label}
                            </span>
                            <span
                              className="block text-xs mt-0.5"
                              style={{ color: T.textColor, opacity: 0.7 }}
                            >
                              {item.desc}
                            </span>
                          </span>
                          <ExternalLink
                            size={14}
                            className="ml-auto shrink-0 opacity-60"
                            style={{ color: T.textColor, opacity: 0.7 }}
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
        {activeTab === "keys" && (
          <div className="space-y-6">
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
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
                    style={{ color: T.textColor, opacity: 0.7 }}
                  >
                    Keys are stored in your browser and sent to
                    LiTTree-LabStudios servers when you use agent features.
                    Never commit keys to a repo.
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {BYOK_KEYS.map((k) => (
                  <div key={k.id} className="space-y-1">
                    <label
                      htmlFor={`byok-${k.id}`}
                      className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                      style={{ color: T.textColor, opacity: 0.7 }}
                    >
                      {k.label} ({k.env})
                    </label>
                    <input
                      id={`byok-${k.id}`}
                      name={`byok-${k.id}`}
                      type="password"
                      value={keys[k.id] || ""}
                      onChange={(e) =>
                        setKeys((prev) => ({ ...prev, [k.id]: e.target.value }))
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
                  style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                >
                  {keysSaved ? <Check size={14} /> : <Save size={14} />}
                  {keysSaved ? "Saved" : "Save Keys"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Integrations Tab */}
        {activeTab === "integrations" && (
          <div className="space-y-6">
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <div className="flex items-start gap-3 mb-5">
                <GitBranch size={20} style={{ color: T.accentColor }} />
                <div>
                  <h2
                    className="text-lg font-black"
                    style={{ color: T.headerColor }}
                  >
                    GitHub Integration
                  </h2>
                  <p
                    className="text-xs opacity-70 max-w-2xl"
                    style={{ color: T.textColor, opacity: 0.7 }}
                  >
                    Connect a GitHub repository to create a real, isolated
                    workspace. LiTT uses a GitHub App — you choose exactly which
                    repos to access.
                  </p>
                </div>
              </div>

              {integrationsLoading ? (
                <div
                  className="flex items-center gap-2 text-sm"
                  style={{ color: T.textColor, opacity: 0.7 }}
                >
                  <Loader2 size={16} className="animate-spin" />
                  Checking GitHub status…
                </div>
              ) : integrationsError ? (
                <div
                  className="rounded-xl border p-4 mb-4"
                  style={{
                    borderColor: "#ef444440",
                    backgroundColor: "#ef444408",
                  }}
                >
                  <div
                    className="text-sm font-bold mb-1"
                    style={{ color: T.textColor }}
                  >
                    GitHub integration is not ready
                  </div>
                  <p
                    className="text-xs mb-3"
                    style={{ color: T.textColor, opacity: 0.7 }}
                  >
                    {integrationsError}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: T.textColor, opacity: 0.7 }}
                  >
                    Ask the site owner to configure the GitHub App environment
                    variables (GITHUB_APP_ID and GITHUB_PRIVATE_KEY) before
                    connecting a repository.
                  </p>
                </div>
              ) : (
                <>
                  {installations.length === 0 ? (
                    <div
                      className="rounded-xl border p-4 mb-4"
                      style={{
                        borderColor: `${T.borderColor}40`,
                        backgroundColor: `${T.boxBg}80`,
                      }}
                    >
                      <div
                        className="text-sm font-bold mb-1"
                        style={{ color: T.textColor }}
                      >
                        No GitHub account connected
                      </div>
                      <p
                        className="text-xs mb-3"
                        style={{ color: T.textColor, opacity: 0.7 }}
                      >
                        Connect your GitHub account to choose repositories for
                        LiTT workspaces.
                      </p>
                      <a
                        href="/api/github/install"
                        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all hover:opacity-90"
                        style={{
                          backgroundColor: T.accentColor,
                          color: T.bgColor,
                        }}
                      >
                        <Plus size={14} /> Connect GitHub
                      </a>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div
                        className="text-[10px] font-black uppercase tracking-widest"
                        style={{ color: T.textColor, opacity: 0.7 }}
                      >
                        Connected GitHub accounts
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {installations.map((i) => (
                          <div
                            key={String(i.id)}
                            className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold"
                            style={{
                              borderColor: `${T.accentColor}25`,
                              color: T.textColor,
                              backgroundColor: `${T.accentColor}08`,
                            }}
                          >
                            <GitBranch
                              size={10}
                              style={{ color: T.accentColor }}
                            />
                            {i.account ?? `Installation ${i.id}`}
                          </div>
                        ))}
                      </div>
                      <a
                        href="/api/github/install"
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold border transition-all hover:opacity-80"
                        style={{
                          borderColor: `${T.borderColor}40`,
                          color: T.textColor,
                        }}
                      >
                        <Plus size={12} /> Connect another account
                      </a>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Usage Tab */}
        {activeTab === "usage" && (
          <div className="space-y-6">
            {usageLoading ? (
              <div
                className="rounded-2xl border p-8 flex items-center justify-center"
                style={cardStyle}
              >
                <Loader2
                  className="animate-spin"
                  style={{ color: T.accentColor }}
                />
              </div>
            ) : usageSummary ? (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    {
                      label: "Commands",
                      value: usageSummary.totalCommands,
                      color: "#22d3ee",
                    },
                    {
                      label: "Agent Tasks",
                      value: usageSummary.totalAgentTasks,
                      color: "#34d399",
                    },
                    {
                      label: "Generations",
                      value: usageSummary.totalGenerations,
                      color: "#a78bfa",
                    },
                    {
                      label: "Hourly Quota",
                      value: `${usageSummary.hourlyUsed}/${usageSummary.hourlyLimit === Infinity ? "∞" : usageSummary.hourlyLimit}`,
                      color: "#f59e0b",
                    },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-xl border p-4"
                      style={cardStyle}
                    >
                      <div
                        className="text-[10px] font-mono uppercase tracking-wider mb-1"
                        style={{ color: T.textColor, opacity: 0.7 }}
                      >
                        {stat.label}
                      </div>
                      <div
                        className="text-2xl font-black"
                        style={{ color: stat.color }}
                      >
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Plan badge */}
                <div
                  className="flex items-center justify-between p-4 rounded-xl border"
                  style={cardStyle}
                >
                  <div>
                    <div
                      className="text-sm font-bold"
                      style={{ color: T.textColor }}
                    >
                      Plan: {usageSummary.plan}
                    </div>
                    <div
                      className="text-[10px] opacity-70"
                      style={{ color: T.textColor, opacity: 0.7 }}
                    >
                      {usageSummary.role === "admin"
                        ? "Unlimited usage — admin account"
                        : `Hourly limit: ${usageSummary.hourlyLimit} commands`}
                    </div>
                  </div>
                  <div
                    className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
                    style={{
                      backgroundColor: `${T.accentColor}20`,
                      color: T.accentColor,
                      border: `1px solid ${T.accentColor}40`,
                    }}
                  >
                    {usageSummary.role}
                  </div>
                </div>

                {/* Chart */}
                <div
                  className="rounded-2xl border p-4 sm:p-6"
                  style={cardStyle}
                >
                  <h2
                    className="text-lg font-black mb-1"
                    style={{ color: T.headerColor }}
                  >
                    14-Day Activity
                  </h2>
                  <p
                    className="text-xs mb-5 opacity-70"
                    style={{ color: T.textColor, opacity: 0.7 }}
                  >
                    {usageDemo
                      ? "Demo data — connect Supabase for real stats."
                      : "Daily breakdown of your platform usage."}
                  </p>

                  {/* Stacked bar chart */}
                  <div className="flex items-end gap-1 h-40 sm:h-48">
                    {usageDaily.map((day) => {
                      const maxVal = Math.max(
                        ...usageDaily.map(
                          (d) => d.commands + d.agentTasks + d.generations,
                        ),
                        1,
                      );
                      const total =
                        day.commands + day.agentTasks + day.generations;
                      const totalH = (total / maxVal) * 100;
                      const cmdH =
                        total > 0 ? (day.commands / total) * totalH : 0;
                      const taskH =
                        total > 0 ? (day.agentTasks / total) * totalH : 0;
                      const genH =
                        total > 0 ? (day.generations / total) * totalH : 0;
                      return (
                        <div
                          key={day.date}
                          className="flex-1 flex flex-col justify-end items-center group relative"
                          style={{ minWidth: 8 }}
                        >
                          <div
                            className="w-full rounded-t-sm overflow-hidden flex flex-col justify-end transition-all hover:opacity-80"
                            style={{ height: `${totalH}%` }}
                          >
                            <div
                              style={{
                                height: `${genH}%`,
                                backgroundColor: "#a78bfa",
                              }}
                            />
                            <div
                              style={{
                                height: `${taskH}%`,
                                backgroundColor: "#34d399",
                              }}
                            />
                            <div
                              style={{
                                height: `${cmdH}%`,
                                backgroundColor: "#22d3ee",
                              }}
                            />
                          </div>
                          {/* Tooltip */}
                          <div
                            className="absolute -top-16 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-lg px-2 py-1 text-[10px] font-mono whitespace-nowrap z-10"
                            style={{
                              backgroundColor: T.boxBg,
                              border: `1px solid ${T.borderColor}60`,
                              color: T.textColor,
                            }}
                          >
                            <div style={{ color: T.textColor, opacity: 0.7 }}>
                              {day.date.slice(5)}
                            </div>
                            <div style={{ color: "#22d3ee" }}>
                              Cmd: {day.commands}
                            </div>
                            <div style={{ color: "#34d399" }}>
                              Tasks: {day.agentTasks}
                            </div>
                            <div style={{ color: "#a78bfa" }}>
                              Gen: {day.generations}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-4 mt-4">
                    {[
                      { label: "Commands", color: "#22d3ee" },
                      { label: "Agent Tasks", color: "#34d399" },
                      { label: "Generations", color: "#a78bfa" },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center gap-1.5"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-sm"
                          style={{ backgroundColor: item.color }}
                        />
                        <span
                          className="text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: T.textColor, opacity: 0.7 }}
                        >
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Hourly quota bar */}
                {usageSummary.hourlyLimit !== Infinity && (
                  <div
                    className="rounded-2xl border p-4 sm:p-6"
                    style={cardStyle}
                  >
                    <h2
                      className="text-sm font-black mb-3"
                      style={{ color: T.headerColor }}
                    >
                      Hourly Command Quota
                    </h2>
                    <div
                      className="w-full h-3 rounded-full overflow-hidden"
                      style={{ backgroundColor: `${T.borderColor}40` }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(
                            100,
                            (usageSummary.hourlyUsed /
                              usageSummary.hourlyLimit) *
                              100,
                          )}%`,
                          backgroundColor:
                            usageSummary.hourlyUsed >= usageSummary.hourlyLimit
                              ? "#ef4444"
                              : T.accentColor,
                        }}
                      />
                    </div>
                    <div
                      className="text-[10px] mt-2 font-mono"
                      style={{ color: T.textColor, opacity: 0.7 }}
                    >
                      {usageSummary.hourlyUsed} / {usageSummary.hourlyLimit}{" "}
                      used this hour
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div
                className="rounded-2xl border p-8 text-center"
                style={cardStyle}
              >
                <p
                  className="text-sm"
                  style={{ color: T.textColor, opacity: 0.7 }}
                >
                  Unable to load usage data. Try refreshing.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === "notifications" && (
          <div className="space-y-6">
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2
                className="text-lg font-black mb-1"
                style={{ color: T.headerColor }}
              >
                Notification Channels
              </h2>
              <p
                className="text-xs mb-5 opacity-70"
                style={{ color: T.textColor, opacity: 0.7 }}
              >
                Connect how you want to be alerted.
              </p>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label
                    htmlFor="discord-webhook"
                    className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                    style={{ color: T.textColor, opacity: 0.7 }}
                  >
                    Discord Webhook URL
                  </label>
                  <input
                    id="discord-webhook"
                    name="discord-webhook"
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
                      style={{ color: T.textColor, opacity: 0.7 }}
                    >
                      Announce alerts on your Echo devices.
                    </div>
                  </div>
                  <button
                    onClick={() => setAlexaEnabled((v) => !v)}
                    aria-pressed={alexaEnabled}
                    aria-label="Toggle Alexa Voice Monkey announcements"
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
                      style={{ color: T.textColor, opacity: 0.7 }}
                    >
                      Summary of your agent activity and coin balance.
                    </div>
                  </div>
                  <button
                    onClick={() => setEmailDigest((v) => !v)}
                    aria-pressed={emailDigest}
                    aria-label="Toggle weekly email digest"
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
                  style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                >
                  {notifSaved ? <Check size={14} /> : <Save size={14} />}
                  {notifSaved ? "Saved" : "Save Notifications"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
