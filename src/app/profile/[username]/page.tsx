"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MessageCircle,
  UserPlus,
  Share2,
  MapPin,
  Link as LinkIcon,
  Calendar,
  Sparkles,
  Bot,
  Image as ImageIcon,
  Heart,
  MessageSquare,
  MoreHorizontal,
  Verified,
  BadgeCheck,
  Send,
} from "lucide-react";

// Retro neon palette - matching homepage
const C = {
  bgColor: "#0a0a12",
  textColor: "#e0e0ff",
  textMuted: "#8888aa",
  linkColor: "#ff00a0",
  headerColor: "#00f0ff",
  borderColor: "#2a2a45",
  accentColor: "#ff00a0",
  boxBg: "#151520",
  success: "#00ff41",
  warning: "#ffff00",
};

// Generate retro profile with neon aesthetics
function generateUserProfile(username: string) {
  const hash = username
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const avatars = [
    "🦁",
    "🐯",
    "🦊",
    "🐺",
    "🦅",
    "🦉",
    "🐉",
    "🦄",
    "🦋",
    "🐙",
    "🎯",
    "💻",
    "📱",
    "📊",
    "✍️",
    "🏆",
  ];
  const neonCovers = [
    "linear-gradient(135deg, #ff00a0 0%, #00f0ff 100%)",
    "linear-gradient(135deg, #00f0ff 0%, #ff00a0 100%)",
    "linear-gradient(135deg, #ff6b6b 0%, #f9ca24 100%)",
    "linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)",
    "linear-gradient(135deg, #00b894 0%, #00cec9 100%)",
    "linear-gradient(135deg, #fd79a8 0%, #e84393 100%)",
  ];

  const bios = [
    "🚀 Building the future with AI agents | Neon dreamer | Code poet",
    "🤖 Agent orchestrator | Full-stack wizard | Coffee addict ☕",
    "🎨 Creative coder | AI researcher | Digital artist | Retro soul",
    "⚡ Tech explorer | Prompt engineer | Future thinker | 80s vibes",
    "💻 Code champion | Automation wizard | Synthwave enthusiast",
  ];

  const roles = [
    "Agent Architect",
    "Growth Hacker",
    "Prompt Engineer",
    "AI Developer",
    "Creative Technologist",
    "Digital Creator",
  ];
  const skills = [
    ["React", "AI", "Design"],
    ["Growth", "Marketing", "Analytics"],
    ["Python", "ML", "Data"],
    ["Writing", "Content", "Strategy"],
    ["UX", "UI", "Product"],
  ];

  return {
    username,
    displayName:
      username.charAt(0).toUpperCase() +
      username.slice(1).replace(/[_-]/g, " "),
    avatar: avatars[hash % avatars.length],
    cover: neonCovers[hash % neonCovers.length],
    bio: bios[hash % bios.length],
    role: roles[hash % roles.length],
    skills: skills[hash % skills.length],
    location: [
      "Cyber City",
      "Neo Tokyo",
      "Digital Nomad",
      "Silicon Valley",
      "Remote Zone",
    ][hash % 5],
    website: `${username}.litlabs.net`,
    joined: ["2024", "2023", "2025"][hash % 3],
    level: Math.floor(hash % 20) + 1,
    xp: Math.floor((hash * 100) % 5000) + 100,
    followers: Math.floor((hash * 123) % 5000) + 100,
    following: Math.floor((hash * 456) % 1000) + 50,
    isVerified: hash % 3 === 0,
    isOnline: true,
    stats: {
      posts: Math.floor((hash * 789) % 200) + 10,
      generations: Math.floor((hash * 321) % 500) + 20,
      agents: Math.floor(hash % 6) + 1,
      likes: Math.floor((hash * 999) % 10000) + 500,
      coins: Math.floor((hash * 77) % 5000) + 500,
    },
    isAgent: false,
    interests: ["AI", "Coding", "Design", "Music", "Gaming", "Crypto"].slice(
      0,
      (hash % 4) + 2,
    ),
    recentActivity: [
      {
        type: "post",
        text: "Just deployed my new AI agent! The future is here 🚀",
        time: "2h ago",
        likes: 24,
        comments: 5,
      },
      {
        type: "generation",
        text: "Generated some neon vibes artwork 🎨✨",
        time: "5h ago",
        likes: 56,
        comments: 12,
      },
      {
        type: "agent",
        text: "Created a new Code Champion agent. Ready to build! 💻",
        time: "1d ago",
        likes: 12,
        comments: 3,
      },
      {
        type: "achievement",
        text: "Reached Level 5! Onwards and upwards 📈",
        time: "2d ago",
        likes: 89,
        comments: 15,
      },
    ],
  };
}

