"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { getAgentProfile, AGENT_PROFILES } from "@/lib/agent-profiles";
import {
  ArrowLeft, MessageCircle, UserPlus, Share2, MapPin, Link as LinkIcon,
  Calendar, Sparkles, Zap, Bot, Image as ImageIcon, Heart, MessageSquare,
  MoreHorizontal, Verified, BadgeCheck, Cpu, Globe, Award, Send
} from "lucide-react";

// Helper to format timestamps
function formatTimeAgo(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

// Generate consistent mock data for any username
function generateUserProfile(username: string) {
  const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const avatars = ["🦁", "🐯", "🦊", "🐺", "🦅", "🦉", "🐉", "🦄", "🦋", "🐙", "🦑", "🦖"];
  const covers = [
    "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
    "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
    "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
    "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
    "linear-gradient(135deg, #30cfd0 0%, #330867 100%)",
  ];
  const bios = [
    "Building the future with AI agents 🚀 | Full-stack dev | Coffee addict ☕",
    "AI researcher • Creative coder • Digital artist 🎨",
    "Agent orchestrator 🤖 | Building autonomous systems | Open source enthusiast",
    "Tech explorer • Prompt engineer • Future thinker 🔮",
    "Code poet • AI whisperer • Automation wizard ⚡",
  ];
  const locations = ["San Francisco, CA", "New York, NY", "London, UK", "Tokyo, JP", "Remote 🌍", "Austin, TX"];
  const websites = ["github.com", "twitter.com", "portfolio.me", "dev.to", "li Treelabstudios.com"];
  
  const joinedDates = ["2024", "2023", "2022", "2025"];
  
  return {
    username,
    displayName: username.charAt(0).toUpperCase() + username.slice(1),
    avatar: avatars[hash % avatars.length],
    cover: covers[hash % covers.length],
    bio: bios[hash % bios.length],
    location: locations[hash % locations.length],
    website: websites[hash % websites.length],
    joined: joinedDates[hash % joinedDates.length],
    followers: Math.floor((hash * 123) % 5000) + 100,
    following: Math.floor((hash * 456) % 1000) + 50,
    isVerified: hash % 3 === 0,
    isFollowing: false,
    stats: {
      posts: Math.floor((hash * 789) % 200) + 10,
      generations: Math.floor((hash * 321) % 500) + 20,
      agents: Math.floor((hash % 8)) + 1,
      likes: Math.floor((hash * 999) % 10000) + 500,
    },
    interests: ["AI", "Coding", "Design", "Music", "Gaming"].slice(0, (hash % 5) + 1),
    recentActivity: [
      { type: "post", text: "Just deployed my new AI agent! 🚀", time: "2h ago", likes: 24 },
      { type: "generation", text: "Generated album art for my new EP", time: "5h ago", likes: 56 },
      { type: "agent", text: "Created a Code Champion agent", time: "1d ago", likes: 12 },
    ],
  };
}

export default function UserProfilePage() {
  const { isLoaded, isSignedIn, userId } = useClerkAuth();
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  const params = useParams();
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [activeTab, setActiveTab] = useState<"posts" | "generations" | "agents">("posts");

  // Agent chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{role: "user" | "assistant"; content: string}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Get current user's username from localStorage or default
  const [currentUsername, setCurrentUsername] = useState<string>("");

  const usernameParam = (params?.username as string) || "";
  
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('litlabs-profile') : null;
    if (stored) {
      const profile = JSON.parse(stored);
      setCurrentUsername(profile.displayName?.toLowerCase().replace(/\s+/g, '') || "");
    }
  }, []);

  useEffect(() => {
    const username = usernameParam;
    if (!username) return;
    
    // First check if this is an agent profile
    const agentProfile = getAgentProfile(username);
    
    if (agentProfile) {
      // Convert agent profile to display format
      setUserProfile({
        ...agentProfile,
        isAgent: true,
        isVerified: true,
        isFollowing: false,
        joined: agentProfile.createdAt,
        followers: agentProfile.stats.followers,
        following: agentProfile.stats.following,
        cover: agentProfile.coverImage,
        stats: {
          posts: agentProfile.stats.posts,
          generations: Math.floor(agentProfile.stats.posts * 0.6),
          agents: Math.floor(Math.random() * 3) + 1,
          likes: agentProfile.stats.credits,
        },
        recentActivity: agentProfile.recentPosts.map(p => ({
          type: "post",
          text: p.content.slice(0, 80) + (p.content.length > 80 ? "..." : ""),
          time: formatTimeAgo(p.timestamp),
          likes: p.likes,
        })),
      });
      setIsFollowing(false);
    } else {
      // Generate profile for this username
      const profile = generateUserProfile(username.toLowerCase());
      setUserProfile(profile);
      setIsFollowing(profile.isFollowing);
    }
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
        setChatMessages([...history, { role: "assistant", content: data.response }]);
      } else {
        setChatMessages([...history, { role: "assistant", content: "Sorry, I'm having trouble connecting right now. Try again in a moment!" }]);
      }
    } catch {
      setChatMessages([...history, { role: "assistant", content: "Oops — something went wrong. Give me another shot?" }]);
    } finally {
      setChatLoading(false);
    }
  };

  const isOwnProfile = currentUsername === usernameParam.toLowerCase();

  // Show error if username param is missing
  if (!usernameParam) {
    return (
      <PageShell title="Profile Not Found">
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">❓</div>
            <h1 className="text-xl font-bold mb-2">No username provided</h1>
            <p className="text-sm opacity-60 mb-4">Please provide a username in the URL</p>
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ backgroundColor: T?.accentColor, color: '#fff' }}
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  if (!isLoaded || !userProfile) {
    return (
      <PageShell title="Profile">
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4" style={{ borderColor: T?.accentColor, borderTopColor: 'transparent' }} />
            <p className="text-sm opacity-60">Loading profile...</p>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={`${userProfile.displayName} (@${userProfile.username})`}>
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
            style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}30`, color: T.textColor }}
          >
            <ArrowLeft size={14} /> Back
          </button>
          {isOwnProfile && (
            <Link
              href="/profile"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80 ml-auto"
              style={{ backgroundColor: T.accentColor + '15', color: T.accentColor, border: `1px solid ${T.accentColor}30` }}
            >
              <Sparkles size={14} /> Edit Profile
            </Link>
          )}
        </div>

        {/* Profile Header Card */}
        <div className="rounded-2xl overflow-hidden mb-6" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}30` }}>
          {/* Cover */}
          <div className="h-40 sm:h-48 w-full relative">
            {userProfile.cover?.startsWith('http') ? (
              <img 
                src={userProfile.cover} 
                alt="Cover" 
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full" style={{ background: userProfile.cover }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </div>

          {/* Profile Info */}
          <div className="px-4 sm:px-6 pb-6 relative">
            {/* Avatar */}
            <div className="relative -mt-12 mb-4">
              <div
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border-4 shadow-lg"
                style={{ backgroundColor: T.bgColor, borderColor: T.boxBg }}
              >
                {userProfile.avatar?.startsWith('http') ? (
                  <img 
                    src={userProfile.avatar} 
                    alt={userProfile.displayName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl sm:text-5xl">
                    {userProfile.avatar}
                  </div>
                )}
              </div>
              {userProfile.isVerified && (
                <div
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: T.accentColor }}
                >
                  <Verified size={14} style={{ color: T.bgColor }} />
                </div>
              )}
              {userProfile.isAgent && (
                <div
                  className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                  style={{ backgroundColor: '#ff6b00', color: 'white' }}
                >
                  <Bot size={10} className="inline mr-0.5" /> Agent
                </div>
              )}
            </div>

            {/* Name & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-xl sm:text-2xl font-black" style={{ color: T.textColor }}>
                    {userProfile.displayName}
                  </h1>
                  {userProfile.isVerified && (
                    <BadgeCheck size={18} style={{ color: T.accentColor }} />
                  )}
                </div>
                <p className="text-sm opacity-50 mb-2">@{userProfile.username}</p>
                <p className="text-sm leading-relaxed max-w-lg" style={{ color: T.textMuted }}>
                  {userProfile.bio}
                </p>
                {userProfile.skills && userProfile.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {userProfile.skills.map((skill: string, idx: number) => (
                      <span 
                        key={idx}
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{ backgroundColor: T.accentColor + '20', color: T.accentColor }}
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
                      backgroundColor: isFollowing ? T.bgColor : T.accentColor,
                      color: isFollowing ? T.textColor : T.bgColor,
                      border: `1px solid ${isFollowing ? T.borderColor : T.accentColor}`,
                    }}
                  >
                    {isFollowing ? (
                      <><span>✓</span> Following</>
                    ) : (
                      <><UserPlus size={14} /> Follow</>
                    )}
                  </button>
                  <button
                    onClick={() => userProfile?.isAgent && setChatOpen(v => !v)}
                    className="p-2 rounded-lg transition-all hover:scale-105"
                    style={{
                      backgroundColor: chatOpen && userProfile?.isAgent ? T.accentColor + '20' : T.bgColor,
                      border: `1px solid ${chatOpen && userProfile?.isAgent ? T.accentColor : T.borderColor}30`,
                    }}
                    title={userProfile?.isAgent ? "Chat with this agent" : "Message"}
                  >
                    <MessageCircle size={16} style={{ color: userProfile?.isAgent && chatOpen ? T.accentColor : T.textMuted }} />
                  </button>
                  <button
                    className="p-2 rounded-lg transition-all hover:scale-105"
                    style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}30` }}
                  >
                    <Share2 size={16} style={{ color: T.textMuted }} />
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
                <a href={`https://${userProfile.website}`} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: T.accentColor }}>
                  {userProfile.website}
                </a>
              </div>
              <div className="flex items-center gap-1">
                <Calendar size={12} />
                <span>Joined {userProfile.joined}</span>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-6 py-4 border-t" style={{ borderColor: T.borderColor + '20' }}>
              <div className="text-center">
                <div className="text-lg font-black" style={{ color: T.textColor }}>{userProfile.stats.posts}</div>
                <div className="text-xs opacity-50">Posts</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black" style={{ color: T.textColor }}>{userProfile.followers.toLocaleString()}</div>
                <div className="text-xs opacity-50">Followers</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black" style={{ color: T.textColor }}>{userProfile.following.toLocaleString()}</div>
                <div className="text-xs opacity-50">Following</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black" style={{ color: T.accentColor }}>{userProfile.stats.generations}</div>
                <div className="text-xs opacity-50">Generations</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black" style={{ color: T.accentColor }}>{userProfile.stats.agents}</div>
                <div className="text-xs opacity-50">Agents</div>
              </div>
            </div>

            {/* Interests */}
            <div className="flex flex-wrap gap-2">
              {userProfile.interests.map((interest: string) => (
                <span
                  key={interest}
                  className="px-2.5 py-1 rounded-full text-[10px] font-medium"
                  style={{ backgroundColor: T.accentColor + '12', color: T.accentColor, border: `1px solid ${T.accentColor}20` }}
                >
                  {interest}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 p-1 rounded-xl" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20` }}>
          {[
            { id: "posts", label: "Posts", icon: MessageSquare },
            { id: "generations", label: "Generations", icon: ImageIcon },
            { id: "agents", label: "Agents", icon: Bot },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all"
              style={{
                backgroundColor: activeTab === tab.id ? T.bgColor : 'transparent',
                color: activeTab === tab.id ? T.accentColor : T.textMuted,
                boxShadow: activeTab === tab.id ? `0 2px 8px ${T.accentColor}10` : 'none',
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
              {userProfile.recentActivity.map((activity: any, i: number) => (
                <div
                  key={i}
                  className="p-4 rounded-xl transition-all hover:scale-[1.01]"
                  style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20` }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{ backgroundColor: T.accentColor + '12' }}
                    >
                      {activity.type === "post" ? "💬" : activity.type === "generation" ? "🎨" : "🤖"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm mb-1" style={{ color: T.textColor }}>{activity.text}</p>
                      <div className="flex items-center gap-3 text-xs opacity-50">
                        <span>{activity.time}</span>
                        <span className="flex items-center gap-1">
                          <Heart size={10} /> {activity.likes}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "generations" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="aspect-square rounded-xl flex items-center justify-center text-3xl cursor-pointer transition-all hover:scale-[1.02]"
                  style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}20` }}
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
                  style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20` }}
                >
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl"
                    style={{ backgroundColor: ["#818cf8", "#f472b6", "#34d399", "#a78bfa", "#fb923c", "#fbbf24"][i % 6] + '20' }}
                  >
                    {["⚡", "🎨", "📈", "📊", "🔥", "🚀"][i % 6]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate" style={{ color: T.textColor }}>
                      {["Code Champion", "Pixel Forge", "Growth Hacker", "Data Slayer", "Speed Demon", "Launch Master"][i % 6]}
                    </div>
                    <div className="text-xs opacity-50">AI Agent • Active</div>
                  </div>
                  <button className="p-1.5 rounded-lg" style={{ backgroundColor: T.bgColor }}>
                    <MoreHorizontal size={14} style={{ color: T.textMuted }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent Chat Panel */}
        {chatOpen && userProfile?.isAgent && (
          <div className="mt-6 rounded-2xl overflow-hidden" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}30` }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${T.borderColor}20` }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#34d399' }} />
                <span className="text-sm font-bold" style={{ color: T.textColor }}>Chat with {userProfile.displayName}</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: T.accentColor + '15', color: T.accentColor }}>AI Agent</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-xs opacity-50 hover:opacity-80 transition-opacity" style={{ color: T.textMuted }}>Close</button>
            </div>

            <div className="p-4 space-y-3 min-h-[200px] max-h-[400px] overflow-y-auto">
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <div className="text-3xl mb-2">👋</div>
                  <p className="text-sm opacity-60" style={{ color: T.textMuted }}>
                    Ask {userProfile.displayName} anything about {userProfile.skills?.slice(0, 3).join(', ') || 'their expertise'}!
                  </p>
                </div>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0" style={{ backgroundColor: T.accentColor + '20', color: T.accentColor }}>
                      {userProfile.avatar?.startsWith('http') ? (
                        <img src={userProfile.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        <Bot size={12} />
                      )}
                    </div>
                  )}
                  <div
                    className="max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed"
                    style={{
                      backgroundColor: m.role === 'user' ? T.accentColor : T.bgColor,
                      color: m.role === 'user' ? '#fff' : T.textColor,
                      border: m.role === 'user' ? 'none' : `1px solid ${T.borderColor}20`,
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0" style={{ backgroundColor: T.accentColor + '20', color: T.accentColor }}>
                    <Bot size={12} />
                  </div>
                  <div className="px-3 py-2 rounded-xl text-sm" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}20`, color: T.textMuted }}>
                    <span className="inline-flex gap-1">
                      <span className="animate-bounce">•</span>
                      <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>•</span>
                      <span className="animate-bounce" style={{ animationDelay: '0.4s' }}>•</span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 p-3" style={{ borderTop: `1px solid ${T.borderColor}20` }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendChatMessage(); }}
                placeholder={`Ask ${userProfile.displayName}...`}
                className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  backgroundColor: T.bgColor,
                  color: T.textColor,
                  border: `1px solid ${T.borderColor}30`,
                }}
              />
              <button
                onClick={sendChatMessage}
                disabled={chatLoading || !chatInput.trim()}
                className="p-2 rounded-lg transition-all hover:scale-105 disabled:opacity-40"
                style={{ backgroundColor: T.accentColor }}
              >
                <Send size={14} style={{ color: '#fff' }} />
              </button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
