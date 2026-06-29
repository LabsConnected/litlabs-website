"use client";
export const dynamic = "force-dynamic";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import Link from "next/link";
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
  const [visitorCount, setVisitorCount] = useState(133742);
  const [newInterest, setNewInterest] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Custom User Profile Comments List (local mock database)
  const [comments, setComments] = useState([
    {
      author: "TechBro99",
      avatar: "💻",
      time: "2 hours ago",
      text: "Yo this profile is fire! 🔥 Let's sync on that next-gen orchestrator build.",
    },
    {
      author: "CodeQueen",
      avatar: "👑",
      time: "5 hours ago",
      text: "The custom volcano skin variables compile beautifully. Outstanding theme!",
    },
    {
      author: "DesignDave",
      avatar: "🎨",
      time: "1 day ago",
      text: "Love the LiTPage aesthetic fused with Gemini agents. Absolutely genius design!",
    },
  ]);
  const [newCommentText, setNewCommentText] = useState("");

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        updateProfile({ avatarUrl: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        updateProfile({ coverUrl: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
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

  const handleAddComment = () => {
    if (!newCommentText.trim()) return;
    setComments([
      ...comments,
      {
        author: profile.displayName || "You",
        avatar: "🔥",
        time: "Just now",
        text: newCommentText.trim(),
      },
    ]);
    setNewCommentText("");
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
      {/* Marquee Ticker */}
      <div
        className="w-full bg-black py-1.5 border-b-2 overflow-hidden flex"
        style={{ borderColor: T.borderColor, color: T.accentColor }}
      >
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px]">
          <span>👤 USER PROFILE MODULE ACTIVE // SECURE SECTOR CHANNELS</span>
          <span>
            ⚡ DOUBLE CLICK HEADERS OR EDIT BUTTONS TO OVERRIDE BIOS VARIABLES
          </span>
          <span>
            💾 ALL CUSTOM AVATARS AND BACKDROP COVERS ENCODED DIRECTLY TO LOCAL
            CLUSTERS
          </span>
        </div>
      </div>

      {/* Cover Image Backdrop */}
      <div
        className="relative h-48 md:h-64 overflow-hidden cursor-pointer group border-b-2"
        style={{ borderColor: T.borderColor }}
        onClick={() => coverInputRef.current?.click()}
      >
        {profile.coverUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={profile.coverUrl}
              alt="Cover"
              className="w-full h-full object-cover"
            />
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-linear-to-r from-purple-950 via-black to-blue-950">
            <span className="text-2xl font-bold tracking-widest text-white/50 animate-pulse">
              📷 CHANGE HERO BACKDROP PACKET
            </span>
            <span className="text-[10px] text-white/30 uppercase mt-1">
              Accepts PNG / JPG structures
            </span>
          </div>
        )}
        <input
          type="file"
          ref={coverInputRef}
          onChange={handleCoverUpload}
          accept="image/*"
          className="hidden"
        />
        <div
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <span className="text-white text-xs font-bold uppercase tracking-widest border border-white p-2">
            Click to Upload Cover Image
          </span>
        </div>
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
              onChange={handleAvatarUpload}
              accept="image/*"
              className="hidden"
            />

            <div
              className="w-32 h-32 mx-auto mb-4 cursor-pointer relative group overflow-hidden border-2"
              style={{
                backgroundColor: T.bgColor,
                borderColor: T.borderColor,
              }}
              onClick={() => avatarInputRef.current?.click()}
            >
              {profile.avatarUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={profile.avatarUrl}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                  />
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <span className="text-4xl">👤</span>
                  <span className="text-[8px] opacity-40 uppercase tracking-widest mt-1">
                    No Frame
                  </span>
                </div>
              )}
              <div
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
              >
                <span className="text-white text-[10px] font-bold uppercase tracking-widest">
                  UPLOAD PIC
                </span>
              </div>
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
                <button
                  onClick={() => setEditingSection(null)}
                  className="px-4 py-1 text-[10px] font-bold border-2"
                  style={{
                    backgroundColor: T.linkColor,
                    color: "black",
                    borderColor: T.borderColor,
                  }}
                >
                  Save Override
                </button>
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

            <div className="flex justify-center items-center gap-1.5 mt-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <p
                className="text-[10px] uppercase font-bold tracking-widest"
                style={{ color: T.accentColor }}
              >
                Node Active
              </p>
            </div>
            <p className="text-[10px] opacity-60 font-mono mt-0.5">
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
                  <button
                    onClick={() => setEditingSection(null)}
                    className="px-3 py-1 text-[10px] font-bold border-2"
                    style={{
                      backgroundColor: T.linkColor,
                      color: "black",
                      borderColor: T.borderColor,
                    }}
                  >
                    Lock Mood
                  </button>
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
              Node Interactions
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
              🎵 Audio Deck
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
                <button
                  onClick={() => setEditingSection(null)}
                  className="w-full px-4 py-1.5 text-xs font-bold border-2"
                  style={{
                    backgroundColor: T.linkColor,
                    color: "black",
                    borderColor: T.borderColor,
                  }}
                >
                  Save Stream Registries
                </button>
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
              🏆 Studio Badges
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
            className="border-2 p-3 bg-black/60 shadow-md"
            style={{ borderColor: T.borderColor }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl animate-pulse">💡</span>
              <p className="italic text-[11px] leading-relaxed">
                <strong className="uppercase" style={{ color: T.accentColor }}>
                  Status Stream:
                </strong>{" "}
                {profile.displayName} is actively tweaking client variables
                inside Sector 7. |
                <strong
                  className="uppercase ml-1"
                  style={{ color: T.accentColor }}
                >
                  {" "}
                  Mood:
                </strong>{" "}
                {profile.mood}
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
              <span>Bio & Objectives</span>
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
                      Grid Sector Location:
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
                      Custom Endpoint Website:
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
                <button
                  onClick={() => setEditingSection(null)}
                  className="px-4 py-2 text-xs font-bold border-2"
                  style={{
                    backgroundColor: T.linkColor,
                    color: "black",
                    borderColor: T.borderColor,
                  }}
                >
                  Save Coordinates
                </button>
              </div>
            ) : (
              <div className="text-[11px] leading-relaxed">
                <p style={{ color: T.textColor }}>{profile.bio}</p>
                <div
                  className="mt-3 pt-2 border-t border-dashed flex flex-wrap gap-4 text-[10px]"
                  style={{ borderColor: T.borderColor, color: T.accentColor }}
                >
                  <span className="font-bold">
                    📍 LOCATION:{" "}
                    <span className="text-white">{profile.location}</span>
                  </span>
                  <span className="font-bold">
                    🌐 WEB TARGET:{" "}
                    <a
                      href={profile.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: T.linkColor }}
                      className="hover:underline"
                    >
                      {profile.website || "N/A"}
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
              <span>Specialty Tags</span>
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
                <button
                  onClick={() => setEditingSection(null)}
                  className="px-4 py-1.5 text-xs font-bold border-2"
                  style={{
                    backgroundColor: T.linkColor,
                    color: "black",
                    borderColor: T.borderColor,
                  }}
                >
                  Commit Interests
                </button>
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
                    No tags loaded in user index registers.
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
              <span>Linked Co-Builder Array</span>
              <span className="text-[10px] font-mono tracking-widest text-white/50">
                TOP 8 ACTIVE NODES
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
              <span>Captured Visual Buffers</span>
              <span className="text-[9px] opacity-50">GALLERY DISK ARRAY</span>
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

          {/* Public Node Comment Registry */}
          <div
            className="lit-box p-4"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="lit-header -mx-4 -mt-4 mb-3"
              style={{ color: "white" }}
            >
              Public Node Comment Registry
            </div>

            <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1 mb-4">
              {comments.map((comment, i) => (
                <div
                  key={i}
                  className="border-b border-dashed pb-3 last:border-b-0 last:pb-0"
                  style={{ borderColor: T.borderColor }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="w-6 h-6 rounded-full bg-gray-900 border flex items-center justify-center text-sm"
                      style={{ borderColor: T.borderColor }}
                    >
                      {comment.avatar}
                    </span>
                    <span
                      className="font-bold text-xs"
                      style={{ color: T.linkColor }}
                    >
                      {comment.author}
                    </span>
                    <span className="text-[9px] opacity-50 ml-auto">
                      - {comment.time}
                    </span>
                  </div>
                  <p
                    className="text-[11px] ml-8 leading-relaxed"
                    style={{ color: T.textColor }}
                  >
                    {comment.text}
                  </p>
                </div>
              ))}
            </div>

            <div
              className="pt-3 border-t border-dashed"
              style={{ borderColor: T.borderColor }}
            >
              <textarea
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder="Compose public comment packet..."
                className="w-full p-2 text-xs border-2 min-h-[60px] outline-none font-mono resize-none"
                style={{
                  backgroundColor: T.bgColor,
                  color: T.textColor,
                  borderColor: T.borderColor,
                }}
              />
              <button
                onClick={handleAddComment}
                className="mt-2 px-4 py-2 text-xs font-bold border-2 hover:scale-105 active:scale-95 transition-all uppercase tracking-wider"
                style={{
                  backgroundColor: T.linkColor,
                  color: "black",
                  borderColor: T.borderColor,
                }}
              >
                Inject Packet ⚡
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer statistics and metadata */}
      <div
        className="border-t-2 mt-8 p-6 text-center text-[10px] font-mono"
        style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
      >
        <div className="mb-3">
          <span
            className="font-bold text-base px-2 py-0.5 bg-black border text-green-400"
            style={{ borderColor: T.borderColor }}
          >
            {visitorCount.toLocaleString()}
          </span>
          <span className="ml-2 uppercase tracking-widest opacity-60 font-bold">
            Captured Telemetry Nodes
          </span>
          <button
            onClick={() => setVisitorCount((v) => v + 1)}
            className="ml-3 px-2 py-0.5 text-[10px] font-bold border-2 active:scale-90 transition-transform"
            style={{ borderColor: T.borderColor, backgroundColor: "black" }}
          >
            PING +1
          </button>
        </div>
        <div style={{ color: T.textColor }} className="opacity-50">
          © {new Date().getFullYear()} LiTreeLabStudios NETWORK HUB | SYSTEM
          CORE v5.24 | POWERED BY ⚡GOD-CORE SPECIALISTS
        </div>
      </div>
    </PageShell>
  );
}
