"use client";
export const dynamic = "force-dynamic";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import Link from "next/link";
import Image from "next/image";
import PageShell from "@/components/PageShell";

export default function ProfilePage() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();
  const { resolvedColors: T } = useTheme();
  const { profile, updateProfile } = useProfile();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/profile");
    }
  }, [isLoaded, isSignedIn, router]);

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

  return (
    <PageShell title="Profile" className="text-xs relative">
      {/* Cover Image Backdrop */}
      <div
        className="relative h-48 md:h-72 overflow-hidden group border-b-2"
        style={{ borderColor: T.borderColor }}
      >
        <Image
          src={coverPreview || profile.coverUrl || "https://placehold.co/1200x400/1a1a2e/ffffff?text=+"}
          alt="Cover"
          fill
          className="object-cover"
          unoptimized
          sizes="100vw"
        />
        {!profile.coverUrl && !coverPreview && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-r from-purple-950/80 via-black/80 to-blue-950/80">
            <span className="text-2xl font-bold tracking-widest text-white/50 animate-pulse">
              📷 Add Cover Image
            </span>
          </div>
        )}
        <input
          type="file"
          ref={coverInputRef}
          onChange={handleCoverSelect}
          accept="image/*"
          className="hidden"
        />
        {!coverPreview ? (
          <button
            onClick={() => coverInputRef.current?.click()}
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          >
            <span className="text-white text-xs font-bold uppercase tracking-widest border border-white p-2">
              Change Cover
            </span>
          </button>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center gap-3" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
            <button
              onClick={confirmCoverUpload}
              disabled={saving}
              className="px-4 py-2 text-xs font-bold uppercase tracking-widest border disabled:opacity-50"
              style={{ backgroundColor: T.accentColor, color: "black", borderColor: T.borderColor }}
            >
              {saving ? "Uploading..." : "Upload Cover"}
            </button>
            <button
              onClick={cancelCoverUpload}
              className="px-4 py-2 text-xs font-bold uppercase tracking-widest border"
              style={{ backgroundColor: T.bgColor, color: T.textMuted, borderColor: T.borderColor }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Main Grid Content */}
      <div className="w-full px-4 py-6 grid md:grid-cols-12 gap-6">
        {/* LEFT COLUMN — PROFILE AVATAR & DIRECTIVES */}
        <div className="md:col-span-4 space-y-4">
          {/* Avatar & Display Name editable card */}
          <div
            className="lit-box p-4 text-center"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <input
              type="file"
              ref={avatarInputRef}
              onChange={handleAvatarSelect}
              accept="image/*"
              className="hidden"
            />

            <div
              className="w-32 h-32 mx-auto mb-4 relative group overflow-hidden border-2 rounded-full"
              style={{
                backgroundColor: T.bgColor,
                borderColor: T.borderColor,
              }}
            >
              <Image
                src={avatarPreview || profile.avatarUrl || "https://placehold.co/128/1a1a2e/ffffff?text=+"}
                alt="Avatar"
                fill
                className="object-cover"
                unoptimized
                sizes="128px"
              />
              {!profile.avatarUrl && !avatarPreview && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl">👤</span>
                  <span className="text-[8px] opacity-40 uppercase tracking-widest mt-1">
                    No Frame
                  </span>
                </div>
              )}
              {!avatarPreview ? (
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
                >
                  <span className="text-white text-[10px] font-bold uppercase tracking-widest">
                    Change Photo
                  </span>
                </button>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
                  <button
                    onClick={confirmAvatarUpload}
                    disabled={saving}
                    className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest border disabled:opacity-50"
                    style={{ backgroundColor: T.accentColor, color: "black", borderColor: T.borderColor }}
                  >
                    {saving ? "Uploading..." : "Upload"}
                  </button>
                  <button
                    onClick={cancelAvatarUpload}
                    className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest border"
                    style={{ backgroundColor: T.bgColor, color: T.textMuted, borderColor: T.borderColor }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Display Name - Editable */}
            {editingSection === "name" ? (
              <div className="space-y-2 max-w-[200px] mx-auto">
                <input
                  type="text"
                  value={profile.displayName}
                  onChange={(e) =>
                    updateProfile({ displayName: e.target.value })
                  }
                  className="w-full p-1.5 text-center font-bold text-xs border outline-none"
                  style={{
                    backgroundColor: T.bgColor,
                    color: T.textColor,
                    borderColor: T.borderColor,
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      saveProfile({ displayName: profile.displayName });
                      setEditingSection(null);
                    }}
                    disabled={saving}
                    className="px-4 py-1.5 text-[10px] font-bold border-2 disabled:opacity-50"
                    style={{
                      backgroundColor: T.accentColor,
                      color: "black",
                      borderColor: T.borderColor,
                    }}
                  >
                    {saving ? "Saving..." : "Save Name"}
                  </button>
                  <button
                    onClick={() => setEditingSection(null)}
                    className="px-4 py-1.5 text-[10px] font-bold border-2"
                    style={{
                      backgroundColor: T.bgColor,
                      color: T.textMuted,
                      borderColor: T.borderColor,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <h2
                className="text-lg font-bold cursor-pointer hover:underline uppercase tracking-widest mb-1"
                style={{ color: T.headerColor }}
                onClick={() => setEditingSection("name")}
              >
                {profile.displayName} ✏️
              </h2>
            )}

            <p className="text-[10px] opacity-60 mt-0.5">
              @{profile.username}
            </p>

            {/* Mood - Editable */}
            <div
              className="mt-4 pt-3 border-t border-dashed"
              style={{ borderColor: T.borderColor }}
            >
              {editingSection === "mood" ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={profile.mood}
                    onChange={(e) => updateProfile({ mood: e.target.value })}
                    className="w-full p-2 text-xs border"
                    style={{
                      backgroundColor: T.bgColor,
                      color: T.textColor,
                      borderColor: T.borderColor,
                    }}
                    placeholder="Enter custom node mood..."
                  />
                  <div className="flex flex-wrap gap-1 justify-center max-h-[80px] overflow-y-auto p-1.5 border border-dashed border-gray-800">
                    {moods.map((mood) => (
                      <button
                        key={mood}
                        onClick={() => {
                          updateProfile({ mood });
                          setEditingSection(null);
                        }}
                        className="px-1.5 py-0.5 text-[9px] border"
                        style={{ borderColor: T.borderColor }}
                      >
                        {mood}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        saveProfile({ mood: profile.mood });
                        setEditingSection(null);
                      }}
                      disabled={saving}
                      className="px-3 py-1 text-[10px] font-bold border-2 disabled:opacity-50"
                      style={{
                        backgroundColor: T.accentColor,
                        color: "black",
                        borderColor: T.borderColor,
                      }}
                    >
                      {saving ? "Saving..." : "Save Mood"}
                    </button>
                    <button
                      onClick={() => setEditingSection(null)}
                      className="px-3 py-1 text-[10px] font-bold border-2"
                      style={{
                        backgroundColor: T.bgColor,
                        color: T.textMuted,
                        borderColor: T.borderColor,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="text-xs cursor-pointer hover:underline inline-block p-1 bg-black/40 border border-gray-900 rounded"
                  onClick={() => setEditingSection("mood")}
                  style={{ color: T.accentColor }}
                >
                  Mood: <strong className="text-white">{profile.mood}</strong>{" "}
                  ✏️
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions Panel */}
          <div
            className="lit-box p-4"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="lit-header -mx-4 -mt-4 mb-3"
              style={{ color: "white" }}
            >
              Quick Actions
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
              <button
                className="p-2 border hover:scale-105 active:scale-95 transition-transform"
                style={{
                  borderColor: T.borderColor,
                  backgroundColor: "transparent",
                }}
              >
                📧 SEND MSG
              </button>
              <button
                className="p-2 border hover:scale-105 active:scale-95 transition-transform"
                style={{
                  borderColor: T.borderColor,
                  backgroundColor: "transparent",
                }}
              >
                👥 ADD LINK
              </button>
              <button
                className="p-2 border hover:scale-105 active:scale-95 transition-transform"
                style={{
                  borderColor: T.borderColor,
                  backgroundColor: "transparent",
                }}
              >
                ⭐ BOOKMARK
              </button>
              <button
                className="p-2 border hover:scale-105 active:scale-95 transition-transform"
                style={{
                  borderColor: T.borderColor,
                  backgroundColor: "transparent",
                }}
              >
                🔗 FORWARD
              </button>
            </div>
          </div>

          {/* Persistent Music Station */}
          <div
            className="lit-box p-4"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="lit-header -mx-4 -mt-4 mb-3"
              style={{ color: "white" }}
            >
              🎵 Music Links
            </div>
            {editingSection === "music" ? (
              <div className="space-y-1.5">
                <input
                  type="url"
                  placeholder="Spotify Playlist URL"
                  value={profile.musicLinks.spotify || ""}
                  onChange={(e) =>
                    updateProfile({
                      musicLinks: {
                        ...profile.musicLinks,
                        spotify: e.target.value,
                      },
                    })
                  }
                  className="w-full p-2 text-[10px] border outline-none font-mono"
                  style={{
                    backgroundColor: T.bgColor,
                    color: T.textColor,
                    borderColor: T.borderColor,
                  }}
                />
                <input
                  type="url"
                  placeholder="YouTube Music URL"
                  value={profile.musicLinks.youtube || ""}
                  onChange={(e) =>
                    updateProfile({
                      musicLinks: {
                        ...profile.musicLinks,
                        youtube: e.target.value,
                      },
                    })
                  }
                  className="w-full p-2 text-[10px] border outline-none font-mono"
                  style={{
                    backgroundColor: T.bgColor,
                    color: T.textColor,
                    borderColor: T.borderColor,
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      saveProfile({ musicLinks: profile.musicLinks });
                      setEditingSection(null);
                    }}
                    disabled={saving}
                    className="flex-1 px-4 py-1.5 text-xs font-bold border-2 disabled:opacity-50"
                    style={{
                      backgroundColor: T.accentColor,
                      color: "black",
                      borderColor: T.borderColor,
                    }}
                  >
                    {saving ? "Saving..." : "Save Music Links"}
                  </button>
                  <button
                    onClick={() => setEditingSection(null)}
                    className="px-4 py-1.5 text-xs font-bold border-2"
                    style={{
                      backgroundColor: T.bgColor,
                      color: T.textMuted,
                      borderColor: T.borderColor,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-[10px] font-bold">
                {profile.musicLinks.spotify && (
                  <a
                    href={profile.musicLinks.spotify}
                    target="_blank"
                    className="flex items-center gap-2 p-2 border"
                    style={{
                      borderColor: T.borderColor,
                      backgroundColor: "rgba(0,255,0,0.03)",
                    }}
                  >
                    <span>🎧</span> Spotify Stream Array
                  </a>
                )}
                {profile.musicLinks.youtube && (
                  <a
                    href={profile.musicLinks.youtube}
                    target="_blank"
                    className="flex items-center gap-2 p-2 border"
                    style={{
                      borderColor: T.borderColor,
                      backgroundColor: "rgba(255,0,0,0.03)",
                    }}
                  >
                    <span>▶️</span> YouTube Audio Buffer
                  </a>
                )}
                {!profile.musicLinks.spotify && !profile.musicLinks.youtube && (
                  <div
                    className="cursor-pointer text-center p-3 border-2 border-dashed hover:bg-black/20"
                    style={{ borderColor: T.borderColor, color: T.accentColor }}
                    onClick={() => setEditingSection("music")}
                  >
                    + Bind Custom Audio Links ✏️
                  </div>
                )}
                {(profile.musicLinks.spotify || profile.musicLinks.youtube) && (
                  <button
                    onClick={() => setEditingSection("music")}
                    className="w-full p-2 text-[9px] border hover:bg-black/20 font-bold uppercase tracking-wider"
                    style={{ borderColor: T.accentColor, color: T.accentColor }}
                  >
                    ✏️ Re-Configure Audio Channels
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Earned Achievements */}
          <div
            className="lit-box p-4"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="lit-header -mx-4 -mt-4 mb-3"
              style={{ color: "white" }}
            >
              🏆 Badges
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(profile.badges || []).map((badge, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 border text-[9px] font-bold uppercase tracking-wider"
                  style={{
                    borderColor: T.accentColor,
                    color: T.accentColor,
                    backgroundColor: `${T.accentColor}11`,
                  }}
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN — FEED, PHOTOS, COMMENTS */}
        <div className="md:col-span-8 space-y-4">
          {/* Status Indicator */}
          <div
            className="border p-3 rounded-lg"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <p className="text-[11px] leading-relaxed" style={{ color: T.textMuted }}>
                <strong style={{ color: T.accentColor }}>
                  {profile.displayName}
                </strong>{" "}
                is {profile.mood.toLowerCase()}.
              </p>
            </div>
          </div>

          {/* About Me */}
          <div
            className="lit-box p-4"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="lit-header -mx-4 -mt-4 mb-3 flex justify-between items-center"
              style={{ color: "white" }}
            >
              <span>About</span>
              <button
                onClick={() =>
                  setEditingSection(editingSection === "bio" ? null : "bio")
                }
                className="text-[9px] px-2 py-0.5 border"
                style={{
                  borderColor: T.accentColor,
                  color: T.accentColor,
                  backgroundColor: "black/40",
                }}
              >
                ✏️ EDIT
              </button>
            </div>

            {editingSection === "bio" ? (
              <div className="space-y-3">
                <textarea
                  value={profile.bio}
                  onChange={(e) => updateProfile({ bio: e.target.value })}
                  className="w-full p-2 text-xs border min-h-[100px] outline-none resize-none font-mono"
                  style={{
                    backgroundColor: T.bgColor,
                    color: T.textColor,
                    borderColor: T.borderColor,
                  }}
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: T.accentColor }}
                    >
                      Location:
                    </label>
                    <input
                      type="text"
                      value={profile.location}
                      onChange={(e) =>
                        updateProfile({ location: e.target.value })
                      }
                      className="w-full p-1.5 text-xs border mt-1 outline-none font-mono"
                      style={{
                        backgroundColor: T.bgColor,
                        color: T.textColor,
                        borderColor: T.borderColor,
                      }}
                    />
                  </div>
                  <div>
                    <label
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: T.accentColor }}
                    >
                      Website:
                    </label>
                    <input
                      type="url"
                      value={profile.website}
                      onChange={(e) =>
                        updateProfile({ website: e.target.value })
                      }
                      className="w-full p-1.5 text-xs border mt-1 outline-none font-mono"
                      style={{
                        backgroundColor: T.bgColor,
                        color: T.textColor,
                        borderColor: T.borderColor,
                      }}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      saveProfile({ bio: profile.bio, location: profile.location, website: profile.website });
                      setEditingSection(null);
                    }}
                    disabled={saving}
                    className="px-4 py-2 text-xs font-bold border-2 disabled:opacity-50"
                    style={{
                      backgroundColor: T.accentColor,
                      color: "black",
                      borderColor: T.borderColor,
                    }}
                  >
                    {saving ? "Saving..." : "Save Bio & Links"}
                  </button>
                  <button
                    onClick={() => setEditingSection(null)}
                    className="px-4 py-2 text-xs font-bold border-2"
                    style={{
                      backgroundColor: T.bgColor,
                      color: T.textMuted,
                      borderColor: T.borderColor,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-[11px] leading-relaxed">
                <p style={{ color: T.textColor }}>{profile.bio}</p>
                <div
                  className="mt-3 pt-2 border-t border-dashed flex flex-wrap gap-4 text-[10px]"
                  style={{ borderColor: T.borderColor, color: T.accentColor }}
                >
                  <span className="font-bold">
                    📍 {profile.location}
                  </span>
                  <span className="font-bold">
                    🌐{" "}
                    <a
                      href={profile.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: T.linkColor }}
                      className="hover:underline"
                    >
                      {profile.website || "No website"}
                    </a>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Interests Section */}
          <div
            className="lit-box p-4"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="lit-header -mx-4 -mt-4 mb-3 flex justify-between items-center"
              style={{ color: "white" }}
            >
              <span>Interests</span>
              <button
                onClick={() =>
                  setEditingSection(
                    editingSection === "interests" ? null : "interests",
                  )
                }
                className="text-[9px] px-2 py-0.5 border"
                style={{
                  borderColor: T.accentColor,
                  color: T.accentColor,
                  backgroundColor: "black/40",
                }}
              >
                ✏️ EDIT
              </button>
            </div>

            {editingSection === "interests" ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newInterest}
                    onChange={(e) => setNewInterest(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addInterest()}
                    placeholder="E.g. Rust, LLM, Synthwave..."
                    className="flex-1 p-2 text-xs border outline-none font-mono"
                    style={{
                      backgroundColor: T.bgColor,
                      color: T.textColor,
                      borderColor: T.borderColor,
                    }}
                  />
                  <button
                    onClick={addInterest}
                    className="px-4 py-2 text-xs font-bold border-2"
                    style={{
                      backgroundColor: T.linkColor,
                      color: "black",
                      borderColor: T.borderColor,
                    }}
                  >
                    Append
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(profile.interests || []).map((interest, i) => (
                    <span
                      key={i}
                      className="px-2 py-1 text-[10px] border flex items-center gap-1.5"
                      style={{
                        borderColor: T.borderColor,
                        backgroundColor: "rgba(0,0,0,0.3)",
                      }}
                    >
                      {interest}
                      <button
                        onClick={() => removeInterest(i)}
                        className="text-red-500 font-bold hover:scale-110 active:scale-95"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      saveProfile({ interests: profile.interests });
                      setEditingSection(null);
                    }}
                    disabled={saving}
                    className="px-4 py-1.5 text-xs font-bold border-2 disabled:opacity-50"
                    style={{
                      backgroundColor: T.accentColor,
                      color: "black",
                      borderColor: T.borderColor,
                    }}
                  >
                    {saving ? "Saving..." : "Save Tags"}
                  </button>
                  <button
                    onClick={() => setEditingSection(null)}
                    className="px-4 py-1.5 text-xs font-bold border-2"
                    style={{
                      backgroundColor: T.bgColor,
                      color: T.textMuted,
                      borderColor: T.borderColor,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(profile.interests || []).map((interest, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 text-[10px] border-2 uppercase font-bold tracking-wide"
                    style={{
                      borderColor: T.borderColor,
                      color: T.linkColor,
                      backgroundColor: "black/40",
                    }}
                  >
                    {interest}
                  </span>
                ))}
                {(profile.interests || []).length === 0 && (
                  <p className="text-[10px] text-gray-500 italic">
                    No interests added yet.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Linked Co-Builder Array */}
          <div
            className="lit-box p-4"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="lit-header -mx-4 -mt-4 mb-3 flex justify-between items-center"
              style={{ color: "white" }}
            >
              <span>Top Collaborators</span>
              <span className="text-[10px] tracking-widest text-white/50">
                MOCK DATA
              </span>
            </div>

            <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
              {[
                { name: "SarahCodes", avatar: "👩‍💻", title: "Specialist" },
                { name: "DevDave", avatar: "👨‍💻", title: "Database" },
                { name: "PixelPete", avatar: "🎨", title: "Designer" },
                { name: "TechTina", avatar: "🤖", title: "A.I." },
                { name: "WebWizard", avatar: "🧙‍♂️", title: "Frontend" },
                { name: "CodeNinja", avatar: "🥷", title: "DevOps" },
                { name: "VoltSlayer", avatar: "⚡", title: "Network" },
                { name: "Director", avatar: "🎯", title: "System" },
              ].map((friend, i) => (
                <div key={i} className="text-center group cursor-pointer">
                  <div
                    className="w-full aspect-square flex items-center justify-center border-2 mb-1.5 group-hover:scale-105 group-hover:shadow-[0_0_15px_rgba(0,255,255,0.25)] transition-all"
                    style={{
                      borderColor: T.borderColor,
                      backgroundColor: T.bgColor,
                    }}
                  >
                    <span className="text-2xl">{friend.avatar}</span>
                  </div>
                  <div
                    className="text-[9px] font-bold truncate tracking-wide"
                    style={{ color: T.linkColor }}
                  >
                    {friend.name}
                  </div>
                  <div className="text-[7px] opacity-40 uppercase tracking-widest">
                    {friend.title}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Photo Gallery Grid */}
          <div
            className="lit-box p-4"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="lit-header -mx-4 -mt-4 mb-3 flex justify-between items-center"
              style={{ color: "white" }}
            >
              <span>Gallery</span>
              <span className="text-[9px] opacity-50">MOCK DATA</span>
            </div>

            <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="aspect-square flex items-center justify-center border-2 hover:scale-110 hover:shadow-[0_0_10px_rgba(255,0,128,0.3)] transition-all cursor-pointer"
                  style={{
                    borderColor: T.borderColor,
                    backgroundColor: T.bgColor,
                  }}
                >
                  <span className="text-2xl">
                    {["🚀", "💻", "🎵", "⚡", "🔥", "🎨", "🌟", "🏆"][i]}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      <div
        className="border-t mt-8 p-6 text-center text-[10px]"
        style={{ borderColor: T.borderColor, color: T.textMuted }}
      >
        © {new Date().getFullYear()} LiTTree LabStudios
      </div>
    </PageShell>
  );
}
