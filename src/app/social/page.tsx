"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";

export default function SocialPage() {
  const { resolvedColors } = useTheme();
  const { profile } = useProfile();
  const [newPost, setNewPost] = useState("");
  const [posts, setPosts] = useState([
    {
      id: 1,
      author: "Alex Chen",
      handle: "@alexchen",
      avatar: "AC",
      time: "2h ago",
      content: "Just deployed my first dual-agent setup — Director handles planning, Executor handles the code. Cut my dev workflow time by 60%. The orchestration features on LitLabs are no joke 🚀",
      likes: 24,
      comments: 8,
      shares: 3,
      liked: false,
    },
    {
      id: 2,
      author: "Sarah Kim",
      handle: "@sarahk",
      avatar: "SK",
      time: "4h ago",
      content: "Looking for recommendations: what's the best agent personality for a customer support chatbot? I need something professional but warm. Anyone had success with the Forge Agent builder for this?",
      likes: 15,
      comments: 12,
      shares: 1,
      liked: false,
    },
    {
      id: 3,
      author: "Mike Dev",
      handle: "@mikedev",
      avatar: "MD",
      time: "6h ago",
      content: "The Code Champion agent on LitLabs just refactored my entire Rust backend — memory safety, zero-cost abstractions, the works. Didn't break a single test. I'm genuinely impressed.",
      likes: 42,
      comments: 6,
      shares: 8,
      liked: false,
    },
    {
      id: 4,
      author: "Jordan Taylor",
      handle: "@jtaylor",
      avatar: "JT",
      time: "8h ago",
      content: "Pro tip: Connect your LitLabs agents to Discord for real-time notifications. Set up takes 5 min and now my deployment alerts go straight to our team server. Game changer for remote workflows.",
      likes: 18,
      comments: 4,
      shares: 5,
      liked: false,
    },
    {
      id: 5,
      author: "Lisa Park",
      handle: "@lisapark",
      avatar: "LP",
      time: "12h ago",
      content: "Just hit Level 50 on the Agent Arena 🏆 My trading analysis agent has won 12 straight matches. The competitive aspect of this platform is so addictive. Who wants to challenge me?",
      likes: 31,
      comments: 9,
      shares: 2,
      liked: false,
    },
  ]);

  const stories = [
    { name: "Your Story", avatar: "➕", hasStory: false },
    { name: "Alex Chen", avatar: "AC", hasStory: true },
    { name: "Sarah Kim", avatar: "SK", hasStory: true },
    { name: "Mike Dev", avatar: "MD", hasStory: true },
    { name: "Jordan T", avatar: "JT", hasStory: true },
    { name: "Lisa Park", avatar: "LP", hasStory: true },
    { name: "Code Queen", avatar: "CQ", hasStory: true },
  ];

  const suggestedAgents = [
    { name: "Code Champion", handle: "@codechamp", desc: "Build", icon: "💻" },
    { name: "Data Slayer", handle: "@dataslayer", desc: "Analyze", icon: "📊" },
    { name: "Social Bot", handle: "@socialbot", desc: "Engage", icon: "🤖" },
  ];

  const trendingTags = [
    { tag: "#AIAgents", count: "3.1K posts" },
    { tag: "#BotForge", count: "2.4K posts" },
    { tag: "#NoCodeAI", count: "742 posts" },
    { tag: "#AgentArena", count: "1.8K posts" },
    { tag: "#LitLabs", count: "956 posts" },
  ];

  const handleLike = (postId: number) => {
    setPosts(posts.map(post => 
      post.id === postId 
        ? { ...post, liked: !post.liked, likes: post.liked ? post.likes - 1 : post.likes + 1 }
        : post
    ));
  };

  const handlePost = () => {
    if (newPost.trim()) {
      setPosts([{
        id: Date.now(),
        author: profile.displayName || "You",
        handle: "@" + (profile.username || "you"),
        avatar: profile.displayName?.substring(0, 2).toUpperCase() || "YO",
        time: "now",
        content: newPost,
        likes: 0,
        comments: 0,
        shares: 0,
        liked: false,
      }, ...posts]);
      setNewPost("");
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.textColor }}>
      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid md:grid-cols-12 gap-6">
          {/* Left Sidebar - Stories */}
          <div className="md:col-span-3">
            <div className="border-2 p-4 sticky top-24" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <h3 className="font-bold mb-3" style={{ color: resolvedColors.headerColor }}>Stories</h3>
              <div className="space-y-3">
                {stories.map((story, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div 
                      className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold border-2"
                      style={{ 
                        backgroundColor: resolvedColors.headerColor, 
                        borderColor: story.hasStory ? resolvedColors.accentColor : resolvedColors.borderColor,
                        color: "white"
                      }}
                    >
                      {story.avatar}
                    </div>
                    <span className="text-sm" style={{ color: resolvedColors.linkColor }}>{story.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Center - Feed */}
          <div className="md:col-span-6 space-y-4">
            {/* Create Post */}
            <div className="border-2 p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <div className="flex gap-3">
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ backgroundColor: resolvedColors.headerColor, color: "white" }}
                >
                  {profile.displayName?.substring(0, 2).toUpperCase() || "YO"}
                </div>
                <div className="flex-1">
                  <textarea
                    value={newPost}
                    onChange={(e) => setNewPost(e.target.value)}
                    placeholder={`What's on your mind, ${profile.displayName || "builder"}?`}
                    className="w-full p-3 text-sm border-2 min-h-[60px] resize-none"
                    style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.textColor, borderColor: resolvedColors.borderColor }}
                  />
                  <div className="flex justify-between items-center mt-3">
                    <div className="flex gap-2">
                      <button className="px-3 py-1 text-xs border-2" style={{ borderColor: resolvedColors.borderColor }}>
                        📷 Photo
                      </button>
                      <button className="px-3 py-1 text-xs border-2" style={{ borderColor: resolvedColors.borderColor }}>
                        🎥 Video
                      </button>
                      <button className="px-3 py-1 text-xs border-2" style={{ borderColor: resolvedColors.borderColor }}>
                        🏷 Tag
                      </button>
                    </div>
                    <button 
                      onClick={handlePost}
                      className="px-4 py-1 text-sm font-bold"
                      style={{ backgroundColor: resolvedColors.linkColor, color: "white" }}
                    >
                      Post
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Posts */}
            {posts.map((post) => (
              <div key={post.id} className="border-2" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                {/* Post Header */}
                <div className="p-4 flex items-center gap-3">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ backgroundColor: resolvedColors.headerColor, color: "white" }}
                  >
                    {post.avatar}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm" style={{ color: resolvedColors.headerColor }}>{post.author}</span>
                      <span className="text-xs" style={{ color: resolvedColors.textColor }}>{post.handle}</span>
                      <span className="text-xs" style={{ color: resolvedColors.accentColor }}>· {post.time}</span>
                    </div>
                  </div>
                  <button className="text-xl" style={{ color: resolvedColors.textColor }}>···</button>
                </div>

                {/* Post Content */}
                <div className="px-4 pb-4">
                  <p className="text-sm leading-relaxed" style={{ color: resolvedColors.textColor }}>{post.content}</p>
                </div>

                {/* Post Stats */}
                <div className="px-4 py-2 border-t flex justify-between text-xs" style={{ borderColor: resolvedColors.borderColor }}>
                  <span style={{ color: resolvedColors.accentColor }}>{post.likes} likes</span>
                  <div className="flex gap-4">
                    <span style={{ color: resolvedColors.linkColor }}>{post.comments} comments</span>
                    <span style={{ color: resolvedColors.linkColor }}>{post.shares} shares</span>
                  </div>
                </div>

                {/* Post Actions */}
                <div className="px-4 py-2 border-t flex justify-around" style={{ borderColor: resolvedColors.borderColor }}>
                  <button 
                    onClick={() => handleLike(post.id)}
                    className="flex items-center gap-1 px-4 py-2 text-sm"
                    style={{ color: post.liked ? resolvedColors.linkColor : resolvedColors.textColor }}
                  >
                    {post.liked ? "❤️" : "👍"} Like
                  </button>
                  <button className="flex items-center gap-1 px-4 py-2 text-sm" style={{ color: resolvedColors.textColor }}>
                    💬 Comment
                  </button>
                  <button className="flex items-center gap-1 px-4 py-2 text-sm" style={{ color: resolvedColors.textColor }}>
                    ↗ Share
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Right Sidebar - Trending & Suggestions */}
          <div className="md:col-span-3 space-y-4">
            {/* Trending */}
            <div className="border-2 p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <h3 className="font-bold mb-3" style={{ color: resolvedColors.headerColor }}>📈 Trending</h3>
              <div className="space-y-2">
                {trendingTags.map((t) => (
                  <div key={t.tag} className="flex justify-between text-xs">
                    <span style={{ color: resolvedColors.linkColor }}>{t.tag}</span>
                    <span style={{ color: resolvedColors.textColor }}>{t.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Suggested Agents */}
            <div className="border-2 p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <h3 className="font-bold mb-3" style={{ color: resolvedColors.headerColor }}>🤖 Suggested Agents</h3>
              <div className="space-y-3">
                {suggestedAgents.map((agent) => (
                  <div key={agent.name} className="flex items-center gap-3">
                    <div 
                      className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                      style={{ backgroundColor: resolvedColors.headerColor }}
                    >
                      {agent.icon}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-bold" style={{ color: resolvedColors.headerColor }}>{agent.name}</div>
                      <div className="text-xs" style={{ color: resolvedColors.textColor }}>{agent.handle}</div>
                    </div>
                    <button 
                      className="px-2 py-1 text-xs border-2"
                      style={{ borderColor: resolvedColors.linkColor, color: resolvedColors.linkColor }}
                    >
                      Try
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Links */}
            <div className="border-2 p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <h3 className="font-bold mb-3" style={{ color: resolvedColors.headerColor }}>🔗 Quick Links</h3>
              <div className="space-y-2 text-xs">
                <Link href="/" style={{ color: resolvedColors.linkColor, display: "block" }}>🏠 Home</Link>
                <Link href="/marketplace" style={{ color: resolvedColors.linkColor, display: "block" }}>🏛 Marketplace</Link>
                <Link href="/builder" style={{ color: resolvedColors.linkColor, display: "block" }}>🔧 Builder</Link>
                <Link href="/profile" style={{ color: resolvedColors.linkColor, display: "block" }}>👤 Profile</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}