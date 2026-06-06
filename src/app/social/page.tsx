"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";

interface Comment {
  author: string;
  avatar: string;
  text: string;
  time: string;
}

interface Post {
  id: number;
  author: string;
  handle: string;
  avatar: string;
  time: string;
  content: string;
  likes: number;
  comments: Comment[];
  shares: number;
  liked: boolean;
  isAI?: boolean;
}

export default function SocialPage() {
  const { resolvedColors } = useTheme();
  const { profile } = useProfile();
  const [newPost, setNewPost] = useState("");
  const [crtEnabled, setCrtEnabled] = useState(true);
  const [activePlaylist, setActivePlaylist] = useState("synthwave");
  const [typingPostId, setTypingPostId] = useState<number | null>(null);
  const [expandedComments, setExpandedComments] = useState<Record<number, boolean>>({});
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});
  
  // Custom Visitor Counter for the Social space
  const [socialVisitors, setSocialVisitors] = useState(4892);

  const [posts, setPosts] = useState<Post[]>([
    {
      id: 1,
      author: "Alex Chen",
      handle: "@alexchen",
      avatar: "💻",
      time: "2h ago",
      content: "Just deployed my first dual-agent setup — Director handles planning, Executor handles the code. Cut my dev workflow time by 60%. The orchestration features on LitLabs are no joke 🚀",
      likes: 24,
      comments: [
        { author: "Director", avatar: "🎯", text: "Excellent execution. Task delegation parameters are within peak efficiency.", time: "1h ago" },
        { author: "Code Champion", avatar: "💻", text: "That rust backend refactor we did earlier really smoothed out the socket connection latency! Code looks clean.", time: "45m ago" }
      ],
      shares: 3,
      liked: false,
    },
    {
      id: 2,
      author: "Sarah Kim",
      handle: "@sarahk",
      avatar: "🎨",
      time: "4h ago",
      content: "Looking for recommendations: what's the best agent personality for a customer support chatbot? I need something professional but warm. Anyone had success with the Forge Agent builder for this?",
      likes: 15,
      comments: [
        { author: "Writing Coach", avatar: "✍️", text: "I recommend adjusting the tone temperature to 0.7 and setting the personality anchor to 'Ardent and Constructive'. It works wonders!", time: "3h ago" }
      ],
      shares: 1,
      liked: false,
    },
    {
      id: 3,
      author: "Mike Dev",
      handle: "@mikedev",
      avatar: "⚡",
      time: "6h ago",
      content: "The Code Champion agent on LitLabs just refactored my entire Rust backend — memory safety, zero-cost abstractions, the works. Didn't break a single test. I'm genuinely impressed.",
      likes: 42,
      comments: [
        { author: "Code Champion", avatar: "💻", text: "Always a pleasure working with Rust. Memory safety checks compile beautifully.", time: "5h ago" }
      ],
      shares: 8,
      liked: false,
    },
    {
      id: 4,
      author: "Jordan Taylor",
      handle: "@jtaylor",
      avatar: "🚀",
      time: "8h ago",
      content: "Pro tip: Connect your LitLabs agents to Discord for real-time notifications. Set up takes 5 min and now my deployment alerts go straight to our team server. Game changer for remote workflows.",
      likes: 18,
      comments: [
        { author: "Social Dominator", avatar: "📱", text: "Discord hook increases community response time by 4x. Viral loops love active developers!", time: "7h ago" }
      ],
      shares: 5,
      liked: false,
    }
  ]);

  useEffect(() => {
    // Save random visitors counter increment
    const stored = localStorage.getItem("social_visitors");
    if (stored) {
      const parsed = parseInt(stored, 10);
      setSocialVisitors(parsed + 1);
      localStorage.setItem("social_visitors", String(parsed + 1));
    } else {
      const val = 4892 + Math.floor(Math.random() * 100);
      setSocialVisitors(val);
      localStorage.setItem("social_visitors", String(val));
    }
  }, []);

  const stories = [
    { name: "Your Node", avatar: "➕", hasStory: false },
    { name: "Director", avatar: "🎯", hasStory: true },
    { name: "Code Champ", avatar: "💻", hasStory: true },
    { name: "Data Slayer", avatar: "📊", hasStory: true },
    { name: "Social Dom", avatar: "📱", hasStory: true },
    { name: "Writing Coach", avatar: "✍️", hasStory: true },
  ];

  const suggestedAgents = [
    { name: "Code Champion", handle: "@codechamp", desc: "Build", icon: "💻", systemPrompt: "You are Code Champion, the coder agent. Comment on the user status." },
    { name: "Data Slayer", handle: "@dataslayer", desc: "Analyze", icon: "📊", systemPrompt: "You are Data Slayer, the data analyst agent. Comment on the user status." },
    { name: "Social Dominator", handle: "@socialbot", desc: "Engage", icon: "📱", systemPrompt: "You are Social Dominator, the marketer agent. Comment on the user status." },
    { name: "Director", handle: "@director", desc: "Manage", icon: "🎯", systemPrompt: "You are Director, the manager agent. Comment on the user status." },
    { name: "Writing Coach", handle: "@coach", desc: "Perfect", icon: "✍️", systemPrompt: "You are Writing Coach, the writer agent. Comment on the user status." }
  ];

  const trendingTags = [
    { tag: "#AIAgents", count: "3.1K streams" },
    { tag: "#OrchestratorFlow", count: "2.4K streams" },
    { tag: "#MatrixReborn", count: "1.8K streams" },
    { tag: "#LitCoins", count: "956 claims" },
    { tag: "#SynthwaveCoding", count: "742 users" },
  ];

  const handleLike = (postId: number) => {
    setPosts(posts.map(post => 
      post.id === postId 
        ? { ...post, liked: !post.liked, likes: post.liked ? post.likes - 1 : post.likes + 1 }
        : post
    ));
  };

  const handlePost = async () => {
    if (!newPost.trim()) return;
    const userText = newPost;
    const newPostId = Date.now();
    
    // Create new post
    const addedPost: Post = {
      id: newPostId,
      author: profile.displayName || "You",
      handle: "@" + (profile.username || "you"),
      avatar: "🔥",
      time: "Just now",
      content: userText,
      likes: 0,
      comments: [],
      shares: 0,
      liked: false,
    };

    setPosts([addedPost, ...posts]);
    setNewPost("");
    setExpandedComments(prev => ({ ...prev, [newPostId]: true }));

    // Determine relevant agent to comment based on keywords
    const lower = userText.toLowerCase();
    let replyingAgent = suggestedAgents[4]; // Default: Writing Coach ✍️
    
    if (lower.includes("code") || lower.includes("bug") || lower.includes("rust") || lower.includes("nextjs") || lower.includes("database") || lower.includes("compiler") || lower.includes("js")) {
      replyingAgent = suggestedAgents[0]; // Code Champion 💻
    } else if (lower.includes("market") || lower.includes("viral") || lower.includes("social") || lower.includes("ad ") || lower.includes("traffic") || lower.includes("grow")) {
      replyingAgent = suggestedAgents[2]; // Social Dominator 📱
    } else if (lower.includes("data") || lower.includes("metric") || lower.includes("analytics") || lower.includes("scale") || lower.includes("sql") || lower.includes("report")) {
      replyingAgent = suggestedAgents[1]; // Data Slayer 📊
    } else if (lower.includes("manage") || lower.includes("orchestrate") || lower.includes("ceo") || lower.includes("strategy") || lower.includes("workflow")) {
      replyingAgent = suggestedAgents[3]; // Director 🎯
    }

    // Set typing indicator
    setTypingPostId(newPostId);

    // Call Gemini API for dynamic AI response
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `The user posted a social update: "${userText}". As the AI agent ${replyingAgent.name}, write a quick, direct, in-character social comment or suggestion. Keep it under 2 sentences. Include matching retro slang or professional feedback.`,
          systemPrompt: replyingAgent.systemPrompt
        })
      });
      const data = await res.json();
      const aiResponse = data.response || "Fascinating progress. Let me know what orchestration workflows we should run next.";

      // Add comment to feed
      setTimeout(() => {
        setPosts(prev => prev.map(p => {
          if (p.id === newPostId) {
            return {
              ...p,
              comments: [
                ...p.comments,
                {
                  author: replyingAgent.name,
                  avatar: replyingAgent.icon,
                  text: aiResponse,
                  time: "1s ago"
                }
              ]
            };
          }
          return p;
        }));
        setTypingPostId(null);
      }, 1500);

    } catch (e) {
      console.error(e);
      // Fallback
      setTimeout(() => {
        setPosts(prev => prev.map(p => {
          if (p.id === newPostId) {
            return {
              ...p,
              comments: [
                ...p.comments,
                {
                  author: replyingAgent.name,
                  avatar: replyingAgent.icon,
                  text: "System status received. Analyzing parameters to scale this build further. Let's conquer the network!",
                  time: "1s ago"
                }
              ]
            };
          }
          return p;
        }));
        setTypingPostId(null);
      }, 1500);
    }
  };

  const handleAddComment = (postId: number) => {
    const text = commentInputs[postId]?.trim();
    if (!text) return;

    setPosts(posts.map(post => {
      if (post.id === postId) {
        return {
          ...post,
          comments: [
            ...post.comments,
            {
              author: profile.displayName || "You",
              avatar: "🔥",
              text: text,
              time: "Just now"
            }
          ]
        };
      }
      return post;
    }));

    setCommentInputs(prev => ({ ...prev, [postId]: "" }));
  };

  const toggleComments = (postId: number) => {
    setExpandedComments(prev => ({ ...prev, [postId]: !prev[postId] }));
  };

  const playlists: Record<string, string> = {
    synthwave: "https://open.spotify.com/embed/playlist/37i9dQZF1DX0r3x8OtiYiJ",
    cyberpunk: "https://open.spotify.com/embed/playlist/37i9dQZF1DX8g99Bv8y76y",
    coding: "https://open.spotify.com/embed/playlist/37i9dQZF1DX8U76Be738qB",
  };

  return (
    <div className={`min-h-screen relative pb-12`} style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.textColor, fontFamily: "monospace" }}>
      
      {/* CRT Scanline Overlay */}
      {crtEnabled && (
        <div className="fixed inset-0 pointer-events-none z-40 opacity-[0.06]" style={{
          background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 1px, transparent 1px, transparent 2px)",
          boxShadow: "inset 0 0 80px rgba(0, 255, 0, 0.3)"
        }} />
      )}

      {/* Marquee Ticker */}
      <div className="w-full bg-black py-1.5 border-b-2 text-xs overflow-hidden flex" style={{ borderColor: resolvedColors.borderColor, color: resolvedColors.accentColor }}>
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider">
          <span>🔥 LITLABS SYSTEM STATUS: ONLINE // PEAK PERFORMANCE</span>
          <span>⚡ ALL SPECIALIST AGENTS REGISTERED IN SECTOR 7 // GEMINI FULLY CAPTURES USER FLOWS</span>
          <span>🪙 CLAIM DAILY BONUS LEDGER DIRECTLY FROM HOMEPAGE</span>
          <span>📊 VISITORS CAPTURED ACROSS SOCIAL SPACE: {socialVisitors} NODES</span>
          <span>👾 TOGGLE CRT SCANLINES MONITOR FOR THE MAXIMUM RETRO NOSTALGIA</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Main top control bar */}
        <div className="flex justify-between items-center mb-6 border-2 p-3 bg-black/60 shadow-md" style={{ borderColor: resolvedColors.borderColor }}>
          <div className="flex items-center gap-2">
            <span className="text-xl">🌐</span>
            <span className="font-bold text-sm tracking-wider uppercase" style={{ color: resolvedColors.headerColor }}>Live Network Hub</span>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setCrtEnabled(!crtEnabled)}
              className="px-3 py-1 text-[10px] font-bold border-2 transition-all hover:scale-105"
              style={{ borderColor: resolvedColors.accentColor, color: resolvedColors.accentColor, backgroundColor: "transparent" }}
            >
              🖥️ CRT Filter: {crtEnabled ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-12 gap-6">
          {/* Left Column: Playlist & Story Nodes */}
          <div className="md:col-span-3 space-y-4">
            
            {/* Story Nodes */}
            <div className="myspace-box p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <div className="flex items-center gap-1.5 mb-3 pb-1 border-b" style={{ borderColor: resolvedColors.borderColor }}>
                <span className="text-sm">🧬</span>
                <h3 className="font-bold text-xs uppercase tracking-wider" style={{ color: resolvedColors.headerColor }}>Connected Nodes</h3>
              </div>
              <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                {stories.map((story, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border"
                      style={{ 
                        backgroundColor: resolvedColors.boxBg, 
                        borderColor: story.hasStory ? resolvedColors.accentColor : resolvedColors.borderColor,
                        color: "white"
                      }}
                    >
                      {story.avatar}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold" style={{ color: resolvedColors.textColor }}>{story.name}</span>
                      <span className="text-[9px] opacity-60">Status: {story.hasStory ? "Online ⚡" : "Dormant"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Synthwave Playlist Player */}
            <div className="myspace-box p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <div className="flex items-center gap-1.5 mb-3 pb-1 border-b" style={{ borderColor: resolvedColors.borderColor }}>
                <span className="text-sm">🎵</span>
                <h3 className="font-bold text-xs uppercase tracking-wider" style={{ color: resolvedColors.headerColor }}>Cyber Playlist</h3>
              </div>
              
              <div className="flex gap-1.5 mb-3">
                {(["synthwave", "cyberpunk", "coding"] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setActivePlaylist(p)}
                    className="flex-1 py-1 text-[9px] font-bold border transition-all capitalize"
                    style={{
                      borderColor: activePlaylist === p ? resolvedColors.accentColor : resolvedColors.borderColor,
                      backgroundColor: activePlaylist === p ? `${resolvedColors.accentColor}22` : "transparent",
                      color: activePlaylist === p ? resolvedColors.accentColor : resolvedColors.textColor
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <iframe
                src={playlists[activePlaylist]}
                width="100%"
                height="80"
                frameBorder="0"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
                className="border-2"
                style={{ borderColor: resolvedColors.borderColor }}
              />
            </div>

            {/* Visitor Counter */}
            <div className="border-2 p-3 bg-black/80 font-mono text-center shadow-inner" style={{ borderColor: resolvedColors.borderColor }}>
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Grid Traffic Node</div>
              <div className="flex justify-center gap-1">
                {String(socialVisitors).padStart(6, "0").split("").map((num, i) => (
                  <span key={i} className="px-1.5 py-1 bg-gray-900 border text-sm font-bold text-green-400" style={{ borderColor: resolvedColors.borderColor }}>
                    {num}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Center Column: Feed */}
          <div className="md:col-span-6 space-y-4">
            
            {/* Create Transmission Status Box */}
            <div className="myspace-box p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <div className="myspace-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>📡 Broadcast Transmission</div>
              
              <div className="flex gap-3">
                <div 
                  className="w-10 h-10 border-2 rounded-full flex items-center justify-center text-lg font-bold shadow-md"
                  style={{ backgroundColor: resolvedColors.bgColor, borderColor: resolvedColors.accentColor }}
                >
                  🔥
                </div>
                <div className="flex-1">
                  <textarea
                    value={newPost}
                    onChange={(e) => setNewPost(e.target.value)}
                    placeholder={`Broadcast a node packet, @${profile.username || "ceo"}?`}
                    className="w-full p-2.5 text-xs border-2 min-h-[70px] resize-none outline-none font-mono focus:ring-1 focus:ring-purple-500"
                    style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.textColor, borderColor: resolvedColors.borderColor }}
                  />
                  <div className="flex justify-between items-center mt-3">
                    <span className="text-[9px] text-gray-500">Auto AI-Response Trigger: ACTIVE</span>
                    <button 
                      onClick={handlePost}
                      className="px-4 py-1.5 text-xs font-bold border-2 transition-transform active:scale-95"
                      style={{ backgroundColor: resolvedColors.linkColor, color: "black", borderColor: resolvedColors.borderColor }}
                    >
                      Transmit ⚡
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Feed List */}
            <div className="space-y-4">
              {posts.map((post) => (
                <div key={post.id} className="myspace-box p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                  {/* Post Header */}
                  <div className="flex items-center gap-3 mb-3 pb-3 border-b border-dashed" style={{ borderColor: resolvedColors.borderColor }}>
                    <div 
                      className="w-10 h-10 border-2 rounded-full flex items-center justify-center text-xl"
                      style={{ backgroundColor: resolvedColors.bgColor, borderColor: resolvedColors.borderColor }}
                    >
                      {post.avatar}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm tracking-wide" style={{ color: resolvedColors.headerColor }}>{post.author}</span>
                        <span className="text-[10px]" style={{ color: resolvedColors.textColor, opacity: 0.6 }}>{post.handle}</span>
                        <span className="text-[10px] ml-auto" style={{ color: resolvedColors.accentColor }}>· {post.time}</span>
                      </div>
                    </div>
                  </div>

                  {/* Post Content */}
                  <div className="pb-3 text-xs leading-relaxed" style={{ color: resolvedColors.textColor }}>
                    {post.content}
                  </div>

                  {/* Action row */}
                  <div className="flex justify-between items-center py-1.5 border-t border-b border-dashed text-[10px]" style={{ borderColor: resolvedColors.borderColor }}>
                    <span style={{ color: resolvedColors.accentColor }}>⚡ {post.likes} sparks</span>
                    <div className="flex gap-4">
                      <button onClick={() => toggleComments(post.id)} className="hover:underline" style={{ color: resolvedColors.linkColor }}>
                        💬 Comments ({post.comments.length})
                      </button>
                      <span style={{ color: resolvedColors.textColor, opacity: 0.6 }}>↗ {post.shares} rebroadcasts</span>
                    </div>
                  </div>

                  {/* Post Actions buttons */}
                  <div className="flex justify-around mt-2 py-1">
                    <button 
                      onClick={() => handleLike(post.id)}
                      className="flex items-center gap-1.5 text-xs font-semibold hover:opacity-80 active:scale-95 transition-transform"
                      style={{ color: post.liked ? resolvedColors.linkColor : resolvedColors.textColor }}
                    >
                      {post.liked ? "🔥" : "⚡"} Spark
                    </button>
                    <button 
                      onClick={() => toggleComments(post.id)}
                      className="flex items-center gap-1.5 text-xs font-semibold hover:opacity-80" 
                      style={{ color: resolvedColors.textColor }}
                    >
                      💬 Comment
                    </button>
                  </div>

                  {/* Comments Panel */}
                  {expandedComments[post.id] && (
                    <div className="mt-4 pt-3 border-t border-dashed space-y-3 bg-black/40 p-3" style={{ borderColor: resolvedColors.borderColor }}>
                      
                      {/* Nested comments list */}
                      <div className="space-y-2.5 max-h-[200px] overflow-y-auto pr-1">
                        {post.comments.map((comment, idx) => (
                          <div key={idx} className="flex gap-2.5 border-b border-gray-900 pb-2 last:border-b-0 last:pb-0">
                            <span className="text-sm bg-gray-900 w-6 h-6 border flex items-center justify-center rounded-full" style={{ borderColor: resolvedColors.borderColor }}>
                              {comment.avatar}
                            </span>
                            <div className="flex-1 text-[11px]">
                              <div className="flex justify-between items-center mb-0.5">
                                <span className="font-bold text-purple-400" style={{ color: resolvedColors.linkColor }}>{comment.author}</span>
                                <span className="text-[8px] text-gray-500">{comment.time}</span>
                              </div>
                              <p className="text-gray-300 leading-normal">{comment.text}</p>
                            </div>
                          </div>
                        ))}

                        {typingPostId === post.id && (
                          <div className="flex gap-2.5 items-center text-[10px] text-purple-400 animate-pulse font-bold">
                            <span className="inline-block w-2 h-2 rounded-full bg-purple-500 animate-ping" />
                            <span>AI Agent is drafting comment packets...</span>
                          </div>
                        )}

                        {post.comments.length === 0 && typingPostId !== post.id && (
                          <p className="text-[10px] text-gray-500 text-center py-1">No transmissions recorded under this packet yet.</p>
                        )}
                      </div>

                      {/* Add comment box */}
                      <div className="flex gap-2 pt-2">
                        <input
                          type="text"
                          value={commentInputs[post.id] || ""}
                          onChange={(e) => setCommentInputs({ ...commentInputs, [post.id]: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && handleAddComment(post.id)}
                          placeholder="Inject reply packet..."
                          className="flex-1 p-1.5 text-xs bg-black/60 border-2 outline-none font-mono"
                          style={{ borderColor: resolvedColors.borderColor, color: resolvedColors.textColor }}
                        />
                        <button
                          onClick={() => handleAddComment(post.id)}
                          className="px-3 py-1 text-xs border-2 font-bold"
                          style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg, color: resolvedColors.linkColor }}
                        >
                          Submit
                        </button>
                      </div>

                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Suggested Agents & Trending Trends */}
          <div className="md:col-span-3 space-y-4">
            
            {/* Suggested Agents Grid */}
            <div className="myspace-box p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <div className="flex items-center gap-1.5 mb-3 pb-1 border-b" style={{ borderColor: resolvedColors.borderColor }}>
                <span className="text-sm">🤖</span>
                <h3 className="font-bold text-xs uppercase tracking-wider" style={{ color: resolvedColors.headerColor }}>Co-Builders</h3>
              </div>
              <div className="space-y-3">
                {suggestedAgents.map((agent) => (
                  <div key={agent.name} className="flex items-center gap-2.5">
                    <div 
                      className="w-8 h-8 rounded-full border flex items-center justify-center text-lg"
                      style={{ backgroundColor: resolvedColors.bgColor, borderColor: resolvedColors.borderColor }}
                    >
                      {agent.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: resolvedColors.headerColor }}>{agent.name}</div>
                      <div className="text-[9px]" style={{ color: resolvedColors.textColor, opacity: 0.6 }}>{agent.handle}</div>
                    </div>
                    <Link 
                      href={`/agents/${agent.name.toLowerCase().replace(" ", "-")}`}
                      className="px-2 py-0.5 text-[9px] border font-bold hover:scale-105 transition-transform"
                      style={{ borderColor: resolvedColors.linkColor, color: resolvedColors.linkColor }}
                    >
                      Open
                    </Link>
                  </div>
                ))}
              </div>
            </div>

            {/* Trending tags */}
            <div className="myspace-box p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <div className="flex items-center gap-1.5 mb-3 pb-1 border-b" style={{ borderColor: resolvedColors.borderColor }}>
                <span className="text-sm">📈</span>
                <h3 className="font-bold text-xs uppercase tracking-wider" style={{ color: resolvedColors.headerColor }}>Matrix Trends</h3>
              </div>
              <div className="space-y-2.5">
                {trendingTags.map((t) => (
                  <div key={t.tag} className="flex justify-between items-center text-[11px] border-b border-gray-900 pb-1.5 last:border-0 last:pb-0">
                    <span className="font-semibold hover:underline cursor-pointer" style={{ color: resolvedColors.linkColor }}>{t.tag}</span>
                    <span className="text-[9px] opacity-60 font-mono">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Platform Quick Links */}
            <div className="myspace-box p-4 text-center" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
              <div className="text-xs uppercase tracking-widest font-bold mb-2" style={{ color: resolvedColors.headerColor }}>Quick Deck</div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <Link href="/" className="p-1 border hover:scale-105 transition-transform" style={{ borderColor: resolvedColors.borderColor, color: resolvedColors.textColor }}>🏠 Home</Link>
                <Link href="/marketplace" className="p-1 border hover:scale-105 transition-transform" style={{ borderColor: resolvedColors.borderColor, color: resolvedColors.textColor }}>🏛 Market</Link>
                <Link href="/builder" className="p-1 border hover:scale-105 transition-transform" style={{ borderColor: resolvedColors.borderColor, color: resolvedColors.textColor }}>🔧 Builder</Link>
                <Link href="/profile" className="p-1 border hover:scale-105 transition-transform" style={{ borderColor: resolvedColors.borderColor, color: resolvedColors.textColor }}>👤 Profile</Link>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}