"use client";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";

const POSTS = [
  { id: 1, author: "Alex Chen", handle: "@alexchen", content: "Just deployed my first AI agent on LitLabs. The speed is insane. My Code Champion wrote a full API in 3 minutes 🔥", time: "2h ago", likes: 12, comments: 3, avatar: "AC" },
  { id: 2, author: "Sarah K", handle: "@sarahk", content: "Anyone else using the Bot Forge? Looking for recommendations on agent templates for content creation.", time: "4h ago", likes: 8, comments: 7, avatar: "SK" },
  { id: 3, author: "Dev Mike", handle: "@devmike", content: "The new Agent Gallery is clean. Already tried 4 different bots. The writing coach is my favorite.", time: "6h ago", likes: 24, comments: 5, avatar: "DM" },
  { id: 4, author: "Jordan T", handle: "@jordant", content: "Pro tip: Build a custom agent, enter it in the Arena, and watch it climb the rankings. Currently #3 this week!", time: "8h ago", likes: 31, comments: 12, avatar: "JT" },
];

const TRENDING = [
  { tag: "#BotForge", posts: "2.4k" },
  { tag: "#AgentArena", posts: "1.8k" },
  { tag: "#LitLabsTools", posts: "956" },
  { tag: "#AIAgents", posts: "3.1k" },
  { tag: "#NoCodeAI", posts: "742" },
];

export default function SocialPage() {
  const { user } = useAuth();
  const [newPost, setNewPost] = useState("");
  const [showCompose, setShowCompose] = useState(false);

  return (
    <div className="max-w-6xl mx-auto pb-20">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-[10px] font-bold text-neon-gold tracking-[0.4em] uppercase mb-2">Matrix_Feed_v3.0</div>
          <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">The <span className="gradient-text">Matrix</span></h1>
          <p className="text-text-secondary font-medium text-sm mt-1">Real-time technical logs from the builder collective.</p>
        </div>
        <div className="badge badge-gold self-start sm:self-end">👥 {POSTS.length} ACTIVE_NODES</div>
      </div>

      <div className="flex gap-8">
        {/* Main Feed */}
        <div className="flex-1 min-w-0">
          {/* Compose - Desktop */}
          <div className="hidden sm:block card mb-8 border-neon-cyan/10 bg-black/40 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center text-neon-cyan font-heading text-sm font-bold">
                {user?.name?.charAt(0) || user?.email?.charAt(0) || "U"}
              </div>
              <div>
                <div className="text-xs font-bold text-text-primary uppercase tracking-tight">{user?.name || user?.email?.split("@")[0] || "Anonymous"}</div>
                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Broadcasting_As_Node</div>
              </div>
            </div>
            <textarea className="input min-h-[100px] resize-none text-sm leading-relaxed bg-black/60" placeholder="Transmit a technical breakthrough or system update..." value={newPost} onChange={e => setNewPost(e.target.value)} />
            <div className="flex justify-between items-center mt-4">
              <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">BYTES: {500 - newPost.length}</div>
              <button className="btn-primary text-xs px-6 py-2.5 uppercase tracking-widest disabled:opacity-50" disabled={!newPost.trim()}>Broadcast_Update</button>
            </div>
          </div>

          {/* Compose - Mobile */}
          <div className="sm:hidden card mb-6 border-neon-cyan/10 bg-black/40 p-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center text-neon-cyan font-heading text-xs font-bold shrink-0">
                {user?.name?.charAt(0) || user?.email?.charAt(0) || "U"}
              </div>
              <input className="input text-sm py-2 px-3 flex-1 bg-black/60" placeholder="Transmit an update..." onFocus={() => setShowCompose(true)} />
            </div>
            {showCompose && (
              <div className="mt-3">
                <textarea className="input min-h-[80px] resize-none text-sm bg-black/60" placeholder="Transmit a technical breakthrough..." value={newPost} onChange={e => setNewPost(e.target.value)} />
                <div className="flex justify-between items-center mt-3">
                  <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest">{500 - newPost.length}</div>
                  <button className="btn-primary text-xs px-5 py-2 uppercase tracking-widest disabled:opacity-50" disabled={!newPost.trim()}>Broadcast</button>
                </div>
              </div>
            )}
          </div>

          {/* Feed */}
          <div className="space-y-4">
            {POSTS.map(post => (
              <div key={post.id} className="card group hover:border-white/20 transition-all duration-300">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-cyber-surface-2 border border-cyber-border flex items-center justify-center text-neon-cyan font-heading text-xs font-bold shrink-0">{post.avatar}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-sm text-text-primary uppercase tracking-tight truncate">{post.author}</div>
                      <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest shrink-0">{post.time}</div>
                    </div>
                    <div className="text-[10px] font-bold text-neon-cyan/60 uppercase tracking-widest">{post.handle}</div>
                  </div>
                </div>
                <p className="text-text-secondary text-sm font-medium leading-relaxed mb-4">{post.content}</p>
                <div className="flex items-center gap-6 pt-3 border-t border-white/5 text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">
                  <button className="hover:text-neon-cyan transition-colors flex items-center gap-1.5">
                    <span className="text-sm">♥</span> <span>{post.likes}</span>
                  </button>
                  <button className="hover:text-neon-cyan transition-colors flex items-center gap-1.5">
                    <span className="text-sm">💬</span> <span>{post.comments}</span>
                  </button>
                  <button className="ml-auto hover:text-neon-cyan transition-colors">↗ Share</button>
                </div>
              </div>
            ))}
          </div>

          {/* Floating Action Button (Mobile) */}
          <button
            onClick={() => setShowCompose(!showCompose)}
            className="sm:hidden fixed bottom-20 right-4 w-14 h-14 rounded-2xl bg-neon-cyan text-cyber-bg shadow-[0_0_20px_rgba(0,242,254,0.4)] flex items-center justify-center text-2xl font-bold z-50 hover:scale-105 active:scale-95 transition-transform"
          >
            +
          </button>
        </div>

        {/* Trending Sidebar (Desktop) */}
        <div className="hidden lg:block w-72 shrink-0">
          <div className="card p-5 sticky top-20">
            <div className="text-[10px] font-bold text-neon-gold tracking-[0.4em] uppercase mb-4">Trending_Nodes</div>
            <div className="space-y-3">
              {TRENDING.map(t => (
                <div key={t.tag} className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-neon-cyan/20 hover:bg-white/5 transition-all cursor-pointer group">
                  <div className="text-sm font-bold text-text-primary group-hover:text-neon-cyan transition-colors uppercase tracking-tight">{t.tag}</div>
                  <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-1">{t.posts} transmissions</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
