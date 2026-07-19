"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme, useCrtToggle } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth, useAppUser } from "@/hooks/useClerkAuth";
import { useWallet } from "@/context/WalletContext";
import PageShell from "@/components/PageShell";
import CLIBridgeTool from "@/app/studio/tools/CLIBridgeTool";
import type { SkinPreset, AccentColor } from "@/context/ThemeContext";
import type { BackgroundMode } from "@/components/AnimatedBackground";
import type { UserProfile } from "@/context/ProfileContext";
import { WALLPAPERS, type WallpaperId } from "@/lib/wallpapers";
import Link from "next/link";
import {
  User,
  ChevronLeft,
  Save,
  Loader2,
  Check,
  Camera,
  Shield,
  LogOut,
  LayoutGrid,
  Bot,
  ExternalLink,
  Bell,
  Palette,
  CreditCard,
  Trash2,
  CheckCircle2,
  Key,
  Coins,
  Terminal,
  ShieldCheck,
  Upload,
} from "lucide-react";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type TabId =
  | "account"
  | "workspace"
  | "appearance"
  | "ai"
  | "agents"
  | "notifications"
  | "billing"
  | "advanced";

type SaveStatus = "idle" | "saving" | "saved" | "error";

// ------------------------------------------------------------------
// Local storage helpers
// ------------------------------------------------------------------

function useStoredState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);

  return [value, setValue];
}

// ------------------------------------------------------------------
// UI primitives
// ------------------------------------------------------------------

