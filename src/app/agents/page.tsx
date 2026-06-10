"use client";
export const dynamic = "force-dynamic";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import Link from "next/link";
import { Send, Loader2, MessageSquare, Zap, ExternalLink, X } from "lucide-react";

const AGENTS = [
  { id: "director",         name: "Director",         icon: "🎯", role: "System Orchestrator",  color: "#00ffff", status: "online",  desc: "Coordinates multi-agent workflows, plans AI strategies, delegates tasks.",         systemPrompt: "You are Director, the master orchestrator of LiTTree Lab Studios. Help users plan AI strategies, design agent systems, and coordinate workflows. Be decisive, strategic, concise.", tags: ["Strategy","Planning","Automation"] },
  { id: "champion",         name: "Champion",          icon: "🏆", role: "General Assistant",    color: "#ff0080", status: "online",  desc: "Your all-purpose AI partner. Brainstorm, research, analyse, execute.",             systemPrompt: "You are Champion, the general assistant of LiTTree Lab Studios. Help with anything — questions, brainstorming, research, writing, analysis. Be helpful, direct, and thorough.", tags: ["Research","Brainstorm","General"] },
  { id: "code-champion",    name: "Code Champion",     icon: "💻", role: "Software Engineer",    color: "#00ff41", status: "online",  desc: "Writes, reviews, debugs, and explains code across all languages.",                 systemPrompt: "You are Code Champion, a senior software engineer at LiTTree Lab Studios. Write clean, production-ready code. Always provide complete working examples. Support all languages.", tags: ["Code","Debug","Architecture"] },
  { id: "social-dominator", name: "Social Dominator",  icon: "📱", role: "Growth Marketer",      color: "#ff6b6b", status: "online",  desc: "Crafts viral content, growth strategies and social media campaigns.",              systemPrompt: "You are Social Dominator, a growth hacker at LiTTree Lab Studios. Write viral posts, craft content strategies, and help users grow their audience. Be bold and results-focused.", tags: ["Content","Growth","SEO"] },
  { id: "data-slayer",      name: "Data Slayer",       icon: "📊", role: "Analytics Engineer",   color: "#ffff00", status: "online",  desc: "Analyses data, builds models, surfaces insights and predicts trends.",             systemPrompt: "You are Data Slayer, a data scientist at LiTTree Lab Studios. Analyse data, explain statistics, suggest models, provide actionable insights. Be precise and data-driven.", tags: ["Analytics","ML","Statistics"] },
  { id: "writing-coach",    name: "Writing Coach",     icon: "✍️", role: "Content Publisher",    color: "#ff9ff3", status: "online",  desc: "Elevates writing quality — editing, tone, copywriting, storytelling.",             systemPrompt: "You are Writing Coach, a master copywriter at LiTTree Lab Studios. Help users write better — improve clarity, adjust tone, edit drafts, write compelling copy.", tags: ["Writing","Editing","Copy"] },
  { id: "music-producer",   name: "Music Producer",    icon: "🎵", role: "Audio Engineer",       color: "#9b59b6", status: "away",   desc: "Generates music concepts, lyrics and audio production ideas from prompts.",        systemPrompt: "You are Music Producer, a creative AI music producer at LiTTree Lab Studios. Help users create original music. Suggest song ideas, write lyrics, describe musical styles.", tags: ["Music","Audio","Creative"] },
  { id: "pixel-forge",      name: "Pixel Forge",       icon: "🎨", role: "Visual Artist",        color: "#22d3ee", status: "online",  desc: "Creates image concepts, design briefs and visual world-building directions.",      systemPrompt: "You are Pixel Forge, a visionary visual artist at LiTTree Lab Studios. Help with image concepts, design direction, visual prompts, and creative world-building. Be vivid and imaginative.", tags: ["Design","Art","Visuals"] },
];

const QUICK: Record<string, string[]> = {
  "director":         ["Build me an agent system for my SaaS", "What agents do I need for marketing automation?"],
  "champion":         ["Give me 5 startup ideas in AI", "Help me plan my week"],
  "code-champion":    ["Write a Next.js API route for authentication", "Debug: Cannot read property of undefined"],
  "social-dominator": ["Write 3 viral tweets about AI productivity", "Create a LinkedIn content strategy"],
  "data-slayer":      ["How do I measure user churn?", "Explain precision vs recall simply"],
  "writing-coach":    ["Improve this sentence: [paste yours]", "Write a punchy product description"],
  "music-producer":   ["Give me a lo-fi study beat concept", "Write lyrics for an upbeat motivational song"],
  "pixel-forge":      ["Describe a cyberpunk city scene for image gen", "Give me a color palette for a dark SaaS UI"],
};

