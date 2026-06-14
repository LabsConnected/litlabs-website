"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useTheme, darkSkins, lightSkins, type SkinPreset, type AccentColor } from "@/context/ThemeContext";
import type { BackgroundMode } from "@/components/AnimatedBackground";
import { useProfile } from "@/context/ProfileContext";
import { useAuth, RedirectToSignIn } from "@clerk/nextjs";
import PageShell from "@/components/PageShell";
import { WALLPAPERS } from "@/lib/wallpapers";
import {
  Palette, User, Bot, Monitor, Sparkles, Moon, Sun, Check,
  Zap, Layers, RefreshCw, Code, Trash2, ChevronRight, Eye, Type, Volume2,
  Camera, ImageIcon, MapPin, Music, Video, Globe, AtSign, Loader2, Wand2, Link2, Hash, X, Fingerprint, Flame, Upload
} from "lucide-react";

/* Modern display labels for legacy skin names */
const skinLabels: Record<SkinPreset, string> = {
  cyberpunk: "Navy Cyan", retro: "Amber Warm", ocean: "Deep Aqua", sunset: "Warm Ember",
  matrix: "Indigo Void", pink: "Rose Mauve", synthwave: "Violet Dream", volcanic: "Coral Ash",
  gold: "Honey Gold", arctic: "Ice Blue", emerald: "Forest Mint", midnight: "Blue Noir",
  neon: "Clean Slate", blood: "Crimson Wine", cosmic: "Lavender Space", miami: "Teal Breeze",
};

const accentLabels: Record<string, string> = {
  "neon-green": "Cyan", "hot-pink": "Magenta", "electric-blue": "Cobalt",
  "cyber-yellow": "Amber", "matrix-green": "Violet", "sunset-orange": "Coral",
  "ocean-blue": "Azure", "purple-haze": "Lilac",
};

const accentHex: Record<string, string> = {
  "neon-green": "#06b6d4", "hot-pink": "#ec4899", "electric-blue": "#3b82f6",
  "cyber-yellow": "#f59e0b", "matrix-green": "#8b5cf6", "sunset-orange": "#f97316",
  "ocean-blue": "#0ea5e9", "purple-haze": "#a855f7",
};

const tabMeta: { id: "theme" | "profile" | "agents" | "interface" | "advanced"; label: string; icon: typeof Palette }[] = [
  { id: "theme", label: "Appearance", icon: Palette },
  { id: "profile", label: "Profile", icon: User },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "interface", label: "Interface", icon: Monitor },
  { id: "advanced", label: "System", icon: Zap },
];

