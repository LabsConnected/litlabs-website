"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";

/* ─── Types ─── */
type Section =
  | "overview"
  | "profile"
  | "account"
  | "integrations"
  | "appearance"
  | "notifications"
  | "billing"
  | "danger";

interface ToastState {
  message: string;
  type: "success" | "error" | "info";
  visible: boolean;
}

/* ─── Config ─── */
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "◈" },
  { id: "profile", label: "Profile", icon: "👤" },
  { id: "account", label: "Account", icon: "🔐" },
  { id: "integrations", label: "API & Integrations", icon: "🔗" },
  { id: "appearance", label: "Appearance", icon: "🎨" },
  { id: "notifications", label: "Notifications", icon: "🔔" },
  { id: "billing", label: "Billing", icon: "💳" },
  { id: "danger", label: "Danger Zone", icon: "⚠" },
];

const AVATAR_EMOJIS = ["🤖", "👾", "🦾", "🧠", "⚡", "🔥", "💎", "🚀", "🌟", "🎯", "🛡", "🎮"];

const ACCENT_COLORS = [
  { id: "cyan", label: "Cyan", var: "var(--neon-cyan)", hex: "#00f2fe" },
  { id: "purple", label: "Purple", var: "var(--neon-purple)", hex: "#9b51e0" },
  { id: "gold", label: "Gold", var: "var(--neon-gold)", hex: "#ffd700" },
  { id: "green", label: "Green", var: "#00ff88", hex: "#00ff88" },
  { id: "red", label: "Red", var: "#ff5050", hex: "#ff5050" },
];

const INTEGRATIONS = [
  { id: "discord", name: "Discord", icon: "💬", connected: false },
  { id: "telegram", name: "Telegram", icon: "✈️", connected: false },
  { id: "email", name: "Email", icon: "📧", connected: false },
  { id: "twitter", label: "X / Twitter", icon: "🐦", connected: false },
];

/* ─── Helpers ─── */
function formatDate(dateStr?: string): string {
  if (!dateStr) return "Unknown";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "Unknown";
  }
}

/* ─── Toggle Component ─── */
function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="relative w-12 h-7 rounded-full transition-all duration-300 shrink-0"
      style={{
        backgroundColor: enabled ? "rgba(0,242,254,0.25)" : "rgba(100,110,130,0.3)",
        boxShadow: enabled ? "0 0 12px rgba(0,242,254,0.3)" : "none",
      }}
      role="switch"
      aria-checked={enabled}
    >
      <span
        className="absolute top-[3px] w-5 h-5 rounded-full transition-all duration-300"
        style={{
          left: enabled ? "26px" : "3px",
          backgroundColor: enabled ? "var(--neon-cyan)" : "rgba(148,163,184,0.6)",
          boxShadow: enabled ? "0 0 10px var(--neon-cyan)" : "none",
        }}
      />
    </button>
  );
}

