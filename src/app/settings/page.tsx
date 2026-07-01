"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme, useCrtToggle, darkSkins, lightSkins, ACCENT_MAP } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useWallet } from "@/context/WalletContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import type { BackgroundMode } from "@/components/AnimatedBackground";
import type { SkinPreset, AccentColor } from "@/context/ThemeContext";
import {
  User,
  Palette,
  Key,
  Bell,
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
  FolderOpen,
  RefreshCw,
  Copy,
  Share2,
  Shield,
  Smartphone,
  Clock,
  Lock,
  Globe,
  Zap,
  Crown,
  CreditCard,
  Receipt,
  Sparkles,
  Plus,
} from "lucide-react";
import {
  loadProjectContext,
  saveProjectContext,
  clearProjectContext,
  hasProjectContext,
  EMPTY_CONTEXT,
} from "@/lib/project-context";
import type { ProjectContext } from "@/lib/agents";
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
  { id: "project", label: "Project", icon: FolderOpen },
  { id: "keys", label: "BYOK", icon: Key },
  { id: "litkeys", label: "Keys", icon: Key },
  { id: "security", label: "Security", icon: Shield },
  { id: "connected", label: "Connected", icon: Globe },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "billing", label: "Billing", icon: Coins },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function SettingsPage() {
  const { theme, resolvedColors: T, setMode, setSkin, setAccent, setBackgroundMode, setCustomColors, resetTheme } = useTheme();
  const { profile, updateProfile } = useProfile();
  const { balance } = useWallet();
  const { crtEnabled, toggleCrt } = useCrtToggle();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [customColorDraft, setCustomColorDraft] = useState<NonNullable<typeof theme.customColors>>(
    () => theme.customColors ?? {}
  );
  const [projectCtx, setProjectCtxState] = useState<ProjectContext>(() => loadProjectContext());
  const [projectSaved, setProjectSaved] = useState(false);

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

  /* BYOK state ΓÇö seeded from localStorage */
  const [keys, setKeys] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    const loaded: Record<string, string> = {};
    BYOK_KEYS.forEach((k) => {
      loaded[k.id] = localStorage.getItem(`litlabs-byok-${k.id}`) || "";
    });
    return loaded;
  });
  const [keysSaved, setKeysSaved] = useState(false);

  /* Notifications state ΓÇö seeded from localStorage */
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

  /* Keys tab state */
  const [apiKeys, setApiKeys] = useState<{ id: string; name: string; prefix: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null; created_at: string }[]>([]);
  const [inviteCodes, setInviteCodes] = useState<{ id: string; label: string | null; max_uses: number; uses_count: number; expires_at: string | null; revoked_at: string | null; created_at: string }[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState("1");
  const [newInviteCode, setNewInviteCode] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  /* Security state */
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [sessions, setSessions] = useState([
    { id: "1", device: "Chrome on Windows", location: "San Francisco, CA", lastActive: "2 minutes ago", current: true },
    { id: "2", device: "Safari on iPhone", location: "San Francisco, CA", lastActive: "1 hour ago", current: false },
    { id: "3", device: "Firefox on Mac", location: "New York, NY", lastActive: "3 days ago", current: false },
  ]);
  const [securitySaved, setSecuritySaved] = useState(false);

  /* Connected Services state */
  const [connectedServices, setConnectedServices] = useState([
    { id: "github", name: "GitHub", connected: true, icon: "🐙" },
    { id: "discord", name: "Discord", connected: false, icon: "💬" },
    { id: "google", name: "Google", connected: true, icon: "🔍" },
    { id: "slack", name: "Slack", connected: false, icon: "💼" },
  ]);
  const [connectedSaved, setConnectedSaved] = useState(false);

  /* Privacy state */
  const [profileVisibility, setProfileVisibility] = useState("public");
  const [dataExportRequested, setDataExportRequested] = useState(false);
  const [privacySaved, setPrivacySaved] = useState(false);

  /* Billing state */
  const [currentPlan, setCurrentPlan] = useState("free");
  const [billingSaved, setBillingSaved] = useState(false);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const loadKeys = useCallback(async () => {
    if (!isSignedIn) return;
    setKeysLoading(true);
    try {
      const [keysRes, invitesRes] = await Promise.all([
        fetch("/api/keys/list"),
        fetch("/api/invites/list"),
      ]);
      if (keysRes.ok) {
        const d = await keysRes.json();
        setApiKeys(d.keys || []);
      }
      if (invitesRes.ok) {
        const d = await invitesRes.json();
        setInviteCodes(d.codes || []);
      }
    } catch { /* silent */ } finally {
      setKeysLoading(false);
      setKeysLoaded(true);
    }
  }, [isSignedIn]);

  const generateApiKey = async () => {
    if (!newKeyName.trim()) return;
    setKeysLoading(true);
    try {
      const res = await fetch("/api/keys/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.key) {
        setNewKeySecret(data.key);
        setNewKeyName("");
        await loadKeys();
      }
    } catch { /* silent */ } finally {
      setKeysLoading(false);
    }
  };

  const revokeApiKey = async (id: string) => {
    try {
      await fetch(`/api/keys/revoke/${id}`, { method: "DELETE" });
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
    } catch { /* silent */ }
  };

  const generateInviteCode = async () => {
    setKeysLoading(true);
    try {
      const res = await fetch("/api/invites/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: inviteLabel.trim(), max_uses: Number(inviteMaxUses) || 1 }),
      });
      const data = await res.json();
      if (res.ok && data.code) {
        setNewInviteCode(data.code);
        setInviteLabel("");
        setInviteMaxUses("1");
        await loadKeys();
      }
    } catch { /* silent */ } finally {
      setKeysLoading(false);
    }
  };

  const revokeInviteCode = async (id: string) => {
    try {
      await fetch("/api/invites/list", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setInviteCodes((prev) => prev.filter((c) => c.id !== id));
    } catch { /* silent */ }
  };

  /* Load keys when tab is opened */
  useEffect(() => {
    if (activeTab === "litkeys" && !keysLoaded && isSignedIn) {
      loadKeys();
    }
  }, [activeTab, keysLoaded, isSignedIn, loadKeys]);

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

  const saveNotifications = useCallback(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("litlabs-notify-discord", discordWebhook);
    localStorage.setItem("litlabs-notify-alexa", String(alexaEnabled));
    localStorage.setItem("litlabs-notify-email", String(emailDigest));
    setNotifSaved(true);
    setTimeout(() => setNotifSaved(false), 2000);
  }, [discordWebhook, alexaEnabled, emailDigest]);

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
      <PageShell title="Settings" subtitle="Loading your preferences..." icon="ΓÜÖ∩╕Å">
        <div className="p-8 flex items-center justify-center">
          <Loader2 className="animate-spin" style={{ color: T.accentColor }} />
        </div>
      </PageShell>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell title="Settings" subtitle="Sign in to manage your account" icon="ΓÜÖ∩╕Å">
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
      subtitle="Profile, appearance, keys, and notifications ΓÇö all in one place."
      icon="ΓÜÖ∩╕Å"
    >
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6">
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
        <div className="flex gap-1 overflow-x-auto pb-2 mb-4 sm:mb-6 scrollbar-hide">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs sm:text-sm font-bold whitespace-nowrap transition-all"
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
                <Icon size={12} className="sm:hidden" />
                <Icon size={14} className="hidden sm:block" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div className="space-y-4 sm:space-y-6">
            <div
              className="rounded-2xl border p-3 sm:p-4 md:p-6"
              style={cardStyle}
            >
              <h2
                className="text-base sm:text-lg font-black mb-1"
                style={{ color: T.headerColor }}
              >
                Public Profile
              </h2>
              <p className="text-[10px] sm:text-xs mb-3 sm:mb-5 opacity-70" style={{ color: T.textMuted }}>
                This is what other creators see across the platform.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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

            {/* Public Profile Share */}
            {username && (
              <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
                <div className="flex items-center gap-2 mb-1">
                  <Share2 size={14} style={{ color: T.accentColor }} />
                  <h2 className="text-lg font-black" style={{ color: T.headerColor }}>Your Public Profile</h2>
                </div>
                <p className="text-xs mb-4 opacity-70" style={{ color: T.textMuted }}>
                  Share this link so others can find and follow you.
                </p>
                <div className="flex items-center gap-2">
                  <div
                    className="flex-1 px-3 py-2 rounded-lg border text-sm font-mono truncate"
                    style={{ backgroundColor: `${T.boxBg}80`, borderColor: `${T.borderColor}30`, color: T.textMuted }}
                  >
                    {typeof window !== "undefined" ? `${window.location.origin}/profile/${username}` : `/profile/${username}`}
                  </div>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/profile/${username}`;
                      navigator.clipboard.writeText(url).catch(() => {});
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:opacity-80"
                    style={{ backgroundColor: `${T.accentColor}15`, color: T.accentColor, border: `1px solid ${T.accentColor}30` }}
                  >
                    <Copy size={12} /> Copy
                  </button>
                  <Link
                    href={`/profile/${username}`}
                    target="_blank"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:opacity-80"
                    style={{ backgroundColor: `${T.boxBg}80`, color: T.textMuted, border: `1px solid ${T.borderColor}30` }}
                  >
                    <ExternalLink size={12} /> View
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Appearance Tab */}
        {activeTab === "appearance" && (
          <div className="space-y-6">
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                Theme Mode
              </h2>
              <p className="text-xs mb-4 opacity-70" style={{ color: T.textMuted }}>
                Daytime mode now uses deep navy (#1a1a2e) text for crisp contrast.
              </p>
              <div className="flex flex-wrap gap-2">
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
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
                      style={{
                        backgroundColor: active
                          ? `${T.accentColor}20`
                          : `${T.boxBg}40`,
                        border: active
                          ? `1px solid ${T.accentColor}50`
                          : `1px solid ${T.borderColor}30`,
                        color: active ? T.accentColor : T.textColor,
                      }}
                    >
                      <Icon size={14} /> {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-4" style={{ color: T.headerColor }}>
                Skin Preset
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                {(Object.keys(darkSkins) as SkinPreset[]).map((skin) => {
                  const colors =
                    theme.mode === "light" ? lightSkins[skin] : darkSkins[skin];
                  const active = theme.skin === skin;
                  return (
                    <button
                      key={skin}
                      onClick={() => setSkin(skin)}
                      className="group relative rounded-xl border p-2 text-left transition-all hover:scale-[1.02]"
                      style={{
                        backgroundColor: active
                          ? `${colors.accentColor}15`
                          : `${colors.bgColor}60`,
                        borderColor: active
                          ? colors.accentColor
                          : `${T.borderColor}30`,
                      }}
                    >
                      <div
                        className="w-full h-10 rounded-lg mb-2"
                        style={{
                          background: `linear-gradient(135deg, ${colors.accentColor}, ${colors.linkColor})`,
                        }}
                      />
                      <div
                        className="text-xs font-bold capitalize"
                        style={{ color: active ? T.accentColor : T.textColor }}
                      >
                        {skin}
                      </div>
                      {active && (
                        <div className="absolute top-2 right-2">
                          <Check size={12} style={{ color: T.accentColor }} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Theme Builder */}
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-black" style={{ color: T.headerColor }}>Custom Theme Builder</h2>
                  <p className="text-xs opacity-60 mt-0.5" style={{ color: T.textMuted }}>Override any colour ΓÇö hex values. Leave blank to use skin default.</p>
                </div>
                <button
                  onClick={() => { setCustomColorDraft({}); resetTheme(); }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg hover:opacity-80"
                  style={{ border: `1px solid ${T.borderColor}40`, color: T.textMuted }}
                >
                  <RefreshCw size={11} /> Reset
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {([
                  ["bgColor", "Background"],
                  ["boxBg", "Card / Box"],
                  ["textColor", "Text"],
                  ["accentColor", "Accent"],
                  ["linkColor", "Link"],
                  ["headerColor", "Header"],
                  ["borderColor", "Border"],
                ] as [keyof NonNullable<typeof theme.customColors>, string][]).map(([key, label]) => {
                  const currentVal = (customColorDraft[key] ?? "") as string;
                  const previewColor = currentVal || (T as Record<string, string>)[key] || "#888";
                  return (
                    <div key={key}>
                      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: T.textMuted }}>{label}</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={previewColor}
                          onChange={(e) => {
                            const next = { ...customColorDraft, [key]: e.target.value };
                            setCustomColorDraft(next);
                            setCustomColors(next);
                          }}
                          className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                        />
                        <input
                          type="text"
                          value={currentVal}
                          onChange={(e) => {
                            const val = e.target.value;
                            const next = { ...customColorDraft, [key]: val || undefined };
                            setCustomColorDraft(next);
                            if (/^#[0-9a-fA-F]{6}$/.test(val) || !val) setCustomColors(next);
                          }}
                          placeholder={previewColor}
                          maxLength={7}
                          className="flex-1 text-xs px-2 py-1 rounded font-mono outline-none"
                          style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}40`, color: T.textColor }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] mt-3 opacity-50" style={{ color: T.textMuted }}>Changes apply live. Reset returns to current skin defaults.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
                <h2 className="text-lg font-black mb-4" style={{ color: T.headerColor }}>
                  Accent Color
                </h2>
                <div className="flex flex-wrap gap-3">
                  {(Object.keys(ACCENT_MAP) as AccentColor[]).map((accent) => {
                    const active = theme.accent === accent;
                    return (
                      <button
                        key={accent}
                        onClick={() => setAccent(accent)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all"
                        style={{
                          backgroundColor: active
                            ? `${ACCENT_MAP[accent].hex}20`
                            : `${T.boxBg}40`,
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

              <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
                <h2 className="text-lg font-black mb-4" style={{ color: T.headerColor }}>
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
                          className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                          style={{
                            backgroundColor: active
                              ? `${T.accentColor}20`
                              : `${T.boxBg}40`,
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
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{
                      backgroundColor: crtEnabled
                        ? `${T.accentColor}20`
                        : `${T.boxBg}40`,
                      border: `1px solid ${crtEnabled ? T.accentColor : T.borderColor}50`,
                      color: crtEnabled ? T.accentColor : T.textColor,
                    }}
                  >
                    <ScanLine size={14} />
                    CRT Scanlines {crtEnabled ? "On" : "Off"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Project Tab */}
        {activeTab === "project" && (
          <div className="space-y-6">
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <div className="flex items-start gap-3 mb-5">
                <FolderOpen size={18} style={{ color: T.accentColor }} />
                <div>
                  <h2 className="text-lg font-black" style={{ color: T.headerColor }}>Your Project Context</h2>
                  <p className="text-xs opacity-70 max-w-2xl mt-1" style={{ color: T.textMuted }}>
                    Every agent reads this before every message ΓÇö so they understand your project, stack, and goals without you repeating yourself. Works for any project, not just LiTTree.
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {([
                  ["name", "Project Name", "e.g. LiTTree Lab Studios", false],
                  ["description", "Description", "What does it do? Who is it for?", true],
                  ["stack", "Tech Stack", "e.g. Next.js 16, Supabase, Tailwind 4, Clerk, Stripe", false],
                  ["goals", "Current Goals", "e.g. Launch v1, improve onboarding, hit 1k users, fix auth bug", true],
                  ["repoUrl", "Repo / Live URL", "https://github.com/... or https://yoursite.com", false],
                  ["customInstructions", "Custom Instructions", "Anything agents should always follow. e.g. Always prefer TypeScript strict. Prefer pnpm over npm. No class components.", true],
                ] as [keyof ProjectContext, string, string, boolean][]).map(([key, label, placeholder, multi]) => (
                  <div key={key}>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: T.accentColor }}>{label}</label>
                    {multi ? (
                      <textarea
                        value={projectCtx[key] ?? ""}
                        onChange={(e) => setProjectCtxState((p) => ({ ...p, [key]: e.target.value }))}
                        placeholder={placeholder}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none focus:ring-2 transition-all"
                        style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "40", color: T.textColor }}
                      />
                    ) : (
                      <input
                        value={projectCtx[key] ?? ""}
                        onChange={(e) => setProjectCtxState((p) => ({ ...p, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                        style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "40", color: T.textColor }}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => {
                    saveProjectContext(projectCtx);
                    setProjectSaved(true);
                    setTimeout(() => setProjectSaved(false), 2500);
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                  style={{ backgroundColor: T.accentColor, color: "#000" }}
                >
                  {projectSaved ? <Check size={14} /> : <Save size={14} />}
                  {projectSaved ? "Saved!" : "Save Context"}
                </button>
                {hasProjectContext(projectCtx) && (
                  <button
                    onClick={() => {
                      clearProjectContext();
                      setProjectCtxState({ ...EMPTY_CONTEXT });
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-bold hover:opacity-80"
                    style={{ border: `1px solid #ef444440`, color: "#ef4444" }}
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>
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
                    Keys are stored in your browser and sent to LiTTree servers when you use
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

        {/* Keys Tab — Invite Codes + API Keys */}
        {activeTab === "litkeys" && (
          <div className="space-y-6">

            {/* New API Key Secret Modal */}
            {newKeySecret && (
              <div
                className="rounded-2xl border p-4 sm:p-6"
                style={{ borderColor: T.accentColor + "60", backgroundColor: `${T.accentColor}08` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Key size={16} style={{ color: T.accentColor }} />
                  <h3 className="font-black text-sm" style={{ color: T.accentColor }}>
                    Copy your key — you will NOT see it again
                  </h3>
                </div>
                <div
                  className="font-mono text-xs break-all px-3 py-2 rounded-lg mb-3 select-all"
                  style={{ backgroundColor: T.bgColor, color: T.textColor, border: `1px solid ${T.borderColor}40` }}
                >
                  {newKeySecret}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyText(newKeySecret, "new-key")}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                  >
                    {copiedId === "new-key" ? <Check size={12} /> : <Copy size={12} />}
                    {copiedId === "new-key" ? "Copied!" : "Copy Key"}
                  </button>
                  <button
                    onClick={() => setNewKeySecret(null)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-80"
                    style={{ border: `1px solid ${T.borderColor}40`, color: T.textMuted }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* New Invite Code Display */}
            {newInviteCode && (
              <div
                className="rounded-2xl border p-4 sm:p-6"
                style={{ borderColor: T.success + "60", backgroundColor: `${T.success}08` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Share2 size={16} style={{ color: T.success }} />
                  <h3 className="font-black text-sm" style={{ color: T.success }}>
                    New Invite Code Created
                  </h3>
                </div>
                <div
                  className="font-mono text-base font-bold tracking-widest px-3 py-2 rounded-lg mb-3"
                  style={{ backgroundColor: T.bgColor, color: T.textColor, border: `1px solid ${T.borderColor}40` }}
                >
                  {newInviteCode}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyText(newInviteCode, "new-invite")}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{ backgroundColor: T.success, color: "#000" }}
                  >
                    {copiedId === "new-invite" ? <Check size={12} /> : <Copy size={12} />}
                    {copiedId === "new-invite" ? "Copied!" : "Copy Code"}
                  </button>
                  <button
                    onClick={() => setNewInviteCode(null)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-80"
                    style={{ border: `1px solid ${T.borderColor}40`, color: T.textMuted }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Invite Codes */}
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <div className="flex items-start gap-3 mb-5">
                <Share2 size={18} style={{ color: T.accentColor }} />
                <div>
                  <h2 className="text-lg font-black" style={{ color: T.headerColor }}>Invite Codes</h2>
                  <p className="text-xs opacity-70 max-w-xl mt-1" style={{ color: T.textMuted }}>
                    Control who can join. Each code can be limited to a number of uses and an expiry date.
                  </p>
                </div>
              </div>

              {/* Generate form */}
              <div className="flex flex-wrap gap-2 mb-5">
                <input
                  value={inviteLabel}
                  onChange={(e) => setInviteLabel(e.target.value)}
                  placeholder="Label (e.g. Beta Wave 1)"
                  className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                  style={inputStyle}
                />
                <select
                  value={inviteMaxUses}
                  onChange={(e) => setInviteMaxUses(e.target.value)}
                  className="px-3 py-2 rounded-lg border text-sm outline-none"
                  style={inputStyle}
                >
                  {[1, 5, 10, 25, 100].map((n) => (
                    <option key={n} value={n}>{n} use{n > 1 ? "s" : ""}</option>
                  ))}
                </select>
                <button
                  onClick={generateInviteCode}
                  disabled={keysLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                >
                  {keysLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Generate
                </button>
              </div>

              {/* Code list */}
              {keysLoading && !keysLoaded ? (
                <div className="text-center py-4">
                  <Loader2 className="animate-spin mx-auto" size={20} style={{ color: T.accentColor }} />
                </div>
              ) : inviteCodes.length === 0 ? (
                <p className="text-sm opacity-50" style={{ color: T.textMuted }}>No invite codes yet.</p>
              ) : (
                <div className="space-y-2">
                  {inviteCodes.map((code) => (
                    <div
                      key={code.id}
                      className="flex flex-wrap items-center gap-2 p-3 rounded-xl"
                      style={{ backgroundColor: `${T.bgColor}80`, border: `1px solid ${T.borderColor}30` }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold" style={{ color: T.textColor }}>
                          {code.label || "Unlabeled"}
                        </div>
                        <div className="text-[10px] font-mono" style={{ color: T.textMuted }}>
                          {code.uses_count}/{code.max_uses} uses
                          {code.expires_at ? ` · expires ${new Date(code.expires_at).toLocaleDateString()}` : ""}
                          {code.revoked_at ? " · REVOKED" : ""}
                        </div>
                      </div>
                      {!code.revoked_at && (
                        <button
                          onClick={() => revokeInviteCode(code.id)}
                          className="text-[10px] px-2 py-1 rounded-lg font-bold hover:opacity-80"
                          style={{ border: `1px solid #ef444440`, color: "#ef4444" }}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* API Keys */}
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <div className="flex items-start gap-3 mb-5">
                <Key size={18} style={{ color: T.accentColor }} />
                <div>
                  <h2 className="text-lg font-black" style={{ color: T.headerColor }}>API Keys</h2>
                  <p className="text-xs opacity-70 max-w-xl mt-1" style={{ color: T.textMuted }}>
                    Let agents, automations, or external apps call your LiTLabs API. The key is only shown once.
                  </p>
                </div>
              </div>

              {/* Generate form */}
              <div className="flex gap-2 mb-5">
                <input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && generateApiKey()}
                  placeholder="Key name (e.g. My Agent Bot)"
                  className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                  style={inputStyle}
                />
                <button
                  onClick={generateApiKey}
                  disabled={keysLoading || !newKeyName.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                >
                  {keysLoading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
                  Create
                </button>
              </div>

              {/* Key list */}
              {keysLoading && !keysLoaded ? (
                <div className="text-center py-4">
                  <Loader2 className="animate-spin mx-auto" size={20} style={{ color: T.accentColor }} />
                </div>
              ) : apiKeys.length === 0 ? (
                <p className="text-sm opacity-50" style={{ color: T.textMuted }}>No API keys yet.</p>
              ) : (
                <div className="space-y-2">
                  {apiKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex flex-wrap items-center gap-2 p-3 rounded-xl"
                      style={{ backgroundColor: `${T.bgColor}80`, border: `1px solid ${T.borderColor}30` }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold" style={{ color: T.textColor }}>{key.name}</div>
                        <div className="text-[10px] font-mono" style={{ color: T.textMuted }}>
                          {key.prefix}···
                          {key.last_used_at
                            ? ` · last used ${new Date(key.last_used_at).toLocaleDateString()}`
                            : " · never used"}
                          {key.revoked_at ? " · REVOKED" : ""}
                        </div>
                      </div>
                      <button
                        onClick={() => copyText(key.prefix + "···", key.id + "-copy")}
                        className="text-[10px] px-2 py-1 rounded-lg font-bold hover:opacity-80"
                        style={{ border: `1px solid ${T.borderColor}40`, color: T.textMuted }}
                      >
                        {copiedId === key.id + "-copy" ? <Check size={10} /> : <Copy size={10} />}
                      </button>
                      {!key.revoked_at && (
                        <button
                          onClick={() => revokeApiKey(key.id)}
                          className="text-[10px] px-2 py-1 rounded-lg font-bold hover:opacity-80"
                          style={{ border: `1px solid #ef444440`, color: "#ef4444" }}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Security Tab */}
        {activeTab === "security" && (
          <div className="space-y-6">
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                Two-Factor Authentication
              </h2>
              <p className="text-xs mb-5 opacity-70" style={{ color: T.textMuted }}>
                Add an extra layer of security to your account.
              </p>
              <div className="flex items-center justify-between p-3 rounded-lg border" style={inputStyle}>
                <div>
                  <div className="text-sm font-bold" style={{ color: T.textColor }}>
                    2FA Authentication
                  </div>
                  <div className="text-[10px] opacity-70" style={{ color: T.textMuted }}>
                    Require verification code when signing in.
                  </div>
                </div>
                <button
                  onClick={() => { setTwoFactorEnabled(!twoFactorEnabled); setSecuritySaved(true); }}
                  className="w-12 h-6 rounded-full transition-colors relative"
                  style={{
                    backgroundColor: twoFactorEnabled ? T.accentColor : `${T.borderColor}50`,
                  }}
                >
                  <span
                    className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                    style={{ transform: twoFactorEnabled ? "translateX(24px)" : "translateX(0)" }}
                  />
                </button>
              </div>
              {securitySaved && (
                <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: "#22c55e" }}>
                  <Check size={12} />
                  Security settings saved
                </div>
              )}
            </div>

            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                Active Sessions
              </h2>
              <p className="text-xs mb-5 opacity-70" style={{ color: T.textMuted }}>
                Manage where you're logged in.
              </p>
              <div className="space-y-3">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                    style={{ backgroundColor: T.bgColor + "30", borderColor: T.borderColor + "30" }}
                  >
                    <div className="flex items-center gap-3">
                      <Smartphone size={16} style={{ color: T.textMuted }} />
                      <div>
                        <div className="text-sm font-bold" style={{ color: T.textColor }}>
                          {session.device}
                        </div>
                        <div className="text-[10px]" style={{ color: T.textMuted }}>
                          {session.location} • {session.lastActive}
                        </div>
                      </div>
                    </div>
                    {session.current ? (
                      <span className="text-[10px] px-2 py-1 rounded-full font-bold" style={{ backgroundColor: "#22c55e20", color: "#22c55e" }}>
                        Current
                      </span>
                    ) : (
                      <button className="text-[10px] px-2 py-1 rounded-lg font-bold transition-all hover:scale-105" style={{ backgroundColor: "#ef444420", color: "#ef4444" }}>
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                Password
              </h2>
              <p className="text-xs mb-5 opacity-70" style={{ color: T.textMuted }}>
                Change your password to keep your account secure.
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider opacity-70" style={{ color: T.textMuted }}>
                    Current Password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                    style={inputStyle}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider opacity-70" style={{ color: T.textMuted }}>
                    New Password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                    style={inputStyle}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider opacity-70" style={{ color: T.textMuted }}>
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                    style={inputStyle}
                  />
                </div>
                <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                  <Lock size={14} />
                  Change Password
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Connected Services Tab */}
        {activeTab === "connected" && (
          <div className="space-y-6">
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                Connected Services
              </h2>
              <p className="text-xs mb-5 opacity-70" style={{ color: T.textMuted }}>
                Connect third-party services to enhance your experience.
              </p>
              <div className="space-y-3">
                {connectedServices.map((service) => (
                  <div
                    key={service.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                    style={{ backgroundColor: T.bgColor + "30", borderColor: T.borderColor + "30" }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{service.icon}</span>
                      <div>
                        <div className="text-sm font-bold" style={{ color: T.textColor }}>
                          {service.name}
                        </div>
                        <div className="text-[10px]" style={{ color: T.textMuted }}>
                          {service.connected ? "Connected" : "Not connected"}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setConnectedServices(services => 
                          services.map(s => 
                            s.id === service.id ? { ...s, connected: !s.connected } : s
                          )
                        );
                        setConnectedSaved(true);
                      }}
                      className="text-[10px] px-3 py-1.5 rounded-lg font-bold transition-all hover:scale-105"
                      style={{
                        backgroundColor: service.connected ? "#ef444420" : T.accentColor + "20",
                        color: service.connected ? "#ef4444" : T.accentColor,
                        border: service.connected ? "1px solid #ef444430" : "1px solid " + T.accentColor + "30",
                      }}
                    >
                      {service.connected ? "Disconnect" : "Connect"}
                    </button>
                  </div>
                ))}
              </div>
              {connectedSaved && (
                <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: "#22c55e" }}>
                  <Check size={12} />
                  Connected services updated
                </div>
              )}
            </div>

            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                Webhooks
              </h2>
              <p className="text-xs mb-5 opacity-70" style={{ color: T.textMuted }}>
                Set up webhooks to receive real-time notifications.
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider opacity-70" style={{ color: T.textMuted }}>
                    Webhook URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://your-server.com/webhook"
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                    style={inputStyle}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider opacity-70" style={{ color: T.textMuted }}>
                    Secret Key
                  </label>
                  <input
                    type="password"
                    placeholder="Your webhook secret"
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                    style={inputStyle}
                  />
                </div>
                <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                  <ExternalLink size={14} />
                  Add Webhook
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Privacy Tab */}
        {activeTab === "privacy" && (
          <div className="space-y-6">
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                Profile Visibility
              </h2>
              <p className="text-xs mb-5 opacity-70" style={{ color: T.textMuted }}>
                Control who can see your profile and activity.
              </p>
              <div className="space-y-3">
                {[
                  { id: "public", label: "Public", desc: "Anyone can view your profile" },
                  { id: "private", label: "Private", desc: "Only you can view your profile" },
                  { id: "friends", label: "Friends Only", desc: "Only connections can view your profile" },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setProfileVisibility(option.id)}
                    className="w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all hover:scale-[1.01]"
                    style={{
                      backgroundColor: profileVisibility === option.id ? T.accentColor + "15" : T.bgColor + "30",
                      borderColor: profileVisibility === option.id ? T.accentColor + "30" : T.borderColor + "30",
                    }}
                  >
                    <div>
                      <div className="text-sm font-bold" style={{ color: T.textColor }}>
                        {option.label}
                      </div>
                      <div className="text-[10px]" style={{ color: T.textMuted }}>
                        {option.desc}
                      </div>
                    </div>
                    {profileVisibility === option.id && (
                      <Check size={16} style={{ color: T.accentColor }} />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                Data Export
              </h2>
              <p className="text-xs mb-5 opacity-70" style={{ color: T.textMuted }}>
                Download all your data in a portable format.
              </p>
              <button
                onClick={() => { setDataExportRequested(true); setPrivacySaved(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}
              >
                <RefreshCw size={14} />
                {dataExportRequested ? "Export Requested" : "Request Data Export"}
              </button>
              {dataExportRequested && (
                <div className="mt-3 text-xs" style={{ color: T.textMuted }}>
                  You'll receive an email with your data export link within 24 hours.
                </div>
              )}
            </div>

            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                Account Deletion
              </h2>
              <p className="text-xs mb-5 opacity-70" style={{ color: T.textMuted }}>
                Permanently delete your account and all associated data.
              </p>
              <button
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                style={{ backgroundColor: "#ef444420", color: "#ef4444", border: "1px solid #ef444430" }}
              >
                <AlertTriangle size={14} />
                Delete Account
              </button>
              <div className="mt-3 text-[10px]" style={{ color: T.textMuted }}>
                This action cannot be undone. All your data will be permanently deleted.
              </div>
            </div>
          </div>
        )}

        {/* Billing Tab */}
        {activeTab === "billing" && (
          <div className="space-y-6">
            {/* Subscription Status Card */}
            <div className="rounded-2xl border p-5 sm:p-6" style={{ ...cardStyle, background: `linear-gradient(135deg, ${T.boxBg} 0%, ${T.accentColor}08 100%)` }}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: T.accentColor + "15", border: `1px solid ${T.accentColor}30` }}
                  >
                    <Crown size={22} style={{ color: T.accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider opacity-60 mb-1" style={{ color: T.textMuted }}>
                      Current Plan
                    </div>
                    <h2 className="text-xl font-black mb-1" style={{ color: T.headerColor }}>
                      {currentPlan === "free" ? "Free" : currentPlan === "pro" ? "Pro" : "Enterprise"}
                    </h2>
                    <p className="text-xs opacity-70" style={{ color: T.textMuted }}>
                      {currentPlan === "free"
                        ? "You're on the free plan. Upgrade to unlock more agents and features."
                        : currentPlan === "pro"
                          ? "Your Pro subscription is active. Renews automatically on Feb 15, 2026."
                          : "Enterprise plan with dedicated support and custom SLA."}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {currentPlan !== "free" && (
                    <button
                      onClick={() => { setCurrentPlan("free"); setBillingSaved(true); }}
                      className="px-4 py-2 rounded-lg text-xs font-bold border transition-all hover:opacity-80"
                      style={{ borderColor: T.borderColor + "40", color: T.textMuted }}
                    >
                      Cancel Plan
                    </button>
                  )}
                  <button
                    onClick={() => { setCurrentPlan("pro"); setBillingSaved(true); }}
                    className="px-4 py-2 rounded-lg text-xs font-bold transition-all hover:opacity-90"
                    style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                  >
                    {currentPlan === "pro" ? "Manage Subscription" : "Upgrade to Pro"}
                  </button>
                </div>
              </div>
            </div>

            {/* Plan Tiers */}
            <div className="grid md:grid-cols-3 gap-4">
              {[
                {
                  id: "free",
                  name: "Free",
                  price: "$0",
                  period: "forever",
                  icon: Zap,
                  color: T.textMuted,
                  features: ["3 core agents", "5 projects", "Community support", "500 daily coins", "Basic analytics"],
                  cta: "Current Plan",
                },
                {
                  id: "pro",
                  name: "Pro",
                  price: "$19",
                  period: "/month",
                  icon: Sparkles,
                  color: T.accentColor,
                  features: ["All 18+ agents", "Unlimited projects", "Priority support", "2,000 daily coins", "Advanced analytics", "API access", "Custom themes"],
                  cta: "Upgrade to Pro",
                  popular: true,
                },
                {
                  id: "enterprise",
                  name: "Enterprise",
                  price: "Custom",
                  period: "pricing",
                  icon: Crown,
                  color: "#fbbf24",
                  features: ["Everything in Pro", "Custom agent training", "Dedicated support", "SLA guarantee", "SSO & audit logs", "White-label options"],
                  cta: "Contact Sales",
                },
              ].map((plan) => {
                const Icon = plan.icon;
                const isCurrent = currentPlan === plan.id;
                return (
                  <div
                    key={plan.id}
                    className="rounded-2xl border p-5 transition-all hover:scale-[1.02]"
                    style={{
                      ...cardStyle,
                      borderColor: plan.popular ? plan.color : T.borderColor + "30",
                      background: plan.popular ? `linear-gradient(180deg, ${plan.color}08 0%, ${T.boxBg} 100%)` : T.boxBg,
                    }}
                  >
                    {plan.popular && (
                      <div
                        className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full mb-3 inline-block"
                        style={{ backgroundColor: plan.color + "20", color: plan.color }}
                      >
                        Most Popular
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: plan.color + "15" }}
                      >
                        <Icon size={16} style={{ color: plan.color }} />
                      </div>
                      <span className="font-black" style={{ color: T.textColor }}>{plan.name}</span>
                    </div>
                    <div className="flex items-baseline gap-1 mb-4">
                      <span className="text-2xl font-black" style={{ color: plan.color }}>{plan.price}</span>
                      <span className="text-xs opacity-60" style={{ color: T.textMuted }}>{plan.period}</span>
                    </div>
                    <div className="space-y-2 mb-5">
                      {plan.features.map((feature) => (
                        <div key={feature} className="flex items-center gap-2 text-[11px]" style={{ color: T.textMuted }}>
                          <Check size={12} style={{ color: plan.color }} />
                          {feature}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => { setCurrentPlan(plan.id); setBillingSaved(true); }}
                      className="w-full py-2.5 rounded-lg text-xs font-bold transition-all hover:opacity-90"
                      style={{
                        backgroundColor: isCurrent ? T.borderColor + "30" : plan.popular ? plan.color : T.accentColor + "15",
                        color: isCurrent ? T.textMuted : plan.popular ? "#000" : T.accentColor,
                        border: isCurrent ? `1px solid ${T.borderColor}30` : "none",
                        cursor: isCurrent ? "default" : "pointer",
                      }}
                    >
                      {isCurrent ? "Current Plan" : plan.cta}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Usage Summary */}
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <h2 className="text-lg font-black mb-4" style={{ color: T.headerColor }}>
                Usage This Month
              </h2>
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { label: "Agents Used", value: "3 / 3", detail: "Free limit reached" },
                  { label: "Projects", value: "2 / 5", detail: "3 remaining" },
                  { label: "Coins Earned", value: "1,240", detail: "+50 daily bonus" },
                ].map((stat) => (
                  <div key={stat.label} className="p-3 rounded-lg border" style={{ backgroundColor: T.bgColor + "30", borderColor: T.borderColor + "30" }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1" style={{ color: T.textMuted }}>
                      {stat.label}
                    </div>
                    <div className="text-lg font-black mb-0.5" style={{ color: T.textColor }}>
                      {stat.value}
                    </div>
                    <div className="text-[10px] opacity-60" style={{ color: T.textMuted }}>
                      {stat.detail}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment Methods */}
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                    Payment Methods
                  </h2>
                  <p className="text-xs opacity-70" style={{ color: T.textMuted }}>
                    Manage cards and billing details.
                  </p>
                </div>
                <button
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-90"
                  style={{ backgroundColor: T.accentColor + "15", color: T.accentColor, border: `1px solid ${T.accentColor}30` }}
                >
                  <Plus size={12} />
                  Add Card
                </button>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border" style={{ backgroundColor: T.bgColor + "30", borderColor: T.borderColor + "30" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-7 rounded flex items-center justify-center" style={{ backgroundColor: "#6366f120" }}>
                      <CreditCard size={16} style={{ color: "#6366f1" }} />
                    </div>
                    <div>
                      <div className="text-sm font-bold" style={{ color: T.textColor }}>Visa ending in 4242</div>
                      <div className="text-[10px]" style={{ color: T.textMuted }}>Expires 12/25</div>
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-1 rounded-full font-bold" style={{ backgroundColor: "#22c55e20", color: "#22c55e" }}>
                    Default
                  </span>
                </div>
              </div>
            </div>

            {/* Invoice History */}
            <div className="rounded-2xl border p-4 sm:p-6" style={cardStyle}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-black mb-1" style={{ color: T.headerColor }}>
                    Invoice History
                  </h2>
                  <p className="text-xs opacity-70" style={{ color: T.textMuted }}>
                    Download past invoices and receipts.
                  </p>
                </div>
                <Receipt size={18} style={{ color: T.accentColor }} />
              </div>
              <div className="space-y-2">
                {[
                  { id: "INV-001", date: "Jan 15, 2026", amount: "$19.00", status: "Paid", plan: "Pro" },
                  { id: "INV-002", date: "Dec 15, 2025", amount: "$19.00", status: "Paid", plan: "Pro" },
                  { id: "INV-003", date: "Nov 15, 2025", amount: "$0.00", status: "Free", plan: "Free" },
                ].map((invoice) => (
                  <div key={invoice.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ backgroundColor: T.bgColor + "30", borderColor: T.borderColor + "30" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: T.accentColor + "10" }}>
                        <Receipt size={14} style={{ color: T.accentColor }} />
                      </div>
                      <div>
                        <div className="text-sm font-bold" style={{ color: T.textColor }}>{invoice.id}</div>
                        <div className="text-[10px]" style={{ color: T.textMuted }}>{invoice.date} · {invoice.plan}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold" style={{ color: T.textColor }}>{invoice.amount}</span>
                      <span
                        className="text-[10px] px-2 py-1 rounded-full font-bold"
                        style={{
                          backgroundColor: invoice.status === "Paid" ? "#22c55e20" : T.borderColor + "20",
                          color: invoice.status === "Paid" ? "#22c55e" : T.textMuted,
                        }}
                      >
                        {invoice.status}
                      </span>
                      <button
                        className="text-[10px] px-2 py-1 rounded-lg font-bold transition-all hover:scale-105"
                        style={{ backgroundColor: T.accentColor + "15", color: T.accentColor }}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ))}
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
