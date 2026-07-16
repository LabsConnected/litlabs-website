"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { useTheme, useCrtToggle } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth, useAppUser } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import type { SkinPreset, AccentColor } from "@/context/ThemeContext";
import type { BackgroundMode } from "@/components/AnimatedBackground";
import type { UserProfile } from "@/context/ProfileContext";
import {
  User,
  ChevronLeft,
  Save,
  Loader2,
  Check,
  Camera,
  Shield,
  Lock,
  LogOut,
  LayoutGrid,
  Bot,
  Mic,
  Volume2,
  ExternalLink,
  Bell,
  Palette,
  CreditCard,
  X,
  Trash2,
  RefreshCw,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type TabId =
  | "profile"
  | "account"
  | "workspace"
  | "ai"
  | "voice"
  | "integrations"
  | "notifications"
  | "appearance"
  | "billing"
  | "privacy";

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
// Mic level meter
// ------------------------------------------------------------------

function MicLevel({ active }: { active: boolean }) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    analyserRef.current = null;
    ctxRef.current?.close();
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRunning(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    stop();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      setRunning(true);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setLevel(Math.min(100, (avg / 255) * 100));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setError("Microphone permission denied");
    }
  }, [stop]);

  useEffect(() => {
    if (active && !running) start();
    if (!active) stop();
    return () => stop();
  }, [active, start, stop, running]);

  return (
    <div className="space-y-2">
      <div className="flex h-4 items-center gap-0.5 overflow-hidden rounded-full bg-white/10 p-0.5">
        {Array.from({ length: 16 }).map((_, i) => {
          const threshold = (i + 1) * (100 / 16);
          return (
            <div
              key={i}
              className="flex-1 rounded-sm transition-all duration-75"
              style={{
                backgroundColor: level >= threshold ? "#34d399" : "rgba(255,255,255,0.06)",
                height: `${Math.min(100, 20 + level * 0.8)}%`,
              }}
            />
          );
        })}
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
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

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("profile");
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
  const [isPublic, setIsPublic] = useState(true);
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
  // Voice state
  // ------------------------------------------------------------------

  const [micActive, setMicActive] = useState(false);
  const [selectedVoice, setSelectedVoice] = useStoredState("litlabs-voice-selected", "");
  const [voiceSpeed, setVoiceSpeed] = useStoredState("litlabs-voice-speed", 1.0);
  const [voicePitch, setVoicePitch] = useStoredState("litlabs-voice-pitch", 1.0);
  const [autoListen, setAutoListen] = useStoredState("litlabs-voice-auto-listen", false);
  const [autoSpeak, setAutoSpeak] = useStoredState("litlabs-voice-auto-speak", true);
  const [removeMarkdown, setRemoveMarkdown] = useStoredState("litlabs-voice-remove-markdown", true);
  const [keepMic, setKeepMic] = useStoredState("litlabs-voice-keep-mic", false);
  const [cameraPermission, setCameraPermission] = useStoredState("litlabs-camera-permission", "prompt");
  const [ttsSpeaking, setTtsSpeaking] = useState(false);

  const testVoice = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(
      "LiTT online. Voice test complete. Adjust speed and pitch to tune how I sound.",
    );
    u.rate = voiceSpeed;
    u.pitch = voicePitch;
    if (selectedVoice) {
      const voice = window.speechSynthesis.getVoices().find((v) => v.name === selectedVoice);
      if (voice) u.voice = voice;
    }
    u.onstart = () => setTtsSpeaking(true);
    u.onend = () => setTtsSpeaking(false);
    window.speechSynthesis.speak(u);
  }, [selectedVoice, voiceSpeed, voicePitch]);

  // ------------------------------------------------------------------
  // Integrations state
  // ------------------------------------------------------------------

  const [integrationStatus, setIntegrationStatus] = useState<Record<string, "connected" | "missing" | "unknown">>({});
  const [integrationLoading, setIntegrationLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/integrations/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.integrations) return;
        const map: Record<string, "connected" | "missing" | "unknown"> = {};
        for (const item of data.integrations as { id: string; status: string }[]) {
          map[item.id] = item.status === "connected" ? "connected" : "missing";
        }
        setIntegrationStatus(map);
      })
      .catch(() => {})
      .finally(() => setIntegrationLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const INTEGRATIONS = [
    { id: "github", name: "GitHub", desc: "Repositories, branches, commits, and pull requests", connect: "/api/github/install", color: "#24292e" },
    { id: "vercel", name: "Vercel", desc: "Deployments and previews", connect: null, color: "#000" },
    { id: "google", name: "Google", desc: "Drive, Gmail, and YouTube", connect: null, color: "#4285f4" },
    { id: "figma", name: "Figma", desc: "Design files and comments", connect: null, color: "#f24e1e" },
    { id: "x", name: "X", desc: "Posts and social sharing", connect: null, color: "#0f1419" },
    { id: "meta", name: "Meta", desc: "Facebook and Instagram", connect: null, color: "#1877f2" },
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
  // Billing state
  // ------------------------------------------------------------------

  const [plan, setPlan] = useState<{ plan: string; credits?: number; period_end?: string } | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);

  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    setBillingLoading(true);
    Promise.all([
      fetch(`/api/users/${user.id}/plan`).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/wallet").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([planData, walletData]) => {
        if (planData?.plan) {
          setPlan({ ...planData, credits: walletData?.balance ?? 0 });
        }
      })
      .finally(() => setBillingLoading(false));
  }, [isSignedIn, user?.id]);

  // ------------------------------------------------------------------
  // Privacy state
  // ------------------------------------------------------------------

  const [analyticsEnabled, setAnalyticsEnabled] = useStoredState("litlabs-privacy-analytics", false);
  const [publicProfile, setPublicProfile] = useStoredState("litlabs-privacy-public-profile", true);
  const [dataMemory, setDataMemory] = useStoredState("litlabs-privacy-memory", true);

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  const saveButton = (
    <Button
      onClick={() => {
        if (activeTab === "profile") saveProfile();
        else {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 1500);
        }
      }}
      disabled={activeTab === "profile" ? !profileDirty || saveStatus === "saving" : saveStatus === "saving"}
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

  const ProfileSection = (
    <div className="space-y-4">
      <Card T={T}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-black" style={{ color: T.headerColor }}>
            Profile photo
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

        <div className="flex items-center gap-4">
          <div className="relative h-20 w-20 overflow-hidden rounded-full border-2" style={{ borderColor: T.accentColor }}>
            {avatarUrl ? (
              <Image src={avatarUrl} alt="Avatar" fill className="object-cover" unoptimized />
            ) : (
              <div className="grid h-full w-full place-items-center text-xl font-black" style={{ backgroundColor: `${T.boxBg}`, color: T.accentColor }}>
                {(displayName?.[0] || user?.firstName?.[0] || "C").toUpperCase()}
              </div>
            )}
          </div>
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
            <Button variant="secondary" disabled T={T}>
              <Sparkles size={14} />
              Generate AI
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

      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Public profile
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Display name" value={displayName} onChange={setDisplayName} T={T} placeholder="Your name" />
          <Input label="Username" value={username} onChange={setUsername} T={T} placeholder="your_username" />
          <div className="sm:col-span-2">
            <TextArea label="Bio" value={bio} onChange={setBio} T={T} placeholder="Tell the community who you are…" />
          </div>
          <Input label="Website" value={website} onChange={setWebsite} T={T} placeholder="https://yoursite.com" />
          <Input label="Location" value={location} onChange={setLocation} T={T} placeholder="City, Country" />
        </div>
        <div className="mt-4">
          <Toggle label="Public profile" description="Allow others to view your profile" checked={isPublic} onChange={setIsPublic} T={T} />
        </div>
      </Card>

      <Card T={T}>
        <h2 className="mb-3 text-base font-black" style={{ color: T.headerColor }}>
          Preview
        </h2>
        <div className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: `${T.borderColor}30` }}>
          <div className="relative h-12 w-12 overflow-hidden rounded-full" style={{ backgroundColor: T.boxBg }}>
            {avatarUrl ? (
              <Image src={avatarUrl} alt="Avatar" fill className="object-cover" unoptimized />
            ) : (
              <div className="grid h-full w-full place-items-center text-lg font-black" style={{ color: T.accentColor }}>
                {(displayName?.[0] || "C").toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <div className="font-bold" style={{ color: T.textColor }}>
              {displayName || "Your name"}
            </div>
            <div className="text-xs" style={{ color: T.textMuted }}>
              @{username || "username"} · {location}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: T.textMuted }}>
              {bio}
            </div>
          </div>
        </div>
      </Card>

      {SaveStatusBar}
    </div>
  );

  const AccountSection = (
    <div className="space-y-4">
      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Email address
        </h2>
        <Input
          label="Email"
          value={user?.primaryEmailAddress?.emailAddress || ""}
          readOnly
          T={T}
        />
        <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: "#34d399" }}>
          <CheckCircle2 size={12} />
          Verified
        </div>
      </Card>

      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Password
        </h2>
        <p className="mb-3 text-xs" style={{ color: T.textMuted }}>
          Password and multi-factor authentication are managed through Clerk.
        </p>
        <Button variant="secondary" disabled T={T}>
          <Shield size={14} />
          Manage in Clerk
        </Button>
      </Card>

      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Connected login methods
        </h2>
        <div className="rounded-xl border p-3 text-sm" style={{ borderColor: `${T.borderColor}30`, color: T.textMuted }}>
          No connected providers available.
        </div>
      </Card>

      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Active sessions
        </h2>
        <div className="flex items-center justify-between rounded-xl border p-3" style={{ borderColor: `${T.borderColor}30` }}>
          <div>
            <div className="text-sm font-bold" style={{ color: T.textColor }}>
              This device
            </div>
            <div className="text-[10px]" style={{ color: T.textMuted }}>
              Current session
            </div>
          </div>
          <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
        </div>
        <form action="/api/auth/logout" method="POST" className="mt-4">
          <Button variant="danger" type="submit" T={T}>
            <LogOut size={14} />
            Sign out everywhere
          </Button>
        </form>
      </Card>
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

  const VoiceSection = (
    <div className="space-y-4">
      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Microphone
        </h2>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm" style={{ color: T.textColor }}>
            Status
          </div>
          <div className="text-xs" style={{ color: "#34d399" }}>
            Permission granted
          </div>
        </div>
        <Select
          label="Input device"
          value="default"
          onChange={() => {}}
          options={[{ value: "default", label: "Default microphone" }]}
          T={T}
        />
        <div className="my-4">
          <MicLevel active={micActive} />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setMicActive(true)} disabled={micActive} T={T}>
            <Mic size={14} />
            Test microphone
          </Button>
          <Button onClick={() => setMicActive(false)} variant="secondary" disabled={!micActive} T={T}>
            <X size={14} />
            Stop
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          <Toggle label="Automatically detect when I stop speaking" checked={autoListen} onChange={setAutoListen} T={T} />
          <Toggle label="LiTT responds aloud" checked={autoSpeak} onChange={setAutoSpeak} T={T} />
          <Toggle label="Remove markdown before speech" checked={removeMarkdown} onChange={setRemoveMarkdown} T={T} />
          <Toggle label="Keep microphone active between replies" checked={keepMic} onChange={setKeepMic} T={T} />
        </div>
      </Card>

      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          LiTT voice
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
              Voice
            </label>
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: `${T.boxBg}60`, borderColor: `${T.borderColor}40`, color: T.textColor }}
            >
              <option value="">Default</option>
              {typeof window !== "undefined" && window.speechSynthesis?.getVoices().map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
              Speed {voiceSpeed.toFixed(1)}x
            </label>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={voiceSpeed}
              onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))}
              className="w-full accent-current"
              style={{ accentColor: T.accentColor }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
              Pitch {(voicePitch * 100 - 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={voicePitch}
              onChange={(e) => setVoicePitch(parseFloat(e.target.value))}
              className="w-full accent-current"
              style={{ accentColor: T.accentColor }}
            />
          </div>
        </div>
        <Button onClick={testVoice} disabled={ttsSpeaking} className="mt-4" T={T}>
          {ttsSpeaking ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
          Test voice
        </Button>
      </Card>

      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Camera
        </h2>
        <Select
          label="Camera permission"
          value={cameraPermission}
          onChange={setCameraPermission}
          options={[
            { value: "prompt", label: "Ask each time" },
            { value: "allowed", label: "Always allow" },
            { value: "denied", label: "Deny" },
          ]}
          T={T}
        />
      </Card>
    </div>
  );

  const IntegrationsSection = (
    <div className="space-y-4">
      {integrationLoading && (
        <div className="text-sm" style={{ color: T.textMuted }}>
          <Loader2 size={14} className="mr-2 inline animate-spin" />
          Loading integration status…
        </div>
      )}
      {INTEGRATIONS.map((item) => {
        const status = integrationStatus[item.id] || "missing";
        const connected = status === "connected";
        return (
          <Card key={item.id} T={T}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-black text-white"
                  style={{ backgroundColor: item.color }}
                >
                  {item.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="font-bold" style={{ color: T.textColor }}>
                    {item.name}
                  </div>
                  <div className="text-xs" style={{ color: T.textMuted }}>
                    {item.desc}
                  </div>
                </div>
              </div>
              <div className="shrink-0">
                {item.connect ? (
                  <a href={item.connect}>
                    <Button variant={connected ? "secondary" : "primary"} T={T}>
                      {connected ? <Check size={14} /> : <ExternalLink size={14} />}
                      {connected ? "Manage" : "Connect"}
                    </Button>
                  </a>
                ) : (
                  <Button variant="secondary" disabled T={T}>
                    Not configured
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
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
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Current plan
        </h2>
        {billingLoading ? (
          <div className="text-sm" style={{ color: T.textMuted }}>
            <Loader2 size={14} className="mr-2 inline animate-spin" />
            Loading…
          </div>
        ) : plan ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: T.textMuted }}>
                Plan
              </span>
              <span className="rounded-full px-3 py-1 text-xs font-black uppercase" style={{ backgroundColor: `${T.accentColor}20`, color: T.accentColor }}>
                {plan.plan}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: T.textMuted }}>
                Credits
              </span>
              <span className="font-bold" style={{ color: T.textColor }}>
                {plan.credits?.toLocaleString() ?? 0}
              </span>
            </div>
            {plan.period_end && (
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: T.textMuted }}>
                  Renews
                </span>
                <span className="text-sm" style={{ color: T.textColor }}>
                  {new Date(plan.period_end).toLocaleDateString()}
                </span>
              </div>
            )}
            <Button variant="secondary" T={T}>
              <CreditCard size={14} />
              Manage subscription
            </Button>
          </div>
        ) : (
          <div className="text-sm" style={{ color: T.textMuted }}>
            No billing information available.
          </div>
        )}
      </Card>
      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Usage
        </h2>
        <div className="rounded-xl border p-4 text-center text-sm" style={{ borderColor: `${T.borderColor}30`, color: T.textMuted }}>
          Usage details coming soon.
        </div>
      </Card>
    </div>
  );

  const PrivacySection = (
    <div className="space-y-4">
      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Privacy & Data
        </h2>
        <div className="space-y-3">
          <Toggle label="Product analytics" description="Help improve LiTTreeLabStudios with usage analytics" checked={analyticsEnabled} onChange={setAnalyticsEnabled} T={T} />
          <Toggle label="Public profile" description="Your profile is visible to others" checked={publicProfile} onChange={setPublicProfile} T={T} />
          <Toggle label="Memory" description="Allow LiTT to remember context across sessions" checked={dataMemory} onChange={setDataMemory} T={T} />
        </div>
      </Card>

      <Card T={T}>
        <h2 className="mb-4 text-base font-black" style={{ color: T.headerColor }}>
          Data
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled T={T}>
            <RefreshCw size={14} />
            Export my data
          </Button>
          <Button variant="danger" disabled T={T}>
            <Trash2 size={14} />
            Delete account
          </Button>
        </div>
      </Card>
    </div>
  );

  const sections: Record<TabId, React.ReactNode> = {
    profile: ProfileSection,
    account: AccountSection,
    workspace: WorkspaceSection,
    ai: AiModelsSection,
    voice: VoiceSection,
    integrations: IntegrationsSection,
    notifications: NotificationsSection,
    appearance: AppearanceSection,
    billing: BillingSection,
    privacy: PrivacySection,
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
  { id: "profile", label: "Profile", icon: User },
  { id: "account", label: "Account", icon: Shield },
  { id: "workspace", label: "Workspace", icon: LayoutGrid },
  { id: "ai", label: "AI & Models", icon: Bot },
  { id: "voice", label: "Voice & Camera", icon: Mic },
  { id: "integrations", label: "Integrations", icon: ExternalLink },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "privacy", label: "Privacy", icon: Lock },
];
