"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme, useCrtToggle, ACCENT_MAP } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useWallet } from "@/context/WalletContext";
import { useAppUser, useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import CLIBridgeTool from "@/app/studio/tools/CLIBridgeTool";
import { THEMES } from "@/lib/themes";
import type { BackgroundMode } from "@/components/AnimatedBackground";
import type { SkinPreset, AccentColor } from "@/context/ThemeContext";
import { WALLPAPERS, type WallpaperId } from "@/lib/wallpapers";
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
  Bot,
  CreditCard,
  Upload,
  Trash2,
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
  { id: "profile", label: "Account", icon: User },
  { id: "workspace", label: "Studio", icon: LayoutGrid },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "keys", label: "AI Models", icon: Key },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "billing", label: "Billing & Credits", icon: CreditCard },
  { id: "cli", label: "Advanced", icon: Terminal },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string | null): value is TabId {
  return !!value && TABS.some((tab) => tab.id === value);
}

export default function SettingsPage() {
  const { theme, resolvedColors: T, setMode, setSkin, setAccent, setBackgroundMode } = useTheme();
  const { profile, updateProfile } = useProfile();
  const { balance } = useWallet();
  const { crtEnabled, toggleCrt } = useCrtToggle();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user: accountUser } = useAppUser();
  const accountUserId = accountUser?.id;
  const accountFullName = accountUser?.fullName;
  const accountFirstName = accountUser?.firstName;
  const accountUsername = accountUser?.username;
  const accountEmail = accountUser?.primaryEmailAddress?.emailAddress;
  const accountImageUrl = accountUser?.imageUrl;
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (!isTabId(requestedTab)) return;
    const timeout = window.setTimeout(() => setActiveTab(requestedTab), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const changeTab = useCallback((tab: TabId) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
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
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!accountUserId) return;
    setName((current) =>
      current && current !== "Member"
        ? current
        : accountFullName || accountFirstName || "",
    );
    setUsername((current) =>
      current && current !== "creator" && current !== "member"
        ? current
        : accountUsername || accountEmail?.split("@")[0] ||
          "",
    );
    setAvatarUrl((current) => current || accountImageUrl || "");
  }, [
    accountUserId,
    accountFullName,
    accountFirstName,
    accountUsername,
    accountEmail,
    accountImageUrl,
  ]);

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
    () => (typeof window !== "undefined" && localStorage.getItem("litlabs-workspace-default")) || "studio",
  );
  const [workspaceSaved, setWorkspaceSaved] = useState(false);
  const [themeSaved, setThemeSaved] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [uploadingWallpaper, setUploadingWallpaper] = useState(false);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  const selectWallpaper = useCallback((wallpaper: WallpaperId) => {
    updateProfile({ wallpaper });
  }, [updateProfile]);

  const uploadWallpaper = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setWallpaperError(null);
    if (!file.type.startsWith("image/")) {
      setWallpaperError("Choose a JPG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setWallpaperError("Wallpaper images must be 10 MB or smaller.");
      return;
    }
    setUploadingWallpaper(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", "wallpaper");
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || "Upload failed");
      updateProfile({ wallpaper: "custom", customWallpaperUrl: data.url });
    } catch (error) {
      setWallpaperError(error instanceof Error ? error.message : "Wallpaper upload failed");
    } finally {
      setUploadingWallpaper(false);
      if (wallpaperInputRef.current) wallpaperInputRef.current.value = "";
    }
  }, [updateProfile]);

  const savePreferences = useCallback(async (updates: Record<string, unknown>) => {
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
  }, []);

  /* Load server preferences for signed-in users; localStorage remains an offline fallback. */
  useEffect(() => {
    if (!isSignedIn) return;
    fetch("/api/settings/preferences")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const prefs = data?.preferences;
        if (!prefs) return;
        if (typeof prefs.notify_discord === "string") setDiscordWebhook(prefs.notify_discord);
        if (typeof prefs.notify_alexa === "boolean") setAlexaEnabled(prefs.notify_alexa);
        if (typeof prefs.notify_email === "boolean") setEmailDigest(prefs.notify_email);
        if (typeof prefs.workspace_autosave === "boolean") setAutoSaveDrafts(prefs.workspace_autosave);
        if (typeof prefs.workspace_compact === "boolean") setCompactMode(prefs.workspace_compact);
        if (typeof prefs.workspace_live_preview === "boolean") setLivePreview(prefs.workspace_live_preview);
        if (typeof prefs.workspace_telemetry === "boolean") setShowTelemetry(prefs.workspace_telemetry);
        if (typeof prefs.workspace_default === "string") setDefaultWorkspace(prefs.workspace_default);
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
        setName((current) =>
          u.name && u.name !== "Member" ? u.name : current,
        );
        setUsername((current) => u.username || current);
        setBio(u.bio || "");
        setWebsite(u.website || "");
        setLocation(u.location || "");
        setAvatarUrl((current) => u.avatar_url || accountUser?.imageUrl || current);
      })
      .catch(() => {});
  }, [isSignedIn, accountUser?.imageUrl]);

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
      setPreferenceError(error instanceof Error ? error.message : "Failed to save notifications");
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
      localStorage.setItem("litlabs-workspace-autosave", String(autoSaveDrafts));
      localStorage.setItem("litlabs-workspace-compact", String(compactMode));
      localStorage.setItem("litlabs-workspace-live-preview", String(livePreview));
      localStorage.setItem("litlabs-workspace-telemetry", String(showTelemetry));
      localStorage.setItem("litlabs-workspace-default", defaultWorkspace);
      setWorkspaceSaved(true);
      setTimeout(() => setWorkspaceSaved(false), 2000);
    } catch (error) {
      setPreferenceError(error instanceof Error ? error.message : "Failed to save workspace preferences");
    }
  }, [autoSaveDrafts, compactMode, livePreview, showTelemetry, defaultWorkspace, savePreferences]);

  const deleteAccount = useCallback(async () => {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete account");
      window.location.href = "/sign-in";
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete account");
      setDeleteLoading(false);
    }
  }, []);

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
      <PageShell title="Settings" subtitle="Loading your preferences..." icon="⚙️">
        <div className="p-8 flex items-center justify-center">
          <Loader2 className="animate-spin" style={{ color: T.accentColor }} />
        </div>
      </PageShell>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell title="Settings" subtitle="Sign in to manage your account" icon="⚙️">
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
      subtitle="Your account, Studio, AI, agents, appearance, notifications, and billing."
      icon="⚙️"
    >
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {preferenceError && (
          <div
            role="alert"
            className="mb-4 rounded-lg border px-3 py-2 text-sm"
            style={{ color: "#fca5a5", borderColor: "#ef444466", backgroundColor: "#7f1d1d33" }}
          >
            {preferenceError}
          </div>
        )}
        {/* Wallet strip */}
        <div
          className="mb-6 flex flex-wrap items-center gap-3 p-3 rounded-xl border text-sm"
          style={cardStyle}
        >
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold"
            style={{ backgroundColor: `${T.accentColor}15`, color: T.accentColor }}
          >
            <Coins size={14} /> {balance.toLocaleString()} LiTBits
          </div>
          <span className="opacity-60" style={{ color: T.textMuted }}>
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
                onClick={() => changeTab(tab.id)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap transition-all"
                style={{
                  backgroundColor: active
                    ? `${T.accentColor}20`
                    : `${T.boxBg}40`,
                  border: active
                    ? `1px solid ${T.accentColor}50`
                    : `1px solid ${T.borderColor}30`,
                  color: active ? T.accentColor : T.textMuted,
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
              <p className="text-xs mb-5 opacity-70" style={{ color: T.textMuted }}>
                This is what other creators see across the platform.
              </p>
              <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/15 p-4 sm:flex-row sm:items-center">
                <div
                  className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-cyan-400/25 to-violet-500/25 text-2xl font-black"
                  aria-label="Profile photo preview"
                >
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    (name || "L").slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-black" style={{ color: T.textColor }}>
                    {name || accountUser?.fullName || "Your account"}
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: T.textMuted }}>
                    @{username || accountUser?.username || "member"}
                    {accountUser?.primaryEmailAddress?.emailAddress
                      ? ` · ${accountUser.primaryEmailAddress.emailAddress}`
                      : ""}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {accountUser?.imageUrl && avatarUrl !== accountUser.imageUrl && (
                      <button
                        onClick={() => setAvatarUrl(accountUser.imageUrl || "")}
                        className="rounded-xl border border-cyan-300/25 bg-cyan-300/8 px-3 py-2 text-[10px] font-bold text-cyan-200"
                      >
                        Use account photo
                      </button>
                    )}
                    <span className="rounded-xl border border-white/10 px-3 py-2 text-[10px] text-white/45">
                      Sign-in and security are managed by your account provider
                    </span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: "Display Name", value: name, set: setName, placeholder: "Your name" },
                  { label: "Username", value: username, set: setUsername, placeholder: "username" },
                  { label: "Website", value: website, set: setWebsite, placeholder: "https://yoursite.com" },
                  { label: "Location", value: location, set: setLocation, placeholder: "City, Country" },
                ].map((field) => (
                  <div key={field.label} className="space-y-1">
                    <label
                      className="text-[10px] font-mono uppercase tracking-wider opacity-70"
                      style={{ color: T.textMuted }}
                    >
                      {field.label}
                    </label>
                    <input
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

            {/* Danger Zone */}
            <div
              className="rounded-2xl border p-4 sm:p-6"
              style={{
                backgroundColor: "rgba(239,68,68,0.05)",
                borderColor: "rgba(239,68,68,0.25)",
              }}
            >
              <h2
                className="text-lg font-black mb-1"
                style={{ color: "#fca5a5" }}
              >
                Danger Zone
              </h2>
              <p className="text-xs mb-5 opacity-80" style={{ color: T.textMuted }}>
                Permanently delete your account, wallet, agents, and all associated data.
                This action cannot be undone.
              </p>
              {deleteError && (
                <div
                  className="mb-4 rounded-lg border px-3 py-2 text-sm"
                  style={{ color: "#fca5a5", borderColor: "rgba(239,68,68,0.4)", backgroundColor: "rgba(239,68,68,0.1)" }}
                >
                  {deleteError}
                </div>
              )}
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
                  style={{
                    backgroundColor: "rgba(239,68,68,0.1)",
                    color: "#fca5a5",
                    border: "1px solid rgba(239,68,68,0.3)",
                  }}
                >
                  <Trash2 size={14} />
                  Delete Account
                </button>
              ) : (
                <div className="space-y-3">
                  <div
                    className="rounded-lg border p-3 text-sm"
                    style={{
                      borderColor: "rgba(239,68,68,0.3)",
                      backgroundColor: "rgba(239,68,68,0.08)",
                      color: T.textColor,
                    }}
                  >
                    <strong style={{ color: "#fca5a5" }}>Are you absolutely sure?</strong>
                    <p className="mt-1 text-xs opacity-80">
                      This will permanently erase your profile, wallet balance, installed agents, and all preferences. You will be signed out immediately.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={deleteAccount}
                      disabled={deleteLoading}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
                      style={{
                        backgroundColor: "#ef4444",
                        color: "white",
                        border: "none",
                        opacity: deleteLoading ? 0.6 : 1,
                      }}
                    >
                      {deleteLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      Yes, delete my account
                    </button>
                    <button
                      onClick={() => {
                        setDeleteConfirm(false);
                        setDeleteError(null);
                      }}
                      className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
                      style={{
                        backgroundColor: `${T.boxBg}55`,
                        color: T.textColor,
                        border: `1px solid ${T.borderColor}30`,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
                    <h2 className="text-xl font-black" style={{ color: T.headerColor }}>
                      Theme Presets
                    </h2>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>
                      Five premium directions designed as real visual systems, not color chips.
                    </p>
                  </div>
                  <div className="rounded-full border px-3 py-1 text-[10px] font-black uppercase" style={{ borderColor: T.borderColor + "30", color: T.accentColor, backgroundColor: T.accentColor + "10" }}>
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
                          borderColor: active ? preset.accent : T.borderColor + "30",
                          boxShadow: active ? `0 0 0 1px ${preset.accent}30, 0 18px 40px ${preset.accent}12` : "none",
                        }}
                      >
                        <div className="h-24 rounded-xl border overflow-hidden" style={{ backgroundColor: previewBg, borderColor: preset.border }}>
                          <div className="flex h-full">
                            <div className="w-1/3 p-2 border-r" style={{ borderColor: preset.border, backgroundColor: previewSurface }}>
                              <div className="h-2 w-8 rounded-full mb-2" style={{ backgroundColor: preset.accent }} />
                              <div className="space-y-1">
                                <div className="h-1.5 rounded-full" style={{ backgroundColor: preset.accent + "88" }} />
                                <div className="h-1.5 rounded-full w-3/4" style={{ backgroundColor: preset.border }} />
                                <div className="h-1.5 rounded-full w-1/2" style={{ backgroundColor: preset.border }} />
                              </div>
                            </div>
                            <div className="flex-1 p-2">
                              <div className="h-3 w-20 rounded-full mb-2" style={{ backgroundColor: preset.accent + "55" }} />
                              <div className="grid grid-cols-2 gap-2">
                                <div className="h-10 rounded-lg border" style={{ backgroundColor: preset.surface, borderColor: preset.border }} />
                                <div className="h-10 rounded-lg border" style={{ background: `linear-gradient(135deg, ${preset.accent}44, ${preset.linkColor}33)`, borderColor: preset.border }} />
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-black capitalize" style={{ color: T.textColor }}>{preset.id.replace("-", " ")}</div>
                            <div className="text-[11px] mt-1" style={{ color: T.textMuted }}>
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
                          {active && <Check size={14} style={{ color: preset.accent }} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
                  <h2 className="text-xl font-black mb-1" style={{ color: T.headerColor }}>
                    Theme Mode
                  </h2>
                  <p className="text-xs mb-4 opacity-70" style={{ color: T.textMuted }}>
                    Daytime mode now uses deep navy (#1a1a2e) text for crisp contrast.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { id: "dark", label: "Dark", icon: Moon },
                      { id: "light", label: "Light", icon: Sun },
                      { id: "system", label: "System", icon: Monitor },
                    ] as const).map((m) => {
                      const Icon = m.icon;
                      const active = theme.mode === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setMode(m.id)}
                          className="flex flex-col items-start gap-2 px-4 py-3 rounded-2xl text-sm font-bold transition-all"
                          style={{
                            backgroundColor: active ? `${T.accentColor}18` : `${T.bgColor}50`,
                            border: active ? `1px solid ${T.accentColor}45` : `1px solid ${T.borderColor}30`,
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

                <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
                  <h2 className="text-xl font-black mb-4" style={{ color: T.headerColor }}>
                    Quick Actions
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        if (typeof window === "undefined") return;
                        localStorage.setItem("litlabs-theme-saved", JSON.stringify(theme));
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
                      <div className="text-xs uppercase tracking-[0.18em]" style={{ color: T.textMuted }}>
                        {themeSaved ? "Saved" : "Save"}
                      </div>
                      <div className="mt-1 text-sm font-bold">
                        {themeSaved ? "Current look stored" : "Store current look"}
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
                      <div className="text-xs uppercase tracking-[0.18em]" style={{ color: T.textMuted }}>
                        Reset
                      </div>
                      <div className="mt-1 text-sm font-bold">Return to base theme</div>
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black" style={{ color: T.headerColor }}>
                    Workspace Wallpaper
                  </h2>
                  <p className="mt-1 max-w-2xl text-xs" style={{ color: T.textMuted }}>
                    Choose a built-in scene or upload your own image. Your wallpaper follows you across LiTTree and keeps a readability overlay above busy images.
                  </p>
                </div>
                <div className="flex gap-2">
                  <input
                    ref={wallpaperInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={uploadWallpaper}
                  />
                  <button
                    type="button"
                    onClick={() => wallpaperInputRef.current?.click()}
                    disabled={uploadingWallpaper}
                    className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition hover:opacity-85 disabled:opacity-50"
                    style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                  >
                    {uploadingWallpaper ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploadingWallpaper ? "Uploading" : "Upload your own"}
                  </button>
                  {profile.customWallpaperUrl && (
                    <button
                      type="button"
                      onClick={() => updateProfile({ wallpaper: "mesh", customWallpaperUrl: null })}
                      className="rounded-xl border p-2.5 transition hover:opacity-80"
                      style={{ borderColor: T.borderColor + "40", color: T.textMuted }}
                      aria-label="Remove custom wallpaper"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {wallpaperError && (
                <div className="mt-4 rounded-xl border px-4 py-3 text-xs" style={{ borderColor: "#ef444455", backgroundColor: "#ef444410", color: "#fca5a5" }}>
                  {wallpaperError}
                </div>
              )}

              {profile.customWallpaperUrl && (
                <button
                  type="button"
                  onClick={() => selectWallpaper("custom")}
                  className="relative mt-5 h-44 w-full overflow-hidden rounded-2xl border text-left sm:h-52"
                  style={{ borderColor: profile.wallpaper === "custom" ? T.accentColor : T.borderColor + "40" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profile.customWallpaperUrl} alt="Your custom wallpaper" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                  <div className="absolute bottom-4 left-4">
                    <div className="text-sm font-black text-white">Your wallpaper</div>
                    <div className="text-[10px] text-white/60">Custom upload · click to apply</div>
                  </div>
                  {profile.wallpaper === "custom" && <Check className="absolute right-4 top-4 rounded-full bg-black/60 p-1 text-white" size={24} />}
                </button>
              )}

              <div className="mt-6 flex items-end justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: T.accentColor }}>
                    LiTT Originals
                  </div>
                  <div className="mt-1 text-sm font-bold" style={{ color: T.textColor }}>
                    Cinematic scenes built for your workspace
                  </div>
                </div>
                <div className="hidden text-[10px] sm:block" style={{ color: T.textMuted }}>
                  New collection · 2026
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {WALLPAPERS.filter((wallpaper) => ["afterglow", "liquid-signal", "biolume-canopy"].includes(wallpaper.id)).map((wallpaper) => {
                  const active = profile.wallpaper === wallpaper.id;
                  return (
                    <button
                      key={wallpaper.id}
                      type="button"
                      onClick={() => selectWallpaper(wallpaper.id)}
                      aria-pressed={active}
                      className="group overflow-hidden rounded-2xl border text-left transition duration-300 hover:-translate-y-1 hover:shadow-2xl"
                      style={{
                        borderColor: active ? T.accentColor : T.borderColor + "35",
                        backgroundColor: T.bgColor + "55",
                        boxShadow: active ? `0 0 0 1px ${T.accentColor}55, 0 18px 45px ${T.accentColor}15` : undefined,
                      }}
                    >
                      <div className="relative h-40 overflow-hidden" style={{ background: wallpaper.preview }}>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/5 to-black/10" />
                        <div className="absolute inset-x-0 bottom-0 p-4">
                          <div className="text-sm font-black text-white">{wallpaper.name}</div>
                          <div className="mt-1 text-[10px] text-white/65">{wallpaper.description}</div>
                        </div>
                        {active && <Check className="absolute right-3 top-3 rounded-full bg-black/55 p-1 text-white backdrop-blur" size={24} />}
                      </div>
                    </button>
                  );
                })}
              </div>

              <details className="group mt-5 rounded-2xl border" style={{ borderColor: T.borderColor + "30", backgroundColor: T.bgColor + "25" }}>
                <summary className="cursor-pointer list-none px-4 py-3 text-xs font-black transition hover:opacity-80" style={{ color: T.textMuted }}>
                  <span className="inline-flex items-center gap-2">
                    <span className="transition group-open:rotate-90">›</span>
                    Ambient & minimal styles
                    <span className="font-normal opacity-60">({WALLPAPERS.length - 4})</span>
                  </span>
                </summary>
                <div className="grid grid-cols-2 gap-3 border-t p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" style={{ borderColor: T.borderColor + "25" }}>
                  {WALLPAPERS.filter((wallpaper) => wallpaper.id !== "custom" && !["afterglow", "liquid-signal", "biolume-canopy"].includes(wallpaper.id)).map((wallpaper) => {
                    const active = profile.wallpaper === wallpaper.id;
                    return (
                      <button
                        key={wallpaper.id}
                        type="button"
                        onClick={() => selectWallpaper(wallpaper.id)}
                        aria-pressed={active}
                        className="group overflow-hidden rounded-xl border text-left transition hover:-translate-y-0.5"
                        style={{ borderColor: active ? T.accentColor : T.borderColor + "30", backgroundColor: T.bgColor + "55" }}
                      >
                        <div className="relative h-20" style={{ background: wallpaper.preview }}>
                          <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
                          {active && <Check className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white" size={21} />}
                        </div>
                        <div className="p-3">
                          <div className="text-xs font-black" style={{ color: T.textColor }}>{wallpaper.name}</div>
                          <div className="mt-1 line-clamp-1 text-[9px] leading-4" style={{ color: T.textMuted }}>{wallpaper.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </details>
              <p className="mt-4 text-[10px]" style={{ color: T.textMuted }}>
                Tip: wide images at 1920×1080 or larger look best. Upload limit: 10 MB.
              </p>
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
                <h2 className="text-xl font-black mb-4" style={{ color: T.headerColor }}>
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
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: ACCENT_MAP[accent].hex }} />
                        {accent.replace("-", " ")}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
                <h2 className="text-xl font-black mb-4" style={{ color: T.headerColor }}>
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
                <h2 className="text-xl font-black mb-1" style={{ color: T.headerColor }}>
                  Workspace Controls
                </h2>
                <p className="text-xs mb-5" style={{ color: T.textMuted }}>
                  Tune how the site behaves so the whole platform feels like your command center.
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
                        backgroundColor: item.value ? `${T.accentColor}12` : `${T.boxBg}55`,
                        borderColor: item.value ? `${T.accentColor}40` : `${T.borderColor}30`,
                      }}
                    >
                      <div>
                        <div className="text-sm font-black" style={{ color: T.textColor }}>
                          {item.title}
                        </div>
                        <div className="text-xs mt-1 max-w-xl" style={{ color: T.textMuted }}>
                          {item.desc}
                        </div>
                      </div>
                      <div
                        className="h-6 w-11 rounded-full border p-0.5 transition-all"
                        style={{
                          backgroundColor: item.value ? T.accentColor : T.bgColor,
                          borderColor: item.value ? T.accentColor : T.borderColor,
                        }}
                      >
                        <div
                          className="h-full w-5 rounded-full bg-white transition-transform"
                          style={{
                            transform: item.value ? "translateX(18px)" : "translateX(0)",
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-5 grid sm:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider opacity-70" style={{ color: T.textMuted }}>
                      Default workspace
                    </span>
                    <select
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
                      style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                    >
                      {workspaceSaved ? <Check size={14} /> : <Save size={14} />}
                      {workspaceSaved ? "Saved" : "Save Workspace"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
                <h2 className="text-xl font-black mb-4" style={{ color: T.headerColor }}>
                  Fast Launch
                </h2>
                <div className="grid gap-3">
                  {[
                    { href: "/studio", label: "Open Studio", desc: "Build agents, media, and workflows." },
                    { href: "/marketplace", label: "Open Marketplace", desc: "Discover installs, templates, and assets." },
                    { href: "/games", label: "Open Games", desc: "Browse entertainment and relax tools." },
                    { href: "/gallery", label: "Open Gallery", desc: "Review recent creations and saved work." },
                    { href: "/admin", label: "Open Admin", desc: "Inspect live telemetry and site health." },
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
                      <div className="text-sm font-black" style={{ color: T.textColor }}>
                        {item.label}
                      </div>
                      <div className="text-xs mt-1" style={{ color: T.textMuted }}>
                        {item.desc}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Agents Tab */}
        {activeTab === "agents" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border p-5 sm:p-6" style={cardStyle}>
              <div className="mb-5 flex items-start gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-400/10 text-violet-300">
                  <Bot size={19} />
                </div>
                <div>
                  <h2 className="text-xl font-black" style={{ color: T.headerColor }}>Your AI crew</h2>
                  <p className="mt-1 text-xs" style={{ color: T.textMuted }}>
                    Configure agents where they work instead of duplicating their controls in Settings.
                  </p>
                </div>
              </div>
              <div className="grid gap-3">
                <Link href="/agents" className="rounded-2xl border border-white/10 bg-white/3 p-4 transition hover:bg-white/6">
                  <strong className="block text-sm">Manage agents</strong>
                  <span className="mt-1 block text-xs" style={{ color: T.textMuted }}>Roles, tools, instructions, and crew status</span>
                </Link>
                <Link href="/studio?intent=agent" className="rounded-2xl border border-white/10 bg-white/3 p-4 transition hover:bg-white/6">
                  <strong className="block text-sm">Launch an agent in Studio</strong>
                  <span className="mt-1 block text-xs" style={{ color: T.textMuted }}>Keep the run beside your active conversation</span>
                </Link>
              </div>
            </div>
            <div className="rounded-3xl border p-5 sm:p-6" style={cardStyle}>
              <h2 className="text-xl font-black" style={{ color: T.headerColor }}>How LiTT routes work</h2>
              <p className="mt-2 text-xs leading-5" style={{ color: T.textMuted }}>
                Studio now understands image, video, audio, build, code, terminal, asset, and agent requests in normal language. You can still use slash commands when you want exact control.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2 text-[10px]">
                {["Creative direction", "Code & build", "Research", "Automation", "Media creation", "Project memory"].map((capability) => (
                  <div key={capability} className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-white/65">{capability}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Billing Tab */}
        {activeTab === "billing" && (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
            <div className="overflow-hidden rounded-3xl border p-6" style={cardStyle}>
              <div className="text-[10px] font-black uppercase tracking-[.2em]" style={{ color: T.textMuted }}>Available balance</div>
              <div className="mt-2 text-4xl font-black" style={{ color: T.headerColor }}>
                {balance.toLocaleString()} <span className="text-lg" style={{ color: T.accentColor }}>LiTBits</span>
              </div>
              <p className="mt-2 max-w-xl text-xs leading-5" style={{ color: T.textMuted }}>
                LiTBits power image, video, audio, and agent runs. The balance shown here comes from the same wallet used throughout Studio.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/wallet" className="rounded-xl px-4 py-2 text-xs font-black" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                  Open wallet
                </Link>
                <Link href="/pricing" className="rounded-xl border border-white/10 px-4 py-2 text-xs font-black">
                  View plans
                </Link>
              </div>
            </div>
            <div className="rounded-3xl border p-6" style={cardStyle}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold" style={{ color: T.textMuted }}>Current plan</span>
                <span className="rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-300">
                  {String(accountUser?.publicMetadata?.plan || "Free")}
                </span>
              </div>
              <div className="mt-5 space-y-3 text-xs text-white/60">
                <div className="flex justify-between border-b border-white/8 pb-3"><span>Account</span><span className="max-w-[60%] truncate text-white/85">{accountUser?.primaryEmailAddress?.emailAddress || "Signed in"}</span></div>
                <div className="flex justify-between border-b border-white/8 pb-3"><span>Currency</span><span className="text-white/85">LiTBits</span></div>
                <div className="flex justify-between"><span>Usage scope</span><span className="text-white/85">All Studio tools</span></div>
              </div>
            </div>
          </div>
        )}

        {/* Advanced Tab */}
        {activeTab === "cli" && (
          <div className="space-y-6">
            <section className="grid xl:grid-cols-[0.75fr_1.25fr] gap-6">
              <div className="space-y-4">
                <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
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
                      <h2 className="text-xl font-black" style={{ color: T.headerColor }}>
                        CLI Tools
                      </h2>
                      <p className="text-xs mt-1 leading-relaxed" style={{ color: T.textMuted }}>
                        Launch Qwen, Hermes, Gemini, OpenClaw, or a shell from the same bridge used
                        in Studio. Access is limited to authorized admin accounts.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border p-4 sm:p-6" style={cardStyle}>
                  <h3 className="text-sm font-black mb-3" style={{ color: T.headerColor }}>
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
                            <span className="block text-sm font-black" style={{ color: T.textColor }}>
                              {item.label}
                            </span>
                            <span className="block text-xs mt-0.5" style={{ color: T.textMuted }}>
                              {item.desc}
                            </span>
                          </span>
                          <ExternalLink size={14} className="ml-auto shrink-0 opacity-60" style={{ color: T.textMuted }} />
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
                  <h2 className="text-lg font-black" style={{ color: T.headerColor }}>
                    Bring Your Own Keys
                  </h2>
                  <p className="text-xs opacity-70 max-w-2xl" style={{ color: T.textMuted }}>
                    Keys are stored in your browser and sent to LiTT Code servers when you use
                    agent features. Never commit keys to a repo.
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

        {/* Notifications Tab */}
        {activeTab === "notifications" && (
          <div className="space-y-6">
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                Notification Channels
              </h2>
              <p className="text-xs mb-5 opacity-70" style={{ color: T.textMuted }}>
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
                    value={discordWebhook}
                    onChange={(e) => setDiscordWebhook(e.target.value)}
                    placeholder="https://discord.com/api/webhooks/..."
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                    style={inputStyle}
                  />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border" style={inputStyle}>
                  <div>
                    <div className="text-sm font-bold" style={{ color: T.textColor }}>
                      Alexa Voice Monkey
                    </div>
                    <div className="text-[10px] opacity-70" style={{ color: T.textMuted }}>
                      Announce alerts on your Echo devices.
                    </div>
                  </div>
                  <button
                    onClick={() => setAlexaEnabled((v) => !v)}
                    className="w-12 h-6 rounded-full transition-colors relative"
                    style={{
                      backgroundColor: alexaEnabled ? T.accentColor : `${T.borderColor}50`,
                    }}
                  >
                    <span
                      className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                      style={{ transform: alexaEnabled ? "translateX(24px)" : "translateX(0)" }}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border" style={inputStyle}>
                  <div>
                    <div className="text-sm font-bold" style={{ color: T.textColor }}>
                      Weekly Email Digest
                    </div>
                    <div className="text-[10px] opacity-70" style={{ color: T.textMuted }}>
                      Summary of your agent activity and coin balance.
                    </div>
                  </div>
                  <button
                    onClick={() => setEmailDigest((v) => !v)}
                    className="w-12 h-6 rounded-full transition-colors relative"
                    style={{
                      backgroundColor: emailDigest ? T.accentColor : `${T.borderColor}50`,
                    }}
                  >
                    <span
                      className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                      style={{ transform: emailDigest ? "translateX(24px)" : "translateX(0)" }}
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
