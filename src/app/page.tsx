"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";

export default function LandingPage() {
  const { theme, resolvedColors, setMode, setSkin } = useTheme();
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [musicUrl, setMusicUrl] = useState("");
  const [directorInput, setDirectorInput] = useState("");
  const [directorMessages, setDirectorMessages] = useState<{role: string; text: string}[]>([]);
  const [directorLoading, setDirectorLoading] = useState(false);
  const directorEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    directorEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [directorMessages]);

  async function sendDirectorMessage() {
    if (!directorInput.trim() || directorLoading) return;
    const msg = directorInput.trim();
    setDirectorInput("");
    setDirectorMessages(prev => [...prev, { role: "user", text: msg }]);
    setDirectorLoading(true);
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "director",
          message: msg,
          systemPrompt: "You are Director, the master orchestrator of LiTTree Lab Studios — a MySpace-meets-Facebook-meets-AI-agent platform. You help users build AI agents, plan automation workflows, and navigate the platform. Be strategic, direct, and inspiring. Keep replies concise (2-3 sentences max).",
        }),
      });
      const data = await res.json();
      setDirectorMessages(prev => [...prev, { role: "agent", text: data.response || "I'm thinking on that..." }]);
    } catch {
      setDirectorMessages(prev => [...prev, { role: "agent", text: "Connection issue. Try again in a moment!" }]);
    } finally {
      setDirectorLoading(false);
    }
  }

  const skinPresets = ["cyberpunk", "retro", "ocean", "sunset", "matrix", "pink"] as const;

  return (
    <div className="min-h-screen font-sans" style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.textColor }}>
      
      {/* Theme Editor Toggle */}
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <button 
          onClick={() => setShowThemeEditor(!showThemeEditor)}
          className="px-4 py-2 text-sm font-bold border-2"
          style={{ borderColor: resolvedColors.linkColor, color: resolvedColors.linkColor }}
        >
          🎨 {showThemeEditor ? "Hide" : "Show"} Theme Editor
        </button>
        
        {showThemeEditor && (
          <div className="mt-4 p-4 border-2" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
            <div className="flex flex-wrap gap-4 mb-4">
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: resolvedColors.headerColor }}>Mode:</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMode("dark")}
                    className="px-3 py-1 text-sm border-2"
                    style={{ 
                      borderColor: resolvedColors.borderColor, 
                      backgroundColor: theme.mode === "dark" ? resolvedColors.linkColor : "transparent",
                      color: theme.mode === "dark" ? "white" : resolvedColors.textColor
                    }}
                  >
                    🌙 Dark
                  </button>
                  <button
                    onClick={() => setMode("light")}
                    className="px-3 py-1 text-sm border-2"
                    style={{ 
                      borderColor: resolvedColors.borderColor, 
                      backgroundColor: theme.mode === "light" ? resolvedColors.linkColor : "transparent",
                      color: theme.mode === "light" ? "white" : resolvedColors.textColor
                    }}
                  >
                    ☀️ Light
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: resolvedColors.headerColor }}>Skin:</label>
                <div className="flex flex-wrap gap-2">
                  {skinPresets.map((skin) => (
                    <button
                      key={skin}
                      onClick={() => setSkin(skin)}
                      className="px-2 py-1 text-xs capitalize border-2"
                      style={{ 
                        borderColor: theme.skin === skin ? resolvedColors.accentColor : resolvedColors.borderColor,
                        backgroundColor: theme.skin === skin ? resolvedColors.accentColor : "transparent",
                        color: theme.skin === skin ? (theme.mode === "dark" ? "#000" : "#fff") : resolvedColors.textColor
                      }}
                    >
                      {skin}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hero Section - MySpace Style */}
      <section className="py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-12 gap-6">
            
            {/* Left Column - Profile & Music */}
            <div className="md:col-span-3 space-y-4">
              {/* Profile Card */}
              <div className="border-2 p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                <div className="text-center">
                  <div className="text-6xl mb-2">🔥</div>
                  <h3 className="font-bold text-lg" style={{ color: resolvedColors.headerColor }}>LiTreeCeo</h3>
                  <p className="text-xs" style={{ color: resolvedColors.accentColor }}>● Online Now</p>
                  <p className="text-xs mt-1" style={{ color: resolvedColors.textColor }}>133,742 profile views</p>
                  <Link href="/profile" className="inline-block mt-3 px-3 py-1 text-xs border-2" style={{ borderColor: resolvedColors.linkColor, color: resolvedColors.linkColor, textDecoration: "none" }}>
                    View Profile →
                  </Link>
                </div>
              </div>

              {/* Music Player */}
              <div className="border-2 p-3" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                <h4 className="font-bold text-xs mb-2" style={{ color: resolvedColors.headerColor }}>🎵 Now Playing</h4>
                <div className="text-xs mb-2" style={{ color: resolvedColors.textColor }}>
                  <div className="font-bold">Building the Future</div>
                  <div style={{ color: resolvedColors.accentColor }}>LiTTree Lab Studios Official</div>
                </div>
                <select 
                  className="w-full text-xs p-1 mb-2"
                  style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.textColor, border: `1px solid ${resolvedColors.borderColor}` }}
                  onChange={(e) => setMusicUrl(e.target.value)}
                  value={musicUrl}
                >
                  <option value="">Select Music...</option>
                  <option value="https://open.spotify.com/embed/playlist/37i9dQZF1DX0r3x8OtiYiJ">Cyberpunk Mix</option>
                  <option value="https://open.spotify.com/embed/playlist/37i9dQZF1DX5trt9i14XVe">Coding Focus</option>
                  <option value="https://open.spotify.com/embed/playlist/37i9dQZF1DX9Z3vMB2b8im">Synthwave</option>
                  <option value="https://open.spotify.com/embed/playlist/37i9dQZF1DWWQRwui0ExPn">Lo-Fi Beats</option>
                </select>
                {musicUrl && (
                  <iframe 
                    src={musicUrl}
                    className="w-full"
                    height="80" 
                    frameBorder="0" 
                    allow="encrypted-media"
                  />
                )}
              </div>

              {/* Quick Links */}
              <div className="border-2 p-3" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                <h4 className="font-bold text-xs mb-2" style={{ color: resolvedColors.headerColor }}>Quick Links</h4>
                <div className="space-y-1 text-xs">
                  <Link href="/marketplace" style={{ color: resolvedColors.linkColor, display: "block" }}>🏛 Agent Gallery</Link>
                  <Link href="/builder" style={{ color: resolvedColors.linkColor, display: "block" }}>🔧 Build an Agent</Link>
                  <Link href="/profile" style={{ color: resolvedColors.linkColor, display: "block" }}>👤 My Profile</Link>
                  <Link href="/social" style={{ color: resolvedColors.linkColor, display: "block" }}>📱 Social Feed</Link>
                </div>
              </div>
            </div>

            {/* Center Column - Main Content */}
            <div className="md:col-span-6 space-y-4">
              {/* Welcome Box */}
              <div className="border-2 p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                <h2 className="text-2xl font-bold mb-2" style={{ color: resolvedColors.headerColor }}>
                  🔥 Welcome to LiTTree Lab Studios
                </h2>
                <p className="text-sm mb-4" style={{ color: resolvedColors.textColor }}>
                  The AI Agent Community! 🤖 Build, deploy, and share AI agents! ✨ 
                  No code required — just describe what you want! 🚀 
                  Free to start — Sign up in 3 seconds!
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Link href="/builder" className="px-4 py-2 text-sm font-bold" style={{ backgroundColor: resolvedColors.linkColor, color: "white", textDecoration: "none" }}>
                    🚀 Get Started Free
                  </Link>
                  <Link href="/marketplace" className="px-4 py-2 text-sm font-bold border-2" style={{ borderColor: resolvedColors.linkColor, color: resolvedColors.linkColor, textDecoration: "none" }}>
                    Explore Agents →
                  </Link>
                </div>
              </div>

              {/* Director Agent Chat */}
              <div className="border-2 p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-3xl">🎯</span>
                  <div>
                    <h3 className="font-bold" style={{ color: resolvedColors.headerColor }}>Director Agent</h3>
                    <p className="text-xs" style={{ color: resolvedColors.accentColor }}>● Online now</p>
                  </div>
                </div>
                <div className="overflow-y-auto mb-3" style={{ maxHeight: "200px", minHeight: "60px" }}>
                  {directorMessages.length === 0 && (
                    <div className="border p-3" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.bgColor }}>
                      <p className="text-sm italic" style={{ color: resolvedColors.textColor }}>
                        "Hi! I'm Director. I can build any AI agent you describe. What do you want to create today?"
                      </p>
                    </div>
                  )}
                  {directorMessages.map((msg, i) => (
                    <div key={i} className="mb-2 p-2 text-sm" style={{
                      borderLeft: `3px solid ${msg.role === "user" ? resolvedColors.accentColor : resolvedColors.linkColor}`,
                      backgroundColor: msg.role === "user" ? "rgba(0,0,0,0.2)" : "rgba(255,0,128,0.07)",
                      color: resolvedColors.textColor
                    }}>
                      <span className="font-bold text-xs" style={{ color: msg.role === "user" ? resolvedColors.accentColor : resolvedColors.linkColor }}>
                        {msg.role === "user" ? "You: " : "🎯 Director: "}
                      </span>
                      {msg.text}
                    </div>
                  ))}
                  {directorLoading && (
                    <div className="text-xs p-2" style={{ color: resolvedColors.accentColor }}>⏳ Director is thinking...</div>
                  )}
                  <div ref={directorEndRef} />
                </div>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={directorInput}
                    onChange={e => setDirectorInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendDirectorMessage()}
                    placeholder="Ask Director anything..."
                    className="flex-1 p-2 text-sm"
                    style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.textColor, border: `1px solid ${resolvedColors.borderColor}`, outline: "none" }}
                  />
                  <button 
                    onClick={sendDirectorMessage}
                    disabled={directorLoading}
                    className="px-4 py-2 text-sm font-bold" 
                    style={{ backgroundColor: resolvedColors.linkColor, color: "white", opacity: directorLoading ? 0.6 : 1, cursor: directorLoading ? "not-allowed" : "pointer" }}
                  >
                    Send
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { value: "133,742", label: "Agents Built" },
                  { value: "2.4M", label: "Tasks Completed" },
                  { value: "98%", label: "Uptime" },
                  { value: "4.9★", label: "User Rating" },
                ].map((stat) => (
                  <div key={stat.label} className="border-2 p-2 text-center" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                    <div className="text-lg font-bold" style={{ color: resolvedColors.accentColor }}>{stat.value}</div>
                    <div className="text-xs" style={{ color: resolvedColors.textColor }}>{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column - Trending & Builders */}
            <div className="md:col-span-3 space-y-4">
              {/* Trending */}
              <div className="border-2 p-3" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                <h4 className="font-bold text-xs mb-2" style={{ color: resolvedColors.headerColor }}>📈 Trending</h4>
                <div className="space-y-1">
                  {[
                    { tag: "#AIAgents", count: "3.1K posts" },
                    { tag: "#BotForge", count: "2.4K posts" },
                    { tag: "#NoCodeAI", count: "742 posts" },
                    { tag: "#AgentArena", count: "1.8K posts" },
                    { tag: "#LitLabs", count: "956 posts" },
                  ].map((t) => (
                    <div key={t.tag} className="flex justify-between text-xs">
                      <span style={{ color: resolvedColors.linkColor }}>{t.tag}</span>
                      <span style={{ color: resolvedColors.textColor }}>{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Suggested Builders */}
              <div className="border-2 p-3" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                <h4 className="font-bold text-xs mb-2" style={{ color: resolvedColors.headerColor }}>👥 Suggested Builders</h4>
                <div className="space-y-2">
                  {[
                    { name: "Alex Chen", handle: "@alexchen", avatar: "AC" },
                    { name: "Sarah Kim", handle: "@sarahk", avatar: "SK" },
                    { name: "Mike Dev", handle: "@mikedev", avatar: "MD" },
                  ].map((builder) => (
                    <div key={builder.handle} className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold" style={{ backgroundColor: resolvedColors.linkColor, color: "white" }}>
                        {builder.avatar}
                      </div>
                      <div>
                        <div className="text-xs font-bold" style={{ color: resolvedColors.headerColor }}>{builder.name}</div>
                        <div className="text-xs" style={{ color: resolvedColors.textColor }}>{builder.handle}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Your Themes */}
              <div className="border-2 p-3" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                <h4 className="font-bold text-xs mb-2" style={{ color: resolvedColors.headerColor }}>🎨 Your Themes</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: resolvedColors.headerColor }}></div>
                    <span>Current Skin</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: resolvedColors.accentColor }}></div>
                    <span>Accent Color</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: resolvedColors.boxBg, border: `1px solid ${resolvedColors.borderColor}` }}></div>
                    <span>Box Background</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Agents */}
      <section className="py-12 px-4 border-t-2" style={{ borderColor: resolvedColors.borderColor }}>
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold mb-6" style={{ color: resolvedColors.headerColor }}>
            🤖 Featured Agents — <Link href="/marketplace" style={{ color: resolvedColors.linkColor }}>See All →</Link>
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { id: "director", name: "Director", role: "Orchestrator", icon: "🎯", desc: "Coordinates all agents and builds new ones", status: "online" },
              { id: "champion", name: "Champion", role: "General Assistant", icon: "🏆", desc: "Your main AI assistant for any task", status: "online" },
              { id: "code-champion", name: "Code Champion", role: "Software Engineer", icon: "💻", desc: "Writes, debugs, and explains code", status: "online" },
              { id: "social-dominator", name: "Social Dominator", role: "Social Media", icon: "📱", desc: "Creates content and grows your audience", status: "away" },
              { id: "data-slayer", name: "Data Slayer", role: "Data Scientist", icon: "📊", desc: "Analyzes data and provides insights", status: "online" },
              { id: "writing-coach", name: "Writing Coach", role: "Content Writer", icon: "✍️", desc: "Helps with writing and editing", status: "online" },
            ].map((agent) => (
              <div key={agent.id} className="border-2 p-4" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-3xl">{agent.icon}</span>
                  <div>
                    <h3 className="font-bold" style={{ color: resolvedColors.headerColor }}>{agent.name}</h3>
                    <p className="text-xs" style={{ color: resolvedColors.textColor }}>{agent.role}</p>
                  </div>
                  <span className={`ml-auto text-xs ${agent.status === 'online' ? 'text-green-400' : 'text-yellow-400'}`}>
                    ● {agent.status}
                  </span>
                </div>
                <p className="text-sm mb-3" style={{ color: resolvedColors.textColor }}>{agent.desc}</p>
                <Link href={`/agents/${agent.id}`} className="inline-block px-3 py-1 text-xs font-bold border-2" style={{ borderColor: resolvedColors.linkColor, color: resolvedColors.linkColor, textDecoration: "none" }}>
                  Chat with {agent.name} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Community Wall */}
      <section className="py-12 px-4 border-t-2" style={{ borderColor: resolvedColors.borderColor }}>
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-6" style={{ color: resolvedColors.headerColor }}>💬 Community Wall</h2>
          <div className="space-y-4 mb-6">
            {[
              { id: 1, user: "CodeWizard42", avatar: "🧙", text: "Director agent is INSANE. Automated my entire deployment pipeline 🔥", time: "2 hours ago" },
              { id: 2, user: "PixelQueen", avatar: "👸", text: "Just built my first agent in 5 minutes. This is the future fr fr", time: "5 hours ago" },
              { id: 3, user: "DataNinja", avatar: "🥷", text: "Data Slayer predicted my sales with 94% accuracy. I'm shook.", time: "1 day ago" },
            ].map((comment) => (
              <div key={comment.id} className="border-2 p-3" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{comment.avatar}</span>
                  <span className="font-bold text-sm" style={{ color: resolvedColors.headerColor }}>{comment.user}</span>
                  <span className="text-xs ml-auto" style={{ color: resolvedColors.textColor }}>{comment.time}</span>
                </div>
                <p className="text-sm" style={{ color: resolvedColors.textColor }}>{comment.text}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="Leave a comment..."
              className="flex-1 p-2 text-sm"
              style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.textColor, border: `1px solid ${resolvedColors.borderColor}` }}
            />
            <button className="px-4 py-2 text-sm font-bold" style={{ backgroundColor: resolvedColors.linkColor, color: "white" }}>
              Post Comment
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t-2" style={{ borderColor: resolvedColors.borderColor, backgroundColor: resolvedColors.boxBg }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-bold mb-2" style={{ color: resolvedColors.headerColor }}>LiTTree Lab Studios</h4>
              <p className="text-xs" style={{ color: resolvedColors.textColor }}>The MySpace of AI Agents</p>
            </div>
            <div>
              <h4 className="font-bold mb-2" style={{ color: resolvedColors.headerColor }}>Product</h4>
              <div className="space-y-1 text-xs">
                <Link href="/marketplace" style={{ color: resolvedColors.linkColor, display: "block" }}>Marketplace</Link>
                <Link href="/builder" style={{ color: resolvedColors.linkColor, display: "block" }}>Builder</Link>
                <Link href="/profile" style={{ color: resolvedColors.linkColor, display: "block" }}>Profile</Link>
              </div>
            </div>
            <div>
              <h4 className="font-bold mb-2" style={{ color: resolvedColors.headerColor }}>Connect</h4>
              <div className="space-y-1 text-xs">
                <a href="https://twitter.com" style={{ color: resolvedColors.linkColor, display: "block" }}>Twitter</a>
                <a href="https://github.com" style={{ color: resolvedColors.linkColor, display: "block" }}>GitHub</a>
                <a href="https://discord.com" style={{ color: resolvedColors.linkColor, display: "block" }}>Discord</a>
              </div>
            </div>
            <div>
              <h4 className="font-bold mb-2" style={{ color: resolvedColors.headerColor }}>Theme</h4>
              <div className="space-y-1 text-xs">
                <button onClick={() => setMode("dark")} style={{ color: resolvedColors.linkColor, display: "block" }}>🌙 Dark Mode</button>
                <button onClick={() => setMode("light")} style={{ color: resolvedColors.linkColor, display: "block" }}>☀️ Light Mode</button>
              </div>
            </div>
          </div>
          <div className="text-center text-xs pt-4 border-t" style={{ borderColor: resolvedColors.borderColor, color: resolvedColors.textColor }}>
            © {new Date().getFullYear()} LiTTree Lab Studios. "The MySpace of AI" 🚀
          </div>
        </div>
      </footer>
    </div>
  );
}