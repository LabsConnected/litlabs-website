"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TrendingUp, Heart, MessageSquare, Loader2 } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";
import { LC } from "../lit-console-theme";

type Post = {
  id: string;
  content: string;
  media_urls: string[];
  likes_count: number;
  comments_count: number;
  is_ai_post: boolean;
  created_at: string;
  author?: { name: string; username: string };
};

const DEMO_POSTS: Post[] = (() => {
  const now = Date.now();
  return [
    {
      id: "d1",
      content: "Just deployed my first dual-agent setup — Director handles planning, Executor handles the code. Cut my dev workflow time by 60% 🚀",
      media_urls: [],
      likes_count: 24,
      comments_count: 3,
      is_ai_post: false,
      created_at: new Date(now - 900000).toISOString(),
      author: { name: "Alex Chen", username: "alexchen" },
    },
    {
      id: "d2",
      content: "Pixel Forge just generated the perfect album art for my new EP. The AI understood my vision instantly 🎵",
      media_urls: [],
      likes_count: 56,
      comments_count: 12,
      is_ai_post: false,
      created_at: new Date(now - 3600000).toISOString(),
      author: { name: "Sarah Kim", username: "sarahk" },
    },
    {
      id: "d3",
      content: "The Code Champion agent just refactored my entire Rust backend — memory safety, zero-cost abstractions, the works. Didn't break a single test. 🔥",
      media_urls: [],
      likes_count: 42,
      comments_count: 7,
      is_ai_post: false,
      created_at: new Date(now - 14400000).toISOString(),
      author: { name: "Mike Dev", username: "mikedev" },
    },
  ];
})();

function formatTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const hue = (name.charCodeAt(0) * 37) % 360;
  return (
    <div
      className="rounded-full flex items-center justify-center font-black shrink-0 text-[10px]"
      style={{
        width: 28,
        height: 28,
        background: `hsl(${hue},60%,35%)`,
        color: `hsl(${hue},80%,85%)`,
      }}
    >
      {initials}
    </div>
  );
}

export function SocialFeedWidget() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/posts")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setPosts(data?.posts?.slice(0, 4) || DEMO_POSTS))
      .catch(() => setPosts(DEMO_POSTS))
      .finally(() => setLoading(false));
  }, []);

  return (
    <BentoCard
      title="Live Feed"
      icon={<TrendingUp size={14} />}
      action={
        <Link
          href="/social"
          className="text-[10px] font-bold uppercase tracking-wider transition hover:opacity-70"
          style={{ color: LC.accentCyan }}
        >
          Full Feed
        </Link>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-8 opacity-40">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {posts.map((post) => (
            <div
              key={post.id}
              className="rounded-xl border p-3"
              style={{ borderColor: `${LC.border}40`, backgroundColor: LC.bgSecondary }}
            >
              <div className="flex items-start gap-2.5">
                <Avatar name={post.author?.name || "User"} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[11px] font-black" style={{ color: LC.text }}>
                      {post.author?.name || "Anonymous"}
                    </span>
                    <span className="text-[9px] opacity-40">
                      @{post.author?.username || "user"} · {formatTime(post.created_at)}
                    </span>
                    {post.is_ai_post && (
                      <span
                        className="text-[8px] px-1.5 py-0.5 rounded font-bold"
                        style={{ backgroundColor: `${LC.accentCyan}15`, color: LC.accentCyan }}
                      >
                        AI
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed mb-2" style={{ color: LC.textMuted }}>
                    {post.content}
                  </p>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() =>
                        setLiked((prev) => {
                          const n = new Set(prev);
                          if (n.has(post.id)) n.delete(post.id);
                          else n.add(post.id);
                          return n;
                        })
                      }
                      className="flex items-center gap-1.5 text-[10px] font-bold transition-all hover:scale-110"
                      style={{ color: liked.has(post.id) ? LC.danger : LC.textDim }}
                    >
                      <Heart size={11} fill={liked.has(post.id) ? LC.danger : "none"} />
                      {post.likes_count + (liked.has(post.id) ? 1 : 0)}
                    </button>
                    <Link
                      href="/social"
                      className="flex items-center gap-1.5 text-[10px] font-bold transition-all hover:scale-110"
                      style={{ color: LC.textDim }}
                    >
                      <MessageSquare size={11} /> {post.comments_count}
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </BentoCard>
  );
}
