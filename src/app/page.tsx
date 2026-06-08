"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useAuth } from "@clerk/nextjs";
import { AGENT_AVATARS } from "@/lib/avatars";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { useMounted } from "@/hooks/useMounted";
import { Zap, Wrench, ShoppingBag, MessagesSquare, Bot } from "lucide-react";

interface UIAgent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  desc: string;
  status: "online" | "away" | "offline";
  systemPrompt: string;
  color: string;
}

const UI_AGENTS: UIAgent[] = [
  { id: "director", name: "Director", role: "System Orchestrator", avatar: AGENT_AVATARS.director, desc: "Coordinates multi-agent workflows.", status: "online", systemPrompt: "You are Director, the master orchestrator. Reply in character, professional, max 2 sentences.", color: "#00ffff" },
  { id: "champion", name: "Champion", role: "General Executive", avatar: AGENT_AVATARS.champion, desc: "Your versatile executive assistant.", status: "online", systemPrompt: "You are Champion, a stellar assistant. Warm, prompt, versatile. Reply in character, max 2 sentences.", color: "#00ff41" },
  { id: "code", name: "Code Champion", role: "Software Architect", avatar: AGENT_AVATARS['code-champion'], desc: "Writes, refactors, and audits code.", status: "online", systemPrompt: "You are Code Champion, a master software architect. Concise and highly technical. Reply in character, max 2 sentences.", color: "#ff0080" },
  { id: "social", name: "Social Dominator", role: "Growth Marketer", avatar: AGENT_AVATARS['social-dominator'], desc: "Launches campaigns and drives traffic.", status: "online", systemPrompt: "You are Social Dominator, a hyper-charismatic growth marketer. Reply with energy and buzz, max 2 sentences.", color: "#ff6b35" },
  { id: "data", name: "Data Slayer", role: "Analytics Engineer", avatar: AGENT_AVATARS['data-slayer'], desc: "Models metrics and predicts profits.", status: "online", systemPrompt: "You are Data Slayer, a data analytics wizard. Analytical and sharp. Reply in character, max 2 sentences.", color: "#a855f7" },
  { id: "writer", name: "Writing Coach", role: "Content Publisher", avatar: AGENT_AVATARS['writing-coach'], desc: "Crafts copy and polishes pitches.", status: "online", systemPrompt: "You are Writing Coach, an eloquent publisher. Articulate and inspiring. Reply in character, max 2 sentences.", color: "#f472b6" },
  { id: "music", name: "Music Producer", role: "Audio Engineer", avatar: AGENT_AVATARS['music-producer'], desc: "Generates music and audio.", status: "away", systemPrompt: "You are Music Producer, a creative audio engineer. Reply with musical enthusiasm, max 2 sentences.", color: "#fbbf24" },
  { id: "pixel", name: "Pixel Forge", role: "Visual Artist", avatar: AGENT_AVATARS['pixel-forge'], desc: "Creates images and 3D worlds.", status: "online", systemPrompt: "You are Pixel Forge, a visionary artist. Reply with creative flair, max 2 sentences.", color: "#22d3ee" },
];

interface FloatingChat {
  agentId: string;
  name: string;
  avatar: string;
  role: string;
  systemPrompt: string;
  messages: { role: "user" | "agent"; text: string }[];
  input: string;
  isMinimized: boolean;
  isLoading: boolean;
}

interface TelemetryLog {
  time: string;
  agent: string;
  text: string;
  icon: string;
}