/* ─── Main Component ─── */
export default function SettingsPage() {
  const { user, logout } = useAuth();

  /* ── Hash-based section navigation ── */
  const [activeSection, setActiveSection] = useState<Section>(() => {
    if (typeof window === "undefined") return "overview";
    const hash = window.location.hash.replace("#", "") as Section;
    return SECTIONS.some((s) => s.id === hash) ? (hash as Section) : "overview";
  });

  const navigateTo = useCallback((section: Section) => {
    setActiveSection(section);
    window.location.hash = section;
  }, []);

  /* ── Toast state ── */
  const [toast, setToast] = useState<ToastState>({ message: "", type: "success", visible: false });

  const showToast = useCallback((message: string, type: ToastState["type"] = "success") => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  }, []);

  /* ── Profile state ── */
  const [displayName, setDisplayName] = useState(user?.name || "");
  const [prevUserName, setPrevUserName] = useState(user?.name);
  const [avatarEmoji, setAvatarEmoji] = useState("🤖");
  const [bio, setBio] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  // Sync display name if user name changes (React 19 pattern to avoid useEffect)
  if (user?.name !== prevUserName) {
    setPrevUserName(user?.name);
    setDisplayName(user?.name || "");
  }

  async function handleSaveProfile() {
    setProfileSaving(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: displayName, avatarEmoji, bio }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save profile");
      }
      showToast("Profile updated successfully!");
    } catch (err) {
      const msg = (err as Error)?.message || "Unknown";
      showToast(msg, "error");
    } finally {
      setProfileSaving(false);
    }
  }

  /* ── Account / Password state ── */
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      showToast("Passwords do not match", "error");
      return;
    }
    if (newPassword.length < 8) {
      showToast("Password must be at least 8 characters", "error");
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to change password");
      }
      showToast("Password changed successfully!");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const msg = (err as Error)?.message || "Unknown";
      showToast(msg, "error");
    } finally {
      setPasswordSaving(false);
    }
  }

  /* ── Integrations state ── */
  const [n8nWebhookUrl, setN8nWebhookUrl] = useState("");

  /* ── Appearance state ── */
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [accentColor, setAccentColor] = useState("cyan");
  const [fontSize, setFontSize] = useState<"sm" | "md" | "lg">("md");
  const [appearanceSaving, setAppearanceSaving] = useState(false);

  async function handleSaveAppearance() {
    setAppearanceSaving(true);
    try {
      const res = await fetch("/api/settings/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, accentColor, fontSize }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save preferences");
      }
      showToast("Appearance preferences saved!");
    } catch (err) {
      const msg = (err as Error)?.message || "Unknown";
      showToast(msg, "error");
    } finally {
      setAppearanceSaving(false);
    }
  }

  /* ── Notifications state ── */
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifPush, setNotifPush] = useState(true);
  const [notifAgent, setNotifAgent] = useState(true);
  const [notifArena, setNotifArena] = useState(true);
  const [notifSocial, setNotifSocial] = useState(false);
  const [notifDigest, setNotifDigest] = useState(true);
  const [notifSaving, setNotifSaving] = useState(false);

  async function handleSaveNotifications() {
    setNotifSaving(true);
    try {
      const res = await fetch("/api/settings/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notifications: {
            email: notifEmail,
            push: notifPush,
            agentResponses: notifAgent,
            arenaResults: notifArena,
            socialMentions: notifSocial,
            weeklyDigest: notifDigest,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save notifications");
      }
      showToast("Notification preferences saved!");
    } catch (err) {
      const msg = (err as Error)?.message || "Unknown";
      showToast(msg, "error");
    } finally {
      setNotifSaving(false);
    }
  }

  /* ── Danger zone state ── */
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE") {
      showToast('Type "DELETE" to confirm account deletion', "error");
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Account deletion not available yet");
      }
      showToast("Account deleted. Redirecting...", "info");
      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
    } catch (err) {
      const msg = (err as Error)?.message || "Unknown";
      showToast(msg, "error");
    } finally {
      setDeleteLoading(false);
    }
  }

  /* ── Render ── */
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-20 selection:bg-neon-cyan/30">
      {/* Toast */}
      <div
        className={`fixed top-6 right-6 z-[100] transition-all duration-500 ${
          toast.visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"
        }`}
      >
        <div
          className={`glass-panel px-6 py-4 flex items-center gap-4 text-xs font-bold uppercase tracking-widest shadow-2xl ${
            toast.type === "success"
              ? "border-green-500/30 text-green-400"
              : toast.type === "error"
              ? "border-red-500/30 text-red-400"
              : "border-neon-cyan/30 text-neon-cyan"
          }`}
        >
          <span className="text-lg">
            {toast.type === "success" ? "✓" : toast.type === "error" ? "⚠" : "ℹ"}
          </span>
          {toast.message}
        </div>
      </div>

      {/* Header Area */}
      <div className="mb-12">
        <div className="text-[10px] font-bold text-neon-cyan tracking-[0.4em] uppercase mb-2">System_Configuration</div>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold uppercase tracking-tight">System <span className="gradient-text">Config</span></h1>
        <p className="text-text-secondary font-medium text-sm mt-1">Modify workspace parameters and node identity.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
        {/* ─── Sidebar Navigation ─── */}

        {/* Mobile: horizontal scrollable tab bar */}
        <nav className="lg:hidden -mx-6 px-6 overflow-x-auto scrollbar-hide mb-8">
          <div className="flex gap-2 pb-4 min-w-max">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => navigateTo(section.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                  activeSection === section.id
                    ? "bg-neon-cyan text-cyber-bg shadow-[0_0_15px_rgba(0,242,254,0.3)]"
                    : "bg-white/5 text-text-muted border border-white/5"
                }`}
              >
                <span>{section.icon}</span>
                {section.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Desktop: vertical sidebar */}
        <nav className="hidden lg:block w-72 shrink-0">
          <div className="card p-3 sticky top-24 border-white/5 bg-black/40">
            <div className="text-[10px] font-bold text-text-muted tracking-[0.2em] mb-4 px-3 uppercase">
              Config_Modules
            </div>
            {SECTIONS.map((section) => {
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => navigateTo(section.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm transition-all group ${
                    isActive
                      ? "bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 shadow-[0_0_20px_rgba(0,242,254,0.05)]"
                      : "text-text-secondary hover:bg-white/5 hover:text-text-primary border border-transparent"
                  }`}
                >
                  <span className={`text-xl transition-transform group-hover:scale-110 ${isActive ? "opacity-100" : "opacity-50"}`}>
                    {section.icon}
                  </span>
                  <span className="font-medium tracking-tight">{section.label}</span>
                  {isActive && (
                    <span className="ml-auto w-1 h-1 rounded-full bg-neon-cyan animate-pulse" />
                  )}
                  {!isActive && section.id === "danger" && (
                    <span className="ml-auto badge badge-red text-[8px] tracking-tighter">!</span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* ─── Content Area ─── */}
        <div className="flex-1 min-w-0">
          {/* ─── OVERVIEW ─── */}
          {activeSection === "overview" && (
            <div className="space-y-10">
              {/* User Card */}
              <div className="card bg-gradient-to-br from-neon-cyan/5 to-neon-purple/5 border-neon-cyan/10 p-8 sm:p-12 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-neon-cyan/5 blur-[100px]" />
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-8 relative z-10">
                  <div className="w-24 h-24 rounded-2xl bg-cyber-surface-2 border-2 border-neon-cyan/30 flex items-center justify-center text-4xl shadow-[0_0_30px_rgba(0,242,254,0.15)] transition-transform hover:scale-110 duration-500">
                    {avatarEmoji}
                  </div>
                  <div className="text-center sm:text-left">
                    <div className="text-[10px] font-bold text-neon-cyan tracking-[0.4em] uppercase mb-2">Authenticated_Identity</div>
                    <h2 className="font-heading text-3xl font-bold text-text-primary uppercase tracking-tight mb-1">
                      {displayName || user?.email?.split("@")[0] || "User"}
                    </h2>
                    <p className="text-text-secondary font-medium font-code text-sm opacity-60 mb-4">{user?.email}</p>
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                      <span className="badge badge-gold px-4 py-1.5 text-[10px] font-bold tracking-widest uppercase">NODE_v3.0_FREE</span>
                      <span className="text-text-muted text-[10px] font-bold tracking-widest uppercase opacity-40">
                        ESTABLISHED: {formatDate(user?.id ? "2025-01-15" : undefined)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-10">
                  <div className="bg-black/40 border border-white/5 rounded-2xl p-6 text-center group hover:border-neon-cyan/30 transition-colors">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-2">Daemons_Forged</div>
                    <div className="font-heading text-4xl font-bold text-neon-cyan text-glow-cyan">12</div>
                  </div>
                  <div className="bg-black/40 border border-white/5 rounded-2xl p-6 text-center group hover:border-neon-purple/30 transition-colors">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-2">Neural_Transmissions</div>
                    <div className="font-heading text-4xl font-bold text-neon-purple text-glow-purple">1,847</div>
                  </div>
                  <div className="bg-black/40 border border-white/5 rounded-2xl p-6 text-center group hover:border-neon-gold/30 transition-colors">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-2">Arena_Triumphs</div>
                    <div className="font-heading text-4xl font-bold text-neon-gold">3</div>
                  </div>
                </div>
              </div>

              {/* Quick Settings */}
              <div className="card p-8">
                <div className="flex items-center gap-3 mb-8">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-text-muted">Core_Parameters</h2>
                  <div className="h-px flex-1 bg-white/5" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-4 border-b border-white/5">
                    <div>
                      <div className="text-sm font-bold uppercase tracking-tight">Interface_Theme</div>
                      <div className="text-xs text-text-muted font-medium mt-0.5">Current optimization: CYBER_DARK</div>
                    </div>
                    <span className="badge badge-cyan px-4 py-1 text-[10px] font-bold tracking-widest uppercase shadow-[0_0_10px_rgba(0,242,254,0.2)]">DARK_v3.0</span>
                  </div>
                  <div className="flex items-center justify-between py-4 border-b border-white/5">
                    <div>
                      <div className="text-sm font-bold uppercase tracking-tight">Neural_Alerts</div>
                      <div className="text-xs text-text-muted font-medium mt-0.5">Receive identity updates via email</div>
                    </div>
                    <span className={`badge px-4 py-1 text-[10px] font-bold tracking-widest uppercase ${notifEmail ? "badge-green shadow-[0_0_10px_rgba(74,222,128,0.2)]" : "badge-red opacity-50"}`}>
                      {notifEmail ? "ENABLED" : "DISABLED"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-4">
                    <div>
                      <div className="text-sm font-bold uppercase tracking-tight">API_Synchronicity</div>
                      <div className="text-xs text-text-muted font-medium mt-0.5">Mainframe connection status</div>
                    </div>
                    <span className="badge badge-green px-4 py-1 text-[10px] font-bold tracking-widest uppercase shadow-[0_0_10px_rgba(74,222,128,0.2)]">● ONLINE</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── PROFILE ─── */}
          {activeSection === "profile" && (
            <div className="space-y-8">
              <div className="card p-8 sm:p-10 border-neon-cyan/5">
                <div className="flex items-center gap-3 mb-10">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-text-muted">Identity_Construction</h2>
                  <div className="h-px flex-1 bg-white/5" />
                </div>

                {/* Avatar Picker */}
                <div className="mb-10">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-4 px-1">Visual_Manifestation</label>
                  <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-3">
                    {AVATAR_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => setAvatarEmoji(emoji)}
                        className={`aspect-square flex items-center justify-center text-2xl rounded-xl transition-all ${
                          avatarEmoji === emoji
                            ? "bg-neon-cyan/20 border-2 border-neon-cyan scale-110 shadow-[0_0_15px_rgba(0,242,254,0.3)]"
                            : "bg-white/5 border border-white/5 hover:border-neon-cyan/30 hover:scale-105"
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Display Name */}
                <div className="mb-8">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-3 px-1">Node_Alias</label>
                  <input
                    className="input text-lg font-bold"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Enter visual alias..."
                  />
                </div>

                {/* Email (readonly) */}
                <div className="mb-8">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-3 px-1">Primary_Link</label>
                  <input
                    className="input opacity-40 font-code"
                    value={user?.email || ""}
                    disabled
                  />
                  <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest mt-3 opacity-40 px-1">Link encryption cannot be modified</p>
                </div>

                {/* Bio */}
                <div className="mb-10">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-3 px-1">Technical_Profile</label>
                  <textarea
                    className="input min-h-[140px] resize-none text-base leading-relaxed"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Define your builder directive..."
                    maxLength={200}
                  />
                  <div className="text-right text-[10px] font-bold text-text-muted uppercase tracking-widest mt-3 opacity-40">
                    Bytes: {bio.length}/200
                  </div>
                </div>

                <button
                  className="btn-primary w-full sm:w-auto px-10 py-4 uppercase tracking-widest text-xs font-bold"
                  onClick={handleSaveProfile}
                  disabled={profileSaving}
                >
                  {profileSaving ? "TRANSMITTING..." : "Update_Identity"}
                </button>
              </div>
            </div>
          )}

          {/* ─── ACCOUNT ─── */}
          {activeSection === "account" && (
            <div className="space-y-8">
              <div className="card p-8 sm:p-10">
                <div className="flex items-center gap-3 mb-10">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-text-muted">Security_Encryption</h2>
                  <div className="h-px flex-1 bg-white/5" />
                </div>

                <div className="space-y-8 max-w-md">
                  <div>
                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-3 px-1">Current_Key</label>
                    <input
                      type="password"
                      className="input"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      placeholder="••••••••••••"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-3 px-1">New_Encryption_Key</label>
                    <input
                      type="password"
                      className="input"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••••••"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-3 px-1">Confirm_New_Key</label>
                    <input
                      type="password"
                      className="input"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••••••"
                    />
                  </div>

                  <button
                    className="btn-primary w-full sm:w-auto px-10 py-4 uppercase tracking-widest text-xs font-bold"
                    onClick={handleChangePassword}
                    disabled={passwordSaving}
                  >
                    {passwordSaving ? "RE-ENCRYPTING..." : "Update_Security_Key"}
                  </button>
                </div>
              </div>

              <div className="card p-8">
                <div className="flex items-center gap-3 mb-8">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-text-muted">Node_Metadata</h2>
                  <div className="h-px flex-1 bg-white/5" />
                </div>
                <div className="space-y-0">
                  <div className="flex flex-col sm:flex-row sm:justify-between py-4 border-b border-white/5 gap-2">
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Global_ID</span>
                    <span className="font-code text-xs text-neon-cyan break-all">{user?.id || "N/A"}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between py-4 border-b border-white/5 gap-2">
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Auth_Endpoint</span>
                    <span className="text-sm font-bold uppercase tracking-tight break-all">{user?.email}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between py-4 gap-2">
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Initialization_Date</span>
                    <span className="text-sm font-bold text-text-primary uppercase tracking-tight">
                      {formatDate(user?.id ? "2025-01-15" : undefined)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── API & INTEGRATIONS ─── */}
          {activeSection === "integrations" && (
            <div className="space-y-8">
              {/* n8n Webhook */}
              <div className="card p-8 border-neon-purple/20">
                <div className="flex items-center gap-3 mb-6">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-neon-purple">n8n_Automation_Link</h2>
                  <div className="h-px flex-1 bg-white/5" />
                </div>
                <p className="text-text-secondary text-sm font-medium mb-6">
                  Configure your primary automation node endpoint for multi-agent workflows.
                </p>
                <div className="relative">
                  <input
                    className="input font-code text-xs mb-3 pr-24"
                    value={n8nWebhookUrl}
                    onChange={(e) => setN8nWebhookUrl(e.target.value)}
                    placeholder="https://n8n.your-domain.com/webhook/..."
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-neon-purple uppercase tracking-widest pointer-events-none">Link_Active</div>
                </div>
                <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest opacity-40">
                  Environment: N8N_WEBHOOK_URL // REQUIRED_FOR_AGENT_EXEC
                </p>
              </div>

              {/* Custom Webhook */}
              <div className="card p-8 border-white/5">
                <div className="flex items-center gap-3 mb-6">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-text-muted">Custom_Node_Endpoint</h2>
                  <div className="h-px flex-1 bg-white/5" />
                </div>
                <p className="text-text-secondary text-sm font-medium mb-6">
                  Receive agent events and system telemetry on your own external endpoint.
                </p>
                <input
                  className="input font-code text-xs"
                  value={customWebhookUrl}
                  onChange={(e) => setCustomWebhookUrl(e.target.value)}
                  placeholder="https://your-server.com/api/webhook"
                />
              </div>

              {/* Integrations */}
              <div className="card p-8">
                <div className="flex items-center gap-3 mb-10">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-text-muted">Neural_Connectors</h2>
                  <div className="h-px flex-1 bg-white/5" />
                </div>
                <div className="space-y-2">
                  {INTEGRATIONS.map((integration) => (
                    <div
                      key={integration.id}
                      className="flex items-center justify-between py-5 border-b border-white/5 last:border-0 gap-4"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                          {integration.icon}
                        </div>
                        <div>
                          <div className="text-sm font-bold uppercase tracking-tight">{integration.name}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${integration.connected ? "bg-green-400 shadow-[0_0_8px_#4ade80]" : "bg-white/10"}`} />
                            <span className={`text-[10px] font-bold uppercase tracking-widest ${integration.connected ? "text-green-400" : "text-text-muted"}`}>
                              {integration.connected ? "Link_Established" : "Not_Linked"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        className="btn-secondary text-[10px] px-6 py-2.5 uppercase tracking-widest font-bold opacity-30 cursor-not-allowed"
                        disabled
                      >
                        {integration.connected ? "Disconnect" : "Initialize_Link"}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-8 p-4 bg-white/5 rounded-xl border border-white/5 text-center">
                  <p className="text-text-muted text-[10px] font-bold uppercase tracking-[0.2em]">
                    More Connectors Initializing... // Matrix_Update_Pending
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ─── APPEARANCE ─── */}
          {activeSection === "appearance" && (
            <div className="space-y-8">
              <div className="card p-8 sm:p-10 border-neon-cyan/10">
                <div className="flex items-center gap-3 mb-10">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-text-muted">Visual_Optimization</h2>
                  <div className="h-px flex-1 bg-white/5" />
                </div>

                {/* Theme */}
                <div className="mb-10">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-4 px-1">Chromatic_Environment</label>
                  <div className="flex flex-wrap gap-3">
                    {(["dark", "light", "system"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        className={`px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                          theme === t
                            ? "bg-neon-cyan text-cyber-bg shadow-[0_0_15px_rgba(0,242,254,0.3)]"
                            : "bg-white/5 text-text-muted border border-white/5 hover:border-neon-cyan/40"
                        }`}
                      >
                        {t === "dark" ? "🌙 Cyber_Dark" : t === "light" ? "☀️ Solar_Light" : "💻 Mainframe_Sync"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Accent Color */}
                <div className="mb-10">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-4 px-1">Glow_Accent_Core</label>
                  <div className="flex gap-4 flex-wrap">
                    {ACCENT_COLORS.map((color) => (
                      <button
                        key={color.id}
                        onClick={() => setAccentColor(color.id)}
                        className={`w-12 h-12 rounded-2xl transition-all ${
                          accentColor === color.id
                            ? "scale-110 shadow-[0_0_20px]"
                            : "opacity-40 hover:opacity-100 hover:scale-105"
                        }`}
                        style={{
                          backgroundColor: color.hex,
                          boxShadow: accentColor === color.id ? `0 0 20px ${color.hex}60` : undefined,
                          border: accentColor === color.id ? "2px solid white" : "none",
                        }}
                        title={color.label}
                      />
                    ))}
                  </div>
                </div>

                {/* Font Size */}
                <div className="mb-12">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-4 px-1">Neural_Scale</label>
                  <div className="flex flex-wrap gap-3">
                    {(["sm", "md", "lg"] as const).map((size) => (
                      <button
                        key={size}
                        onClick={() => setFontSize(size)}
                        className={`px-8 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                          fontSize === size
                            ? "bg-neon-cyan text-cyber-bg shadow-[0_0_15px_rgba(0,242,254,0.3)]"
                            : "bg-white/5 text-text-muted border border-white/5"
                        }`}
                      >
                        {size.toUpperCase()}_v1.0
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  className="btn-primary w-full sm:w-auto px-10 py-4 uppercase tracking-widest text-xs font-bold"
                  onClick={handleSaveAppearance}
                  disabled={appearanceSaving}
                >
                  {appearanceSaving ? "PROCESSING..." : "Commit_Visual_Preferences"}
                </button>
              </div>
            </div>
          )}

          {/* ─── NOTIFICATIONS ─── */}
          {activeSection === "notifications" && (
            <div className="space-y-8">
              <div className="card p-8 border-neon-cyan/5">
                <div className="flex items-center gap-3 mb-10">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-text-muted">Neural_Notification_Bypass</h2>
                  <div className="h-px flex-1 bg-white/5" />
                </div>

                <div className="space-y-2">
                  {[
                    { label: "Neural_Link_Digest", desc: "Receive account and security telemetry", value: notifEmail, setter: setNotifEmail },
                    { label: "Mainframe_Push", desc: "Real-time system alerts in terminal", value: notifPush, setter: setNotifPush },
                    { label: "Daemon_Sync_Complete", desc: "Notifications when agents finish processing", value: notifAgent, setter: setNotifAgent },
                    { label: "Arena_Telemetry", desc: "Live updates from competition nodes", value: notifArena, setter: setNotifArena },
                    { label: "Matrix_Social_Ping", desc: "When mentioned in the collective Matrix", value: notifSocial, setter: setNotifSocial },
                    { label: "System_Health_Report", desc: "Weekly binary summary of node activity", value: notifDigest, setter: setNotifDigest },
                  ].map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-5 border-b border-white/5 last:border-0 gap-6"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold uppercase tracking-tight">{item.label}</div>
                        <div className="text-xs text-text-muted font-medium mt-0.5">{item.desc}</div>
                      </div>
                      <Toggle enabled={item.value} onChange={item.setter} />
                    </div>
                  ))}
                </div>

                <button
                  className="btn-primary w-full sm:w-auto px-10 py-4 uppercase tracking-widest text-xs font-bold mt-8"
                  onClick={handleSaveNotifications}
                  disabled={notifSaving}
                >
                  {notifSaving ? "SAVING..." : "Save_Signal_Preferences"}
                </button>
              </div>
            </div>
          )}

          {/* ─── BILLING ─── */}
          {activeSection === "billing" && (
            <div className="space-y-10">
              {/* Current Plan */}
              <div className="card bg-gradient-to-br from-neon-gold/10 to-neon-purple/5 border-neon-gold/20 p-8 sm:p-12 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-80 h-80 bg-neon-gold/5 blur-[120px]" />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-8 relative z-10">
                  <div>
                    <div className="text-[10px] font-bold text-neon-gold tracking-[0.4em] uppercase mb-2">Resource_Allocation</div>
                    <h3 className="font-heading text-4xl font-bold uppercase tracking-tight text-white mb-2">
                      FREE <span className="text-neon-gold">PLAN</span>
                    </h3>
                    <div className="text-sm font-bold text-text-muted uppercase tracking-[0.2em] opacity-60">COST: $0.00 / CYCLE</div>
                  </div>
                  <button
                    className="btn-primary px-10 py-4 uppercase tracking-[0.2em] font-bold text-xs shadow-[0_0_30px_rgba(255,215,0,0.2)]"
                    style={{ background: "linear-gradient(135deg, var(--neon-gold), #ff8c00)", color: "#000" }}
                  >
                    ✨ Upgrade_To_PRO_v3
                  </button>
                </div>

                {/* Usage */}
                <div className="mt-12">
                  <div className="flex justify-between items-end mb-4">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">Data_Packet_Usage</div>
                    <div className="text-sm font-bold font-code text-neon-gold">47% OPERATIONAL</div>
                  </div>
                  <div className="w-full h-3 bg-black/40 border border-white/5 rounded-full overflow-hidden p-0.5">
                    <div
                      className="h-full bg-gradient-to-r from-neon-gold to-neon-purple rounded-full shadow-[0_0_15px_rgba(255,215,0,0.3)] transition-all duration-1000"
                      style={{ width: "47%" }}
                    />
                  </div>
                  <div className="flex justify-between mt-4">
                    <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest opacity-40">
                      Cycle_Reset: 01_NEXT_MONTH
                    </p>
                    <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest opacity-40">
                      Limit: 100_PACKETS
                    </p>
                  </div>
                </div>
              </div>

              {/* Feature Comparison */}
              <div className="card p-8">
                <div className="flex items-center gap-3 mb-10">
                  <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-text-muted">Node_Tier_Comparison</h2>
                  <div className="h-px flex-1 bg-white/5" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left py-4 text-[10px] font-bold text-text-muted uppercase tracking-widest">Module_Feature</th>
                        <th className="text-center py-4 text-[10px] font-bold text-text-muted uppercase tracking-widest">Base</th>
                        <th className="text-center py-4 text-[10px] font-bold text-neon-cyan uppercase tracking-widest">PRO_v3</th>
                        <th className="text-center py-4 text-[10px] font-bold text-neon-purple uppercase tracking-widest">ENT_v3</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Neural_Transmissions", "100", "Unlimited", "Unlimited"],
                        ["Forged_Daemons", "3", "Unlimited", "Unlimited"],
                        ["Arena_Simulation", "1/week", "Unlimited", "Unlimited"],
                        ["Mainframe_API_Key", "—", "✓", "✓"],
                        ["Connector_Library", "—", "✓", "✓"],
                        ["Direct_Support_Node", "—", "✓", "✓"],
                        ["Custom_Encryption", "—", "—", "✓"],
                        ["Price_Per_Cycle", "$0", "$19/mo", "Custom"],
                      ].map(([feature, free, pro, enterprise], i) => (
                        <tr key={i} className="border-b border-white/5 group hover:bg-white/5 transition-colors">
                          <td className="py-4 text-xs font-bold uppercase tracking-tight text-text-primary">{feature}</td>
                          <td className="py-4 text-center text-xs font-code text-text-muted">{free}</td>
                          <td className="py-4 text-center text-xs font-code text-neon-cyan">{pro}</td>
                          <td className="py-4 text-center text-xs font-code text-neon-purple">{enterprise}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ─── DANGER ZONE ─── */}
          {activeSection === "danger" && (
            <div className="space-y-8">
              {/* Sign Out */}
              <div className="card p-8 border-white/5">
                <h3 className="font-heading text-lg font-bold uppercase tracking-tight mb-2">Initialize_Logout</h3>
                <p className="text-text-secondary text-sm font-medium mb-6">
                  Terminate the current session on this device. Identity remains preserved.
                </p>
                <button className="btn-secondary px-8 py-3 text-xs font-bold uppercase tracking-widest" onClick={logout}>
                  Terminate_Session
                </button>
              </div>

              {/* Delete Account */}
              <div className="card border-red-500/20 p-8 bg-red-500/[0.02]">
                <h3 className="font-heading text-lg font-bold uppercase tracking-tight mb-2 text-red-400">
                  Wipe_Node_Data
                </h3>
                <p className="text-text-secondary text-sm font-medium mb-8">
                  Permanently erase your authenticated identity and all forged daemons. This action is terminal.
                </p>

                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 mb-8">
                  <div className="text-red-400 text-xs font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span className="text-lg">⚠</span> CRITICAL_WARNING_ENCOUNTERED
                  </div>
                  <ul className="text-text-muted text-[10px] font-bold uppercase tracking-[0.2em] space-y-2 opacity-80">
                    <li>• ALL_FORGED_DAEMONS_WILL_BE_PURGED</li>
                    <li>• MATRIX_TRANSMISSIONS_WILL_BE_ERASED</li>
                    <li>• SUBSCRIPTION_LINKS_WILL_BE_SEVERED</li>
                    <li>• RECOVERY_IS_IMPOSSIBLE</li>
                  </ul>
                </div>

                <div className="mb-8">
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-3 px-1">
                    Input <span className="text-red-400 font-code">DELETE</span> to authorize purge
                  </label>
                  <input
                    className="input border-red-500/20 focus:border-red-500 text-center font-bold tracking-[0.5em]"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="CONFIRM_ERASURE"
                  />
                </div>

                <button
                  className="btn-secondary w-full sm:w-auto border-red-500/30 text-red-400 hover:bg-red-500/20 px-10 py-4 uppercase tracking-[0.2em] font-bold text-xs disabled:opacity-20 disabled:grayscale transition-all"
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading || deleteConfirm !== "DELETE"}
                >
                  {deleteLoading ? "PURGING..." : "Authorize_Terminal_Wipe"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
