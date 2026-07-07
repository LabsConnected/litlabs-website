"use client";
export const dynamic = "force-dynamic";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useWallet } from "@/context/WalletContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import Image from "next/image";
import PageShell from "@/components/PageShell";
import {
  Palette,
  Terminal,
  Store,
  Image as ImageIcon,
  Users,
  Gamepad2,
  Settings,
  Bot,
  TrendingUp,
  Sparkles,
  Music,
  ExternalLink,
  ArrowRight,
  Coins,
  Crown,
  Zap,
  Activity,
  Link as LinkIcon,
  Share2,
} from "lucide-react";

const PLATFORM_LINKS = [
  { href: "/studio", icon: Palette, label: "Studio", desc: "Generate images, music, video", color: "#a78bfa" },
  { href: "/studio?tool=chat", icon: Terminal, label: "LiT Console", desc: "Chat, terminal, agents", color: "#22d3ee" },
  { href: "/marketplace", icon: Store, label: "Marketplace", desc: "Browse & install agents", color: "#f472b6" },
  { href: "/gallery", icon: ImageIcon, label: "Gallery", desc: "Community showcase", color: "#fb923c" },
  { href: "/social", icon: Users, label: "Social", desc: "Posts & community", color: "#34d399" },
  { href: "/games/cloud", icon: Gamepad2, label: "Games", desc: "Cloud gaming hub", color: "#fbbf24" },
  { href: "/dashboard", icon: TrendingUp, label: "Dashboard", desc: "Analytics & stats", color: "#60a5fa" },
  { href: "/settings", icon: Settings, label: "Settings", desc: "Profile & preferences", color: "#9ca3af" },
];