function Card({
  children,
  className = "",
  T,
}: {
  children: React.ReactNode;
  className?: string;
  T: { boxBg: string; borderColor: string };
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${className}`}
      style={{
        backgroundColor: `${T.boxBg}80`,
        borderColor: `${T.borderColor}30`,
      }}
    >
      {children}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
  T,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  T: { boxBg: string; borderColor: string; textColor: string; textMuted: string };
}) {
  return (
    <div className="space-y-1.5">
      <label
        className="text-[10px] font-black uppercase tracking-widest"
        style={{ color: T.textMuted }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={readOnly}
        placeholder={placeholder}
        className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-2 focus:ring-offset-0 disabled:opacity-50"
        style={{
          backgroundColor: `${T.boxBg}60`,
          borderColor: `${T.borderColor}40`,
          color: T.textColor,
        }}
        disabled={readOnly}
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  T,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  T: { boxBg: string; borderColor: string; textColor: string; textMuted: string };
}) {
  return (
    <div className="space-y-1.5">
      <label
        className="text-[10px] font-black uppercase tracking-widest"
        style={{ color: T.textMuted }}
      >
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-2"
        style={{
          backgroundColor: `${T.boxBg}60`,
          borderColor: `${T.borderColor}40`,
          color: T.textColor,
        }}
      />
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  T,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  T: { accentColor: string; borderColor: string; textColor: string; textMuted: string };
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border p-3.5" style={{ borderColor: `${T.borderColor}30` }}>
      <div>
        <div className="text-sm font-bold" style={{ color: T.textColor }}>
          {label}
        </div>
        {description && (
          <div className="text-[10px] opacity-70" style={{ color: T.textMuted }}>
            {description}
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 rounded-full transition-colors disabled:opacity-50"
        style={{ backgroundColor: checked ? T.accentColor : `${T.borderColor}60` }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  T,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  T: { boxBg: string; borderColor: string; textColor: string; textMuted: string };
}) {
  return (
    <div className="space-y-1.5">
      <label
        className="text-[10px] font-black uppercase tracking-widest"
        style={{ color: T.textMuted }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2"
        style={{
          backgroundColor: `${T.boxBg}60`,
          borderColor: `${T.borderColor}40`,
          color: T.textColor,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  T,
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  T: { accentColor: string; bgColor: string; boxBg: string; borderColor: string; textColor: string };
  className?: string;
  type?: "button" | "submit";
}) {
  const styles =
    variant === "primary"
      ? { backgroundColor: T.accentColor, color: T.bgColor }
      : variant === "danger"
        ? { backgroundColor: "#7f1d1d66", color: "#fca5a5", border: `1px solid #ef444466` }
        : { backgroundColor: `${T.boxBg}80`, color: T.textColor, border: `1px solid ${T.borderColor}40` };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      style={styles}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------
// Profile completion
// ------------------------------------------------------------------

function completionPct(profile: UserProfile): number {
  const fields = [
    profile.displayName,
    profile.username,
    profile.bio,
    profile.website,
    profile.location,
    profile.avatarUrl,
  ];
  const filled = fields.filter((f) => f && String(f).trim().length > 0).length;
  return Math.round((filled / fields.length) * 100);
}

// ------------------------------------------------------------------
// Main page
// ------------------------------------------------------------------

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedColors: T, theme, setMode, setSkin, setAccent, setBackgroundMode } = useTheme();
  const { crtEnabled, toggleCrt } = useCrtToggle();
  const { profile, updateProfile } = useProfile();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user } = useAppUser();
  const { balance } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("account");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync active tab with query param
  useEffect(() => {
    const tab = searchParams.get("tab") as TabId | null;
    if (tab && TABS.some((t) => t.id === tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const setTab = useCallback(
    (id: TabId) => {
      setActiveTab(id);
      const params = new URLSearchParams(window.location.search);
      params.set("tab", id);
      router.replace(`/settings?${params.toString()}`, { scroll: false });
    },
    [router],
  );

  // ------------------------------------------------------------------
  // Profile state
  // ------------------------------------------------------------------

  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [website, setWebsite] = useState(profile.website);
  const [location, setLocation] = useState(profile.location);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl || "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const profileDirty = useMemo(
    () =>
      displayName !== profile.displayName ||
      username !== profile.username ||
      bio !== profile.bio ||
      website !== profile.website ||
      location !== profile.location ||
      avatarUrl !== (profile.avatarUrl || ""),
    [displayName, username, bio, website, location, avatarUrl, profile],
  );

  const uploadAvatar = useCallback(
    async (file: File) => {
      setUploadingAvatar(true);
      setSaveError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
        setAvatarUrl(data.url);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Avatar upload failed");
      } finally {
        setUploadingAvatar(false);
      }
    },
    [],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadAvatar(file);
      if (e.target) e.target.value = "";
    },
    [uploadAvatar],
  );

  const saveProfile = useCallback(async () => {
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const body = {
        name: displayName.trim(),
        username: username.trim(),
        bio: bio.trim(),
        website: website.trim(),
        location: location.trim(),
        avatar_url: avatarUrl.trim(),
      };
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save profile");
      updateProfile({
        displayName: displayName.trim(),
        username: username.trim(),
        bio: bio.trim(),
        website: website.trim(),
        location: location.trim(),
        avatarUrl: avatarUrl.trim(),
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
      setSaveStatus("error");
    }
  }, [displayName, username, bio, website, location, avatarUrl, updateProfile]);

  const profileCompletion = useMemo(() => completionPct({ ...profile, displayName, username, bio, website, location, avatarUrl }), [profile, displayName, username, bio, website, location, avatarUrl]);

  // ------------------------------------------------------------------
  // Workspace state
  // ------------------------------------------------------------------

  const [workspaceName, setWorkspaceName] = useStoredState("litlabs-workspace-name", "");
  const [defaultProject, setDefaultProject] = useStoredState("litlabs-workspace-default-project", "");
  const [githubOrg, setGithubOrg] = useStoredState("litlabs-workspace-github-org", "");
  const [githubRepo, setGithubRepo] = useStoredState("litlabs-workspace-github-repo", "");
  const [defaultBranch, setDefaultBranch] = useStoredState("litlabs-workspace-default-branch", "main");
  const [deploymentProvider, setDeploymentProvider] = useStoredState("litlabs-workspace-deployment-provider", "vercel");
  const [autosave, setAutosave] = useStoredState("litlabs-workspace-autosave", true);
  const [projectMemory, setProjectMemory] = useStoredState("litlabs-workspace-project-memory", true);

  // ------------------------------------------------------------------
  // AI models state
  // ------------------------------------------------------------------

  const [autoRouter, setAutoRouter] = useStoredState("litlabs-ai-auto-router", true);
  const [defaultModel, setDefaultModel] = useStoredState("litlabs-ai-default-model", "gemini-2.5-flash");
  const [codingModel, setCodingModel] = useStoredState("litlabs-ai-coding-model", "gemini-2.5-flash");
  const [imageModel, setImageModel] = useStoredState("litlabs-ai-image-model", "fal-flux-pro");
  const [videoModel, setVideoModel] = useStoredState("litlabs-ai-video-model", "luma-dream-machine");
  const [localModelUrl, setLocalModelUrl] = useStoredState("litlabs-ai-local-model", "");

  const AI_MODELS = [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "openrouter-qwen-32b", label: "OpenRouter Qwen 32B" },
    { value: "openrouter-deepseek-v3", label: "OpenRouter DeepSeek V3" },
    { value: "openrouter-llama-70b", label: "OpenRouter Llama 3.3 70B" },
    { value: "claude-opus-4", label: "Claude Opus 4" },
    { value: "o3-mini", label: "OpenAI o3-mini" },
  ];
  const IMAGE_MODELS = [
    { value: "fal-flux-pro", label: "Fal Flux Pro" },
    { value: "dall-e-3", label: "DALL-E 3" },
    { value: "midjourney", label: "Midjourney" },
    { value: "ideogram", label: "Ideogram" },
  ];
  const VIDEO_MODELS = [
    { value: "luma-dream-machine", label: "Luma Dream Machine" },
    { value: "kling", label: "Kling" },
    { value: "runway-gen3", label: "Runway Gen-3" },
    { value: "pika", label: "Pika" },
  ];

  // ------------------------------------------------------------------
  // Notifications state
  // ------------------------------------------------------------------

  const [notifyMissions, setNotifyMissions] = useStoredState("litlabs-notify-missions", true);
  const [notifyAgents, setNotifyAgents] = useStoredState("litlabs-notify-agents", true);
  const [notifyDeploy, setNotifyDeploy] = useStoredState("litlabs-notify-deploy", true);
  const [notifySocial, setNotifySocial] = useStoredState("litlabs-notify-social", true);
  const [notifyEmail, setNotifyEmail] = useStoredState("litlabs-notify-email", false);
  const [notifyPush, setNotifyPush] = useStoredState("litlabs-notify-push", false);

  // ------------------------------------------------------------------
  // Appearance state
  // ------------------------------------------------------------------

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

  const [density, setDensity] = useStoredState<"compact" | "comfortable" | "spacious">("litlabs-ui-density", "comfortable");
  const [animations, setAnimations] = useStoredState<"minimal" | "reduced" | "normal">("litlabs-ui-animations", "normal");
  const [reducedMotion, setReducedMotion] = useStoredState("litlabs-ui-reduced-motion", false);

  const SKIN_OPTIONS: { value: SkinPreset; label: string }[] = [
    { value: "cyberpunk", label: "Cyberpunk" },
    { value: "neon", label: "Neon" },
    { value: "midnight", label: "Midnight" },
    { value: "emerald", label: "Emerald" },
    { value: "matrix", label: "Matrix" },
    { value: "synthwave", label: "Synthwave" },
    { value: "volcanic", label: "Volcanic" },
    { value: "honeycomb", label: "Honeycomb" },
    { value: "ocean", label: "Ocean" },
    { value: "sunset", label: "Sunset" },
    { value: "retro", label: "Retro" },
    { value: "pink", label: "Pink" },
    { value: "gold", label: "Gold" },
    { value: "arctic", label: "Arctic" },
    { value: "cosmic", label: "Cosmic" },
    { value: "miami", label: "Miami" },
    { value: "blood", label: "Blood" },
  ];

  const ACCENT_OPTIONS: { value: AccentColor; label: string }[] = [
    { value: "neon-green", label: "Neon Cyan" },
    { value: "hot-pink", label: "Hot Pink" },
    { value: "electric-blue", label: "Electric Blue" },
    { value: "cyber-yellow", label: "Cyber Yellow" },
    { value: "matrix-green", label: "Purple Haze" },
    { value: "sunset-orange", label: "Sunset Orange" },
    { value: "ocean-blue", label: "Ocean Blue" },
    { value: "purple-haze", label: "Purple" },
  ];

  const BACKGROUND_OPTIONS: { value: BackgroundMode; label: string }[] = [
    { value: "constellation", label: "Constellation" },
    { value: "nebula", label: "Nebula" },
    { value: "waves", label: "Waves" },
    { value: "minimal", label: "Minimal" },
    { value: "holo", label: "Holo" },
  ];

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  const saveButton = (
    <Button
      onClick={() => {
        if (activeTab === "account") saveProfile();
        else {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 1500);
        }
      }}
      disabled={activeTab === "account" ? !profileDirty || saveStatus === "saving" : saveStatus === "saving"}
      T={T}
    >
      {saveStatus === "saving" ? <Loader2 size={14} className="animate-spin" /> : saveStatus === "saved" ? <Check size={14} /> : <Save size={14} />}
      {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : "Save"}
    </Button>
  );

  const SaveStatusBar = (
    <div className="min-h-5">
      {saveError && <span className="text-xs text-red-400">{saveError}</span>}
    </div>
  );

  if (!isLoaded || !mounted) {
    return (
      <PageShell title="Settings" subtitle="Loading…" icon="⚙️">
        <div className="p-4 text-sm" style={{ color: T.textMuted }}>
          Loading settings…
        </div>
      </PageShell>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell title="Settings" subtitle="Sign in to manage your account" icon="⚙️">
        <div className="p-4 text-sm" style={{ color: T.textMuted }}>
          Please sign in to view settings.
        </div>
      </PageShell>
    );
  }

  // ------------------------------------------------------------------
  // Sections
  // ------------------------------------------------------------------

  const AccountSection = (
    <div className="space-y-4">
      {/* Clerk identity header */}
      <Card T={T}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-black" style={{ color: T.headerColor }}>
            Account
          </h2>
          <div className="text-xs" style={{ color: T.textMuted }}>
            {profileCompletion}% complete
          </div>
        </div>

        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${profileCompletion}%`, backgroundColor: T.accentColor }}
          />
        </div>

        {/* Large profile photo preview with Clerk identity */}
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/15 p-4 sm:flex-row sm:items-center">
          <div
            className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-white/15 bg-linear-to-br from-cyan-400/25 to-violet-500/25 text-2xl font-black"
            aria-label="Profile photo preview"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
            ) : (
              (displayName || user?.firstName?.[0] || "L").slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-black" style={{ color: T.textColor }}>
              {displayName || user?.fullName || "Your account"}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: T.textMuted }}>
              @{username || user?.username || "member"}
              {user?.primaryEmailAddress?.emailAddress
                ? ` · ${user.primaryEmailAddress.emailAddress}`
                : ""}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {user?.imageUrl && avatarUrl !== user.imageUrl && (
                <button
                  onClick={() => setAvatarUrl(user.imageUrl || "")}
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

        {/* Profile photo upload controls */}
        <div className="flex items-center gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingAvatar}
              T={T}
            >
              {uploadingAvatar ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              Upload photo
            </Button>
            <Button
              onClick={() => setAvatarUrl("")}
              variant="secondary"
              T={T}
              disabled={!avatarUrl}
            >
              <Trash2 size={14} />
              Remove
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </Card>

      {/* Extended profile info */}
      <Card T={T}>
        <h2 className="mb-1 text-base font-black" style={{ color: T.headerColor }}>
          Public Profile
        </h2>
        <p className="mb-4 text-xs" style={{ color: T.textMuted }}>
          Extended profile information stored by LiTTree. Account identity comes from your sign-in provider.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Display name" value={displayName} onChange={setDisplayName} T={T} placeholder="Your name" />
          <Input label="Username" value={username} onChange={setUsername} T={T} placeholder="username" />
          <div className="sm:col-span-2">
            <TextArea label="Bio" value={bio} onChange={setBio} T={T} placeholder="Tell the community who you are…" />
          </div>
          <Input label="Website" value={website} onChange={setWebsite} T={T} placeholder="https://yoursite.com" />
          <Input label="Location" value={location} onChange={setLocation} T={T} placeholder="City, Country" />
          <div className="sm:col-span-2">
            <Input label="Avatar URL" value={avatarUrl} onChange={setAvatarUrl} T={T} placeholder="https://..." />
          </div>
        </div>
      </Card>

      {/* Account security */}
      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Security
        </h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border p-3" style={{ borderColor: `${T.borderColor}30` }}>
            <div>
              <div className="text-sm font-bold" style={{ color: T.textColor }}>
                Email
              </div>
              <div className="text-xs" style={{ color: T.textMuted }}>
                {user?.primaryEmailAddress?.emailAddress || "Not set"}
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs" style={{ color: "#34d399" }}>
              <CheckCircle2 size={12} />
              Verified
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border p-3" style={{ borderColor: `${T.borderColor}30` }}>
            <div>
              <div className="text-sm font-bold" style={{ color: T.textColor }}>
                Password & MFA
              </div>
              <div className="text-xs" style={{ color: T.textMuted }}>
                Managed by your account provider
              </div>
            </div>
            <Button variant="secondary" disabled T={T}>
              <Shield size={14} />
              Manage
            </Button>
          </div>
          <form action="/api/auth/logout" method="POST">
            <Button variant="danger" type="submit" T={T}>
              <LogOut size={14} />
              Sign out everywhere
            </Button>
          </form>
        </div>
      </Card>

      {SaveStatusBar}
    </div>
  );

  const WorkspaceSection = (
    <div className="space-y-4">
      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Workspace
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Workspace name" value={workspaceName} onChange={setWorkspaceName} T={T} placeholder="My Studio" />
          <Input label="Default project" value={defaultProject} onChange={setDefaultProject} T={T} placeholder="project-name" />
          <Input label="GitHub organization" value={githubOrg} onChange={setGithubOrg} T={T} placeholder="LiTreeLabStudios" />
          <Input label="Default repository" value={githubRepo} onChange={setGithubRepo} T={T} placeholder="litlabs" />
          <Input label="Default branch" value={defaultBranch} onChange={setDefaultBranch} T={T} />
          <Select
            label="Deployment provider"
            value={deploymentProvider}
            onChange={setDeploymentProvider}
            options={[
              { value: "vercel", label: "Vercel" },
              { value: "railway", label: "Railway" },
              { value: "netlify", label: "Netlify" },
              { value: "self-hosted", label: "Self-hosted" },
            ]}
            T={T}
          />
        </div>
        <div className="mt-4 space-y-3">
          <Toggle label="Autosave" description="Automatically save drafts" checked={autosave} onChange={setAutosave} T={T} />
          <Toggle label="Project memory" description="Remember recent projects and files" checked={projectMemory} onChange={setProjectMemory} T={T} />
        </div>
      </Card>
    </div>
  );

  const AiModelsSection = (
    <div className="space-y-4">
      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          AI & Models
        </h2>
        <div className="mb-4">
          <Toggle label="Auto Router" description="Let LiTT pick the cheapest/fastest model for each task" checked={autoRouter} onChange={setAutoRouter} T={T} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Default conversational model" value={defaultModel} onChange={setDefaultModel} options={AI_MODELS} T={T} />
          <Select label="Coding model" value={codingModel} onChange={setCodingModel} options={AI_MODELS} T={T} />
          <Select label="Image model" value={imageModel} onChange={setImageModel} options={IMAGE_MODELS} T={T} />
          <Select label="Video model" value={videoModel} onChange={setVideoModel} options={VIDEO_MODELS} T={T} />
          <div className="sm:col-span-2">
            <Input label="Local model URL" value={localModelUrl} onChange={setLocalModelUrl} T={T} placeholder="http://localhost:11434 or openai-compatible endpoint" />
          </div>
        </div>
      </Card>
    </div>
  );

  const AgentsSection = (
    <div className="space-y-4">
      <Card T={T}>
        <div className="mb-5 flex items-start gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-400/10 text-violet-300">
            <Bot size={19} />
          </div>
          <div>
            <h2 className="text-base font-black" style={{ color: T.headerColor }}>Your AI crew</h2>
            <p className="mt-1 text-xs" style={{ color: T.textMuted }}>
              Configure agents where they work instead of duplicating their controls in Settings.
            </p>
          </div>
        </div>
        <div className="grid gap-3">
          <Link href="/agents" className="rounded-2xl border border-white/10 bg-white/3 p-4 transition hover:bg-white/6">
            <strong className="block text-sm" style={{ color: T.textColor }}>Manage agents</strong>
            <span className="mt-1 block text-xs" style={{ color: T.textMuted }}>Roles, tools, instructions, and crew status</span>
          </Link>
          <Link href="/studio?intent=agent" className="rounded-2xl border border-white/10 bg-white/3 p-4 transition hover:bg-white/6">
            <strong className="block text-sm" style={{ color: T.textColor }}>Launch an agent in Studio</strong>
            <span className="mt-1 block text-xs" style={{ color: T.textMuted }}>Keep the run beside your active conversation</span>
          </Link>
        </div>
      </Card>
      <Card T={T}>
        <h2 className="mb-2 text-base font-black" style={{ color: T.headerColor }}>How LiTT routing works</h2>
        <p className="text-xs leading-5" style={{ color: T.textMuted }}>
          Studio now understands image, video, audio, build, code, terminal, asset, and agent requests in normal language. You can still use slash commands when you want exact control.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-[10px]">
          {["Creative direction", "Code & build", "Research", "Automation", "Media creation", "Project memory"].map((capability) => (
            <div key={capability} className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-white/65">{capability}</div>
          ))}
        </div>
      </Card>
    </div>
  );

  const NotificationsSection = (
    <div className="space-y-4">
      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Notification channels
        </h2>
        <div className="space-y-3">
          <Toggle label="Missions" description="New missions and objectives" checked={notifyMissions} onChange={setNotifyMissions} T={T} />
          <Toggle label="Agent completion" description="When agents finish a task" checked={notifyAgents} onChange={setNotifyAgents} T={T} />
          <Toggle label="Deploy status" description="Build and deployment updates" checked={notifyDeploy} onChange={setNotifyDeploy} T={T} />
          <Toggle label="Social alerts" description="Follows, mentions, and messages" checked={notifySocial} onChange={setNotifySocial} T={T} />
          <Toggle label="Email" description="Important updates by email" checked={notifyEmail} onChange={setNotifyEmail} T={T} />
          <Toggle label="Push notifications" description="Browser push alerts" checked={notifyPush} onChange={setNotifyPush} T={T} />
        </div>
      </Card>
    </div>
  );

  const AppearanceSection = (
    <div className="space-y-4">
      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Theme
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Mode"
            value={theme.mode}
            onChange={(v) => setMode(v as "dark" | "light" | "system")}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
            ]}
            T={T}
          />
          <Select label="Skin" value={theme.skin} onChange={(v) => setSkin(v as SkinPreset)} options={SKIN_OPTIONS} T={T} />
          <Select label="Accent" value={theme.accent} onChange={(v) => setAccent(v as AccentColor)} options={ACCENT_OPTIONS} T={T} />
          <Select label="Background" value={theme.backgroundMode} onChange={(v) => setBackgroundMode(v as BackgroundMode)} options={BACKGROUND_OPTIONS} T={T} />
        </div>
      </Card>

      <Card T={T}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-black" style={{ color: T.headerColor }}>
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
          <div className="mb-4 rounded-xl border px-4 py-3 text-xs" style={{ borderColor: "#ef444455", backgroundColor: "#ef444410", color: "#fca5a5" }}>
            {wallpaperError}
          </div>
        )}

        {profile.customWallpaperUrl && (
          <button
            type="button"
            onClick={() => selectWallpaper("custom")}
            className="relative mb-4 h-44 w-full overflow-hidden rounded-2xl border text-left sm:h-52"
            style={{ borderColor: profile.wallpaper === "custom" ? T.accentColor : T.borderColor + "40" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={profile.customWallpaperUrl} alt="Your custom wallpaper" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/10 to-transparent" />
            <div className="absolute bottom-4 left-4">
              <div className="text-sm font-black text-white">Your wallpaper</div>
              <div className="text-[10px] text-white/60">Custom upload · click to apply</div>
            </div>
            {profile.wallpaper === "custom" && <Check className="absolute right-4 top-4 rounded-full bg-black/60 p-1 text-white" size={24} />}
          </button>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {WALLPAPERS.filter((wallpaper) => wallpaper.id !== "custom").map((wallpaper) => {
            const active = profile.wallpaper === wallpaper.id;
            return (
              <button
                key={wallpaper.id}
                type="button"
                onClick={() => selectWallpaper(wallpaper.id)}
                className="group overflow-hidden rounded-2xl border text-left transition hover:-translate-y-0.5"
                style={{ borderColor: active ? T.accentColor : T.borderColor + "30", backgroundColor: T.bgColor + "55" }}
              >
                <div className="relative h-24" style={{ background: wallpaper.preview }}>
                  <div className="absolute inset-0 bg-linear-to-t from-black/45 to-transparent" />
                  {active && <Check className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white" size={21} />}
                </div>
                <div className="p-3">
                  <div className="text-xs font-black" style={{ color: T.textColor }}>{wallpaper.name}</div>
                  <div className="mt-1 line-clamp-2 text-[9px] leading-4" style={{ color: T.textMuted }}>{wallpaper.description}</div>
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-[10px]" style={{ color: T.textMuted }}>
          Tip: wide images at 1920×1080 or larger look best. Upload limit: 10 MB.
        </p>
      </Card>

      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Interface
        </h2>
        <div className="space-y-3">
          <Select
            label="Density"
            value={density}
            onChange={(v) => setDensity(v as "compact" | "comfortable" | "spacious")}
            options={[
              { value: "compact", label: "Compact" },
              { value: "comfortable", label: "Comfortable" },
              { value: "spacious", label: "Spacious" },
            ]}
            T={T}
          />
          <Select
            label="Animation level"
            value={animations}
            onChange={(v) => setAnimations(v as "minimal" | "reduced" | "normal")}
            options={[
              { value: "minimal", label: "Minimal" },
              { value: "reduced", label: "Reduced" },
              { value: "normal", label: "Normal" },
            ]}
            T={T}
          />
          <Toggle label="Reduced motion" checked={reducedMotion} onChange={setReducedMotion} T={T} />
          <Toggle label="CRT scanlines" checked={crtEnabled} onChange={(v) => toggleCrt(v)} T={T} />
        </div>
      </Card>
    </div>
  );

  const BillingSection = (
    <div className="space-y-4">
      <Card T={T}>
        <div className="text-[10px] font-black uppercase tracking-[.2em]" style={{ color: T.textMuted }}>Available balance</div>
        <div className="mt-2 text-4xl font-black" style={{ color: T.headerColor }}>
          {balance.toLocaleString()} <span className="text-lg" style={{ color: T.accentColor }}>LiTBits</span>
        </div>
        <p className="mt-2 max-w-xl text-xs leading-5" style={{ color: T.textMuted }}>
          LiTBits power image, video, audio, and agent runs. The balance shown here comes from the same wallet used throughout Studio.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/wallet" className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
            <Coins size={14} />
            Open wallet
          </Link>
          <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-xs font-black" style={{ color: T.textColor }}>
            View plans
          </Link>
        </div>
      </Card>

      <Card T={T}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold" style={{ color: T.textMuted }}>Current plan</span>
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-300">
            {String(user?.publicMetadata?.plan || "Free")}
          </span>
        </div>
        <div className="mt-5 space-y-3 text-xs text-white/60">
          <div className="flex justify-between border-b border-white/8 pb-3"><span>Account</span><span className="max-w-[60%] truncate text-white/85">{user?.primaryEmailAddress?.emailAddress || "Signed in"}</span></div>
          <div className="flex justify-between border-b border-white/8 pb-3"><span>Currency</span><span className="text-white/85">LiTBits</span></div>
          <div className="flex justify-between"><span>Usage scope</span><span className="text-white/85">All Studio tools</span></div>
        </div>
      </Card>
    </div>
  );

  const AdvancedSection = (
    <div className="space-y-4">
      <Card T={T}>
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
            <h2 className="text-base font-black" style={{ color: T.headerColor }}>
              CLI Tools
            </h2>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: T.textMuted }}>
              Launch Qwen, Hermes, Gemini, OpenClaw, or a shell from the same bridge used
              in Studio. Access is limited to authorized admin accounts.
            </p>
          </div>
        </div>
      </Card>

      <Card T={T}>
        <h3 className="mb-3 text-sm font-black" style={{ color: T.headerColor }}>
          Connected Surfaces
        </h3>
        <div className="grid gap-3">
          {[
            { href: "/studio", label: "Studio Tools", desc: "Open the full creative workspace.", icon: LayoutGrid },
            { href: "/admin/terminal", label: "Admin Terminal", desc: "Jump to the dedicated terminal view.", icon: Terminal },
            { href: "/admin", label: "Admin Console", desc: "Review health, live activity, and platform controls.", icon: ShieldCheck },
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
      </Card>

      <div
        className="min-h-[400px] overflow-hidden rounded-2xl border"
        style={{
          backgroundColor: `${T.boxBg}60`,
          borderColor: `${T.borderColor}30`,
        }}
      >
        <CLIBridgeTool />
      </div>
    </div>
  );

  const sections: Record<TabId, React.ReactNode> = {
    account: AccountSection,
    workspace: WorkspaceSection,
    appearance: AppearanceSection,
    ai: AiModelsSection,
    agents: AgentsSection,
    notifications: NotificationsSection,
    billing: BillingSection,
    advanced: AdvancedSection,
  };

  return (
    <PageShell>
      {/* Sticky mobile header */}
      <header
        className="sticky top-0 z-40 border-b px-4 py-3 sm:px-6"
        style={{ backgroundColor: `${T.bgColor}f2`, borderColor: `${T.borderColor}20`, backdropFilter: "blur(12px)" }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex h-10 w-10 items-center justify-center rounded-xl border transition-colors active:scale-95"
            style={{ borderColor: `${T.borderColor}40`, color: T.textColor }}
            aria-label="Back"
          >
            <ChevronLeft size={20} />
          </button>
          <h1 className="flex-1 text-center text-base font-black" style={{ color: T.headerColor }}>
            Settings
          </h1>
          <div className="min-w-22">{saveButton}</div>
        </div>
      </header>

      {/* Horizontal scrollable tabs */}
      <div
        className="sticky top-13 z-30 border-b px-4 py-2 sm:px-6"
        style={{ backgroundColor: `${T.bgColor}f2`, borderColor: `${T.borderColor}20`, backdropFilter: "blur(12px)" }}
      >
        <div className="mx-auto max-w-3xl overflow-x-auto">
          <div className="flex min-w-max gap-2 pb-1">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-black transition-all whitespace-nowrap`}
                  style={{
                    backgroundColor: active ? `${T.accentColor}15` : `${T.boxBg}60`,
                    color: active ? T.accentColor : T.textMuted,
                    border: `2px solid ${active ? T.accentColor : `${T.borderColor}30`}`,
                  }}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="mx-auto max-w-3xl px-4 py-4 pb-28 sm:px-6">
        {sections[activeTab]}
      </main>
    </PageShell>
  );
}

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "account", label: "Account", icon: User },
  { id: "workspace", label: "Studio", icon: LayoutGrid },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "ai", label: "AI Models", icon: Key },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "billing", label: "Billing & Credits", icon: CreditCard },
  { id: "advanced", label: "Advanced", icon: Terminal },
];
