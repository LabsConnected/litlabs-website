"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

const POSTS = [
  { id: 1, author: "Alex Chen", handle: "@alexchen", content: "Just deployed my first AI agent on LitLabs. The speed is insane. My Code Champion wrote a full API in 3 minutes 🔥", time: "2h ago", likes: 12, comments: 3, avatar: "AC" },
  { id: 2, author: "Sarah K", handle: "@sarahk", content: "Anyone else using the Bot Forge? Looking for recommendations on agent templates for content creation.", time: "4h ago", likes: 8, comments: 7, avatar: "SK" },
  { id: 3, author: "Dev Mike", handle: "@devmike", content: "The new Agent Gallery is clean. Already tried 4 different bots. The writing coach is my favorite.", time: "6h ago", likes: 24, comments: 5, avatar: "DM" },
  { id: 4, author: "Jordan T", handle: "@jordant", content: "Pro tip: Build a custom agent, enter it in the Arena, and watch it climb the rankings. Currently #3 this week!", time: "8h ago", likes: 31, comments: 12, avatar: "JT" },
];

export default function SocialPage() {
  const { user } = useAuth();
  const [newPost, setNewPost] = useState("");

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Social Hub</h1>
          <p className="text-text-secondary text-sm">What builders are saying</p>
        </div>
        <span className="badge badge-cyan">👥 {POSTS.length} posts today</span>
      </div>

      {/* New Post */}
      <div className="card mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center text-neon-cyan font-heading text-xs font-bold">
            {user?.name?.charAt(0) || user?.email?.charAt(0) || "U"}
          </div>
          <span className="text-sm text-text-secondary">
            Posting as <span className="text-text-primary">{user?.name || user?.email}</span>
          </span>
        </div>
        <textarea
          className="input min-h-[80px] resize-none"
          placeholder="Share a win, ask a question, or show off your agent..."
          value={newPost}
          onChange={e => setNewPost(e.target.value)}
        />
        <div className="flex justify-between items-center mt-3">
          <span className="text-xs text-text-muted">{newPost.length}/500</span>
          <button className="btn-primary text-sm" disabled={!newPost.trim()}>
            Post Update
          </button>
        </div>
      </div>

      {/* Feed */}
      <div className="space-y-4">
        {POSTS.map(post => (
          <div key={post.id} className="card">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-cyber-surface-2 border border-cyber-border flex items-center justify-center text-neon-cyan font-heading text-xs font-bold">
                {post.avatar}
              </div>
              <div>
                <div className="font-medium text-sm">{post.author}</div>
                <div className="text-xs text-text-muted">{post.handle} · {post.time}</div>
              </div>
            </div>
            <p className="text-text-secondary text-sm mb-3">{post.content}</p>
            <div className="flex items-center gap-6 text-text-muted text-xs">
              <button className="hover:text-neon-cyan transition-colors flex items-center gap-1">
                <span>♥</span> {post.likes}
              </button>
              <button className="hover:text-neon-cyan transition-colors flex items-center gap-1">
                <span>💬</span> {post.comments}
              </button>
              <button className="hover:text-neon-cyan transition-colors">↗ Share</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