type Msg = { role: "user" | "agent"; text: string };

export default function AgentsPage() {
  const { resolvedColors: T } = useTheme();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, Msg[]>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const endRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const activeAgent = AGENTS.find(a => a.id === activeId);

  useEffect(() => {
    if (activeId) endRefs.current[activeId]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chats, activeId]);

  const send = async (agentId: string, text?: string) => {
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) return;
    const content = text || inputs[agentId] || "";
    if (!content.trim() || loading[agentId]) return;
    setInputs(p => ({ ...p, [agentId]: "" }));
    setLoading(p => ({ ...p, [agentId]: true }));
    const userMsg: Msg = { role: "user", text: content.trim() };
    setChats(p => ({ ...p, [agentId]: [...(p[agentId] || [{ role: "agent", text: `Hi! I''m ${agent.name}. ${agent.desc} Ask me anything!` }]), userMsg] }));
    try {
      const res = await fetch("/api/gemini", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content.trim(), systemPrompt: agent.systemPrompt }),
      });
      const data = await res.json();
      setChats(p => ({ ...p, [agentId]: [...(p[agentId] || []), { role: "agent", text: data.response || "No response." }] }));
    } catch {
      setChats(p => ({ ...p, [agentId]: [...(p[agentId] || []), { role: "agent", text: "Connection error. Try again." }] }));
    }
    setLoading(p => ({ ...p, [agentId]: false }));
  };

  const openAgent = (id: string) => {
    setActiveId(id);
    if (!chats[id]) {
      const agent = AGENTS.find(a => a.id === id)!;
      setChats(p => ({ ...p, [id]: [{ role: "agent", text: `Hi! I''m ${agent.name}, your ${agent.role}. ${agent.desc} What can I help you with?` }] }));
    }
  };

  return (
    <div className="min-h-screen font-mono" style={{ backgroundColor: T.bgColor, color: T.textColor }}>

      {/* Header */}
      <div className="border-b px-6 py-5" style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "60" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black tracking-tight" style={{ color: T.headerColor }}>
              <span style={{ color: T.accentColor }}>⚡</span> Agent Directory
            </h1>
            <p className="text-xs mt-0.5 opacity-50" style={{ color: T.textMuted }}>
              {AGENTS.filter(a => a.status === "online").length} agents online · Click any card to open live chat
            </p>
          </div>
          <Link href="/studio?tool=agents"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
            style={{ backgroundColor: T.accentColor, color: "#0a0a0f" }}>
            <Zap size={12} /> Open Studio
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-5" style={{ minHeight: "calc(100vh - 130px)" }}>

        {/* Agent grid */}
        <div className={`grid gap-4 content-start transition-all ${activeAgent ? "w-[340px] shrink-0 grid-cols-1" : "flex-1 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
          {AGENTS.map(agent => {
            const isActive = activeId === agent.id;
            const msgCount = (chats[agent.id] || []).filter(m => m.role === "user").length;
            return (
              <div key={agent.id} onClick={() => openAgent(agent.id)}
                className="rounded-xl p-4 cursor-pointer transition-all hover:scale-[1.02] group relative overflow-hidden"
                style={{
                  backgroundColor: isActive ? agent.color + "12" : T.boxBg,
                  border: `1.5px solid ${isActive ? agent.color + "60" : T.borderColor + "20"}`,
                  boxShadow: isActive ? `0 0 20px ${agent.color}20` : "none",
                }}>
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: `radial-gradient(circle at top right, ${agent.color}06, transparent 60%)` }} />

                <div className="flex items-start justify-between mb-3 relative">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl" style={{ backgroundColor: agent.color + "12", border: `1px solid ${agent.color}25` }}>
                    {agent.icon}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${agent.status === "online" ? "bg-green-400" : "bg-amber-400"}`}
                      style={{ boxShadow: `0 0 6px ${agent.status === "online" ? "#22c55e" : "#f59e0b"}` }} />
                    <span className="text-[9px] font-bold uppercase" style={{ color: agent.status === "online" ? "#22c55e" : "#f59e0b" }}>
                      {agent.status}
                    </span>
                  </div>
                </div>

                <div className="relative">
                  <div className="text-sm font-bold mb-0.5" style={{ color: isActive ? agent.color : T.headerColor }}>{agent.name}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider mb-2 opacity-60" style={{ color: T.textMuted }}>{agent.role}</div>
                  {!activeAgent && <p className="text-[10px] leading-relaxed opacity-60 mb-3 line-clamp-2" style={{ color: T.textColor }}>{agent.desc}</p>}
                  <div className={`flex flex-wrap gap-1 ${activeAgent ? "hidden" : ""}`}>
                    {agent.tags.map(tag => (
                      <span key={tag} className="text-[8px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: agent.color + "12", color: agent.color, border: `1px solid ${agent.color}25` }}>{tag}</span>
                    ))}
                  </div>
                  {msgCount > 0 && (
                    <div className="mt-2 flex items-center gap-1 text-[9px]" style={{ color: T.textMuted }}>
                      <MessageSquare size={8} /> {msgCount} msg{msgCount > 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Live chat panel */}
        {activeAgent && (
          <div className="flex-1 flex flex-col rounded-xl overflow-hidden min-h-0"
            style={{ backgroundColor: T.boxBg, border: `1.5px solid ${activeAgent.color}30`, boxShadow: `0 0 30px ${activeAgent.color}10` }}>

            {/* Chat header */}
            <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: activeAgent.color + "20", backgroundColor: activeAgent.color + "08" }}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{activeAgent.icon}</span>
                <div>
                  <div className="text-sm font-bold" style={{ color: activeAgent.color }}>{activeAgent.name}</div>
                  <div className="text-[9px] opacity-60" style={{ color: T.textMuted }}>{activeAgent.role} · Live via Gemini</div>
                </div>
                <span className="w-2 h-2 rounded-full animate-pulse bg-green-400" style={{ boxShadow: "0 0 6px #22c55e" }} />
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/agents/${activeAgent.id}`} title="Full page"
                  className="p-1.5 rounded-lg opacity-60 hover:opacity-100 transition-all"
                  style={{ color: T.textMuted }}>
                  <ExternalLink size={12} />
                </Link>
                <button onClick={() => setActiveId(null)}
                  className="p-1.5 rounded-lg opacity-60 hover:opacity-100 transition-all"
                  style={{ color: T.textMuted }}>
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: "none" }}>
              {(chats[activeAgent.id] || []).map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] shrink-0 mt-0.5"
                    style={{ backgroundColor: msg.role === "user" ? T.accentColor + "20" : activeAgent.color + "20", border: `1px solid ${msg.role === "user" ? T.accentColor + "40" : activeAgent.color + "40"}` }}>
                    {msg.role === "user" ? "U" : activeAgent.icon}
                  </div>
                  <div className="max-w-[80%] px-3 py-2 rounded-xl text-xs leading-relaxed"
                    style={{
                      backgroundColor: msg.role === "user" ? T.accentColor + "10" : T.bgColor,
                      border: `1px solid ${msg.role === "user" ? T.accentColor + "25" : T.borderColor + "20"}`,
                      color: T.textColor,
                      borderTopRightRadius: msg.role === "user" ? "4px" : undefined,
                      borderTopLeftRadius: msg.role !== "user" ? "4px" : undefined,
                    }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {loading[activeAgent.id] && (
                <div className="flex gap-2 items-center">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px]" style={{ backgroundColor: activeAgent.color + "20", border: `1px solid ${activeAgent.color}40` }}>{activeAgent.icon}</div>
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}20`, color: activeAgent.color }}>
                    <Loader2 size={10} className="animate-spin" /> thinking...
                  </div>
                </div>
              )}
              <div ref={el => { endRefs.current[activeAgent.id] = el; }} />
            </div>

            {/* Quick prompts */}
            {!(chats[activeAgent.id] || []).find(m => m.role === "user") && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                {(QUICK[activeAgent.id] || []).map(q => (
                  <button key={q} onClick={() => send(activeAgent.id, q)}
                    className="text-[10px] px-2.5 py-1 rounded-full border transition-all hover:scale-105"
                    style={{ borderColor: activeAgent.color + "40", color: activeAgent.color, backgroundColor: activeAgent.color + "08" }}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: T.borderColor + "15" }}>
              <div className="flex gap-2">
                <input
                  value={inputs[activeAgent.id] || ""}
                  onChange={e => setInputs(p => ({ ...p, [activeAgent.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") send(activeAgent.id); }}
                  disabled={loading[activeAgent.id]}
                  placeholder={`Message ${activeAgent.name}...`}
                  className="flex-1 px-3 py-2 text-xs rounded-lg outline-none disabled:opacity-50"
                  style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                <button onClick={() => send(activeAgent.id)} disabled={!inputs[activeAgent.id]?.trim() || loading[activeAgent.id]}
                  className="px-3 py-2 rounded-lg font-bold disabled:opacity-30 transition-all hover:scale-105"
                  style={{ backgroundColor: activeAgent.color, color: "#0a0a0f" }}>
                  <Send size={12} />
                </button>
              </div>
              <div className="text-[8px] mt-1.5 opacity-30 text-center" style={{ color: T.textMuted }}>Powered by Gemini · Enter to send</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}