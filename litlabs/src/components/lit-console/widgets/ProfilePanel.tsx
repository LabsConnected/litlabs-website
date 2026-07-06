"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { useProfile } from "@/context/ProfileContext";
import { useUser } from "@clerk/nextjs";
import { LC } from "../lit-console-theme";

const MOODS = [
  "😀 Happy", "😎 Cool", "💡 Creative", "🔥 Hot", "🎯 Focused",
  "🌟 Stellar", "💪 Strong", "🎵 Chill", "🚀 Launching", "😴 Tired",
  "🤔 Thinking", "💭 Dreaming",
];

export function ProfilePanel() {
  const { profile, updateProfile } = useProfile();
  const { user } = useUser();
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [newInterest, setNewInterest] = useState("");
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const displayName = user?.firstName || profile.displayName || "Creator";
  const username = user?.username || profile.username || "creator";
  const avatarUrl = avatarPreview || user?.imageUrl || profile.avatarUrl || "";
  const coverUrl = coverPreview || profile.coverUrl || "";

  const save = async (updates: Record<string, unknown>) => {
    setSaving(true);
    try {
      await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } finally {
      setSaving(false);
    }
  };

  const uploadAndSave = async (file: File, field: "avatar_url" | "cover_url") => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (data.url) {
      await save({ [field]: data.url });
      if (field === "avatar_url") updateProfile({ avatarUrl: data.url });
      if (field === "cover_url") updateProfile({ coverUrl: data.url });
    }
  };

  const handleAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCoverFile(file);
      setCoverPreview(URL.createObjectURL(file));
    }
  };

  const confirmAvatar = async () => {
    if (avatarFile) await uploadAndSave(avatarFile, "avatar_url");
    setAvatarFile(null);
    setAvatarPreview(null);
  };

  const confirmCover = async () => {
    if (coverFile) await uploadAndSave(coverFile, "cover_url");
    setCoverFile(null);
    setCoverPreview(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Cover */}
      <div
        className="relative h-48 md:h-72 overflow-hidden rounded-2xl border group"
        style={{ borderColor: LC.border, backgroundColor: LC.bgSecondary }}
      >
        {coverUrl ? (
          <Image src={coverUrl} alt="Cover" fill className="object-cover" unoptimized />
        ) : (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${LC.accentPurple}22 0%, ${LC.accentCyan}11 50%, ${LC.accentOrange}11 100%)`,
            }}
          >
            <span className="text-2xl font-black tracking-widest opacity-30">+ Add Cover</span>
          </div>
        )}
        <input type="file" ref={coverRef} onChange={handleCover} accept="image/*" className="hidden" />
        {!coverPreview ? (
          <button
            onClick={() => coverRef.current?.click()}
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          >
            <span className="text-white text-xs font-bold uppercase tracking-widest border border-white px-3 py-1">Change Cover</span>
          </button>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center gap-3" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
            <button onClick={confirmCover} disabled={saving} className="px-4 py-2 text-xs font-bold rounded" style={{ backgroundColor: LC.accentCyan, color: "#000" }}>
              {saving ? "Uploading..." : "Upload Cover"}
            </button>
            <button onClick={() => { setCoverFile(null); setCoverPreview(null); }} className="px-4 py-2 text-xs font-bold rounded" style={{ backgroundColor: LC.bgSecondary, color: LC.textMuted }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left column */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Avatar card */}
          <div className="rounded-2xl border p-4 text-center" style={{ borderColor: LC.border, backgroundColor: LC.bgPanel }}>
            <input type="file" ref={avatarRef} onChange={handleAvatar} accept="image/*" className="hidden" />
            <div className="w-32 h-32 mx-auto mb-4 relative group overflow-hidden rounded-full border-4" style={{ borderColor: LC.accentCyan }}>
              {avatarUrl ? (
                <Image src={avatarUrl} alt="Avatar" fill className="object-cover" unoptimized />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center font-black text-3xl" style={{ backgroundColor: LC.bgSecondary, color: LC.accentCyan }}>
                  {displayName.slice(0, 2).toUpperCase()}
                </div>
              )}
              {!avatarPreview ? (
                <button onClick={() => avatarRef.current?.click()} className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
                  <span className="text-white text-[10px] font-bold uppercase tracking-widest">Change Photo</span>
                </button>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
                  <button onClick={confirmAvatar} disabled={saving} className="px-3 py-1 text-[10px] font-bold rounded" style={{ backgroundColor: LC.accentCyan, color: "#000" }}>
                    {saving ? "Uploading..." : "Upload"}
                  </button>
                  <button onClick={() => { setAvatarFile(null); setAvatarPreview(null); }} className="px-3 py-1 text-[10px] font-bold rounded" style={{ backgroundColor: LC.bgSecondary, color: LC.textMuted }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <h2 className="text-lg font-black uppercase tracking-widest" style={{ color: LC.text }}>{displayName}</h2>
            <p className="text-[10px] opacity-60">@{username}</p>
            <div className="mt-3 inline-block px-3 py-1 rounded text-[10px] font-bold" style={{ backgroundColor: LC.bgSecondary, color: LC.accentCyan }}>
              Mood: {profile.mood}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-2xl border p-4" style={{ borderColor: LC.border, backgroundColor: LC.bgPanel }}>
            <div className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: LC.text }}>Quick Actions</div>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
              {["Send Msg", "Add Link", "Bookmark", "Forward"].map((label) => (
                <button key={label} className="p-2 rounded border transition hover:scale-105" style={{ borderColor: LC.border, backgroundColor: LC.bgSecondary, color: LC.textMuted }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Music Links */}
          <div className="rounded-2xl border p-4" style={{ borderColor: LC.border, backgroundColor: LC.bgPanel }}>
            <div className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: LC.text }}>Music Links</div>
            {editing === "music" ? (
              <div className="space-y-2">
                <input type="url" placeholder="Spotify" value={profile.musicLinks.spotify || ""} onChange={(e) => updateProfile({ musicLinks: { ...profile.musicLinks, spotify: e.target.value } })} className="w-full p-2 text-[10px] rounded border outline-none" style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border, color: LC.text }} />
                <input type="url" placeholder="YouTube" value={profile.musicLinks.youtube || ""} onChange={(e) => updateProfile({ musicLinks: { ...profile.musicLinks, youtube: e.target.value } })} className="w-full p-2 text-[10px] rounded border outline-none" style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border, color: LC.text }} />
                <div className="flex gap-2">
                  <button onClick={() => { save({ musicLinks: profile.musicLinks }); setEditing(null); }} className="flex-1 py-1.5 text-[10px] font-bold rounded" style={{ backgroundColor: LC.accentCyan, color: "#000" }}>Save</button>
                  <button onClick={() => setEditing(null)} className="py-1.5 text-[10px] font-bold rounded px-3" style={{ backgroundColor: LC.bgSecondary, color: LC.textMuted }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {(profile.musicLinks.spotify || profile.musicLinks.youtube) ? (
                  <>
                    {profile.musicLinks.spotify && (
                      <a href={profile.musicLinks.spotify} target="_blank" className="block p-2 text-[10px] font-bold border rounded" style={{ borderColor: LC.border, color: LC.textMuted }}>🎧 Spotify Stream</a>
                    )}
                    {profile.musicLinks.youtube && (
                      <a href={profile.musicLinks.youtube} target="_blank" className="block p-2 text-[10px] font-bold border rounded" style={{ borderColor: LC.border, color: LC.textMuted }}>▶️ YouTube Audio</a>
                    )}
                    <button onClick={() => setEditing("music")} className="w-full py-1.5 text-[9px] font-bold border rounded" style={{ borderColor: LC.accentCyan, color: LC.accentCyan }}>✏️ Re-Configure</button>
                  </>
                ) : (
                  <button onClick={() => setEditing("music")} className="w-full py-3 text-[10px] font-bold border-2 border-dashed rounded" style={{ borderColor: LC.border, color: LC.accentCyan }}>+ Bind Audio Links</button>
                )}
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="rounded-2xl border p-4" style={{ borderColor: LC.border, backgroundColor: LC.bgPanel }}>
            <div className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: LC.text }}>Badges</div>
            <div className="flex flex-wrap gap-1.5">
              {(profile.badges || []).map((badge) => (
                <span key={badge} className="px-2 py-0.5 border text-[9px] font-bold uppercase tracking-wider" style={{ borderColor: LC.accentCyan, color: LC.accentCyan, backgroundColor: `${LC.accentCyan}11` }}>
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Status */}
          <div className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: LC.border, backgroundColor: LC.bgPanel }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: LC.success, boxShadow: `0 0 8px ${LC.success}` }} />
            <p className="text-[11px]" style={{ color: LC.textMuted }}>
              <strong style={{ color: LC.accentCyan }}>{displayName}</strong> is {profile.mood.toLowerCase()}.
            </p>
          </div>

          {/* About */}
          <div className="rounded-2xl border p-4" style={{ borderColor: LC.border, backgroundColor: LC.bgPanel }}>
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: LC.text }}>About</span>
              <button onClick={() => setEditing(editing === "bio" ? null : "bio")} className="text-[9px] px-2 py-0.5 border rounded" style={{ borderColor: LC.accentCyan, color: LC.accentCyan }}>✏️ EDIT</button>
            </div>
            {editing === "bio" ? (
              <div className="space-y-3">
                <textarea value={profile.bio} onChange={(e) => updateProfile({ bio: e.target.value })} className="w-full p-2 text-xs rounded border outline-none resize-none min-h-[100px]" style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border, color: LC.text }} />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase" style={{ color: LC.accentCyan }}>Location</label>
                    <input type="text" value={profile.location} onChange={(e) => updateProfile({ location: e.target.value })} className="w-full p-1.5 text-xs rounded border outline-none mt-1" style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border, color: LC.text }} />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase" style={{ color: LC.accentCyan }}>Website</label>
                    <input type="url" value={profile.website} onChange={(e) => updateProfile({ website: e.target.value })} className="w-full p-1.5 text-xs rounded border outline-none mt-1" style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border, color: LC.text }} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { save({ bio: profile.bio, location: profile.location, website: profile.website }); setEditing(null); }} disabled={saving} className="px-4 py-2 text-xs font-bold rounded disabled:opacity-50" style={{ backgroundColor: LC.accentCyan, color: "#000" }}>
                    {saving ? "Saving..." : "Save Bio"}
                  </button>
                  <button onClick={() => setEditing(null)} className="px-4 py-2 text-xs font-bold rounded" style={{ backgroundColor: LC.bgSecondary, color: LC.textMuted }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="text-[11px] leading-relaxed">
                <p style={{ color: LC.textMuted }}>{profile.bio}</p>
                <div className="mt-3 pt-3 border-t border-dashed flex flex-wrap gap-4 text-[10px]" style={{ borderColor: LC.border }}>
                  <span className="font-bold" style={{ color: LC.accentCyan }}>📍 {profile.location}</span>
                  <span className="font-bold" style={{ color: LC.accentCyan }}>🌐 <a href={profile.website} target="_blank" style={{ color: LC.linkColor }}>{profile.website || "No website"}</a></span>
                </div>
              </div>
            )}
          </div>

          {/* Interests */}
          <div className="rounded-2xl border p-4" style={{ borderColor: LC.border, backgroundColor: LC.bgPanel }}>
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: LC.text }}>Interests</span>
              <button onClick={() => setEditing(editing === "interests" ? null : "interests")} className="text-[9px] px-2 py-0.5 border rounded" style={{ borderColor: LC.accentCyan, color: LC.accentCyan }}>✏️ EDIT</button>
            </div>
            {editing === "interests" ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {profile.interests.map((interest, i) => (
                    <span key={interest} className="px-2 py-0.5 border text-[9px] font-bold rounded flex items-center gap-1" style={{ borderColor: LC.border, color: LC.textMuted }}>
                      {interest}
                      <button onClick={() => updateProfile({ interests: profile.interests.filter((_, idx) => idx !== i) })} style={{ color: LC.danger }}>×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="text" value={newInterest} onChange={(e) => setNewInterest(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newInterest.trim() && profile.interests.length < 10) { updateProfile({ interests: [...profile.interests, newInterest.trim()] }); setNewInterest(""); } }} placeholder="Add interest..." className="flex-1 p-1.5 text-xs rounded border outline-none" style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border, color: LC.text }} />
                  <button onClick={() => { if (newInterest.trim() && profile.interests.length < 10) { updateProfile({ interests: [...profile.interests, newInterest.trim()] }); setNewInterest(""); } }} className="px-3 py-1 text-xs font-bold rounded" style={{ backgroundColor: LC.accentCyan, color: "#000" }}>Add</button>
                </div>
                <button onClick={() => { save({ interests: profile.interests }); setEditing(null); }} className="px-4 py-2 text-xs font-bold rounded" style={{ backgroundColor: LC.accentCyan, color: "#000" }}>Save Interests</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {profile.interests.map((interest) => (
                  <span key={interest} className="px-2 py-0.5 border text-[9px] font-bold uppercase tracking-wider rounded" style={{ borderColor: LC.accentCyan, color: LC.accentCyan, backgroundColor: `${LC.accentCyan}10` }}>
                    {interest}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Mood selector */}
          <div className="rounded-2xl border p-4" style={{ borderColor: LC.border, backgroundColor: LC.bgPanel }}>
            <div className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: LC.text }}>Mood</div>
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map((mood) => (
                <button
                  key={mood}
                  onClick={() => { updateProfile({ mood }); save({ mood }); }}
                  className="px-2 py-1 text-[9px] font-bold border rounded transition hover:scale-105"
                  style={{
                    borderColor: profile.mood === mood ? LC.accentCyan : LC.border,
                    backgroundColor: profile.mood === mood ? `${LC.accentCyan}22` : LC.bgSecondary,
                    color: profile.mood === mood ? LC.accentCyan : LC.textMuted,
                  }}
                >
                  {mood}
                </button>
              ))}
            </div>
          </div>

          {/* Collaborators / Gallery placeholder */}
          <div className="rounded-2xl border p-4" style={{ borderColor: LC.border, backgroundColor: LC.bgPanel }}>
            <div className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: LC.text }}>Top Collaborators</div>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {["SarahCodes", "DevGuru", "PixelPro", "TechTitan", "WebWizard", "CodeNinja", "VidSlayer", "Director"].map((name) => (
                <div key={name} className="text-center">
                  <div className="w-10 h-10 mx-auto rounded-full flex items-center justify-center text-[10px] font-black mb-1" style={{ backgroundColor: LC.bgSecondary, color: LC.accentCyan, border: `1px solid ${LC.border}` }}>
                    {name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="text-[8px] truncate" style={{ color: LC.textMuted }}>{name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