/* Reusable text field */
function TextField({ label, value, onChange, T, icon: Icon, prefix }: { label: string; value: string; onChange: (v: string) => void; T: any; icon?: typeof MapPin; prefix?: string }) {
  return (
    <div>
      <label className="text-[11px] font-medium opacity-60 mb-1.5 block" style={{ color: T.textMuted }}>{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] opacity-40" style={{ color: T.textMuted }}>{prefix}</span>}
        {Icon && <Icon size={12} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" style={{ color: T.textMuted }} />}
        <input type="text" value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full p-2.5 rounded-xl text-[12px] outline-none transition-all focus:ring-2"
          style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}20`, color: T.textColor, paddingLeft: (prefix || Icon) ? '2rem' : '0.75rem', '--tw-ring-color': T.accentColor + '30' } as React.CSSProperties} />
      </div>
    </div>
  );
}

/* Image field with AI generate button */
function ImageGenField({ label, value, onChange, onGenerate, placeholder, generating, T, icon: Icon }: {
  label: string; value: string; onChange: (v: string) => void; onGenerate: () => void; placeholder: string; generating: boolean; T: any; icon: typeof User;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium opacity-60 mb-1.5 block" style={{ color: T.textMuted }}>{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Icon size={12} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" style={{ color: T.textMuted }} />
          <input type="text" value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full p-2.5 rounded-xl text-[12px] outline-none"
            style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}20`, color: T.textColor, paddingLeft: '2rem' }} />
        </div>
        <button onClick={onGenerate} disabled={generating}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ backgroundColor: T.accentColor + "12", border: `1px solid ${T.accentColor}20`, color: T.accentColor }}>
          {generating ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
          {generating ? "Gen..." : "AI Gen"}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { theme, resolvedColors, setMode, setSkin, setAccent, setBackgroundMode, resetTheme } = useTheme();
  const { profile, updateProfile, resetProfile } = useProfile();

  const [activeTab, setActiveTab] = useState<"theme" | "profile" | "agents" | "advanced" | "interface">("theme");
  const [saved, setSaved] = useState(false);

  // Interface settings
  const [animSpeed, setAnimSpeed] = useState<string>("normal");
  const [compactMode, setCompactMode] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundEffects, setSoundEffects] = useState(false);
  const [customCSS, setCustomCSS] = useState("");

  const skinPresets: SkinPreset[] = ["cyberpunk", "retro", "ocean", "sunset", "matrix", "pink", "synthwave", "volcanic", "gold", "arctic", "emerald", "midnight", "neon", "blood", "cosmic", "miami"];
  const backgroundModes: { mode: BackgroundMode; label: string }[] = [
    { mode: "constellation", label: "Constellation" },
    { mode: "nebula", label: "Nebula" },
    { mode: "waves", label: "Waves" },
    { mode: "minimal", label: "Minimal" },
  ];
  const accentColors: AccentColor[] = ["electric-blue", "purple-haze", "hot-pink", "cyber-yellow", "neon-green", "matrix-green", "sunset-orange", "ocean-blue"];

  useEffect(() => {
    const rm = localStorage.getItem("litlabs-reduced-motion") === "true";
    setAnimSpeed(localStorage.getItem("litlabs-anim-speed") || "normal");
    setCompactMode(localStorage.getItem("litlabs-compact") === "true");
    setReducedMotion(rm);
    setSoundEffects(localStorage.getItem("litlabs-sound") === "true");
    setCustomCSS(localStorage.getItem("litlabs-custom-css") || "");
    document.documentElement.classList.toggle("reduce-motion", rm);
  }, []);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0c0c14", color: "#7dd3fc" }}>
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">⚡</div>
          <div className="text-sm opacity-70">Loading settings...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <RedirectToSignIn redirectUrl="/settings" />;
  }

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveInterface = (key: string, value: string | boolean) => {
    localStorage.setItem(`litlabs-${key}`, String(value));
    showSaved();
    if (key === "reduced-motion") {
      document.documentElement.classList.toggle("reduce-motion", !!value);
    }
    if (key === "custom-css") {
      let style = document.getElementById("litlabs-custom-css") as HTMLStyleElement | null;
      if (!style) { style = document.createElement("style"); style.id = "litlabs-custom-css"; document.head.appendChild(style); }
      style.textContent = value as string;
    }
  };

  const T = resolvedColors;

  // Image generation state
  const [generating, setGenerating] = useState<string | null>(null);

  const generateImage = async (type: "avatar" | "cover") => {
    setGenerating(type);
    try {
      const prompt = type === "avatar"
        ? "Professional portrait avatar, abstract digital art style, single figure centered, dark background with subtle purple and blue neon glow, futuristic, clean, high quality, square composition"
        : "Abstract futuristic technology banner, dark purple and blue gradient, subtle grid lines, soft glowing particles, wide cinematic composition, clean minimal, high quality";
      const res = await fetch("/api/media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          mediaType: "image",
          provider: "pollinations",
          model: "flux",
          width: type === "avatar" ? 512 : 1280,
          height: type === "avatar" ? 512 : 640,
        }),
      });
      const data = await res.json();
      if (data.url) {
        updateProfile({ [type === "avatar" ? "avatarUrl" : "coverUrl"]: data.url });
        showSaved();
      }
    } catch (e) {
      console.error("Image generation failed", e);
    } finally {
      setGenerating(null);
    }
  };

  return (
    <PageShell title="Settings" className="relative">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-10">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-40 mb-2" style={{ color: T.linkColor }}>Workspace</div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-2" style={{ color: T.textColor }}>Settings</h1>
          <p className="text-xs opacity-50 max-w-md">Customize your experience. Appearance, profile, agents, and interface preferences.</p>
        </div>

        {/* Glassmorphism tab navigation */}
        <div className="flex gap-1 mb-10 p-1.5 rounded-2xl overflow-x-auto" style={{ backgroundColor: T.boxBg + '80', border: `1px solid ${T.borderColor}18`, backdropFilter: 'blur(12px)' }}>
          {tabMeta.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[11px] font-bold transition-all duration-200 shrink-0"
                style={{
                  backgroundColor: isActive ? T.accentColor + "18" : "transparent",
                  color: isActive ? T.accentColor : T.textMuted,
                  boxShadow: isActive ? `0 0 20px ${T.accentColor}10` : 'none',
                }}
              >
                <Icon size={14} /> {tab.label}
              </button>
            );
          })}
        </div>

        {/* Theme Tab */}
        {activeTab === "theme" && (
          <div className="space-y-5 animate-fadeInUp">
            {/* Background */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-5">
                <Sparkles size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Background Effect</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {backgroundModes.map((bm) => (
                  <button key={bm.mode} onClick={() => { setBackgroundMode(bm.mode); showSaved(); }}
                    className="px-3 py-2.5 rounded-xl text-[11px] font-medium transition-all hover:scale-[1.02]"
                    style={{
                      backgroundColor: theme.backgroundMode === bm.mode ? T.accentColor + "15" : T.bgColor,
                      border: `1px solid ${theme.backgroundMode === bm.mode ? T.accentColor + "30" : T.borderColor + "15"}`,
                      color: theme.backgroundMode === bm.mode ? T.accentColor : T.textColor,
                    }}>{bm.label}</button>
                ))}
              </div>
            </section>

            {/* Mode */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-5">
                <Monitor size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Mode</h2>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setMode("dark"); showSaved(); }}
                  className="flex items-center gap-2 flex-1 px-4 py-3 rounded-xl text-[11px] font-semibold transition-all hover:scale-[1.01]"
                  style={{ backgroundColor: theme.mode === "dark" ? T.accentColor + "12" : T.bgColor, border: `1px solid ${theme.mode === "dark" ? T.accentColor + "30" : T.borderColor + "15"}`, color: theme.mode === "dark" ? T.accentColor : T.textMuted }}>
                  <Moon size={14} /> Dark
                </button>
                <button onClick={() => { setMode("light"); showSaved(); }}
                  className="flex items-center gap-2 flex-1 px-4 py-3 rounded-xl text-[11px] font-semibold transition-all hover:scale-[1.01]"
                  style={{ backgroundColor: theme.mode === "light" ? T.accentColor + "12" : T.bgColor, border: `1px solid ${theme.mode === "light" ? T.accentColor + "30" : T.borderColor + "15"}`, color: theme.mode === "light" ? T.accentColor : T.textMuted }}>
                  <Sun size={14} /> Light
                </button>
              </div>
            </section>

            {/* Skins with swatches */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-5">
                <Palette size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Color Palette</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {skinPresets.map((skin) => {
                  const colors = theme.mode === "light" ? lightSkins[skin] : darkSkins[skin];
                  const isActive = theme.skin === skin;
                  return (
                    <button key={skin} onClick={() => { setSkin(skin); showSaved(); }}
                      className="relative px-3 py-3 rounded-xl text-[11px] font-medium transition-all hover:scale-[1.02] text-left"
                      style={{ backgroundColor: isActive ? colors.accentColor + "10" : T.bgColor, border: `1px solid ${isActive ? colors.accentColor + "40" : T.borderColor + "12"}`, color: T.textColor }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colors.accentColor }} />
                        <span className="truncate">{skinLabels[skin]}</span>
                      </div>
                      <div className="flex gap-1">
                        <span className="w-4 h-1.5 rounded-full" style={{ backgroundColor: colors.bgColor, border: `1px solid ${colors.borderColor}` }} />
                        <span className="w-4 h-1.5 rounded-full" style={{ backgroundColor: colors.textColor }} />
                        <span className="w-4 h-1.5 rounded-full" style={{ backgroundColor: colors.linkColor }} />
                      </div>
                      {isActive && <Check size={12} className="absolute top-2 right-2" style={{ color: colors.accentColor }} />}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Accent */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-5">
                <Zap size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Accent</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {accentColors.map((accent) => {
                  const isActive = theme.accent === accent;
                  const hex = accentHex[accent];
                  return (
                    <button key={accent} onClick={() => { setAccent(accent); showSaved(); }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-medium transition-all hover:scale-[1.02]"
                      style={{ backgroundColor: isActive ? hex + "12" : T.bgColor, border: `1px solid ${isActive ? hex + "40" : T.borderColor + "12"}`, color: isActive ? hex : T.textMuted }}>
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: hex }} />
                      {accentLabels[accent]}
                    </button>
                  );
                })}
              </div>
            </section>

            <button onClick={() => { resetTheme(); showSaved(); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-medium transition-all hover:scale-[1.02]"
              style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, color: T.textMuted }}>
              <RefreshCw size={12} /> Reset to defaults
            </button>
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div className="space-y-5 animate-fadeInUp max-w-2xl">
            {/* Avatar & Cover Preview */}
            <section className="rounded-2xl overflow-hidden relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25 z-10" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="h-32 relative" style={{ background: profile.coverUrl ? `url(${profile.coverUrl}) center/cover` : `linear-gradient(135deg, ${T.linkColor}30, ${T.headerColor}20)` }}>
                {/* Cover upload button */}
                <button
                  onClick={() => document.getElementById('cover-upload')?.click()}
                  className="absolute top-3 right-3 p-2 rounded-lg opacity-0 hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: T.bgColor + '90', color: T.textColor }}
                  title="Change cover"
                >
                  <Camera size={14} />
                </button>
                <input
                  id="cover-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        updateProfile({ coverUrl: event.target?.result as string });
                        showSaved();
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                />
                <div className="absolute bottom-0 left-5 translate-y-1/2">
                  <div
                    className="w-20 h-20 rounded-2xl border-[3px] flex items-center justify-center overflow-hidden cursor-pointer group relative"
                    style={{ borderColor: T.boxBg, backgroundColor: profile.avatarUrl ? 'transparent' : T.bgColor }}
                    onClick={() => document.getElementById('avatar-upload')?.click()}
                    title="Click to change avatar"
                  >
                    {profile.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <User size={28} style={{ color: T.textMuted }} />
                    )}
                    {/* Avatar hover overlay */}
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera size={20} style={{ color: 'white' }} />
                    </div>
                  </div>
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          updateProfile({ avatarUrl: event.target?.result as string });
                          showSaved();
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </div>
              </div>
              <div className="pt-14 pb-5 px-5">
                <div className="text-[15px] font-bold" style={{ color: T.textColor }}>{profile.displayName || "Your Name"}</div>
                <div className="text-[11px] opacity-50" style={{ color: T.textMuted }}>@{profile.username || "username"}</div>
              </div>
            </section>

            {/* Images */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Camera size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Images</h2>
              </div>
              <div className="space-y-4">
                {/* Avatar with Upload */}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <ImageGenField label="Avatar URL" value={profile.avatarUrl || ""}
                      icon={User}
                      onChange={(v) => updateProfile({ avatarUrl: v || null })}
                      onGenerate={() => generateImage("avatar")}
                      placeholder="https://..."
                      generating={generating === "avatar"}
                      T={T} />
                  </div>
                  <input
                    id="avatar-file-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          updateProfile({ avatarUrl: event.target?.result as string });
                          showSaved();
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                  <button
                    onClick={() => document.getElementById('avatar-file-upload')?.click()}
                    className="px-3 py-2 rounded-lg text-[11px] font-bold transition-all hover:scale-105 flex items-center gap-1.5"
                    style={{ backgroundColor: T.accentColor + '15', color: T.accentColor, border: `1px solid ${T.accentColor}30` }}
                    title="Upload from folder"
                  >
                    <Upload size={14} /> Upload
                  </button>
                </div>
                
                {/* Cover with Upload */}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <ImageGenField label="Cover URL" value={profile.coverUrl || ""}
                      icon={ImageIcon}
                      onChange={(v) => updateProfile({ coverUrl: v || null })}
                      onGenerate={() => generateImage("cover")}
                      placeholder="https://..."
                      generating={generating === "cover"}
                      T={T} />
                  </div>
                  <input
                    id="cover-file-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          updateProfile({ coverUrl: event.target?.result as string });
                          showSaved();
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                  <button
                    onClick={() => document.getElementById('cover-file-upload')?.click()}
                    className="px-3 py-2 rounded-lg text-[11px] font-bold transition-all hover:scale-105 flex items-center gap-1.5"
                    style={{ backgroundColor: T.accentColor + '15', color: T.accentColor, border: `1px solid ${T.accentColor}30` }}
                    title="Upload from folder"
                  >
                    <Upload size={14} /> Upload
                  </button>
                </div>
              </div>
            </section>

            {/* Basic Info */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Fingerprint size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Basic Info</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="Display Name" value={profile.displayName} onChange={(v) => updateProfile({ displayName: v })} T={T} />
                <TextField label="Username" value={profile.username} onChange={(v) => updateProfile({ username: v })} T={T} prefix="@" />
                <TextField label="Mood" value={profile.mood} onChange={(v) => updateProfile({ mood: v })} T={T} />
                <TextField label="Location" value={profile.location} onChange={(v) => updateProfile({ location: v })} T={T} icon={MapPin} />
                <TextField label="Website" value={profile.website} onChange={(v) => updateProfile({ website: v })} T={T} icon={Globe} />
              </div>
              <div className="mt-3">
                <label className="text-[11px] font-medium opacity-60 mb-1.5 block" style={{ color: T.textMuted }}>Bio</label>
                <textarea value={profile.bio} rows={3}
                  onChange={(e) => { updateProfile({ bio: e.target.value }); showSaved(); }}
                  className="w-full p-3 rounded-xl text-[12px] outline-none resize-none"
                  style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}20`, color: T.textColor }} />
              </div>
            </section>

            {/* Social Links */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Link2 size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Social Links</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="X / Twitter" value={profile.socialLinks?.twitter || ""} onChange={(v) => updateProfile({ socialLinks: { ...profile.socialLinks, twitter: v } })} T={T} icon={AtSign} />
                <TextField label="Instagram" value={profile.socialLinks?.instagram || ""} onChange={(v) => updateProfile({ socialLinks: { ...profile.socialLinks, instagram: v } })} T={T} icon={AtSign} />
                <TextField label="GitHub" value={profile.socialLinks?.github || ""} onChange={(v) => updateProfile({ socialLinks: { ...profile.socialLinks, github: v } })} T={T} icon={Hash} />
                <TextField label="LinkedIn" value={profile.socialLinks?.linkedin || ""} onChange={(v) => updateProfile({ socialLinks: { ...profile.socialLinks, linkedin: v } })} T={T} icon={Link2} />
              </div>
            </section>

            {/* Music & Video */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Music size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Music</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                <TextField label="Spotify" value={profile.musicLinks?.spotify || ""} onChange={(v) => updateProfile({ musicLinks: { ...profile.musicLinks, spotify: v } })} T={T} icon={Music} />
                <TextField label="YouTube Music" value={profile.musicLinks?.youtube || ""} onChange={(v) => updateProfile({ musicLinks: { ...profile.musicLinks, youtube: v } })} T={T} icon={Video} />
                <TextField label="SoundCloud" value={profile.musicLinks?.soundcloud || ""} onChange={(v) => updateProfile({ musicLinks: { ...profile.musicLinks, soundcloud: v } })} T={T} icon={Music} />
                <TextField label="Apple Music" value={profile.musicLinks?.appleMusic || ""} onChange={(v) => updateProfile({ musicLinks: { ...profile.musicLinks, appleMusic: v } })} T={T} icon={Music} />
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Video size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Video</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="YouTube" value={profile.videoLinks?.youtube || ""} onChange={(v) => updateProfile({ videoLinks: { ...profile.videoLinks, youtube: v } })} T={T} icon={Video} />
                <TextField label="Vimeo" value={profile.videoLinks?.vimeo || ""} onChange={(v) => updateProfile({ videoLinks: { ...profile.videoLinks, vimeo: v } })} T={T} icon={Video} />
              </div>
            </section>

            {/* Interests */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Interests</h2>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {(profile.interests || []).map((tag, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                    style={{ backgroundColor: T.accentColor + "10", border: `1px solid ${T.accentColor}20`, color: T.accentColor }}>
                    {tag}
                    <button onClick={() => updateProfile({ interests: profile.interests.filter((_, idx) => idx !== i) })}
                      className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                  </span>
                ))}
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem("newInterest") as HTMLInputElement;
                const val = input.value.trim();
                if (val && !profile.interests.includes(val)) {
                  updateProfile({ interests: [...profile.interests, val] });
                  input.value = "";
                  showSaved();
                }
              }} className="flex gap-2">
                <input name="newInterest" type="text" placeholder="Add interest..."
                  className="flex-1 p-2.5 rounded-xl text-[11px] outline-none"
                  style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}20`, color: T.textColor }} />
                <button type="submit" className="px-3 py-2 rounded-xl text-[11px] font-medium"
                  style={{ backgroundColor: T.accentColor + "12", border: `1px solid ${T.accentColor}20`, color: T.accentColor }}>Add</button>
              </form>
            </section>

            {/* Badges */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Hash size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Badges</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {(profile.badges || []).map((badge, i) => (
                  <span key={i} className="px-3 py-1.5 rounded-lg text-[11px] font-medium"
                    style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}15`, color: T.textColor }}>
                    {badge}
                  </span>
                ))}
              </div>
            </section>

            <button onClick={() => { resetProfile(); showSaved(); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-medium"
              style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, color: T.textMuted }}>
              <RefreshCw size={12} /> Reset profile
            </button>
          </div>
        )}

        {/* Agents Tab */}
        {activeTab === "agents" && (
          <div className="space-y-4 animate-fadeInUp max-w-xl">
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-3">
                <Bot size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Webhook</h2>
              </div>
              <p className="text-[11px] opacity-60 mb-2">ActivePieces flow endpoint</p>
              <code className="block p-3 rounded-xl text-[10px] font-mono break-all"
                style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}15`, color: T.accentColor }}>
                https://cloud.activepieces.com/api/v1/webhooks/VoccE3SEr4bciLvkThTlO
              </code>
            </section>

            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Layers size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Core Agents</h2>
              </div>
              <div className="space-y-2">
                {[
                  { name: "Director", role: "Orchestrator", color: T.accentColor },
                  { name: "Champion", role: "General Assistant", color: T.linkColor },
                  { name: "Code Champion", role: "Software Expert", color: T.headerColor },
                  { name: "Social Dominator", role: "Growth & Viral", color: T.accentColor },
                  { name: "Data Slayer", role: "Analytics", color: T.linkColor },
                  { name: "Writing Coach", role: "Copy & Content", color: T.headerColor },
                ].map((a) => (
                  <div key={a.name} className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}10` }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                    <span className="text-[12px] font-semibold" style={{ color: T.textColor }}>{a.name}</span>
                    <span className="text-[10px] opacity-50 ml-auto" style={{ color: T.textMuted }}>{a.role}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Interface Tab */}
        {activeTab === "interface" && (
          <div className="space-y-4 animate-fadeInUp max-w-xl">
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Zap size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Animation</h2>
              </div>
              <div className="flex gap-2">
                {["fast", "normal", "slow", "off"].map((speed) => (
                  <button key={speed} onClick={() => { setAnimSpeed(speed); saveInterface("anim-speed", speed); }}
                    className="flex-1 px-3 py-2.5 rounded-xl text-[11px] font-medium transition-all hover:scale-[1.02]"
                    style={{ backgroundColor: animSpeed === speed ? T.accentColor + "12" : T.bgColor, border: `1px solid ${animSpeed === speed ? T.accentColor + "30" : T.borderColor + "15"}`, color: animSpeed === speed ? T.accentColor : T.textMuted }}>
                    {speed.charAt(0).toUpperCase() + speed.slice(1)}
                  </button>
                ))}
              </div>
            </section>

            {/* Wallpaper Gallery Section */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ImageIcon size={14} style={{ color: T.accentColor }} />
                  <h2 className="text-sm font-bold" style={{ color: T.textColor }}>AI Wallpaper Gallery</h2>
                </div>
                <span className="text-[10px] opacity-50" style={{ color: T.textMuted }}>14 unique styles</span>
              </div>
              
              {/* Categories */}
              {[
                { name: 'Tech', wallpapers: WALLPAPERS.filter(w => w.category === 'tech') },
                { name: 'Abstract', wallpapers: WALLPAPERS.filter(w => w.category === 'abstract') },
                { name: 'Nature', wallpapers: WALLPAPERS.filter(w => w.category === 'nature') },
                { name: 'Minimal', wallpapers: WALLPAPERS.filter(w => w.category === 'minimal') },
              ].map((category) => (
                <div key={category.name} className="mb-4">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider opacity-40 mb-2" style={{ color: T.textMuted }}>{category.name}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {category.wallpapers.filter(w => w.id !== 'custom').map((wp) => (
                      <button key={wp.id} onClick={() => { updateProfile({ wallpaper: wp.id as any }); showSaved(); }}
                        className="group relative flex flex-col gap-2 p-2 rounded-xl transition-all hover:scale-[1.02] overflow-hidden"
                        style={{ backgroundColor: profile.wallpaper === wp.id ? T.accentColor + '12' : T.bgColor, border: `1px solid ${profile.wallpaper === wp.id ? T.accentColor + '50' : T.borderColor + '15'}` }}>
                        <div className="w-full h-16 rounded-lg relative overflow-hidden" style={{ background: wp.preview }}>
                          {profile.wallpaper === wp.id && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Check size={20} style={{ color: T.accentColor }} />
                            </div>
                          )}
                        </div>
                        <div className="text-left">
                          <span className="text-[10px] font-bold block" style={{ color: profile.wallpaper === wp.id ? T.accentColor : T.textColor }}>{wp.name}</span>
                          <span className="text-[9px] opacity-50 block truncate" style={{ color: T.textMuted }}>{wp.description}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              
              {/* Custom Option */}
              <div className="mt-4 pt-4 border-t" style={{ borderColor: T.borderColor + '20' }}>
                <button onClick={() => { updateProfile({ wallpaper: 'custom' as any }); showSaved(); }}
                  className="w-full flex flex-col gap-2 p-2 rounded-xl transition-all hover:scale-[1.01]"
                  style={{ backgroundColor: profile.wallpaper === 'custom' ? T.accentColor + '12' : T.bgColor, border: `1px solid ${profile.wallpaper === 'custom' ? T.accentColor + '50' : T.borderColor + '15'}` }}>
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: T.borderColor + '30' }}>
                      <Upload size={16} style={{ color: T.textMuted }} />
                    </div>
                    <div className="text-left">
                      <span className="text-[11px] font-bold block" style={{ color: profile.wallpaper === 'custom' ? T.accentColor : T.textColor }}>Custom Image</span>
                      <span className="text-[9px] opacity-50 block" style={{ color: T.textMuted }}>Upload your own wallpaper</span>
                    </div>
                    {profile.wallpaper === 'custom' && <Check size={16} style={{ color: T.accentColor }} className="ml-auto" />}
                  </div>
                </button>
                
                {profile.wallpaper === 'custom' && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      <input type="text" value={profile.customWallpaperUrl || ''} onChange={(e) => updateProfile({ customWallpaperUrl: e.target.value })}
                        placeholder="https://your-image-url.com/wallpaper.jpg"
                        className="flex-1 p-2.5 rounded-xl text-[12px] outline-none"
                        style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                      <button onClick={() => showSaved()} className="px-4 py-2 rounded-xl text-[11px] font-bold"
                        style={{ backgroundColor: T.accentColor, color: T.bgColor }}>Apply</button>
                    </div>
                    <p className="text-[10px] opacity-40" style={{ color: T.textMuted }}>Tip: Use high-res images (1920x1080 or larger) for best results</p>
                  </div>
                )}
              </div>
            </section>

            {/* Accent Color */}
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Palette size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Accent Color</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {['#fbbf24', '#818cf8', '#f472b6', '#34d399', '#a78bfa', '#06b6d4', '#f97316', '#ef4444'].map((color) => (
                  <button key={color} onClick={() => { updateProfile({ accentColor: color }); showSaved(); }}
                    className="w-10 h-10 rounded-xl transition-all hover:scale-110"
                    style={{ backgroundColor: color, border: `2px solid ${profile.accentColor === color ? T.textColor : 'transparent'}` }} />
                ))}
              </div>
            </section>

            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Monitor size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Density</h2>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setCompactMode(true); saveInterface("compact", true); }}
                  className="flex-1 px-3 py-2.5 rounded-xl text-[11px] font-medium transition-all"
                  style={{ backgroundColor: compactMode ? T.accentColor + "12" : T.bgColor, border: `1px solid ${compactMode ? T.accentColor + "30" : T.borderColor + "15"}`, color: compactMode ? T.accentColor : T.textMuted }}>
                  Compact
                </button>
                <button onClick={() => { setCompactMode(false); saveInterface("compact", false); }}
                  className="flex-1 px-3 py-2.5 rounded-xl text-[11px] font-medium transition-all"
                  style={{ backgroundColor: !compactMode ? T.accentColor + "12" : T.bgColor, border: `1px solid ${!compactMode ? T.accentColor + "30" : T.borderColor + "15"}`, color: !compactMode ? T.accentColor : T.textMuted }}>
                  Comfortable
                </button>
              </div>
            </section>

            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Eye size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Accessibility</h2>
              </div>
              <div className="space-y-3">
                {[
                  { label: "Reduced Motion", desc: "Disable animations", state: reducedMotion, key: "reduced-motion" },
                  { label: "Sound Effects", desc: "UI audio cues", state: soundEffects, key: "sound" },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between p-3 rounded-xl" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}10` }}>
                    <div>
                      <div className="text-[12px] font-semibold" style={{ color: T.textColor }}>{item.label}</div>
                      <div className="text-[10px] opacity-50" style={{ color: T.textMuted }}>{item.desc}</div>
                    </div>
                    <button onClick={() => {
                      const next = !item.state;
                      if (item.key === "reduced-motion") setReducedMotion(next);
                      else setSoundEffects(next);
                      saveInterface(item.key, next);
                    }} className="relative w-10 h-5 rounded-full transition-all"
                      style={{ backgroundColor: item.state ? T.accentColor : T.borderColor + "40" }}>
                      <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all"
                        style={{ transform: item.state ? "translateX(18px)" : "translateX(0)" }} />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Code size={14} style={{ color: T.accentColor }} />
                  <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Custom CSS</h2>
                </div>
                <button onClick={() => { setCustomCSS(""); saveInterface("custom-css", ""); }}
                  className="text-[10px] px-2 py-1 rounded-lg font-medium"
                  style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}20`, color: T.textMuted }}>Clear</button>
              </div>
              <textarea value={customCSS} onChange={(e) => setCustomCSS(e.target.value)} onBlur={(e) => saveInterface("custom-css", e.target.value)}
                rows={5} placeholder={":root { --border: #333; }"}
                className="w-full p-3 rounded-xl text-[10px] font-mono outline-none resize-none"
                style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}20`, color: T.textColor }} />
            </section>
          </div>
        )}

        {/* Advanced Tab */}
        {activeTab === "advanced" && (
          <div className="space-y-4 animate-fadeInUp max-w-xl">
            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Code size={14} style={{ color: T.accentColor }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Environment</h2>
              </div>
              <div className="space-y-2 text-[10px] font-mono">
                {[
                  { key: "Clerk Auth", status: "Configured" },
                  { key: "Gemini AI", status: "Active" },
                  { key: "OpenRouter", status: "Active" },
                ].map((env) => (
                  <div key={env.key} className="flex justify-between p-2.5 rounded-xl" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}10` }}>
                    <span style={{ color: T.textMuted }}>{env.key}</span>
                    <span style={{ color: "#34d399" }}>{env.status}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] opacity-40 mt-3" style={{ color: T.textMuted }}>Update in Vercel Dashboard → Settings → Environment Variables</p>
            </section>

            <section className="rounded-2xl p-6 relative" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, boxShadow: `0 4px 24px ${T.bgColor}30` }}>
              <div className="absolute top-0 left-6 right-6 h-px opacity-25" style={{ background: `linear-gradient(90deg, transparent, ${T.accentColor}, transparent)` }} />
              <div className="flex items-center gap-2 mb-4">
                <Trash2 size={14} style={{ color: "#ef4444" }} />
                <h2 className="text-sm font-bold" style={{ color: T.textColor }}>Data</h2>
              </div>
              <p className="text-[11px] opacity-60 mb-3">This will erase all local config and reset everything.</p>
              <button onClick={() => { localStorage.clear(); window.location.reload(); }}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[11px] font-semibold transition-all hover:scale-[1.02]"
                style={{ backgroundColor: "#ef444415", border: `1px solid #ef444430`, color: "#ef4444" }}>
                <Trash2 size={12} /> Clear all data
              </button>
            </section>
          </div>
        )}

        {/* Saved toast */}
        {saved && (
          <div className="fixed bottom-6 right-6 px-5 py-3 rounded-2xl text-[12px] font-bold z-50 flex items-center gap-2 shadow-2xl animate-slideInBottom"
            style={{ backgroundColor: T.boxBg + 'dd', border: `1px solid ${T.accentColor}30`, color: T.accentColor, backdropFilter: 'blur(12px)', boxShadow: `0 8px 32px ${T.accentColor}15` }}>
            <Check size={16} /> Saved successfully
          </div>
        )}
      </div>
    </PageShell>
  );
}