const SOCIAL_LABELS: Record<string, string> = {
  github: "GitHub",
  twitter: "Twitter / X",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

type InstalledAgent = {
  id: string;
  agent_id: string;
  is_active: boolean;
  agents?: {
    id: string;
    name: string;
    slug: string;
    category: string;
    avatar_url: string | null;
    description: string | null;
  };
};

export default function ProfilePage() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user } = useUser();
  const router = useRouter();
  const { resolvedColors: T } = useTheme();
  const { profile, updateProfile } = useProfile();
  const { balance } = useWallet();

  const [plan, setPlan] = useState<string>("free");
  const [installedAgents, setInstalledAgents] = useState<InstalledAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/profile");
    }
  }, [isLoaded, isSignedIn, router]);

  // Fetch plan
  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    fetch(`/api/users/${user.id}/plan`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.plan) setPlan(data.plan);
      })
      .catch(() => {});
  }, [isSignedIn, user?.id]);

  // Fetch installed agents
  useEffect(() => {
    if (!isSignedIn) return;
    setAgentsLoading(true);
    fetch("/api/user-agents")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setInstalledAgents(data);
        else if (data?.agents && Array.isArray(data.agents)) setInstalledAgents(data.agents);
      })
      .catch(() => {})
      .finally(() => setAgentsLoading(false));
  }, [isSignedIn]);

  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [newInterest, setNewInterest] = useState("");
  const [saving, setSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const saveProfile = useCallback(
    async (updates: Record<string, unknown>) => {
      setSaving(true);
      try {
        const res = await fetch("/api/settings/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to save profile");
        if (typeof data.user === "object" && data.user) {
          updateProfile({
            displayName: String((data.user as Record<string, unknown>).name || profile.displayName),
            username: String((data.user as Record<string, unknown>).username || profile.username),
            avatarUrl:
              (data.user as Record<string, unknown>).avatar_url === undefined
                ? profile.avatarUrl
                : String((data.user as Record<string, unknown>).avatar_url || ""),
            bio: String((data.user as Record<string, unknown>).bio || profile.bio),
            website: String((data.user as Record<string, unknown>).website || profile.website),
            location: String((data.user as Record<string, unknown>).location || profile.location),
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [profile, updateProfile],
  );

  const uploadAndSave = useCallback(
    async (file: File, field: "avatar_url" | "cover_url") => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
      if (field === "avatar_url") updateProfile({ avatarUrl: data.url });
      if (field === "cover_url") updateProfile({ coverUrl: data.url });
      await saveProfile({ [field]: data.url });
    },
    [saveProfile, updateProfile],
  );

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCoverFile(file);
      setCoverPreview(URL.createObjectURL(file));
    }
  };

  const confirmAvatarUpload = async () => {
    if (!avatarFile) return;
    await uploadAndSave(avatarFile, "avatar_url").catch(() => {
      updateProfile({ avatarUrl: URL.createObjectURL(avatarFile) });
    });
    setAvatarFile(null);
    setAvatarPreview(null);
  };

  const confirmCoverUpload = async () => {
    if (!coverFile) return;
    await uploadAndSave(coverFile, "cover_url").catch(() => {
      updateProfile({ coverUrl: URL.createObjectURL(coverFile) });
    });
    setCoverFile(null);
    setCoverPreview(null);
  };

  const cancelAvatarUpload = () => {
    setAvatarFile(null);
    setAvatarPreview(null);
  };

  const cancelCoverUpload = () => {
    setCoverFile(null);
    setCoverPreview(null);
  };

  const addInterest = () => {
    if (newInterest.trim() && profile.interests.length < 10) {
      updateProfile({ interests: [...profile.interests, newInterest.trim()] });
      setNewInterest("");
    }
  };

  const removeInterest = (index: number) => {
    const newInterests = [...profile.interests];
    newInterests.splice(index, 1);
    updateProfile({ interests: newInterests });
  };

  const moods = [
    "😀 Happy",
    "😎 Cool",
    "💡 Creative",
    "🔥 Hot",
    "🎯 Focused",
    "🌟 Stellar",
    "💪 Strong",
    "🎵 Chill",
    "🚀 Launching",
    "😴 Tired",
    "🤔 Thinking",
    "💭 Dreaming",
  ];

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center font-mono"
        style={{
          backgroundColor: T?.bgColor || "#0a0a0f",
          color: T?.textColor || "#00ff41",
        }}
      >
        <div className="text-center">
          <div className="text-3xl mb-4">⏳</div>
          <div>Loading profile...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell title="Sign In">
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
          <p className="text-sm opacity-60">
            Please sign in to view your profile.
          </p>
          <Link
            href="/sign-in?redirect_url=/profile"
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={{ backgroundColor: "#6366f1", color: "#fff" }}
          >
            Sign In
          </Link>
        </div>
      </PageShell>
    );
  }

  const planLabel = plan === "elite" ? "Elite" : plan === "creator" ? "Creator" : "Free";
  const planColor = plan === "elite" ? "#fbbf24" : plan === "creator" ? "#a78bfa" : "#6b7280";
  const activeSocialLinks = Object.entries(profile.socialLinks || {}).filter(([, v]) => v);
  const activeMusicLinks = Object.entries(profile.musicLinks || {}).filter(([, v]) => v);

  return (
    <PageShell title="Profile" className="text-xs relative">
      {/* Cover Image */}
      <div className="relative overflow-hidden group" style={{ height: 200 }}>
        {coverPreview || profile.coverUrl ? (
          <Image src={coverPreview || profile.coverUrl!} alt="Cover" fill className="object-cover" unoptimized sizes="100vw" />
        ) : (
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#0d0d1a 0%,#1a0d2e 30%,#0d1a2e 60%,#0a1a0d 100%)" }}>
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 30% 50%,#6366f115 0%,transparent 60%),radial-gradient(ellipse at 70% 50%,#22d3ee10 0%,transparent 60%)" }} />
          </div>
        )}
        <input type="file" ref={coverInputRef} onChange={handleCoverSelect} accept="image/*" className="hidden" />
        {!coverPreview ? (
          <button onClick={() => coverInputRef.current?.click()}
            className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg text-xs font-black opacity-0 group-hover:opacity-100 transition-all"
            style={{ background: "rgba(0,0,0,0.7)", border: "1px solid #22d3ee40", color: "#22d3ee" }}>
            📷 Change Cover
          </button>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center gap-3" style={{ backgroundColor: "rgba(0,0,0,0.75)" }}>
            <button onClick={confirmCoverUpload} disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-black disabled:opacity-50"
              style={{ background: "#22d3ee", color: "#000" }}>
              {saving ? "Uploading…" : "Upload Cover"}
            </button>
            <button onClick={cancelCoverUpload}
              className="px-4 py-2 rounded-xl text-xs font-black"
              style={{ background: "#1e1e2e", color: "#6b7280" }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Stats Bar */}
      <div className="w-full px-4 py-3 flex flex-wrap items-center gap-3" style={{ background: "#0d0d14", borderBottom: "1px solid #1e1e2e" }}>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
          <Coins size={16} style={{ color: "#fbbf24" }} />
          <div>
            <div className="text-sm font-black" style={{ color: "#fbbf24" }}>{balance.toLocaleString()}</div>
            <div className="text-[8px] uppercase tracking-wider" style={{ color: "#6b7280" }}>LBC Balance</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
          <Crown size={16} style={{ color: planColor }} />
          <div>
            <div className="text-sm font-black" style={{ color: planColor }}>{planLabel}</div>
            <div className="text-[8px] uppercase tracking-wider" style={{ color: "#6b7280" }}>Plan</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
          <Bot size={16} style={{ color: "#22d3ee" }} />
          <div>
            <div className="text-sm font-black" style={{ color: "#22d3ee" }}>{installedAgents.length}</div>
            <div className="text-[8px] uppercase tracking-wider" style={{ color: "#6b7280" }}>Agents</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
          <Activity size={16} style={{ color: "#4ade80" }} />
          <div>
            <div className="text-sm font-black" style={{ color: "#4ade80" }}>{profile.mood}</div>
            <div className="text-[8px] uppercase tracking-wider" style={{ color: "#6b7280" }}>Mood</div>
          </div>
        </div>
        <Link href="/wallet" className="ml-auto px-3 py-2 rounded-xl text-[10px] font-black transition-all hover:scale-[1.02] flex items-center gap-1"
          style={{ background: "linear-gradient(135deg,#fbbf2415,#fbbf2405)", border: "1px solid #fbbf2430", color: "#fbbf24" }}>
          <Zap size={12} /> Claim Daily Bonus
        </Link>
        <Link href="/marketplace" className="px-3 py-2 rounded-xl text-[10px] font-black transition-all hover:scale-[1.02] flex items-center gap-1"
          style={{ background: "linear-gradient(135deg,#6366f115,#6366f105)", border: "1px solid #6366f130", color: "#a78bfa" }}>
          <Crown size={12} /> Upgrade Plan
        </Link>
        <Link href="/settings" className="px-3 py-2 rounded-xl text-[10px] font-black transition-all hover:scale-[1.02] flex items-center gap-1"
          style={{ background: "#1e1e2e", border: "1px solid #2a2a3e", color: "#9ca3af" }}>
          <Settings size={12} /> Settings
        </Link>
      </div>

      {/* Main Grid */}
      <div className="w-full px-4 py-6 grid md:grid-cols-12 gap-4">
        {/* LEFT COLUMN */}
        <div className="md:col-span-4 space-y-4">
          {/* Avatar card */}
          <div className="rounded-2xl p-4 text-center" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
            <input type="file" ref={avatarInputRef} onChange={handleAvatarSelect} accept="image/*" className="hidden" />
            <div className="w-28 h-28 mx-auto mb-4 relative group overflow-hidden rounded-full" style={{ border: "2px solid #22d3ee30" }}>
              {(avatarPreview || profile.avatarUrl || user?.imageUrl) ? (
                <Image src={avatarPreview || profile.avatarUrl! || user!.imageUrl} alt="Avatar" fill className="object-cover" unoptimized sizes="112px" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center font-black text-2xl" style={{ background: "linear-gradient(135deg,#1a1a2e,#0d1a2e)", color: "#22d3ee" }}>
                  {(profile.displayName || "C").slice(0, 2).toUpperCase()}
                </div>
              )}
              {!avatarPreview ? (
                <button onClick={() => avatarInputRef.current?.click()}
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: "rgba(0,0,0,0.75)" }}>
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#22d3ee" }}>Change</span>
                </button>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5" style={{ backgroundColor: "rgba(0,0,0,0.8)" }}>
                  <button onClick={confirmAvatarUpload} disabled={saving}
                    className="px-3 py-1 rounded-lg text-[10px] font-black disabled:opacity-50"
                    style={{ background: "#22d3ee", color: "#000" }}>
                    {saving ? "…" : "Upload"}
                  </button>
                  <button onClick={cancelAvatarUpload}
                    className="px-3 py-1 rounded-lg text-[10px] font-black"
                    style={{ background: "#1e1e2e", color: "#6b7280" }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {editingSection === "name" ? (
              <div className="space-y-2 max-w-[190px] mx-auto">
                <input type="text" value={profile.displayName} onChange={e => updateProfile({ displayName: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-xl text-xs text-center font-black outline-none"
                  style={{ background: "#08080c", border: "1px solid #22d3ee40", color: "#f0f0f6" }} />
                <div className="flex gap-2">
                  <button onClick={() => { saveProfile({ displayName: profile.displayName }); setEditingSection(null); }}
                    disabled={saving} className="flex-1 py-1.5 rounded-xl text-[10px] font-black disabled:opacity-50"
                    style={{ background: "#22d3ee", color: "#000" }}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => setEditingSection(null)}
                    className="px-3 py-1.5 rounded-xl text-[10px] font-black"
                    style={{ background: "#1e1e2e", color: "#6b7280" }}>✕</button>
                </div>
              </div>
            ) : (
              <h2 className="text-base font-black uppercase tracking-widest mb-0.5 cursor-pointer flex items-center justify-center gap-1.5"
                style={{ color: "#f0f0f6" }} onClick={() => setEditingSection("name")}>
                {profile.displayName}
                <span className="text-[10px] opacity-40">✏️</span>
              </h2>
            )}
            <p className="text-[10px] mb-3" style={{ color: "#6b7280" }}>@{profile.username}</p>

            {/* Mood */}
            <div className="pt-3 border-t" style={{ borderColor: "#1e1e2e" }}>
              {editingSection === "mood" ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1 justify-center max-h-24 overflow-y-auto">
                    {moods.map(mood => (
                      <button key={mood} onClick={() => { updateProfile({ mood }); setEditingSection(null); }}
                        className="px-2 py-0.5 rounded-lg text-[9px] font-bold transition-all"
                        style={{ background: profile.mood === mood ? "#22d3ee20" : "#1e1e2e", border: `1px solid ${profile.mood === mood ? "#22d3ee50" : "#2a2a3e"}`, color: profile.mood === mood ? "#22d3ee" : "#6b7280" }}>
                        {mood}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { saveProfile({ mood: profile.mood }); setEditingSection(null); }}
                      disabled={saving} className="flex-1 py-1.5 rounded-xl text-[10px] font-black disabled:opacity-50"
                      style={{ background: "#22d3ee", color: "#000" }}>
                      {saving ? "Saving…" : "Save Mood"}
                    </button>
                    <button onClick={() => setEditingSection(null)}
                      className="px-3 py-1.5 rounded-xl text-[10px] font-black"
                      style={{ background: "#1e1e2e", color: "#6b7280" }}>✕</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setEditingSection("mood")}
                  className="px-3 py-1.5 rounded-xl text-xs font-black transition-all hover:scale-[1.02]"
                  style={{ background: "#22d3ee10", border: "1px solid #22d3ee30", color: "#22d3ee" }}>
                  {profile.mood} <span className="opacity-40 text-[9px]">✏️</span>
                </button>
              )}
            </div>
          </div>

          {/* Platform Quick Links */}
          <div className="rounded-2xl p-4" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
            <div className="text-[10px] font-black uppercase tracking-[0.15em] mb-3" style={{ color: "#6b7280" }}>Quick Links</div>
            <div className="grid grid-cols-2 gap-2">
              {PLATFORM_LINKS.map(link => {
                const Icon = link.icon;
                return (
                  <Link key={link.href} href={link.href}
                    className="p-2.5 rounded-xl transition-all hover:scale-[1.02] group"
                    style={{ background: "#08080c", border: "1px solid #1e1e2e" }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <Icon size={14} style={{ color: link.color }} />
                      <span className="text-[10px] font-black" style={{ color: "#f0f0f6" }}>{link.label}</span>
                    </div>
                    <p className="text-[8px] leading-tight" style={{ color: "#6b7280" }}>{link.desc}</p>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Social Links */}
          <div className="rounded-2xl p-4" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: "#6b7280" }}>Social Links</span>
              <button onClick={() => setEditingSection(editingSection === "social" ? null : "social")}
                className="px-2 py-0.5 rounded-lg text-[9px] font-black"
                style={{ background: "#22d3ee10", border: "1px solid #22d3ee30", color: "#22d3ee" }}>✏️ Edit</button>
            </div>
            {editingSection === "social" ? (
              <div className="space-y-2">
                {Object.entries(SOCIAL_LABELS).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2">
                      <LinkIcon size={14} style={{ color: "#6b7280" }} />
                      <input type="url" placeholder={`${label} URL`} value={(profile.socialLinks as Record<string, string>)?.[key] || ""}
                        onChange={e => updateProfile({ socialLinks: { ...profile.socialLinks, [key]: e.target.value } })}
                        className="flex-1 px-2 py-1.5 rounded-lg text-[10px] outline-none"
                        style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#f0f0f6" }} />
                    </div>
                  ))}
                <div className="flex gap-2">
                  <button onClick={() => { saveProfile({ socialLinks: profile.socialLinks }); setEditingSection(null); }}
                    disabled={saving} className="flex-1 py-2 rounded-xl text-[10px] font-black disabled:opacity-50"
                    style={{ background: "#22d3ee", color: "#000" }}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => setEditingSection(null)}
                    className="px-4 py-2 rounded-xl text-[10px] font-black"
                    style={{ background: "#1e1e2e", color: "#6b7280" }}>✕</button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {activeSocialLinks.length > 0 ? activeSocialLinks.map(([key, url]) => {
                  const label = SOCIAL_LABELS[key] || key;
                  return (
                    <a key={key} href={url as string} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold transition-all hover:scale-[1.01]"
                      style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#9ca3af" }}>
                      <Share2 size={14} style={{ color: "#22d3ee" }} />
                      {label}
                      <ExternalLink size={10} className="ml-auto opacity-40" />
                    </a>
                  );
                }) : (
                  <button onClick={() => setEditingSection("social")}
                    className="w-full py-3 rounded-xl text-[10px] font-black border-dashed"
                    style={{ border: "1px dashed #1e1e2e", color: "#22d3ee" }}>
                    + Add Social Links
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="rounded-2xl p-4" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
            <div className="text-[10px] font-black uppercase tracking-[0.15em] mb-3" style={{ color: "#6b7280" }}>🏆 Badges</div>
            <div className="flex flex-wrap gap-1.5">
              {(profile.badges || []).map((badge, i) => (
                <span key={i} className="px-2 py-0.5 rounded-lg text-[9px] font-black"
                  style={{ background: "#a78bfa15", border: "1px solid #a78bfa30", color: "#a78bfa" }}>
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="md:col-span-8 space-y-4">
          {/* About */}
          <div className="rounded-2xl p-4" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: "#6b7280" }}>About</span>
              <button onClick={() => setEditingSection(editingSection === "bio" ? null : "bio")}
                className="px-2 py-0.5 rounded-lg text-[9px] font-black"
                style={{ background: "#22d3ee10", border: "1px solid #22d3ee30", color: "#22d3ee" }}>✏️ Edit</button>
            </div>
            {editingSection === "bio" ? (
              <div className="space-y-3">
                <textarea value={profile.bio} onChange={e => updateProfile({ bio: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl text-xs outline-none resize-none min-h-[90px]"
                  style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#f0f0f6" }} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-black uppercase mb-1" style={{ color: "#6b7280" }}>Location</label>
                    <input type="text" value={profile.location} onChange={e => updateProfile({ location: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-lg text-xs outline-none"
                      style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#f0f0f6" }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase mb-1" style={{ color: "#6b7280" }}>Website</label>
                    <input type="url" value={profile.website} onChange={e => updateProfile({ website: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-lg text-xs outline-none"
                      style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#f0f0f6" }} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { saveProfile({ bio: profile.bio, location: profile.location, website: profile.website }); setEditingSection(null); }}
                    disabled={saving} className="flex-1 py-2 rounded-xl text-xs font-black disabled:opacity-50"
                    style={{ background: "#22d3ee", color: "#000" }}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => setEditingSection(null)}
                    className="px-4 py-2 rounded-xl text-xs font-black"
                    style={{ background: "#1e1e2e", color: "#6b7280" }}>✕</button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-[11px] leading-relaxed mb-3" style={{ color: "#9ca3af" }}>{profile.bio}</p>
                <div className="flex flex-wrap gap-3 text-[10px] pt-3 border-t" style={{ borderColor: "#1e1e2e" }}>
                  <span style={{ color: "#22d3ee" }}>📍 {profile.location}</span>
                  <a href={profile.website} target="_blank" rel="noopener noreferrer"
                    className="hover:underline flex items-center gap-1" style={{ color: "#22d3ee" }}>
                    🌐 {profile.website || "No website"} <ExternalLink size={9} />
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Interests */}
          <div className="rounded-2xl p-4" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: "#6b7280" }}>Interests</span>
              <button onClick={() => setEditingSection(editingSection === "interests" ? null : "interests")}
                className="px-2 py-0.5 rounded-lg text-[9px] font-black"
                style={{ background: "#22d3ee10", border: "1px solid #22d3ee30", color: "#22d3ee" }}>✏️ Edit</button>
            </div>
            {editingSection === "interests" ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input type="text" value={newInterest} onChange={e => setNewInterest(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addInterest()}
                    placeholder="Add interest…"
                    className="flex-1 px-3 py-1.5 rounded-xl text-xs outline-none"
                    style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#f0f0f6" }} />
                  <button onClick={addInterest}
                    className="px-3 py-1.5 rounded-xl text-xs font-black"
                    style={{ background: "#22d3ee", color: "#000" }}>Add</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(profile.interests || []).map((interest, i) => (
                    <span key={i} className="px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1"
                      style={{ background: "#1e1e2e", color: "#9ca3af", border: "1px solid #2a2a3e" }}>
                      {interest}
                      <button onClick={() => removeInterest(i)} className="text-red-400 font-black hover:text-red-300 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { saveProfile({ interests: profile.interests }); setEditingSection(null); }}
                    disabled={saving} className="flex-1 py-2 rounded-xl text-xs font-black disabled:opacity-50"
                    style={{ background: "#22d3ee", color: "#000" }}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => setEditingSection(null)}
                    className="px-4 py-2 rounded-xl text-xs font-black"
                    style={{ background: "#1e1e2e", color: "#6b7280" }}>✕</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(profile.interests || []).map((interest, i) => (
                  <span key={i} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide"
                    style={{ background: "#22d3ee10", border: "1px solid #22d3ee25", color: "#22d3ee" }}>
                    {interest}
                  </span>
                ))}
                {(profile.interests || []).length === 0 && (
                  <p className="text-[10px] italic" style={{ color: "#6b7280" }}>No interests yet.</p>
                )}
              </div>
            )}
          </div>

          {/* Installed Agents */}
          <div className="rounded-2xl p-4" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: "#6b7280" }}>Installed Agents</span>
              <Link href="/marketplace" className="px-2 py-0.5 rounded-lg text-[9px] font-black flex items-center gap-1"
                style={{ background: "#f472b615", border: "1px solid #f472b630", color: "#f472b6" }}>
                <Store size={10} /> Get More
              </Link>
            </div>
            {agentsLoading ? (
              <div className="py-6 text-center text-[10px]" style={{ color: "#6b7280" }}>Loading agents…</div>
            ) : installedAgents.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {installedAgents.map((ua) => (
                  <Link key={ua.id} href="/agents"
                    className="flex items-center gap-3 p-2.5 rounded-xl transition-all hover:scale-[1.01]"
                    style={{ background: "#08080c", border: "1px solid #1e1e2e" }}>
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{ background: "#22d3ee15" }}>
                      <Bot size={18} style={{ color: "#22d3ee" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-black truncate" style={{ color: "#f0f0f6" }}>
                        {ua.agents?.name || "Agent"}
                      </div>
                      <div className="text-[9px] truncate" style={{ color: "#6b7280" }}>
                        {ua.agents?.category || "agent"} • {ua.is_active ? "Active" : "Inactive"}
                      </div>
                    </div>
                    <ArrowRight size={12} style={{ color: "#6b7280" }} />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center">
                <Bot size={32} className="mx-auto mb-2 opacity-20" style={{ color: "#6b7280" }} />
                <p className="text-[10px] mb-3" style={{ color: "#6b7280" }}>No agents installed yet.</p>
                <Link href="/marketplace" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-black transition-all hover:scale-[1.02]"
                  style={{ background: "linear-gradient(135deg,#6366f1,#22d3ee)", color: "#fff" }}>
                  <Store size={12} /> Browse Marketplace
                </Link>
              </div>
            )}
          </div>

          {/* Music Links */}
          <div className="rounded-2xl p-4" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: "#6b7280" }}>🎵 Music Links</span>
              <button onClick={() => setEditingSection(editingSection === "music" ? null : "music")}
                className="px-2 py-0.5 rounded-lg text-[9px] font-black"
                style={{ background: "#22d3ee10", border: "1px solid #22d3ee30", color: "#22d3ee" }}>✏️ Edit</button>
            </div>
            {editingSection === "music" ? (
              <div className="space-y-1.5">
                <input type="url" placeholder="Spotify URL" value={profile.musicLinks.spotify || ""}
                  onChange={e => updateProfile({ musicLinks: { ...profile.musicLinks, spotify: e.target.value } })}
                  className="w-full px-3 py-2 rounded-xl text-[10px] outline-none"
                  style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#f0f0f6" }} />
                <input type="url" placeholder="YouTube URL" value={profile.musicLinks.youtube || ""}
                  onChange={e => updateProfile({ musicLinks: { ...profile.musicLinks, youtube: e.target.value } })}
                  className="w-full px-3 py-2 rounded-xl text-[10px] outline-none"
                  style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#f0f0f6" }} />
                <input type="url" placeholder="SoundCloud URL" value={profile.musicLinks.soundcloud || ""}
                  onChange={e => updateProfile({ musicLinks: { ...profile.musicLinks, soundcloud: e.target.value } })}
                  className="w-full px-3 py-2 rounded-xl text-[10px] outline-none"
                  style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#f0f0f6" }} />
                <div className="flex gap-2">
                  <button onClick={() => { saveProfile({ musicLinks: profile.musicLinks }); setEditingSection(null); }}
                    disabled={saving} className="flex-1 py-2 rounded-xl text-[10px] font-black disabled:opacity-50"
                    style={{ background: "#22d3ee", color: "#000" }}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => setEditingSection(null)}
                    className="px-4 py-2 rounded-xl text-[10px] font-black"
                    style={{ background: "#1e1e2e", color: "#6b7280" }}>✕</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {activeMusicLinks.length > 0 ? activeMusicLinks.map(([key, url]) => (
                  <a key={key} href={url as string} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold transition-all hover:scale-[1.01]"
                    style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#9ca3af" }}>
                    <Music size={14} style={{ color: "#22d3ee" }} />
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                    <ExternalLink size={10} className="ml-auto opacity-40" />
                  </a>
                )) : (
                  <button onClick={() => setEditingSection("music")}
                    className="w-full py-3 rounded-xl text-[10px] font-black border-dashed"
                    style={{ border: "1px dashed #1e1e2e", color: "#22d3ee" }}>
                    + Add Music Links
                  </button>
                )}
              </div>
            )}
          </div>

          {/* CTA: Ready to build */}
          <div className="rounded-2xl p-6 text-center" style={{ background: "linear-gradient(135deg,#0d0d1a,#1a0d2e)", border: "1px solid #1e1e2e" }}>
            <Sparkles size={24} className="mx-auto mb-2" style={{ color: "#a78bfa" }} />
            <h3 className="text-sm font-black mb-1" style={{ color: "#f0f0f6" }}>Ready to turn an idea into a live product?</h3>
            <p className="text-[10px] mb-4" style={{ color: "#6b7280" }}>Start in Studio, browse agents, or jump into the marketplace.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/studio" className="px-4 py-2 rounded-xl text-[10px] font-black transition-all hover:scale-[1.02] flex items-center gap-1.5"
                style={{ background: "linear-gradient(135deg,#a78bfa,#6366f1)", color: "#fff" }}>
                <Palette size={12} /> Launch Studio
              </Link>
              <Link href="/marketplace" className="px-4 py-2 rounded-xl text-[10px] font-black transition-all hover:scale-[1.02] flex items-center gap-1.5"
                style={{ background: "#1e1e2e", border: "1px solid #2a2a3e", color: "#f472b6" }}>
                <Store size={12} /> Browse Agents
              </Link>
              <Link href="/studio?tool=chat" className="px-4 py-2 rounded-xl text-[10px] font-black transition-all hover:scale-[1.02] flex items-center gap-1.5"
                style={{ background: "#1e1e2e", border: "1px solid #2a2a3e", color: "#22d3ee" }}>
                <Terminal size={12} /> Open Console
              </Link>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