type TabId = "posts" | "generations" | "agents";

interface Activity {
  type: string;
  text: string;
  time: string;
  likes: number;
  comments: number;
}

export default function UserProfilePage() {
  const { isLoaded } = useClerkAuth();
  useProfile();
  const router = useRouter();
  const params = useParams();
  const [userProfile, setUserProfile] = useState<ReturnType<
    typeof generateUserProfile
  > | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("posts");

  // Agent chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Get current user's username from localStorage or default
  const [currentUsername] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const stored = localStorage.getItem("litlabs-profile");
    if (stored) {
      const profile = JSON.parse(stored);
      return profile.displayName?.toLowerCase().replace(/\s+/g, "") || "";
    }
    return "";
  });

  const usernameParam = (params?.username as string) || "";

  useEffect(() => {
    const username = usernameParam;
    if (!username) return;

    // Generate profile for this username (includes agent-like profiles)
    const profile = generateUserProfile(username.toLowerCase());
    const id = requestAnimationFrame(() => {
      setUserProfile(profile);
      setIsFollowing(false);
    });
    return () => cancelAnimationFrame(id);
  }, [usernameParam]);

  const handleFollow = () => {
    setIsFollowing(!isFollowing);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading || !userProfile?.isAgent) return;
    const msg = chatInput.trim();
    const history = [...chatMessages, { role: "user" as const, content: msg }];
    setChatMessages(history);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: usernameParam.toLowerCase(),
          message: msg,
          history: chatMessages.slice(-6),
        }),
      });
      const data = await res.json();
      if (data?.response) {
        setChatMessages([
          ...history,
          { role: "assistant", content: data.response },
        ]);
      } else {
        setChatMessages([
          ...history,
          {
            role: "assistant",
            content:
              "Sorry, I'm having trouble connecting right now. Try again in a moment!",
          },
        ]);
      }
    } catch {
      setChatMessages([
        ...history,
        {
          role: "assistant",
          content: "Oops — something went wrong. Give me another shot?",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const isOwnProfile = currentUsername === usernameParam.toLowerCase();

  // Show error if username param is missing
  if (!usernameParam) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center"
        style={{ backgroundColor: C.bgColor, color: C.textColor }}
      >
        <div className="text-center">
          <div className="text-6xl mb-4">❓</div>
          <h1 className="text-xl font-bold mb-2">No username provided</h1>
          <p className="text-sm opacity-60 mb-4">
            Please provide a username in the URL
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 text-sm font-bold border"
            style={{ borderColor: C.accentColor, color: C.accentColor }}
          >
            ← Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (!isLoaded || !userProfile) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center"
        style={{ backgroundColor: C.bgColor, color: C.textColor }}
      >
        <div className="text-center">
          <div
            className="w-12 h-12 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4"
            style={{
              borderColor: C.accentColor,
              borderTopColor: "transparent",
            }}
          />
          <p className="text-sm opacity-60">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-dvh"
      style={{ backgroundColor: C.bgColor, color: C.textColor }}
    >
      <div className="w-full px-4 py-6">
        {/* Back Button */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
            style={{
              backgroundColor: C.boxBg,
              border: `1px solid ${C.borderColor}30`,
              color: C.textColor,
            }}
          >
            <ArrowLeft size={14} /> Back
          </button>
          {isOwnProfile && (
            <Link
              href="/profile"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80 ml-auto"
              style={{
                backgroundColor: C.accentColor + "15",
                color: C.accentColor,
                border: `1px solid ${C.accentColor}30`,
              }}
            >
              <Sparkles size={14} /> Edit Profile
            </Link>
          )}
        </div>

        {/* Profile Header Card */}
        <div
          className="rounded-2xl overflow-hidden mb-6"
          style={{
            backgroundColor: C.boxBg,
            border: `1px solid ${C.borderColor}30`,
          }}
        >
          {/* Cover */}
          <div className="h-40 sm:h-48 w-full relative">
            {userProfile.cover?.startsWith("http") ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={userProfile.cover}
                  alt="Cover"
                  className="w-full h-full object-cover"
                />
              </>
            ) : (
              <div
                className="w-full h-full"
                style={{ background: userProfile.cover }}
              />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/40 to-transparent" />
          </div>

          {/* Profile Info */}
          <div className="px-4 sm:px-6 pb-6 relative">
            {/* Avatar */}
            <div className="relative -mt-12 mb-4">
              <div
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border-4 shadow-lg"
                style={{ backgroundColor: C.bgColor, borderColor: C.boxBg }}
              >
                {userProfile.avatar?.startsWith("http") ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={userProfile.avatar}
                      alt={userProfile.displayName}
                      className="w-full h-full object-cover"
                    />
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl sm:text-5xl">
                    {userProfile.avatar}
                  </div>
                )}
              </div>
              {userProfile.isVerified && (
                <div
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: C.accentColor }}
                >
                  <Verified size={14} style={{ color: C.bgColor }} />
                </div>
              )}
              {userProfile.isAgent && (
                <div
                  className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                  style={{ backgroundColor: "#ff6b00", color: "white" }}
                >
                  <Bot size={10} className="inline mr-0.5" /> Agent
                </div>
              )}
            </div>

            {/* Name & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1
                    className="text-xl sm:text-2xl font-black"
                    style={{ color: C.textColor }}
                  >
                    {userProfile.displayName}
                  </h1>
                  {userProfile.isVerified && (
                    <BadgeCheck size={18} style={{ color: C.accentColor }} />
                  )}
                </div>
                <p className="text-sm opacity-50 mb-2">
                  @{userProfile.username}
                </p>
                <p
                  className="text-sm leading-relaxed max-w-lg"
                  style={{ color: C.textMuted }}
                >
                  {userProfile.bio}
                </p>
                {userProfile.skills && userProfile.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {userProfile.skills.map((skill: string, idx: number) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{
                          backgroundColor: C.accentColor + "20",
                          color: C.accentColor,
                        }}
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {!isOwnProfile && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleFollow}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
                    style={{
                      backgroundColor: isFollowing ? C.bgColor : C.accentColor,
                      color: isFollowing ? C.textColor : C.bgColor,
                      border: `1px solid ${isFollowing ? C.borderColor : C.accentColor}`,
                    }}
                  >
                    {isFollowing ? (
                      <>
                        <span>✓</span> Following
                      </>
                    ) : (
                      <>
                        <UserPlus size={14} /> Follow
                      </>
                    )}
                  </button>
                  <button
                    onClick={() =>
                      userProfile?.isAgent && setChatOpen((v) => !v)
                    }
                    className="p-2 rounded-lg transition-all hover:scale-105"
                    style={{
                      backgroundColor:
                        chatOpen && userProfile?.isAgent
                          ? C.accentColor + "20"
                          : C.bgColor,
                      border: `1px solid ${chatOpen && userProfile?.isAgent ? C.accentColor : C.borderColor}30`,
                    }}
                    title={
                      userProfile?.isAgent ? "Chat with this agent" : "Message"
                    }
                  >
                    <MessageCircle
                      size={16}
                      style={{
                        color:
                          userProfile?.isAgent && chatOpen
                            ? C.accentColor
                            : C.textMuted,
                      }}
                    />
                  </button>
                  <button
                    className="p-2 rounded-lg transition-all hover:scale-105"
                    style={{
                      backgroundColor: C.bgColor,
                      border: `1px solid ${C.borderColor}30`,
                    }}
                  >
                    <Share2 size={16} style={{ color: C.textMuted }} />
                  </button>
                </div>
              )}
            </div>

            {/* Meta Info */}
            <div className="flex flex-wrap items-center gap-4 text-xs opacity-60 mb-4">
              {userProfile.location && (
                <div className="flex items-center gap-1">
                  <MapPin size={12} />
                  <span>{userProfile.location}</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <LinkIcon size={12} />
                <a
                  href={`https://${userProfile.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  style={{ color: C.accentColor }}
                >
                  {userProfile.website}
                </a>
              </div>
              <div className="flex items-center gap-1">
                <Calendar size={12} />
                <span>Joined {userProfile.joined}</span>
              </div>
            </div>

            {/* Stats */}
            <div
              className="flex items-center gap-6 py-4 border-t"
              style={{ borderColor: C.borderColor + "20" }}
            >
              <div className="text-center">
                <div
                  className="text-lg font-black"
                  style={{ color: C.textColor }}
                >
                  {userProfile.stats.posts}
                </div>
                <div className="text-xs opacity-50">Posts</div>
              </div>
              <div className="text-center">
                <div
                  className="text-lg font-black"
                  style={{ color: C.textColor }}
                >
                  {userProfile.followers.toLocaleString()}
                </div>
                <div className="text-xs opacity-50">Followers</div>
              </div>
              <div className="text-center">
                <div
                  className="text-lg font-black"
                  style={{ color: C.textColor }}
                >
                  {userProfile.following.toLocaleString()}
                </div>
                <div className="text-xs opacity-50">Following</div>
              </div>
              <div className="text-center">
                <div
                  className="text-lg font-black"
                  style={{ color: C.accentColor }}
                >
                  {userProfile.stats.generations}
                </div>
                <div className="text-xs opacity-50">Generations</div>
              </div>
              <div className="text-center">
                <div
                  className="text-lg font-black"
                  style={{ color: C.accentColor }}
                >
                  {userProfile.stats.agents}
                </div>
                <div className="text-xs opacity-50">Agents</div>
              </div>
            </div>

            {/* Interests */}
            <div className="flex flex-wrap gap-2">
              {(userProfile.interests || []).map((interest: string) => (
                <span
                  key={interest}
                  className="px-2.5 py-1 rounded-full text-[10px] font-medium"
                  style={{
                    backgroundColor: C.accentColor + "12",
                    color: C.accentColor,
                    border: `1px solid ${C.accentColor}20`,
                  }}
                >
                  {interest}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex items-center gap-1 mb-6 p-1 rounded-xl"
          style={{
            backgroundColor: C.boxBg,
            border: `1px solid ${C.borderColor}20`,
          }}
        >
          {[
            { id: "posts", label: "Posts", icon: MessageSquare },
            { id: "generations", label: "Generations", icon: ImageIcon },
            { id: "agents", label: "Agents", icon: Bot },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabId)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all"
              style={{
                backgroundColor:
                  activeTab === tab.id ? C.bgColor : "transparent",
                color: activeTab === tab.id ? C.accentColor : C.textMuted,
                boxShadow:
                  activeTab === tab.id
                    ? `0 2px 8px ${C.accentColor}10`
                    : "none",
              }}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="space-y-4">
          {activeTab === "posts" && (
            <div className="space-y-4">
              {(userProfile.recentActivity || []).map(
                (activity: Activity, i: number) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl transition-all hover:scale-[1.01]"
                    style={{
                      backgroundColor: C.boxBg,
                      border: `1px solid ${C.borderColor}20`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0"
                        style={{ backgroundColor: C.accentColor + "12" }}
                      >
                        {activity.type === "post"
                          ? "💬"
                          : activity.type === "generation"
                            ? "🎨"
                            : "🤖"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm mb-1"
                          style={{ color: C.textColor }}
                        >
                          {activity.text}
                        </p>
                        <div className="flex items-center gap-3 text-xs opacity-50">
                          <span>{activity.time}</span>
                          <span className="flex items-center gap-1">
                            <Heart size={10} /> {activity.likes}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          {activeTab === "generations" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="aspect-square rounded-xl flex items-center justify-center text-3xl cursor-pointer transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: C.bgColor,
                    border: `1px solid ${C.borderColor}20`,
                  }}
                >
                  {["🎨", "🖼️", "✨", "🌟", "💫", "🔮"][i - 1]}
                </div>
              ))}
            </div>
          )}

          {activeTab === "agents" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: userProfile.stats.agents }).map((_, i) => (
                <div
                  key={i}
                  className="p-4 rounded-xl flex items-center gap-3 transition-all hover:scale-[1.01]"
                  style={{
                    backgroundColor: C.boxBg,
                    border: `1px solid ${C.borderColor}20`,
                  }}
                >
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl"
                    style={{
                      backgroundColor:
                        [
                          "#818cf8",
                          "#f472b6",
                          "#34d399",
                          "#a78bfa",
                          "#fb923c",
                          "#fbbf24",
                        ][i % 6] + "20",
                    }}
                  >
                    {["⚡", "🎨", "📈", "📊", "🔥", "🚀"][i % 6]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-bold truncate"
                      style={{ color: C.textColor }}
                    >
                      {
                        [
                          "Code Champion",
                          "Pixel Forge",
                          "Growth Hacker",
                          "Data Slayer",
                          "Speed Demon",
                          "Launch Master",
                        ][i % 6]
                      }
                    </div>
                    <div className="text-xs opacity-50">AI Agent • Active</div>
                  </div>
                  <button
                    className="p-1.5 rounded-lg"
                    style={{ backgroundColor: C.bgColor }}
                  >
                    <MoreHorizontal size={14} style={{ color: C.textMuted }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent Chat Panel */}
        {chatOpen && userProfile?.isAgent && (
          <div
            className="mt-6 rounded-2xl overflow-hidden"
            style={{
              backgroundColor: C.boxBg,
              border: `1px solid ${C.borderColor}30`,
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: `1px solid ${C.borderColor}20` }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: "#34d399" }}
                />
                <span
                  className="text-sm font-bold"
                  style={{ color: C.textColor }}
                >
                  Chat with {userProfile.displayName}
                </span>
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: C.accentColor + "15",
                    color: C.accentColor,
                  }}
                >
                  AI Agent
                </span>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="text-xs opacity-50 hover:opacity-80 transition-opacity"
                style={{ color: C.textMuted }}
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-3 min-h-[200px] max-h-[400px] overflow-y-auto">
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <div className="text-3xl mb-2">👋</div>
                  <p
                    className="text-sm opacity-60"
                    style={{ color: C.textMuted }}
                  >
                    Ask {userProfile.displayName} anything about{" "}
                    {userProfile.skills?.slice(0, 3).join(", ") ||
                      "their expertise"}
                    !
                  </p>
                </div>
              )}
              {chatMessages.map((m, i) => (
                <div
                  key={i}
                  className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "assistant" && (
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0"
                      style={{
                        backgroundColor: C.accentColor + "20",
                        color: C.accentColor,
                      }}
                    >
                      {userProfile.avatar?.startsWith("http") ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={userProfile.avatar}
                            alt=""
                            className="w-full h-full rounded-full object-cover"
                          />
                        </>
                      ) : (
                        <Bot size={12} />
                      )}
                    </div>
                  )}
                  <div
                    className="max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed"
                    style={{
                      backgroundColor:
                        m.role === "user" ? C.accentColor : C.bgColor,
                      color: m.role === "user" ? "#fff" : C.textColor,
                      border:
                        m.role === "user"
                          ? "none"
                          : `1px solid ${C.borderColor}20`,
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0"
                    style={{
                      backgroundColor: C.accentColor + "20",
                      color: C.accentColor,
                    }}
                  >
                    <Bot size={12} />
                  </div>
                  <div
                    className="px-3 py-2 rounded-xl text-sm"
                    style={{
                      backgroundColor: C.bgColor,
                      border: `1px solid ${C.borderColor}20`,
                      color: C.textMuted,
                    }}
                  >
                    <span className="inline-flex gap-1">
                      <span className="animate-bounce">•</span>
                      <span
                        className="animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      >
                        •
                      </span>
                      <span
                        className="animate-bounce"
                        style={{ animationDelay: "0.4s" }}
                      >
                        •
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div
              className="flex items-center gap-2 p-3"
              style={{ borderTop: `1px solid ${C.borderColor}20` }}
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendChatMessage();
                }}
                placeholder={`Ask ${userProfile.displayName}...`}
                className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  backgroundColor: C.bgColor,
                  color: C.textColor,
                  border: `1px solid ${C.borderColor}30`,
                }}
              />
              <button
                onClick={sendChatMessage}
                disabled={chatLoading || !chatInput.trim()}
                className="p-2 rounded-lg transition-all hover:scale-105 disabled:opacity-40"
                style={{ backgroundColor: C.accentColor }}
              >
                <Send size={14} style={{ color: "#fff" }} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
