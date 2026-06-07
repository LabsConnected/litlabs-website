"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@clerk/nextjs";
import { Send, Plus, Trash2, Loader2, Zap, Bot } from "lucide-react";

/* ─── Types ──────────────────────────────────────────────────────────── */
type Agent = {
  id: string;
  name: string;
  icon: string;
  role: string;
  desc: string;
  systemPrompt: string;
  color: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
};

/* ─── Built-in Agents ────────────────────────────────────────────────── */
const AGENTS: Agent[] = [
  { id: "director", name: "Director", icon: "🎯", role: "Orchestrator", desc: "Coordinates strategy, builds other agents, and delegates tasks across the platform.", systemPrompt: "You are Director, the master orchestrator of LiTTree Lab Studios. You help users plan AI strategies, design agent systems, and coordinate workflows. Be decisive, strategic, and concise. Give actionable plans.", color: "#00ffff" },
  { id: "champion", name: "Champion", icon: "🏆", role: "General Assistant", desc: "Your all-purpose AI partner. Ask anything — brainstorm, research, plan, execute.", systemPrompt: "You are Champion, the general assistant of LiTTree Lab Studios. You help with anything — answering questions, brainstorming ideas, research, writing, analysis. Be helpful, direct, and thorough.", color: "#ff0080" },
  { id: "code-champion", name: "Code Champion", icon: "💻", role: "Software Engineer", desc: "Writes, reviews, debugs, and explains code across all languages and frameworks.", systemPrompt: "You are Code Champion, a senior software engineer at LiTTree Lab Studios. You write clean, production-ready code. Always provide complete working examples. Explain your reasoning. Support all languages and frameworks.", color: "#00ff41" },
  { id: "social-dominator", name: "Social Dominator", icon: "📱", role: "Growth & Content", desc: "Creates viral content, growth strategies, and social media campaigns.", systemPrompt: "You are Social Dominator, a growth hacker and content creator at LiTTree Lab Studios. You write viral posts, craft content strategies, and help users grow their audience. Be bold, creative, and results-focused.", color: "#ff6b6b" },
  { id: "data-slayer", name: "Data Slayer", icon: "📊", role: "Data Scientist", desc: "Analyzes data, builds models, creates visualizations, and surfaces insights.", systemPrompt: "You are Data Slayer, a data scientist at LiTTree Lab Studios. You analyze data, explain statistics, suggest models, and provide actionable insights. Be precise and data-driven.", color: "#ffff00" },
  { id: "writing-coach", name: "Writing Coach", icon: "✍️", role: "Content Writer", desc: "Elevates writing quality — editing, tone adjustment, copywriting, storytelling.", systemPrompt: "You are Writing Coach, a master copywriter at LiTTree Lab Studios. You help users write better — improve clarity, adjust tone, edit drafts, write compelling copy. Be constructive and show before/after examples.", color: "#ff9ff3" },
  { id: "music-producer", name: "Music Producer", icon: "🎵", role: "Music Generation", desc: "Creates original music from text prompts and lyrics.", systemPrompt: "You are Music Producer, a creative AI music producer at LiTTree Lab Studios. You help users create original music. Suggest song ideas, write lyrics, describe musical styles. Be creative and musical.", color: "#9b59b6" },
];

const QUICK: Record<string, string[]> = {
  director: ["Build me an agent system for my business", "What agents do I need to automate my workflow?", "Create a 30-day AI roadmap for me"],
  champion: ["Summarize key AI trends right now", "Help me brainstorm 10 startup ideas", "What should I focus on today?"],
  "code-champion": ["Write a React component for a chat interface", "Debug: TypeError cannot read property of undefined", "Explain async/await vs Promises"],
  "social-dominator": ["Write 5 viral Twitter threads about AI", "Create a content calendar for this month", "Write a LinkedIn post about my AI project"],
  "data-slayer": ["How do I analyze user retention data?", "Explain precision vs recall", "Create a Python script to clean CSV data"],
  "writing-coach": ["Rewrite this to sound more professional", "Write a compelling bio for a tech founder", "What makes a great hook for a blog post?"],
  "music-producer": ["Generate a lo-fi hip hop beat for studying", "Create a melancholic indie folk song about rainy nights", "Write lyrics for a love song"],
};

const STORAGE_KEY = "litlabs-agent-chat";

