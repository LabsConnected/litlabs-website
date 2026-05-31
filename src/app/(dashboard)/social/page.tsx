"use client";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";

const POSTS = [
  { 
    id: 1, 
    author: "Alex Chen", 
    handle: "NODE_7742", 
    content: "Just successfully synchronized my first custom cyber-daemon with the Director node. The dual-agent orchestration is holding steady at 45ms latency. Optimized for production. 🚀", 
    time: "02:44:12", 
    likes: 12, 
    comments: 3, 
    avatar: "AC",
    status: "ELITE_BUILDER",
    color: "neon-cyan"
  },
  { 
    id: 2, 
    author: "Sarah K", 
    handle: "FORGE_MASTER", 
    content: "Scanning for high-performance persona matrixes for an automated trading bot. Any recommendations for the current market volatility? Looking for 'Aggressive' but 'Risk-Aware'.", 
    time: "04:12:05", 
    likes: 8, 
    comments: 7, 
    avatar: "SK",
    status: "CORE_MEMBER",
    color: "neon-purple"
  },
  { 
    id: 3, 
    author: "Dev Mike", 
    handle: "DAEMON_SLAYER", 
    content: "The Agent Gallery v3.0 update is massive. Just tested the Code Champion on a complex Rust backend. It refactored the entire memory management system without breaking a single test. Pure technical magic.", 
    time: "06:33:41", 
    likes: 24, 
    comments: 5, 
    avatar: "DM",
    status: "SENIOR_NODE",
    color: "neon-gold"
  },
  { 
    id: 4, 
    author: "Jordan T", 
    handle: "MATRIX_KING", 
    content: "New directive: Deploying my custom 'Sentiment Analyzer' agent into the global matrix feed. It will be providing real-time technical sentiment logs for all #BotForge transmissions. Stay tuned.", 
    time: "08:15:22", 
    likes: 31, 
    comments: 12, 
    avatar: "JT",
    status: "SYSTEM_COMMANDER",
    color: "neon-cyan"
  },
];

const TRENDING = [
  { tag: "#BotForge", posts: "2.4k", color: "neon-cyan" },
  { tag: "#AgentArena", posts: "1.8k", color: "neon-purple" },
  { tag: "#LitLabsTools", posts: "956", color: "neon-gold" },
  { tag: "#AIAgents", posts: "3.1k", color: "neon-cyan" },
  { tag: "#NoCodeAI", posts: "742", color: "neon-purple" },
];

