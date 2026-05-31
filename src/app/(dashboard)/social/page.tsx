"use client";
import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

const STORIES = [
  { name: "Your Story", avatar: "Y", isOwn: true, color: "bg-blue-600" },
  { name: "Code Champ", avatar: "CC", color: "bg-purple-600" },
  { name: "Data Bot", avatar: "DB", color: "bg-green-600" },
  { name: "Social AI", avatar: "SA", color: "bg-pink-600" },
  { name: "Builder_X", avatar: "BX", color: "bg-amber-600" },
];

const POSTS = [
  {
    id: 1,
    author: "Alex Chen",
    handle: "@alexchen",
    time: "2h ago",
    avatar: "AC",
    avatarColor: "bg-blue-600",
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
    time: "4h ago",
    avatar: "SK",
    avatarColor: "bg-purple-600",
    content: "Looking for recommendations: what's the best agent personality for a customer support chatbot? I need something professional but warm. Anyone had success with the Forge Agent builder for this?",
    likes: 15,
    comments: 12,
    shares: 1,
    liked: true,
  },
  {
    id: 3,
    author: "Mike Dev",
    handle: "@mikedev",
    time: "6h ago",
    avatar: "MD",
    avatarColor: "bg-green-600",
    content: "The Code Champion agent on LitLabs just refactored my entire Rust backend — memory safety, zero-cost abstractions, the works. Didn't break a single test. I'm genuinely impressed.",
    image: null,
    likes: 42,
    comments: 6,
    shares: 8,
    liked: false,
  },
  {
    id: 4,
    author: "Jordan Taylor",
    handle: "@jtaylor",
    time: "8h ago",
    avatar: "JT",
    avatarColor: "bg-amber-600",
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
    time: "12h ago",
    avatar: "LP",
    avatarColor: "bg-pink-600",
    content: "Just hit Level 50 on the Agent Arena 🏆 My trading analysis agent has won 12 straight matches. The competitive aspect of this platform is so addictive. Who wants to challenge me?",
    likes: 31,
    comments: 9,
    shares: 2,
    liked: false,
  },
];

const TRENDING = [
  { tag: "#AIAgents", posts: "3.1K" },
  { tag: "#BotForge", posts: "2.4K" },
  { tag: "#NoCodeAI", posts: "742" },
  { tag: "#AgentArena", posts: "1.8K" },
  { tag: "#LitLabs", posts: "956" },
];

const SUGGESTED = [
  { name: "Code Champion", handle: "@codechamp", avatar: "CC", tag: "Build" },
  { name: "Data Slayer", handle: "@dataslayer", avatar: "DS", tag: "Analyze" },
  { name: "Social Bot", handle: "@socialbot", avatar: "SB", tag: "Engage" },
];

export default function SocialPage() {
  const { user } = useAuth();
  const [newPost, setNewPost] = useState("");
  const [posts, setPosts] = useState(POSTS);

  const handleLike = (id: number) => {
    setPosts(posts.map(p =>
      p.id === id
        ? { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 }
        : p
    ));
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* ========== MAIN FEED ========== */}
        <div className="flex-1 min-w-0">
          {/* Stories */}
          <div className="mb-6 flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {STORIES.map((story) => (
              <div key={story.name} className="flex flex-col items-center gap-1.5 flex-shrink-0 cursor-pointer group">
                <div className={`w-16 h-16 rounded-full ${story.isOwn ? "bg-white/10 border-2 border-dashed border-white/20" : story.color} flex items-center justify-center text-white font-bold text-sm group-hover:scale-105 transition-transform`}>
                  {story.isOwn ? "+" : story.avatar}
                </div>
                <span className="text-[10px] text-zinc-400 w-16 text-center truncate">{story.name}</span>
              </div>
            ))}
          </div>

          {/* Compose */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
                {user?.name?.charAt(0) || user?.email?.charAt(0) || "U"}
              </div>
              <span className="text-sm font-medium text-zinc-300">
                {user?.name || user?.email?.split("@")[0] || "User"}
              </span>
            </div>
            <textarea
              className="w-full min-h-[80px] resize-none bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              placeholder="What's on your mind? Share a win, ask a question..."
              value={newPost}
              onChange={e => setNewPost(e.target.value)}
            />
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
              <div className="flex gap-4 text-xs text-zinc-500">
                <span className="cursor-pointer hover:text-white transition-colors">📷 Photo</span>
                <span className="cursor-pointer hover:text-white transition-colors">🏷 Tag</span>
                <span className="cursor-pointer hover:text-white transition-colors">😊 Feeling</span>
              </div>
              <button
                className="rounded-lg bg-blue-600 px-6 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-30"
                disabled={!newPost.trim()}
              >
                Post
              </button>
            </div>
          </div>

          {/* Feed */}
          <div className="space-y-4">
            {posts.map(post => (
              <div key={post.id} className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                {/* Post header */}
                <div className="flex items-center gap-3 p-4 pb-3">
                  <div className={`w-10 h-10 rounded-full ${post.avatarColor} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
                    {post.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white hover:underline cursor-pointer">{post.author}</div>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span>{post.handle}</span>
                      <span>·</span>
                      <span>{post.time}</span>
                    </div>
                  </div>
                  <button className="text-zinc-500 hover:text-white transition-colors text-lg">···</button>
                </div>

                {/* Post content */}
                <div className="px-4 pb-3">
                  <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{post.content}</p>
                </div>

                {/* Post stats */}
                <div className="flex items-center justify-between px-4 py-2 text-xs text-zinc-500 border-t border-white/5">
                  <span>{post.likes.toLocaleString()} likes</span>
                  <div className="flex gap-3">
                    <span>{post.comments} comments</span>
                    <span>{post.shares} shares</span>
                  </div>
                </div>

                {/* Post actions */}
                <div className="flex items-center border-t border-white/10">
                  <button
                    onClick={() => handleLike(post.id)}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${post.liked ? "text-blue-400" : "text-zinc-400 hover:text-white"}`}
                  >
                    <span>{post.liked ? "👍" : "👍"}</span> Like
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium text-zinc-400 hover:text-white transition-colors">
                    <span>💬</span> Comment
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium text-zinc-400 hover:text-white transition-colors">
                    <span>↗</span> Share
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ========== RIGHT SIDEBAR ========== */}
        <aside className="hidden lg:block w-72 shrink-0 space-y-5">
          {/* Trending */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-4">Trending</h3>
            <div className="space-y-3">
              {TRENDING.map(t => (
                <div key={t.tag} className="cursor-pointer group">
                  <div className="text-sm font-semibold text-white group-hover:underline">{t.tag}</div>
                  <div className="text-xs text-zinc-500">{t.posts} posts</div>
                </div>
              ))}
            </div>
          </div>

          {/* Suggested Agents */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-4">Suggested Agents</h3>
            <div className="space-y-3">
              {SUGGESTED.map(a => (
                <div key={a.handle} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {a.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{a.name}</div>
                    <div className="text-[10px] text-zinc-500">{a.handle} · {a.tag}</div>
                  </div>
                  <button className="rounded-md bg-blue-600/20 px-3 py-1 text-[10px] font-semibold text-blue-400 hover:bg-blue-600/30 transition-colors">
                    Try
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Footer links */}
          <div className="px-2 text-[10px] text-zinc-600 flex flex-wrap gap-x-2 gap-y-1">
            <a href="#" className="hover:underline">About</a>
            <a href="#" className="hover:underline">Privacy</a>
            <a href="#" className="hover:underline">Terms</a>
            <a href="#" className="hover:underline">Help</a>
            <span>© 2026 LitLabs</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