export default function LandingPage() {
  const { theme, resolvedColors, setMode, setSkin } = useTheme();
  const { profile } = useProfile();

  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [crtEnabled, setCrtEnabled] = useState(false);
  const [visitorCount, setVisitorCount] = useState(133742);
  const [musicUrl, setMusicUrl] = useState("https://open.spotify.com/embed/playlist/37i9dQZF1DX0r3x8OtiYiJ");
  const [litBitCoins, setLitBitCoins] = useState(500);
  const [claimedToday, setClaimedToday] = useState(false);

  const [activeChats, setActiveChats] = useState<FloatingChat[]>([]);

  const [orchestratorAgent1, setOrchestratorAgent1] = useState("director");
  const [orchestratorAgent2, setOrchestratorAgent2] = useState("code");
  const [orchestratorTopic, setOrchestratorTopic] = useState("Automated SaaS Marketing Pipeline");
  const [orchestratorLogs, setOrchestratorLogs] = useState<{ from: string; to: string; text: string; timestamp: string }[]>([]);
  const [orchestratorStatus, setOrchestratorStatus] = useState<"idle" | "running">("idle");

  const [telemetry, setTelemetry] = useState<TelemetryLog[]>([
    { time: "20:44:12", agent: "Code Champion", text: "Synchronized local Supabase client instance.", icon: "" },
    { time: "20:44:28", agent: "Data Slayer", text: "Optimized ledger indexing. Uptime: 99.98%", icon: "" },
    { time: "20:44:54", agent: "Director", text: "Orchestration thread compiled for active boardroom session.", icon: "" }
  ]);

  const directorEndRef = useRef<HTMLDivElement>(null);
  const telemetryEndRef = useRef<HTMLDivElement>(null);

  // Load persistence
  useEffect(() => {
    const storedCount = localStorage.getItem("litlabs_visitor_count");
    if (storedCount) {
      const newCount = parseInt(storedCount) + 1;
      setVisitorCount(newCount);
      localStorage.setItem("litlabs_visitor_count", newCount.toString());
    } else {
      localStorage.setItem("litlabs_visitor_count", "133742");
    }

    // 1) Optimistic local cache for instant render
    const cachedCoins = localStorage.getItem("litbitcoins");
    if (cachedCoins) setLitBitCoins(parseInt(cachedCoins));
    const lastClaim = localStorage.getItem("litbitcoins_last_claimed");
    if (lastClaim === new Date().toISOString().split("T")[0]) setClaimedToday(true);

    // 2) Authoritative fetch from /api/wallet (Clerk auth required server-side)
    //    This syncs balance across devices once the user signs in.
    fetch("/api/wallet")
      .then(r => r.json())
      .then(d => {
        if (typeof d.balance === "number") {
          setLitBitCoins(d.balance);
          localStorage.setItem("litbitcoins", String(d.balance));
        }
        if (d.last_claim_date) {
          const claimed = d.last_claim_date.startsWith(new Date().toISOString().split("T")[0]);
          if (claimed) {
            setClaimedToday(true);
            localStorage.setItem("litbitcoins_last_claimed", new Date().toISOString().split("T")[0]);
          }
        }
      })
      .catch(() => { /* offline / unauthenticated — keep cached value */ });
  }, []);

  // Poll telemetry
  useEffect(() => {
    const logPool = [
      { agent: "Code Champion", text: "Analyzed memory safety checks in Agent builder schema.", icon: "" },
      { agent: "Data Slayer", text: "Processed user query telemetry logs. Saved 1.2M tokens.", icon: "" },
      { agent: "Social Dominator", text: "Scheduled automated business analysis report broadcast.", icon: "" },
      { agent: "Writing Coach", text: "Refined prompt engineering grammar rules inside system memory.", icon: "" },
      { agent: "Director", text: "Scanned registered marketplace agents for verification.", icon: "" },
      { agent: "Champion", text: "Flushed single-turn chat cache. System fully operational.", icon: "" }
    ];
    const interval = setInterval(() => {
      const randomLog = logPool[Math.floor(Math.random() * logPool.length)];
      const timeStr = new Date().toTimeString().split(" ")[0];
      setTelemetry(prev => [
        ...prev.slice(-8),
        { time: timeStr, agent: randomLog.agent, text: randomLog.text, icon: randomLog.icon }
      ]);
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  // Track if this is initial mount to prevent scroll-to-bottom on page load
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // Only scroll within the telemetry card, not the whole page
    telemetryEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [telemetry]);

  const claimDailyBonus = async () => {
    if (claimedToday) return;

    // Optimistic update so the UI feels instant
    const optimistic = litBitCoins + 50;
    setLitBitCoins(optimistic);
    localStorage.setItem("litbitcoins", String(optimistic));
    setClaimedToday(true);
    const today = new Date().toISOString().split("T")[0];
    localStorage.setItem("litbitcoins_last_claimed", today);
    const timeStr = new Date().toTimeString().split(" ")[0];
    setTelemetry(prev => [
      ...prev,
      { time: timeStr, agent: "System", text: `Claimed daily LiTBit Coins bonus: +50 coins!`, icon: "🪙" }
    ]);

    // Authoritative claim via API. Roll back on failure.
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "daily" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Claim failed");
      if (typeof data.balance === "number") {
        setLitBitCoins(data.balance);
        localStorage.setItem("litbitcoins", String(data.balance));
      }
    } catch (err) {
      // Roll back optimistic update on failure
      setLitBitCoins(litBitCoins);
      setClaimedToday(false);
      localStorage.setItem("litbitcoins", String(litBitCoins));
      localStorage.removeItem("litbitcoins_last_claimed");
      setTelemetry(prev => [
        ...prev,
        { time: new Date().toTimeString().split(" ")[0], agent: "System", text: `Daily claim failed: ${err instanceof Error ? err.message : "unknown"}`, icon: "⚠️" }
      ]);
    }
  };

  const openMessengerChat = (agent: UIAgent) => {
    if (activeChats.some(c => c.agentId === agent.id)) {
      setActiveChats(activeChats.map(c => c.agentId === agent.id ? { ...c, isMinimized: false } : c));
      return;
    }
    const newChat: FloatingChat = {
      agentId: agent.id,
      name: agent.name,
      avatar: agent.avatar,
      role: agent.role,
      systemPrompt: agent.systemPrompt,
      messages: [{ role: "agent", text: `Hi! I'm ${agent.name}, your ${agent.role}. Ask me anything to automate your workflows!` }],
      input: "",
      isMinimized: false,
      isLoading: false
    };
    setActiveChats(prev => prev.length >= 3 ? [...prev.slice(1), newChat] : [...prev, newChat]);
  };

  const sendMessengerMessage = async (agentId: string) => {
    const chat = activeChats.find(c => c.agentId === agentId);
    if (!chat || !chat.input.trim() || chat.isLoading) return;
    const userMsg = chat.input.trim();
    setActiveChats(prev => prev.map(c =>
      c.agentId === agentId ? { ...c, input: "", messages: [...c.messages, { role: "user", text: userMsg }], isLoading: true } : c
    ));
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, systemPrompt: chat.systemPrompt })
      });
      const data = await res.json();
      setActiveChats(prev => prev.map(c =>
        c.agentId === agentId ? { ...c, isLoading: false, messages: [...c.messages, { role: "agent", text: data.response || "No response received." }] } : c
      ));
    } catch {
      setActiveChats(prev => prev.map(c =>
        c.agentId === agentId ? { ...c, isLoading: false, messages: [...c.messages, { role: "agent", text: "Connection error. Try again!" }] } : c
      ));
    }
  };

  const closeMessengerChat = (agentId: string) => setActiveChats(activeChats.filter(c => c.agentId !== agentId));
  const toggleMinimizeMessenger = (agentId: string) => setActiveChats(prev => prev.map(c => c.agentId === agentId ? { ...c, isMinimized: !c.isMinimized } : c));

  const handleStartOrchestrator = () => {
    if (orchestratorStatus === "running") { setOrchestratorStatus("idle"); return; }
    setOrchestratorStatus("running");
    const a1 = UI_AGENTS.find(a => a.id === orchestratorAgent1)!;
    const a2 = UI_AGENTS.find(a => a.id === orchestratorAgent2)!;
    setOrchestratorLogs([{
      from: "System",
      to: "All",
      text: `Assembling boardroom on "${orchestratorTopic}" — ${a1.name} ↔ ${a2.name}`,
      timestamp: new Date().toTimeString().split(" ")[0]
    }]);
    let step = 0;
    const mockInterval = setInterval(() => {
      const nowTime = new Date().toTimeString().split(" ")[0];
      if (step === 0) {
        setOrchestratorLogs(prev => [{ from: a1.name, to: a2.name, text: `Let's outline our strategy on "${orchestratorTopic}". What metrics should we align first?`, timestamp: nowTime }, ...prev]);
        step++;
      } else if (step === 1) {
        setOrchestratorLogs(prev => [{ from: a2.name, to: a1.name, text: `We must optimize core funnel latency first, then map targeted outreach using Gemini parameters.`, timestamp: nowTime }, ...prev]);
        step++;
      } else {
        setOrchestratorLogs(prev => [{ from: "System", to: "All", text: "Boardroom alignment finalized.", timestamp: nowTime }, ...prev]);
        setOrchestratorStatus("idle");
        clearInterval(mockInterval);
      }
    }, 4000);
  };

  const skinPresets = ["cyberpunk", "retro", "ocean", "sunset", "matrix", "pink", "synthwave", "volcanic", "gold", "arctic", "emerald", "midnight", "neon", "blood", "cosmic", "miami"] as const;

  const { isLoaded, isSignedIn } = useAuth();
  const mounted = useMounted();
  // Pre-generate random scales once to prevent background avatar jitter on re-render
  const randomScales = useRef(UI_AGENTS.map(() => 0.8 + Math.random() * 0.5));

  // Scroll reveal for landing page sections — MUST be before any conditional returns
  useScrollReveal(".reveal");

  // ── LOADING STATE (prevents hydration mismatch with Clerk) ──
  if (!mounted || !isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono" style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.accentColor }}>
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">⚡</div>
          <div>Initializing LiTTree Lab...</div>
        </div>
      </div>
    );
  }

  // ── LANDING PAGE FOR NON-LOGGED-IN USERS ──
  if (!isSignedIn) {
    return (
      <div className="min-h-screen relative overflow-hidden grid-bg" style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.textColor }}>
        {/* Ambient glow orbs */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="glow-orb w-[500px] h-[500px]" style={{ background: resolvedColors.linkColor, top: '-10%', left: '-10%', animationDelay: '0s' }} />
          <div className="glow-orb w-[400px] h-[400px]" style={{ background: resolvedColors.headerColor, bottom: '-5%', right: '-5%', animationDelay: '2s' }} />
          <div className="glow-orb w-[300px] h-[300px]" style={{ background: resolvedColors.accentColor, top: '40%', left: '60%', animationDelay: '4s', opacity: 0.08 }} />
        </div>

        {/* Floating agent avatars in background */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          {UI_AGENTS.map((agent, i) => (
            <div key={agent.id} className="absolute opacity-[0.06] animate-pulse" style={{
              left: `${15 + (i * 10)}%`,
              top: `${20 + (i % 3) * 25}%`,
              animationDelay: `${i * 0.5}s`,
              transform: `scale(${randomScales.current[i]})`,
            }}>
              <img src={agent.avatar} alt="" className="w-24 h-24 filter blur-[3px] opacity-20 rounded-lg object-cover" />
            </div>
          ))}
        </div>

        {/* CRT Overlay */}
        {crtEnabled && <div className="crt-overlay" />}

        {/* HERO SECTION */}
        <main className="relative z-10">
          <div className="max-w-7xl mx-auto px-6 py-20 md:py-32">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              
              {/* Left: Value Prop */}
              <div className="space-y-8">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-500/30 bg-cyan-500/10">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                  <span className="text-xs font-mono text-cyan-300">{UI_AGENTS.filter(a => a.status === "online").length} AI Agents Online</span>
                </div>
                
                <h1 className="font-display text-4xl md:text-6xl font-bold leading-tight">
                  Your <span style={{ color: resolvedColors.linkColor }}>AI Workforce</span> is Ready
                </h1>
                
                <p className="text-lg md:text-xl text-white/70 max-w-xl leading-relaxed">
                  Join thousands of creators, developers, and entrepreneurs using LiTreeLabStudios to build, automate, and scale with AI agents that actually get work done.
                </p>

                <div className="flex flex-wrap gap-4">
                  <Link href="/sign-up" className="btn btn-primary text-base px-8 py-4 font-bold" style={{ background: resolvedColors.linkColor, boxShadow: `0 0 30px ${resolvedColors.linkColor}50` }}>
                    Start Building — Free
                  </Link>
                  <Link href="/agents" className="btn btn-outline text-base px-6 py-4">
                    Explore Agents
                  </Link>
                </div>

                {/* Stats */}
                <div className="flex flex-wrap gap-8 pt-6 border-t border-white/10">
                  <div>
                    <div className="text-2xl font-bold text-cyan-400">{UI_AGENTS.length}+</div>
                    <div className="text-xs text-white/50 uppercase tracking-wider">AI Agents</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-pink-400">50K+</div>
                    <div className="text-xs text-white/50 uppercase tracking-wider">Users</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-yellow-400">2M+</div>
                    <div className="text-xs text-white/50 uppercase tracking-wider">Tasks Done</div>
                  </div>
                </div>
              </div>

              {/* Right: Agent Showcase */}
              <div className="relative reveal">
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-pink-500/20 rounded-3xl blur-3xl"></div>
                <div className="relative glass-card rounded-2xl p-6 glow-box">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-sm font-mono text-white/50">LIVE AGENT DASHBOARD</span>
                    <span className="text-xs text-green-400 animate-pulse">● System Online</span>
                  </div>

                  <div className="space-y-3">
                    {UI_AGENTS.slice(0, 6).map((agent) => (
                      <div key={agent.id} className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.03] border border-white/5 hover:border-white/20 hover:bg-white/[0.06] transition-all group cursor-pointer glow-border">
                        <img src={agent.avatar} alt={agent.name} className="w-10 h-10 rounded-lg object-cover border border-white/10 group-hover:scale-110 transition-transform" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{agent.name}</span>
                            <span className={`w-2 h-2 rounded-full ${agent.status === 'online' ? 'bg-green-400' : 'bg-yellow-400'}`} style={{ boxShadow: agent.status === 'online' ? '0 0 6px #4ade80' : 'none' }}></span>
                          </div>
                          <div className="text-xs text-white/50">{agent.role}</div>
                        </div>
                        <div className="text-xs font-mono px-2 py-1 rounded" style={{ background: agent.color + '20', color: agent.color, boxShadow: `0 0 8px ${agent.color}30` }}>
                          {agent.status === 'online' ? 'ACTIVE' : 'AWAY'}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 pt-4 border-t border-white/10 text-center">
                    <Link href="/sign-up" className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors hover:underline">
                      + Unlock All 8 Agents →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* WHAT WE DO SECTION */}
          <div className="max-w-7xl mx-auto px-6 py-20 border-t border-white/5">
            <div className="text-center mb-16">
              <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">What We Do</h2>
              <p className="text-white/60 max-w-2xl mx-auto">LiTreeLabStudios is your complete AI workspace — build custom agents, join a thriving creator community, and automate your workflow.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {[
                { title: "Build AI Agents", desc: "Create custom agents with unique personalities, skills, and system prompts. Deploy them to handle specific tasks." },
                { title: "Generate Content", desc: "AI-powered image generation, music creation, 3D world building, and video production tools." },
                { title: "Join the Community", desc: "Connect with other AI builders, share agents, collaborate on projects, and grow together." },
              ].map((feature, i) => (
                <div key={i} className={`glass-card p-6 rounded-xl hover:border-cyan-500/30 transition-all group reveal reveal-delay-${i + 1}`}>
                  <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform" style={{ boxShadow: '0 0 12px rgba(6,182,212,0.15)' }}>
                    <div className="w-3 h-3 rounded-full bg-cyan-400" style={{ boxShadow: '0 0 8px rgba(6,182,212,0.5)' }} />
                  </div>
                  <h3 className="font-bold text-lg mb-2">{feature.title}</h3>
                  <p className="text-sm text-white/60 leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* SOCIAL PROOF / COMMUNITY SECTION */}
          <div className="max-w-7xl mx-auto px-6 py-20 border-t border-white/5">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="reveal">
                <h2 className="font-display text-3xl font-bold mb-6">Join Our Growing Community</h2>
                <p className="text-white/60 mb-8 leading-relaxed">
                  Connect with thousands of AI enthusiasts, developers, and creators. Share your agents, get feedback, collaborate on projects, and stay ahead of the AI curve.
                </p>

                <div className="space-y-4">
                  {[
                    { text: "Daily discussions on AI trends and agent building" },
                    { text: "Showcase your agents and get community feedback" },
                    { text: "Learn from experts and share your knowledge" },
                    { text: "Earn LiTBit Coins and monetize your creations" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 group">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0 group-hover:shadow-[0_0_8px_rgba(34,211,238,0.6)] transition-shadow" />
                      <span className="text-sm text-white/70">{item.text}</span>
                    </div>
                  ))}
                </div>

                <Link href="/social" className="btn btn-primary mt-8 inline-flex items-center gap-2 hover-lift" style={{ background: resolvedColors.linkColor, boxShadow: `0 0 20px ${resolvedColors.linkColor}40` }}>
                  Join the Community
                  <span className="text-lg">→</span>
                </Link>
              </div>

              {/* Community Preview */}
              <div className="relative reveal reveal-delay-2">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-pink-500/10 rounded-2xl blur-xl"></div>
                <div className="relative glass-card rounded-2xl p-6 space-y-4 glow-box">
                  <div className="flex items-center gap-3 pb-4 border-b border-white/10">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-sm font-bold shadow-lg">AC</div>
                    <div>
                      <div className="font-bold text-sm">Alex Chen</div>
                      <div className="text-xs text-white/50">2h ago</div>
                    </div>
                  </div>
                  <p className="text-sm text-white/80">"Just deployed my first dual-agent setup — Director handles planning, Executor handles the code. Cut my dev workflow time by 60%."</p>
                  <div className="flex items-center gap-4 text-xs text-white/50">
                    <span className="hover:text-cyan-400 transition-colors cursor-pointer">❤ 24 likes</span>
                    <span className="hover:text-cyan-400 transition-colors cursor-pointer">💬 3 comments</span>
                  </div>

                  <div className="flex items-center gap-3 pt-4 border-t border-white/10">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-sm font-bold shadow-lg">SK</div>
                    <div>
                      <div className="font-bold text-sm">Sarah Kim</div>
                      <div className="text-xs text-white/50">4h ago</div>
                    </div>
                  </div>
                  <p className="text-sm text-white/80">"Pixel Forge just generated the perfect album art for my new EP. The AI understood my vision instantly."</p>
                  <div className="flex items-center gap-4 text-xs text-white/50">
                    <span className="hover:text-cyan-400 transition-colors cursor-pointer">❤ 56 likes</span>
                    <span className="hover:text-cyan-400 transition-colors cursor-pointer">💬 12 comments</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CTA SECTION */}
          <div className="max-w-7xl mx-auto px-6 py-20 reveal">
            <div className="relative overflow-hidden rounded-3xl p-12 text-center glass-card glow-box" style={{ background: `linear-gradient(135deg, ${resolvedColors.linkColor}15, ${resolvedColors.headerColor}15)` }}>
              <div className="absolute inset-0 opacity-20" style={{
                backgroundImage: `radial-gradient(circle at 30% 50%, ${resolvedColors.linkColor} 0%, transparent 50%),
                                  radial-gradient(circle at 70% 50%, ${resolvedColors.headerColor} 0%, transparent 50%)`,
              }} />

              <div className="relative z-10">
                <h2 className="font-display text-3xl md:text-5xl font-bold mb-6">Ready to Build the Future?</h2>
                <p className="text-white/70 text-lg mb-8 max-w-2xl mx-auto">
                  Join LiTreeLabStudios today and start building with AI agents that work as hard as you do.
                </p>

                <div className="flex flex-wrap justify-center gap-4">
                  <Link href="/sign-up" className="btn btn-primary text-lg px-10 py-4 font-bold hover-lift" style={{ background: resolvedColors.linkColor, boxShadow: `0 0 40px ${resolvedColors.linkColor}60` }}>
                    Get Started Free
                  </Link>
                  <Link href="/marketplace" className="btn btn-outline text-lg px-8 py-4 hover-lift">
                    Browse Agents
                  </Link>
                </div>

                <p className="text-xs text-white/40 mt-6">No credit card required. Start with 500 free LiTBit Coins.</p>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="relative z-10 border-t border-white/5 py-8">
          <div className="max-w-7xl mx-auto px-6 text-center text-xs text-white/40">
            <p>© 2025 LiTreeLabStudios. All rights reserved.</p>
            <div className="flex justify-center gap-4 mt-2">
              <Link href="/terms" className="hover:text-white/60">Terms</Link>
              <Link href="/privacy" className="hover:text-white/60">Privacy</Link>
              <Link href="/cookies" className="hover:text-white/60">Cookies</Link>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // ── DASHBOARD FOR LOGGED-IN USERS ──
  return (
    <div className="relative grid-bg" style={{ backgroundColor: resolvedColors.bgColor, color: resolvedColors.textColor }}>
      {/* Ambient glow orbs */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="glow-orb w-[600px] h-[600px]" style={{ background: resolvedColors.linkColor, top: '-15%', left: '-5%', animationDelay: '0s', opacity: 0.1 }} />
        <div className="glow-orb w-[400px] h-[400px]" style={{ background: resolvedColors.accentColor, bottom: '-10%', right: '-10%', animationDelay: '3s', opacity: 0.08 }} />
      </div>

      {/* CRT Overlay */}
      {crtEnabled && <div className="crt-overlay" />}

      {/* ── TOP CONTROLS ── */}
      <header className="relative z-10 border-b glass-card" style={{ borderColor: "rgba(255,255,255,0.06)", borderRadius: 0, borderWidth: '0 0 1px 0' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowThemeEditor(!showThemeEditor)} className="btn btn-ghost text-xs hover-lift" style={{ color: resolvedColors.textMuted }}>
              {showThemeEditor ? "Hide" : "Theme"} Editor
            </button>
            <button onClick={() => setCrtEnabled(!crtEnabled)} className="btn btn-ghost text-xs hover-lift" style={{ color: resolvedColors.textMuted }}>
              CRT: {crtEnabled ? "ON" : "OFF"}
            </button>
          </div>

          {/* Playlist selector */}
          <div className="flex items-center gap-1">
            <span className="font-mono text-[11px] text-muted mr-2">Audio</span>
            {[
              { name: "Cyberpunk", url: "https://open.spotify.com/embed/playlist/37i9dQZF1DX0r3x8OtiYiJ" },
              { name: "Coding", url: "https://open.spotify.com/embed/playlist/37i9dQZF1DX5trt9i14XVe" },
              { name: "Synthwave", url: "https://open.spotify.com/embed/playlist/37i9dQZF1DX9Z3vMB2b8im" }
            ].map(p => (
              <button key={p.name} onClick={() => setMusicUrl(p.url)}
                className="btn btn-ghost text-[11px] hover-lift"
                style={{ color: musicUrl === p.url ? resolvedColors.accentColor : resolvedColors.textMuted }}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── THEME EDITOR DRAWER ── */}
      {showThemeEditor && (
        <div className="relative z-10 border-b" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(15,15,23,0.9)", backdropFilter: "blur(16px)" }}>
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="section-eyebrow mb-3">Display Mode</p>
                <div className="flex gap-3">
                  {(["dark", "light"] as const).map(m => (
                    <button key={m} onClick={() => setMode(m)}
                      className="btn text-xs"
                      style={{
                        background: theme.mode === m ? resolvedColors.linkColor : "transparent",
                        color: theme.mode === m ? "#0a0a0f" : resolvedColors.textColor,
                        borderColor: theme.mode === m ? resolvedColors.linkColor : "rgba(255,255,255,0.1)"
                      }}>
                      {m === "dark" ? "Dark" : "Light"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="section-eyebrow mb-3">Skin Preset</p>
                <div className="flex flex-wrap gap-2">
                  {skinPresets.map(skin => (
                    <button key={skin} onClick={() => setSkin(skin)}
                      className="btn text-[11px]"
                      style={{
                        background: theme.skin === skin ? resolvedColors.accentColor : "transparent",
                        color: theme.skin === skin ? "#0a0a0f" : resolvedColors.textColor,
                        borderColor: theme.skin === skin ? resolvedColors.accentColor : "rgba(255,255,255,0.1)"
                      }}>
                      {skin}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <div className="grid md:grid-cols-12 gap-6 items-start">

          {/* ── LEFT SIDEBAR ── */}
          <aside className="md:col-span-3 space-y-5">

            {/* Profile card */}
            <div className="card glass-card glow-box">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-black"
                  style={{ background: `linear-gradient(135deg, ${resolvedColors.linkColor}, ${resolvedColors.headerColor})`, color: "#0a0a0f" }}>
                  {profile.displayName ? profile.displayName.charAt(0).toUpperCase() : "L"}
                </div>
                <div>
                  <h2 className="font-display text-base font-bold" style={{ color: resolvedColors.textColor }}>
                    {profile.displayName || "LiTreeCeo"}
                  </h2>
                  <p className="font-mono text-[11px] mt-0.5" style={{ color: resolvedColors.textMuted }}>
                    @{profile.username || "litree_ceo"}
                  </p>
                </div>
                <div className="w-full flex items-center justify-between text-[11px] font-mono py-1">
                  <span style={{ color: resolvedColors.textMuted }}>STATUS</span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <span style={{ color: resolvedColors.accentColor }}>Active</span>
                  </span>
                </div>
                <div className="w-full py-3 rounded-lg text-center" style={{ background: "rgba(0,0,0,0.3)" }}>
                  <p className="font-display text-[9px] uppercase tracking-widest mb-1" style={{ color: resolvedColors.textMuted }}>Visitor Counter</p>
                  <p className="font-mono text-2xl font-bold" style={{ color: resolvedColors.success }}>{visitorCount.toLocaleString()}</p>
                </div>
                <Link href="/profile" className="btn btn-secondary w-full text-xs">
                  My Profile →
                </Link>
              </div>
            </div>

            {/* LiTBit Coins Wallet */}
            <div className="card glass-card glow-box">
              <div className="card-header">
                <div className="card-title"><span className="dot" style={{ background: resolvedColors.accentColor, boxShadow: `0 0 8px ${resolvedColors.accentColor}` }} />LiTBit Coins</div>
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs" style={{ color: resolvedColors.textMuted }}>Balance</span>
                <span className="font-mono text-xl font-bold" style={{ color: resolvedColors.accentColor }}>{litBitCoins}</span>
              </div>
              <button onClick={claimDailyBonus} disabled={claimedToday}
                className="btn btn-primary w-full text-xs"
                style={{ opacity: claimedToday ? 0.5 : 1 }}>
                {claimedToday ? "✓ Claimed Today" : "+50 Daily Claim"}
              </button>
              <p className="text-[10px] text-center mt-2" style={{ color: resolvedColors.textMuted }}>Used to run custom AI agents.</p>
            </div>

            {/* Audio Deck */}
            {musicUrl && (
              <div className="card glass-card glow-box">
                <div className="card-header">
                  <div className="card-title"><span className="dot" />Audio Deck</div>
                  <span className="status-dot online" />
                </div>
                {/* Visualizer bars */}
                <div className="flex items-end justify-center gap-0.5 h-8 mb-3 px-2">
                  {[...Array(16)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1 rounded-sm animate-pulse"
                      style={{
                        backgroundColor: resolvedColors.accentColor,
                        height: `${20 + Math.sin(i * 1.2) * 15 + Math.cos(i * 0.7) * 10}%`,
                        animationDelay: `${i * 0.08}s`,
                        opacity: 0.7,
                      }}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono mb-2 px-1" style={{ color: resolvedColors.textMuted }}>
                  <span>● LIVE</span>
                  <span>Synthwave Mix</span>
                  <span>--:--</span>
                </div>
                <iframe
                  src={musicUrl}
                  className="w-full rounded"
                  height="152"
                  style={{ border: 0 }}
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                />
              </div>
            )}

            {/* AI Boardroom */}
            <div className="card glass-card glow-box">
              <div className="card-header">
                <div className="card-title"><span className="dot" />Assemble Boardroom</div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider block mb-1" style={{ color: resolvedColors.textMuted }}>Agent A</label>
                  <select value={orchestratorAgent1} onChange={e => setOrchestratorAgent1(e.target.value)} className="select text-xs">
                    {UI_AGENTS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider block mb-1" style={{ color: resolvedColors.textMuted }}>Agent B</label>
                  <select value={orchestratorAgent2} onChange={e => setOrchestratorAgent2(e.target.value)} className="select text-xs">
                    {UI_AGENTS.filter(a => a.id !== orchestratorAgent1).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider block mb-1" style={{ color: resolvedColors.textMuted }}>Topic</label>
                  <input type="text" value={orchestratorTopic} onChange={e => setOrchestratorTopic(e.target.value)} className="input text-xs" placeholder="Business topic..." />
                </div>
                <button onClick={handleStartOrchestrator} className="btn btn-primary w-full text-xs"
                  style={{ background: orchestratorStatus === "running" ? resolvedColors.warning : resolvedColors.linkColor, color: "#0a0a0f" }}>
                  {orchestratorStatus === "running" ? "Pause" : "Launch Boardroom"}
                </button>
              </div>
              {orchestratorLogs.length > 0 && (
                <div className="mt-3 p-2.5 rounded-lg overflow-y-auto max-h-[140px]" style={{ background: "rgba(0,0,0,0.35)" }}>
                  <p className="font-mono text-[9px] uppercase tracking-wider mb-2" style={{ color: resolvedColors.accentColor }}>Boardroom Logs</p>
                  <div className="space-y-1.5">
                    {orchestratorLogs.map((log, i) => (
                      <div key={i} className="telemetry-row text-[10px]">
                        <span className="text-muted font-mono">{log.timestamp}</span>
                        <span className="font-mono" style={{ color: log.from === "System" ? resolvedColors.accentColor : resolvedColors.linkColor }}>
                          {log.from}:
                        </span>
                        <span style={{ color: resolvedColors.textColor }}>{log.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>

          {/* ── CENTER: WORKSPACE HUB ── */}
          <div className="md:col-span-6 space-y-5">

            {/* Operations header */}
            <div className="card glass-card glow-box">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="section-eyebrow mb-2">Operations Center</p>
                  <h1 className="font-display text-2xl font-black">
                    <span className="gradient-text">LiTreeLabStudios</span>
                  </h1>
                  <p className="text-sm mt-2" style={{ color: resolvedColors.textMuted }}>
                    Welcome back, <strong>{profile.displayName || "CEO"}</strong>. Your AI workforce is standing by.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" style={{ boxShadow: '0 0 6px #4ade80' }} />
                  <span className="text-[10px] font-mono" style={{ color: resolvedColors.textMuted }}>
                    {UI_AGENTS.filter(a => a.status === "online").length} online
                  </span>
                </div>
              </div>

              {/* Quick-launch grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { href: "/studio", icon: <Wrench size={16} />, label: "Studio", desc: "AI tools" },
                  { href: "/social", icon: <MessagesSquare size={16} />, label: "Community", desc: "Feed & posts" },
                  { href: "/marketplace", icon: <ShoppingBag size={16} />, label: "Market", desc: "Browse agents" },
                  { href: "/agents", icon: <Bot size={16} />, label: "Agents", desc: "Manage agents" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-lg text-center transition-all hover:scale-105 border hover:border-opacity-60"
                    style={{
                      backgroundColor: resolvedColors.accentColor + "08",
                      borderColor: resolvedColors.borderColor + "20",
                      color: resolvedColors.textColor,
                    }}
                  >
                    <span style={{ color: resolvedColors.accentColor }}>{item.icon}</span>
                    <span className="text-[11px] font-bold">{item.label}</span>
                    <span className="text-[9px] opacity-50">{item.desc}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Go to Social CTA */}
            <Link
              href="/social"
              className="card glass-card glow-box flex items-center justify-between gap-4 hover:border-opacity-60 transition-all group"
              style={{ borderColor: resolvedColors.linkColor + "30" }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: resolvedColors.linkColor + "15", border: `1px solid ${resolvedColors.linkColor}30` }}>
                  <MessagesSquare size={18} style={{ color: resolvedColors.linkColor }} />
                </div>
                <div>
                  <div className="font-bold text-sm">Community Feed</div>
                  <div className="text-[11px] opacity-60">Post updates, see what agents are doing, connect with creators</div>
                </div>
              </div>
              <span className="text-lg opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" style={{ color: resolvedColors.linkColor }}>→</span>
            </Link>

            {/* Recent agent activity */}
            <div className="card glass-card glow-box">
              <div className="card-header">
                <div className="card-title"><span className="dot" style={{ background: resolvedColors.accentColor }} />Recent Agent Activity</div>
              </div>
              <div className="space-y-3">
                {[
                  { agent: "Pixel Forge", action: "Generated album cover art", time: "2m ago", color: "#ff6b6b" },
                  { agent: "Code Champion", action: "Refactored 3 code files", time: "5m ago", color: "#00ff41" },
                  { agent: "Data Slayer", action: "Analyzed user retention data", time: "12m ago", color: "#ffff00" },
                  { agent: "Director", action: "Boardroom session completed", time: "20m ago", color: "#00ffff" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg" style={{ backgroundColor: item.color + "08" }}>
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: item.color, boxShadow: `0 0 6px ${item.color}` }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-bold" style={{ color: item.color }}>{item.agent}</span>
                      <span className="text-[11px] opacity-70" style={{ color: resolvedColors.textColor }}> — {item.action}</span>
                    </div>
                    <span className="text-[9px] shrink-0 opacity-40" style={{ color: resolvedColors.textMuted }}>{item.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* System stats */}
            <div className="card glass-card glow-box">
              <div className="card-header">
                <div className="card-title"><span className="dot" />Platform Status</div>
                <span className="text-[10px] font-mono" style={{ color: resolvedColors.success }}>All systems operational</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { val: `${UI_AGENTS.filter(a => a.status === "online").length}/${UI_AGENTS.length}`, label: "Agents Online" },
                  { val: "99.98%", label: "Uptime" },
                  { val: "12ms", label: "Latency" },
                  { val: "2.4M", label: "Task Tokens" },
                ].map((stat, i) => (
                  <div key={i} className="metric">
                    <div className="metric-value" style={{ color: resolvedColors.accentColor }}>{stat.val}</div>
                    <div className="metric-label">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          <aside className="md:col-span-3 space-y-5">

            {/* Top Agents */}
            <div className="card glass-card glow-box">
              <div className="card-header">
                <div className="card-title"><span className="dot" />My Top 6 Agents</div>
                <Link href="/marketplace" className="text-[10px] font-mono" style={{ color: resolvedColors.success }}>Ledger →</Link>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {UI_AGENTS.map(agent => (
                  <button key={agent.id} onClick={() => openMessengerChat(agent)}
                    className="agent-tile">
                    <div className="agent-avatar relative">
                      <img src={agent.avatar} alt={agent.name} className="w-10 h-10 rounded-lg object-cover border border-white/10" />
                      <span className={`status-dot ${agent.status}`}
                        style={{ position: "absolute", bottom: -1, right: -1 }} />
                    </div>
                    <span className="agent-name">{agent.name}</span>
                    <span className="agent-role">{agent.status}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-center mt-3" style={{ color: resolvedColors.textMuted }}>Click to open real-time chat</p>
            </div>

            {/* Studio Metrics */}
            <div className="card glass-card glow-box">
              <div className="card-header">
                <div className="card-title"><span className="dot" />Studio Metrics</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { val: "133,742", label: "Ledger Actions" },
                  { val: "99.98%", label: "Uptime" },
                  { val: "12ms", label: "Query Latency" },
                  { val: "2.4M", label: "Task Tokens" }
                ].map((stat, i) => (
                  <div key={i} className="metric">
                    <div className="metric-value">{stat.val}</div>
                    <div className="metric-label">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Telemetry */}
            <div className="card glass-card glow-box">
              <div className="card-header">
                <div className="card-title">
                  <span className="status-dot online" />
                  Live Telemetry
                </div>
              </div>
              <div className="overflow-y-auto max-h-[200px]">
                {telemetry.map((log, i) => (
                  <div key={i} className="telemetry-row">
                    <span className="telemetry-time">{log.time}</span>
                    <span className="telemetry-agent">{log.icon ? log.icon + ' ' : ''}{log.agent}:</span>
                    <span>{log.text}</span>
                  </div>
                ))}
                <div ref={telemetryEndRef} />
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* ── FLOATING CHATS ── */}
      <div className="fixed bottom-0 right-4 z-50 hidden md:flex items-end gap-3">
        {activeChats.map(chat => (
          <div key={chat.agentId} className="chat-window"
            style={{ height: chat.isMinimized ? "44px" : "400px" }}>
            <div className="chat-header" onClick={() => toggleMinimizeMessenger(chat.agentId)}>
              <div className="flex items-center gap-2">
                <img src={chat.avatar} alt={chat.name} className="w-6 h-6 rounded object-cover border border-white/10" />
                <span className="text-sm font-bold">{chat.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={e => { e.stopPropagation(); toggleMinimizeMessenger(chat.agentId); }}
                  className="text-lg opacity-70 hover:opacity-100">⬜</button>
                <button onClick={e => { e.stopPropagation(); closeMessengerChat(chat.agentId); }}
                  className="text-lg opacity-70 hover:opacity-100">✕</button>
              </div>
            </div>
            {!chat.isMinimized && (
              <>
                <div className="chat-body">
                  {chat.messages.map((m, i) => (
                    <div key={i} className={`chat-msg ${m.role}`}>{m.text}</div>
                  ))}
                  {chat.isLoading && <div className="text-[10px] font-mono animate-pulse-opacity" style={{ color: resolvedColors.headerColor }}>Processing...</div>}
                  <div ref={directorEndRef} />
                </div>
                <div className="chat-input-row">
                  <input type="text" className="chat-input" value={chat.input}
                    onChange={e => setActiveChats(prev => prev.map(c => c.agentId === chat.agentId ? { ...c, input: e.target.value } : c))}
                    onKeyDown={e => e.key === "Enter" && sendMessengerMessage(chat.agentId)}
                    placeholder="Ask anything..." />
                  <button className="chat-send" onClick={() => sendMessengerMessage(chat.agentId)}
                    disabled={chat.isLoading || !chat.input.trim()}>Send</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}