export default function AgentTool() {
  const { resolvedColors: T } = useTheme();
  const { userId } = useAuth();
  const [selectedAgent, setSelectedAgent] = useState<Agent>(AGENTS[0]);
  const [chatMap, setChatMap] = useState<Record<string, Message[]>>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [customAgents, setCustomAgents] = useState<Agent[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", slug: "", description: "", category: "general", systemPrompt: "", personality: "", icon: "🤖" });
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const allAgents = [...AGENTS, ...customAgents];
  const messages = chatMap[selectedAgent.id] || [];

  /* Persist chats */
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(chatMap)); }, [chatMap]);

  /* Auto scroll */
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming]);

  /* Fetch custom agents */
  useEffect(() => {
    fetch("/api/agents?mine=true")
      .then(r => r.json())
      .then((data: { agents?: Array<{ name: string; slug: string; description: string | null; category: string; avatar_url: string | null; system_prompt: string; personality: string | null }> }) => {
        if (data.agents) {
          setCustomAgents(data.agents.map(a => ({
            id: a.slug, name: a.name, icon: a.avatar_url || "🤖", role: a.category,
            desc: a.description || `Custom ${a.category} agent`, systemPrompt: a.system_prompt, color: "#ff0080",
          })));
        }
      })
      .catch(() => {});
  }, []);

  const switchAgent = useCallback((agent: Agent) => { setSelectedAgent(agent); setStreaming(""); }, []);
  const clearChat = useCallback(() => { setChatMap(prev => ({ ...prev, [selectedAgent.id]: [] })); setStreaming(""); }, [selectedAgent.id]);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;
    setInput("");
    setIsLoading(true);
    setStreaming("");

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content, ts: new Date().toLocaleTimeString() };
    setChatMap(prev => ({ ...prev, [selectedAgent.id]: [...(prev[selectedAgent.id] || []), userMsg] }));

    try {
      const history = [...(chatMap[selectedAgent.id] || []), userMsg].map(m => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/gemini/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, systemPrompt: selectedAgent.systemPrompt, stream: true }),
      });
      if (!res.ok) throw new Error("API error");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n\n")) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try { const parsed = JSON.parse(data); if (parsed.text) { full += parsed.text; setStreaming(full); } } catch {}
          }
        }
      }

      if (full) {
        const assistantMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: full, ts: new Date().toLocaleTimeString() };
        setChatMap(prev => ({ ...prev, [selectedAgent.id]: [...(prev[selectedAgent.id] || []), assistantMsg] }));
        setStreaming("");
      }
    } catch {
      setChatMap(prev => ({ ...prev, [selectedAgent.id]: [...(prev[selectedAgent.id] || []), { id: crypto.randomUUID(), role: "assistant", content: "⚠️ Connection error. Check API configuration.", ts: new Date().toLocaleTimeString() }] }));
      setStreaming("");
    }
    setIsLoading(false);
  }, [input, isLoading, selectedAgent, chatMap]);

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  const handleCreate = async () => {
    if (!createForm.name.trim() || !createForm.slug.trim() || !createForm.systemPrompt.trim()) {
      setCreateError("Name, slug, and system prompt are required."); return;
    }
    setCreating(true); setCreateError("");
    try {
      const res = await fetch("/api/agents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createForm.name, slug: createForm.slug, description: createForm.description, category: createForm.category, system_prompt: createForm.systemPrompt, personality: createForm.personality, avatar_url: createForm.icon }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error || "Failed to create agent"); setCreating(false); return; }
      const newAgent: Agent = { id: data.agent.slug, name: data.agent.name, icon: data.agent.avatar_url || "🤖", role: data.agent.category, desc: data.agent.description || `Custom ${data.agent.category} agent`, systemPrompt: data.agent.system_prompt, color: "#ff0080" };
      setCustomAgents(prev => [...prev, newAgent]);
      setShowCreate(false);
      setCreateForm({ name: "", slug: "", description: "", category: "general", systemPrompt: "", personality: "", icon: "🤖" });
      switchAgent(newAgent);
    } catch { setCreateError("Network error. Try again."); }
    setCreating(false);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Agent list */}
      <div className="w-[200px] shrink-0 border-r flex flex-col overflow-y-auto" style={{ borderColor: T.borderColor + "30", backgroundColor: T.boxBg + "80" }}>
        <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: T.borderColor + "20" }}>
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.accentColor }}>Agents ({allAgents.length})</span>
          <button onClick={() => setShowCreate(true)} className="text-[9px] px-1.5 py-0.5 rounded border font-bold" style={{ borderColor: T.accentColor, color: T.accentColor }}><Plus size={10} className="inline" /></button>
        </div>
        <div className="p-1.5 space-y-0.5">
          {allAgents.map(a => (
            <button key={a.id} onClick={() => switchAgent(a)}
              className="w-full flex items-center gap-2 px-2 py-2 text-left text-[11px] font-bold rounded transition-all"
              style={{
                backgroundColor: selectedAgent.id === a.id ? T.accentColor + "15" : "transparent",
                borderLeft: selectedAgent.id === a.id ? `3px solid ${a.color}` : "3px solid transparent",
                color: selectedAgent.id === a.id ? a.color : T.textColor,
              }}>
              <span className="text-base">{a.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="truncate">{a.name}</div>
                <div className="text-[9px] opacity-60 font-normal truncate" style={{ color: T.textMuted }}>{a.role}</div>
              </div>
              {selectedAgent.id === a.id && <span className="text-[8px]">●</span>}
            </button>
          ))}
        </div>
        <div className="mt-auto px-2 py-2 border-t text-[9px] font-mono" style={{ borderColor: T.borderColor + "20", color: T.textMuted }}>
          <div className="flex justify-between"><span>Agents</span><span>{allAgents.length}</span></div>
          <div className="flex justify-between"><span>Msgs</span><span>{messages.length}</span></div>
        </div>
      </div>

      {/* Center: Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-10 border-b shrink-0" style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "60" }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">{selectedAgent.icon}</span>
            <div>
              <div className="text-xs font-bold" style={{ color: selectedAgent.color }}>{selectedAgent.name}</div>
              <div className="text-[9px] opacity-60" style={{ color: T.textMuted }}>{selectedAgent.role}</div>
            </div>
          </div>
          <button onClick={clearChat} className="text-[10px] opacity-50 hover:opacity-100 flex items-center gap-1" style={{ color: T.textMuted }}><Trash2 size={10} /> Clear</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && !streaming && (
            <div className="text-center pt-8">
              <div className="text-4xl mb-3">{selectedAgent.icon}</div>
              <div className="text-sm font-bold mb-1" style={{ color: selectedAgent.color }}>{selectedAgent.name}</div>
              <div className="text-xs opacity-60 max-w-sm mx-auto mb-4" style={{ color: T.textMuted }}>{selectedAgent.desc}</div>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
                {(QUICK[selectedAgent.id] || []).map(q => (
                  <button key={q} onClick={() => sendMessage(q)} className="px-2.5 py-1 text-[10px] rounded border hover:opacity-80" style={{ borderColor: T.borderColor, color: T.linkColor, backgroundColor: T.bgColor }}>{q}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[85%] px-3 py-2 rounded-lg text-xs" style={{
                backgroundColor: msg.role === "user" ? T.accentColor + "12" : T.boxBg,
                border: `1px solid ${msg.role === "user" ? T.accentColor + "30" : T.borderColor + "30"}`,
                color: T.textColor,
              }}>
                <div className="text-[9px] font-bold mb-1 flex items-center gap-1" style={{ color: msg.role === "user" ? T.accentColor : T.linkColor }}>
                  {msg.role === "user" ? "▶ You" : `${selectedAgent.icon} ${selectedAgent.name}`} · {msg.ts}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
              </div>
            </div>
          ))}
          {streaming && (
            <div className="flex justify-start">
              <div className="max-w-[85%] px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}30`, color: T.textColor }}>
                <div className="text-[9px] font-bold mb-1" style={{ color: T.linkColor }}>{selectedAgent.icon} {selectedAgent.name}</div>
                <div className="whitespace-pre-wrap leading-relaxed">{streaming}<span className="animate-pulse">▊</span></div>
              </div>
            </div>
          )}
          {isLoading && !streaming && (
            <div className="flex justify-start">
              <div className="px-3 py-2 rounded-lg text-[11px] flex items-center gap-1.5" style={{ border: `1px solid ${T.borderColor}30`, color: T.linkColor }}>
                <Loader2 size={12} className="animate-spin" /> {selectedAgent.name} is thinking...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-2 border-t shrink-0" style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "60" }}>
          <div className="flex gap-2">
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
              placeholder={`Message ${selectedAgent.name}...`} rows={1} disabled={isLoading}
              className="flex-1 px-3 py-2 text-sm rounded outline-none resize-none min-h-[40px] max-h-[100px] disabled:opacity-50"
              style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
            <button onClick={() => sendMessage()} disabled={!input.trim() || isLoading}
              className="px-4 py-2 rounded font-bold text-sm disabled:opacity-40 transition-all hover:scale-105"
              style={{ backgroundColor: T.linkColor, color: T.bgColor }}>
              <Send size={14} />
            </button>
          </div>
          <div className="text-[9px] mt-1 opacity-40" style={{ color: T.textMuted }}>Powered by Gemini · Shift+Enter for new line</div>
        </div>
      </div>

      {/* Right: Agent info */}
      <div className="hidden xl:block w-[180px] shrink-0 border-l overflow-y-auto" style={{ borderColor: T.borderColor + "30", backgroundColor: T.boxBg + "60" }}>
        <div className="p-3 text-center border-b" style={{ borderColor: T.borderColor + "20" }}>
          <div className="text-3xl mb-1">{selectedAgent.icon}</div>
          <div className="text-xs font-bold" style={{ color: selectedAgent.color }}>{selectedAgent.name}</div>
          <div className="text-[9px] opacity-60" style={{ color: T.textMuted }}>{selectedAgent.role}</div>
        </div>
        <div className="p-3">
          <div className="text-[9px] uppercase tracking-widest mb-1.5 font-bold" style={{ color: T.accentColor }}>About</div>
          <p className="text-[10px] leading-relaxed opacity-70 mb-4" style={{ color: T.textColor }}>{selectedAgent.desc}</p>
          <div className="text-[9px] uppercase tracking-widest mb-1.5 font-bold" style={{ color: T.accentColor }}>System Prompt</div>
          <p className="text-[9px] opacity-50 leading-relaxed" style={{ color: T.textMuted }}>{selectedAgent.systemPrompt}</p>
        </div>
      </div>

      {/* Create Agent Modal */}
      {showCreate && (
        <div onClick={() => setShowCreate(false)} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.85)" }}>
          <div onClick={e => e.stopPropagation()} className="max-w-md w-full rounded-lg border p-5 space-y-3" style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold" style={{ color: T.headerColor }}>Create Agent</h2>
              <button onClick={() => setShowCreate(false)} className="text-lg" style={{ color: T.textColor }}>✕</button>
            </div>
            {createError && <div className="text-[11px] px-2 py-1.5 rounded border" style={{ borderColor: "#f85149", color: "#f85149", backgroundColor: "#f8514910" }}>{createError}</div>}
            <div className="space-y-2">
              <div>
                <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.accentColor }}>Name</label>
                <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g. Crypto Analyst" className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
              </div>
              <div>
                <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.accentColor }}>Slug (URL ID)</label>
                <input value={createForm.slug} onChange={e => setCreateForm({ ...createForm, slug: e.target.value })} placeholder="crypto-analyst" className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
              </div>
              <div>
                <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.accentColor }}>Category</label>
                <select value={createForm.category} onChange={e => setCreateForm({ ...createForm, category: e.target.value })} className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}>
                  {["general","developer","marketing","analytics","content","design","research","legal"].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.accentColor }}>Description</label>
                <input value={createForm.description} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} placeholder="Short description..." className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
              </div>
              <div>
                <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.accentColor }}>System Prompt *</label>
                <textarea value={createForm.systemPrompt} onChange={e => setCreateForm({ ...createForm, systemPrompt: e.target.value })} placeholder="You are Crypto Analyst, a specialist in blockchain markets..." rows={3} className="w-full px-2 py-1.5 text-xs rounded outline-none resize-none" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.accentColor }}>Personality</label>
                  <input value={createForm.personality} onChange={e => setCreateForm({ ...createForm, personality: e.target.value })} placeholder="Bold, analytical..." className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
                </div>
                <div>
                  <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.accentColor }}>Icon</label>
                  <input value={createForm.icon} onChange={e => setCreateForm({ ...createForm, icon: e.target.value })} placeholder="🤖" className="w-full px-2 py-1.5 text-xs rounded outline-none text-center" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
                </div>
              </div>
              <button onClick={handleCreate} disabled={creating}
                className="w-full py-2 text-xs font-bold rounded disabled:opacity-50"
                style={{ backgroundColor: T.linkColor, color: T.bgColor }}>
                {creating ? "Creating..." : "Create Agent"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