export default function SocialPage() {
  const { user } = useAuth();
  const [newPost, setNewPost] = useState("");

  return (
    <div className="max-w-6xl mx-auto pb-24 selection:bg-neon-gold selection:text-black animate-fade-in">
      {/* Matrix Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-12 border-b border-white/5 pb-8">
        <div className="space-y-1">
          <div className="text-[10px] font-black text-neon-gold tracking-[0.5em] uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-gold animate-pulse" />
            Matrix_Pulse_v3.0.4
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl font-black uppercase tracking-tighter text-white">
            The <span className="gradient-text-gold drop-shadow-[0_0_20px_rgba(255,215,0,0.2)]">Matrix</span>
          </h1>
          <p className="text-zinc-500 font-mono text-xs tracking-wider uppercase">Real-time technical logs from the global builder collective.</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2 font-mono">
          <div className="badge badge-gold px-4 py-1.5 text-[10px] font-black tracking-[0.2em] shadow-[0_0_15px_rgba(255,215,0,0.1)]">
            👥 {POSTS.length} ACTIVE_NODES
          </div>
          <div className="text-[8px] font-bold text-zinc-600 tracking-[0.3em] uppercase">Uplink: STABLE // {new Date().toLocaleTimeString()}</div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-10">
        {/* Main Transmission Feed */}
        <div className="flex-1 min-w-0 space-y-8">
          {/* Compose Terminal */}
          <div className="card border-white/10 bg-black/40 p-6 relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-neon-gold/30 to-transparent" />
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-neon-gold/10 border border-neon-gold/30 flex items-center justify-center text-neon-gold font-heading text-lg font-black shadow-inner">
                {user?.name?.charAt(0) || user?.email?.charAt(0) || "U"}
              </div>
              <div>
                <div className="text-xs font-black text-white uppercase tracking-wider">{user?.name || user?.email?.split("@")[0] || "Anonymous"}</div>
                <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em]">NODE_STATUS: AUTHORIZED_BROADCAST</div>
              </div>
            </div>
            <textarea 
              className="input min-h-[120px] resize-none text-base leading-relaxed bg-black/60 border-white/5 focus:border-neon-gold/40 transition-all font-medium placeholder:text-zinc-700" 
              placeholder="Transmit a technical breakthrough or system update to the Matrix..." 
              value={newPost} 
              onChange={e => setNewPost(e.target.value)} 
            />
            <div className="flex flex-col sm:flex-row justify-between items-center mt-6 gap-4 border-t border-white/5 pt-6">
              <div className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em]">
                TRANSMISSION_RESERVE: <span className={500 - newPost.length < 50 ? 'text-neon-red' : 'text-neon-gold'}>{500 - newPost.length} BYTES</span>
              </div>
              <button 
                className="btn-primary bg-gradient-to-r from-neon-gold to-orange-500 text-black text-[10px] px-10 py-3 font-black uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(255,215,0,0.15)] hover:shadow-[0_0_30px_rgba(255,215,0,0.3)] disabled:opacity-20 disabled:grayscale transition-all" 
                disabled={!newPost.trim()}
              >
                Broadcast_Transmission
              </button>
            </div>
          </div>

          {/* Post Feed */}
          <div className="space-y-6">
            {POSTS.map(post => (
              <div key={post.id} className="card group hover:border-white/20 transition-all duration-500 relative overflow-hidden bg-zinc-900/20">
                {/* Status indicator line */}
                <div className={`absolute left-0 top-0 w-1 h-full opacity-30 group-hover:opacity-100 transition-opacity bg-${post.color}`} />
                
                <div className="flex items-center gap-4 mb-6">
                  <div className={`w-11 h-11 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center text-${post.color} font-heading text-sm font-black transition-transform group-hover:scale-110 duration-500`}>
                    {post.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-black text-sm text-white uppercase tracking-tight truncate">{post.author}</div>
                      <div className="text-[9px] font-bold text-zinc-600 font-mono tracking-widest bg-white/5 px-2 py-0.5 rounded uppercase">{post.time}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] font-black text-neon-cyan/60 uppercase tracking-[0.2em]">{post.handle}</div>
                      <div className="h-0.5 w-0.5 rounded-full bg-zinc-700" />
                      <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">{post.status}</div>
                    </div>
                  </div>
                </div>

                <p className="text-zinc-300 text-sm sm:text-base font-medium leading-relaxed mb-6 pl-2">
                  {post.content}
                </p>

                <div className="flex items-center gap-8 pt-5 border-t border-white/5 font-mono">
                  <button className="text-zinc-500 hover:text-neon-gold transition-colors flex items-center gap-2 group/btn">
                    <span className="text-lg group-hover/btn:scale-125 transition-transform">♥</span> 
                    <span className="text-[10px] font-black uppercase tracking-widest">{post.likes}</span>
                  </button>
                  <button className="text-zinc-500 hover:text-neon-cyan transition-colors flex items-center gap-2 group/btn">
                    <span className="text-lg group-hover/btn:scale-125 transition-transform">💬</span> 
                    <span className="text-[10px] font-black uppercase tracking-widest">{post.comments}</span>
                  </button>
                  <button className="ml-auto text-zinc-600 hover:text-white transition-colors text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                    REPLICATE_LINK <span className="text-xs">↗</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Technical Sidebar */}
        <aside className="hidden lg:block w-80 shrink-0 space-y-8">
          {/* Trending Nodes */}
          <div className="card p-6 border-white/5 bg-zinc-950/40 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-neon-gold/5 blur-[60px]" />
            <div className="text-[10px] font-black text-neon-gold tracking-[0.4em] uppercase mb-6 flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-neon-gold" />
              Trending_Nodes
            </div>
            <div className="space-y-4">
              {TRENDING.map(t => (
                <div key={t.tag} className="group cursor-pointer p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/20 transition-all">
                  <div className={`text-xs font-black uppercase tracking-wider group-hover:text-${t.color} transition-colors`}>{t.tag}</div>
                  <div className="flex justify-between items-center mt-2">
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">{t.posts} Transmissions</div>
                    <div className="text-[10px] text-zinc-800 font-mono group-hover:translate-x-1 transition-transform">&rarr;</div>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-6 py-3 rounded-xl border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 hover:text-white hover:bg-white/5 transition-all">
              View_All_Sectors
            </button>
          </div>

          {/* Builder Reputation */}
          <div className="card p-6 border-white/5 bg-zinc-950/40">
            <div className="text-[10px] font-black text-neon-cyan tracking-[0.4em] uppercase mb-6 flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-neon-cyan" />
              Elite_Commanders
            </div>
            <div className="space-y-5">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center font-black text-xs text-zinc-500">0{i}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-black text-white uppercase truncate tracking-wide">COMMANDER_ALPHA_0{i}</div>
                    <div className="text-[8px] font-bold text-neon-cyan/50 uppercase tracking-widest">REP: 14.2k // LVL_99</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
