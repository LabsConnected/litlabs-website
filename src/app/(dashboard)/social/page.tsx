"use client";
import { useState } from "react";

const POSTS = [
  { id: 1, author: "Alex Chen", handle: "@alexchen", content: "Just deployed my first AI agent on LitLabs. The speed is insane.", time: "2h ago", likes: 12, comments: 3 },
  { id: 2, author: "Sarah K", handle: "@sarahk", content: "Anyone else using the Bot Forge? Looking for recommendations on agent templates.", time: "4h ago", likes: 8, comments: 7 },
  { id: 3, author: "Dev Mike", handle: "@devmike", content: "The new dashboard is clean. Love the dark theme. 🔥", time: "6h ago", likes: 24, comments: 5 },
];

export default function SocialPage() {
  const [newPost, setNewPost] = useState("");

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-heading text-2xl font-bold mb-6">Social Hub</h1>

      {/* New Post */}
      <div className="card mb-6">
        <textarea
          className="input min-h-[80px] resize-none"
          placeholder="What's on your mind?"
          value={newPost}
          onChange={e => setNewPost(e.target.value)}
        />
        <div className="flex justify-end mt-3">
          <button className="btn-primary text-sm">Post</button>
        </div>
      </div>

      {/* Feed */}
      <div className="space-y-4">
        {POSTS.map(post => (
          <div key={post.id} className="card">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-cyber-surface-2 border border-cyber-border flex items-center justify-center text-neon-cyan font-heading text-xs font-bold">
                {post.author.split(" ").map(n => n[0]).join("")}
              </div>
              <div>
                <div className="font-medium text-sm">{post.author}</div>
                <div className="text-xs text-text-muted">{post.handle} · {post.time}</div>
              </div>
            </div>
            <p className="text-text-secondary text-sm mb-3">{post.content}</p>
            <div className="flex items-center gap-6 text-text-muted text-xs">
              <button className="hover:text-neon-cyan transition-colors">♥ {post.likes}</button>
              <button className="hover:text-neon-cyan transition-colors">💬 {post.comments}</button>
              <button className="hover:text-neon-cyan transition-colors">↗ Share</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
