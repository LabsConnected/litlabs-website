"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTheme } from "@/context/ThemeContext";

const ClerkUserWidget = dynamic(
  () => import("@/components/ClerkUser").then(m => ({ default: m.ClerkUserWidget })),
  { ssr: false }
);

const ClerkUserCompact = dynamic(
  () => import("@/components/ClerkUser").then(m => ({ default: (props: object) => <m.ClerkUserWidget compact {...props} /> })),
  { ssr: false }
);

const ACTIVEPIECES_WEBHOOK = "https://cloud.activepieces.com/api/v1/webhooks/VoccE3SEr4bciLvkThTlO";

// ─── Theme ───────────────────────────────────────────────────────────────────
// Resolved inside component from useTheme()

// ─── Built-in Agents ──────────────────────────────────────────────────────────
type Agent = {
  id: string;
  name: string;
  icon: string;
  role: string;
  desc: string;
  systemPrompt: string;
  color: string;
};

const AGENTS: Agent[] = [
  {
    id: "director",
    name: "Director",
    icon: "🎯",
    role: "Orchestrator",
    desc: "Coordinates strategy, builds other agents, and delegates tasks across the platform.",
    systemPrompt: "You are Director, the master orchestrator of LiTTree Lab Studios. You help users plan AI strategies, design agent systems, and coordinate workflows. Be decisive, strategic, and concise. Give actionable plans.",
    color: "#00ffff",
  },
  {
    id: "champion",
    name: "Champion",
    icon: "🏆",
    role: "General Assistant",
    desc: "Your all-purpose AI partner. Ask anything — brainstorm, research, plan, execute.",
    systemPrompt: "You are Champion, the general assistant of LiTTree Lab Studios. You help with anything — answering questions, brainstorming ideas, research, writing, analysis. Be helpful, direct, and thorough.",
    color: "#ff0080",
  },
  {
    id: "code-champion",
    name: "Code Champion",
    icon: "💻",
    role: "Software Engineer",
    desc: "Writes, reviews, debugs, and explains code across all languages and frameworks.",
    systemPrompt: "You are Code Champion, a senior software engineer at LiTTree Lab Studios. You write clean, production-ready code. Always provide complete working examples. Explain your reasoning. Support all languages and frameworks.",
    color: "#00ff41",
  },
  {
    id: "social-dominator",
    name: "Social Dominator",
    icon: "📱",
    role: "Growth & Content",
    desc: "Creates viral content, growth strategies, and social media campaigns.",
    systemPrompt: "You are Social Dominator, a growth hacker and content creator at LiTTree Lab Studios. You write viral posts, craft content strategies, and help users grow their audience. Be bold, creative, and results-focused.",
    color: "#ff6b6b",
  },
  {
    id: "data-slayer",
    name: "Data Slayer",
    icon: "📊",
    role: "Data Scientist",
    desc: "Analyzes data, builds models, creates visualizations, and surfaces insights.",
    systemPrompt: "You are Data Slayer, a data scientist at LiTTree Lab Studios. You analyze data, explain statistics, suggest models, and provide actionable insights. Be precise and data-driven.",
    color: "#ffff00",
  },
  {
    id: "writing-coach",
    name: "Writing Coach",
    icon: "✍️",
    role: "Content Writer",
    desc: "Elevates writing quality — editing, tone adjustment, copywriting, storytelling.",
    systemPrompt: "You are Writing Coach, a master copywriter at LiTTree Lab Studios. You help users write better — improve clarity, adjust tone, edit drafts, write compelling copy. Be constructive and show before/after examples.",
    color: "#ff9ff3",
  },
  {
    id: "music-producer",
    name: "Music Producer",
    icon: "🎵",
    role: "Music Generation",
    desc: "Creates original music from text prompts and lyrics. Generates songs, instrumentals, and covers with AI.",
    systemPrompt: "You are Music Producer, a creative AI music producer at LiTTree Lab Studios. You help users create original music. Suggest song ideas, write lyrics, describe musical styles, and explain the music generation process. When users ask you to make music, guide them on what prompt and lyrics to use. Be creative and musical.",
    color: "#9b59b6",
  },
];

// ─── Message type ─────────────────────────────────────────────────────────────
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
};

// ─── Quick prompts ────────────────────────────────────────────────────────────
const QUICK: Record<string, string[]> = {
  director: ["Build me an agent system for my business", "What agents do I need to automate my workflow?", "Create a 30-day AI roadmap for me"],
  champion: ["Summarize the key trends in AI right now", "Help me brainstorm 10 startup ideas", "What should I focus on today?"],
  "code-champion": ["Write a React component for a chat interface", "Debug this: TypeError: cannot read property of undefined", "Explain async/await vs Promises"],
  "social-dominator": ["Write 5 viral Twitter threads about AI", "Create a content calendar for this month", "Write a LinkedIn post about my AI project"],
  "data-slayer": ["How do I analyze user retention data?", "Explain the difference between precision and recall", "Create a Python script to clean CSV data"],
  "writing-coach": ["Rewrite this to sound more professional: [paste text]", "Write a compelling bio for a tech founder", "What makes a great hook for a blog post?"],
  "music-producer": ["Generate a lo-fi hip hop beat for studying", "Create a melancholic indie folk song about rainy nights", "Make an upbeat electronic dance track", "Write lyrics for a love song and generate the music"],
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function Builder() {
  const { resolvedColors } = useTheme();
  const T = {
    bg: resolvedColors.bgColor,
    text: resolvedColors.textColor,
    link: resolvedColors.linkColor,
    header: resolvedColors.headerColor,
    border: resolvedColors.borderColor,
    accent: resolvedColors.accentColor,
    box: resolvedColors.boxBg,
    input: resolvedColors.bgColor,
  };

  const [selectedAgent, setSelectedAgent] = useState<Agent>(AGENTS[0]);
  const [chatMap, setChatMap] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Music generation state
  const [musicPrompt, setMusicPrompt] = useState("");
  const [musicLyrics, setMusicLyrics] = useState("");
  const [musicModel, setMusicModel] = useState("music-2.6-free");
  const [musicResult, setMusicResult] = useState<{audio?: string; status?: number; extraInfo?: Record<string, unknown>} | null>(null);
  const [isGeneratingMusic, setIsGeneratingMusic] = useState(false);
  const [isInstrumental, setIsInstrumental] = useState(false);

  const [crtEnabled, setCrtEnabled] = useState(true);

  const messages = chatMap[selectedAgent.id] || [];

  useEffect(() => {
    // Load global CRT config
    const val = localStorage.getItem("crt_global_scanlines");
    if (val !== null) {
      setCrtEnabled(val === "true");
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const switchAgent = useCallback((agent: Agent) => {
    setSelectedAgent(agent);
    setStreaming("");
  }, []);

  const clearChat = useCallback(() => {
    setChatMap(prev => ({ ...prev, [selectedAgent.id]: [] }));
    setStreaming("");
  }, [selectedAgent.id]);

  const triggerFlow = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;

    setInput("");
    setIsLoading(true);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: `⚡ Sent to ActivePieces flow: "${content}"`,
      ts: new Date().toLocaleTimeString(),
    };
    setChatMap(prev => ({ ...prev, [selectedAgent.id]: [...(prev[selectedAgent.id] || []), userMsg] }));

    try {
      const res = await fetch(ACTIVEPIECES_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, agent: selectedAgent.name, source: "litlabs-builder" }),
      });
      const data = await res.json().catch(() => ({}));
      const reply = data?.output ?? data?.response ?? data?.result ?? "✅ Flow triggered — check ActivePieces for results.";
      setChatMap(prev => ({
        ...prev,
        [selectedAgent.id]: [
          ...(prev[selectedAgent.id] || []),
          { id: crypto.randomUUID(), role: "assistant", content: String(reply), ts: new Date().toLocaleTimeString() },
        ],
      }));
    } catch {
      setChatMap(prev => ({
        ...prev,
        [selectedAgent.id]: [
          ...(prev[selectedAgent.id] || []),
          { id: crypto.randomUUID(), role: "assistant", content: "⚠️ ActivePieces webhook error. Check that the flow is published.", ts: new Date().toLocaleTimeString() },
        ],
      }));
    }
    setIsLoading(false);
  }, [input, isLoading, selectedAgent]);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;

    setInput("");
    setIsLoading(true);
    setStreaming("");

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      ts: new Date().toLocaleTimeString(),
    };

    setChatMap(prev => ({
      ...prev,
      [selectedAgent.id]: [...(prev[selectedAgent.id] || []), userMsg],
    }));

    try {
      const history = [...(chatMap[selectedAgent.id] || []), userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          systemPrompt: selectedAgent.systemPrompt,
          stream: true,
        }),
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
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                full += parsed.text;
                setStreaming(full);
              }
            } catch { /* skip */ }
          }
        }
      }

      if (full) {
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: full,
          ts: new Date().toLocaleTimeString(),
        };
        setChatMap(prev => ({
          ...prev,
          [selectedAgent.id]: [...(prev[selectedAgent.id] || []), assistantMsg],
        }));
        setStreaming("");
      }
    } catch {
      setChatMap(prev => ({
        ...prev,
        [selectedAgent.id]: [
          ...(prev[selectedAgent.id] || []),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "⚠️ Connection error. Check your API key configuration.",
            ts: new Date().toLocaleTimeString(),
          },
        ],
      }));
      setStreaming("");
    }

    setIsLoading(false);
  }, [input, isLoading, selectedAgent, chatMap]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const generateMusic = useCallback(async () => {
    if (!musicPrompt.trim() || isGeneratingMusic) return;
    setIsGeneratingMusic(true);
    setMusicResult(null);
    try {
      const res = await fetch("/api/music/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: musicModel,
          prompt: musicPrompt.trim(),
          lyrics: musicLyrics.trim() || undefined,
          isInstrumental,
          outputFormat: "url",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMusicResult({
          audio: data.audio,
          status: data.status,
          extraInfo: data.extraInfo,
        });
      } else {
        setChatMap(prev => ({
          ...prev,
          [selectedAgent.id]: [
            ...(prev[selectedAgent.id] || []),
            { id: crypto.randomUUID(), role: "assistant", content: `🎵 Music generation failed: ${data.error || "Unknown error"}`, ts: new Date().toLocaleTimeString() },
          ],
        }));
      }
    } catch {
      setChatMap(prev => ({
        ...prev,
        [selectedAgent.id]: [
          ...(prev[selectedAgent.id] || []),
          { id: crypto.randomUUID(), role: "assistant", content: "🎵 Music generation error. Check MINIMAX_API_KEY configuration.", ts: new Date().toLocaleTimeString() },
        ],
      }));
    }
    setIsGeneratingMusic(false);
  }, [musicPrompt, musicLyrics, musicModel, isInstrumental, isGeneratingMusic, selectedAgent]);


  return (
    <div style={{ backgroundColor: T.bg, minHeight: "100vh", display: "flex", flexDirection: "column", color: T.text, fontFamily: "monospace", position: "relative" }}>
      {/* CRT Scanline Filter */}
      {crtEnabled && (
        <div className="fixed inset-0 pointer-events-none z-40 opacity-[0.06]" style={{
          background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 1px, transparent 1px, transparent 2px)",
          boxShadow: "inset 0 0 80px rgba(0, 255, 0, 0.3)"
        }} />
      )}
      {/* ── Top Nav ── */}
      <nav style={{ backgroundColor: T.box, borderBottom: `2px solid ${T.border}`, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <Link href="/" style={{ textDecoration: "none", color: T.header, fontWeight: "bold", fontSize: "14px", letterSpacing: "2px" }}>
          ⚡ LITLABS BUILDER
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ color: T.accent, fontSize: "10px" }}>● ONLINE</span>
          <Link href="/marketplace" style={{ color: T.link, fontSize: "11px", textDecoration: "none" }}>MARKETPLACE</Link>
          <Link href="/" style={{ color: T.text, fontSize: "11px", textDecoration: "none" }}>HOME</Link>
          <ClerkUserCompact />
        </div>
      </nav>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Left Sidebar ── */}
        <div style={{ width: "220px", flexShrink: 0, backgroundColor: T.box, borderRight: `2px solid ${T.border}`, display: "flex", flexDirection: "column", overflowY: "auto" }}>
          {/* Profile */}
          <div style={{ padding: "12px", borderBottom: `1px solid ${T.border}` }}>
            <ClerkUserWidget />
          </div>

          {/* Agent List */}
          <div style={{ padding: "8px" }}>
            <div style={{ color: T.accent, fontSize: "9px", letterSpacing: "1px", marginBottom: "6px", paddingLeft: "4px" }}>AGENTS ({AGENTS.length})</div>
            {AGENTS.map(a => (
              <button
                key={a.id}
                onClick={() => switchAgent(a)}
                style={{
                  width: "100%", textAlign: "left", padding: "8px", marginBottom: "3px", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", border: "none", backgroundColor: selectedAgent.id === a.id ? "rgba(255,0,128,0.15)" : "transparent", borderLeft: selectedAgent.id === a.id ? `3px solid ${a.color}` : "3px solid transparent", transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: "18px" }}>{a.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: selectedAgent.id === a.id ? a.color : T.header, fontSize: "11px", fontWeight: "bold" }}>{a.name}</div>
                  <div style={{ color: T.text, fontSize: "9px", opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.role}</div>
                </div>
                {selectedAgent.id === a.id && <span style={{ color: a.color, fontSize: "8px" }}>●</span>}
              </button>
            ))}
          </div>

          {/* Stats */}
          <div style={{ marginTop: "auto", padding: "8px", borderTop: `1px solid ${T.border}` }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
              {[["AGENTS", AGENTS.length], ["MSGS", messages.length]].map(([label, val]) => (
                <div key={label as string} style={{ textAlign: "center", padding: "6px", backgroundColor: "rgba(0,0,0,0.3)", border: `1px solid ${T.border}` }}>
                  <div style={{ color: T.accent, fontSize: "14px", fontWeight: "bold" }}>{val}</div>
                  <div style={{ color: T.text, fontSize: "8px" }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Chat Area ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Chat Header */}
          <div style={{ backgroundColor: T.box, borderBottom: `2px solid ${T.border}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
            <span style={{ fontSize: "22px" }}>{selectedAgent.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: selectedAgent.color, fontSize: "13px", fontWeight: "bold" }}>{selectedAgent.name}</div>
              <div style={{ color: T.text, fontSize: "10px", opacity: 0.7 }}>{selectedAgent.role} · {selectedAgent.desc.slice(0, 60)}...</div>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              {selectedAgent.id === "director" && (
                <button
                  onClick={() => triggerFlow()}
                  disabled={!input.trim() || isLoading}
                  title="Send to ActivePieces multi-agent flow"
                  style={{ padding: "4px 10px", fontSize: "10px", backgroundColor: input.trim() && !isLoading ? "rgba(255,255,0,0.15)" : "transparent", border: `1px solid ${T.accent}`, color: T.accent, cursor: input.trim() && !isLoading ? "pointer" : "not-allowed", fontWeight: "bold" }}
                >
                  ⚡ FLOW
                </button>
              )}
              <button onClick={clearChat} style={{ padding: "4px 10px", fontSize: "10px", backgroundColor: "transparent", border: `1px solid ${T.border}`, color: T.text, cursor: "pointer" }}>
                🗑 CLEAR
              </button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {messages.length === 0 && !streaming && (
              <div style={{ textAlign: "center", paddingTop: "40px" }}>
                <div style={{ fontSize: "48px", marginBottom: "12px" }}>{selectedAgent.icon}</div>
                <div style={{ color: selectedAgent.color, fontSize: "18px", fontWeight: "bold", marginBottom: "8px" }}>{selectedAgent.name}</div>
                <div style={{ color: T.text, fontSize: "12px", maxWidth: "400px", margin: "0 auto 24px", lineHeight: 1.6 }}>{selectedAgent.desc}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", maxWidth: "500px", margin: "0 auto" }}>
                  {(QUICK[selectedAgent.id] || []).map(q => (
                    <button key={q} onClick={() => sendMessage(q)} style={{ padding: "6px 12px", fontSize: "11px", backgroundColor: "rgba(255,0,128,0.1)", border: `1px solid ${T.link}`, color: T.link, cursor: "pointer", textAlign: "left" }}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "80%", padding: "10px 14px", backgroundColor: msg.role === "user" ? "rgba(0,255,65,0.08)" : "rgba(255,0,128,0.08)", border: `1px solid ${msg.role === "user" ? T.text : T.link}` }}>
                  <div style={{ fontSize: "9px", color: msg.role === "user" ? T.text : T.link, fontWeight: "bold", marginBottom: "5px" }}>
                    {msg.role === "user" ? `▶ You` : `${selectedAgent.icon} ${selectedAgent.name}`} · {msg.ts}
                  </div>
                  <div style={{ color: "#e0e0e0", fontSize: "13px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{msg.content}</div>
                </div>
              </div>
            ))}

            {streaming && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ maxWidth: "80%", padding: "10px 14px", backgroundColor: "rgba(255,0,128,0.08)", border: `1px solid ${T.link}` }}>
                  <div style={{ fontSize: "9px", color: T.link, fontWeight: "bold", marginBottom: "5px" }}>
                    {selectedAgent.icon} {selectedAgent.name}
                  </div>
                  <div style={{ color: "#e0e0e0", fontSize: "13px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {streaming}<span style={{ animation: "blink 1s step-end infinite", color: T.link }}>▊</span>
                  </div>
                </div>
              </div>
            )}

            {isLoading && !streaming && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ padding: "10px 14px", border: `1px solid ${T.link}`, color: T.link, fontSize: "11px" }}>
                  {selectedAgent.icon} {selectedAgent.name} is processing...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "12px 16px", borderTop: `2px solid ${T.border}`, backgroundColor: T.box, flexShrink: 0 }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={`Message ${selectedAgent.name}... (Enter to send)`}
                rows={1}
                disabled={isLoading}
                style={{ flex: 1, padding: "10px 12px", backgroundColor: T.input, border: `1px solid ${T.border}`, color: "#e0e0e0", fontSize: "13px", resize: "none", minHeight: "42px", maxHeight: "120px", fontFamily: "monospace", outline: "none" }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isLoading}
                style={{ padding: "0 20px", backgroundColor: input.trim() && !isLoading ? T.link : "#2a1a2e", color: "white", border: "none", cursor: input.trim() && !isLoading ? "pointer" : "not-allowed", fontWeight: "bold", fontSize: "16px", flexShrink: 0 }}
              >
                ➤
              </button>
            </div>
            <div style={{ color: T.text, fontSize: "9px", marginTop: "5px", opacity: 0.5 }}>
              Powered by Gemini · Shift+Enter for new line
            </div>
          </div>
        </div>

        {/* ── Right Panel - Agent Info ── */}
        <div style={{ width: "200px", flexShrink: 0, backgroundColor: T.box, borderLeft: `2px solid ${T.border}`, overflowY: "auto" }}>
          <div style={{ padding: "12px", textAlign: "center", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: "40px", marginBottom: "8px" }}>{selectedAgent.icon}</div>
            <div style={{ color: selectedAgent.color, fontSize: "13px", fontWeight: "bold" }}>{selectedAgent.name}</div>
            <div style={{ color: T.text, fontSize: "10px", opacity: 0.7 }}>{selectedAgent.role}</div>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: T.accent, margin: "6px auto 0", boxShadow: `0 0 6px ${T.accent}` }} />
          </div>
          <div style={{ padding: "12px" }}>
            {selectedAgent.id === "music-producer" ? (
              <>
                <div style={{ color: T.accent, fontSize: "9px", letterSpacing: "1px", marginBottom: "6px" }}>🎵 MUSIC STUDIO</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                  <select
                    value={musicModel}
                    onChange={e => setMusicModel(e.target.value)}
                    style={{ padding: "6px", backgroundColor: T.input, border: `1px solid ${T.border}`, color: T.text, fontSize: "10px", fontFamily: "monospace" }}
                  >
                    <option value="music-2.6-free">music-2.6-free</option>
                    <option value="music-2.6">music-2.6 (paid)</option>
                  </select>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: T.text, cursor: "pointer" }}>
                    <input type="checkbox" checked={isInstrumental} onChange={e => setIsInstrumental(e.target.checked)} />
                    Instrumental (no vocals)
                  </label>
                  <textarea
                    value={musicPrompt}
                    onChange={e => setMusicPrompt(e.target.value)}
                    placeholder="Describe the music style, mood, scenario..."
                    rows={3}
                    style={{ padding: "8px", backgroundColor: T.input, border: `1px solid ${T.border}`, color: "#e0e0e0", fontSize: "11px", resize: "none", fontFamily: "monospace" }}
                  />
                  {!isInstrumental && (
                    <textarea
                      value={musicLyrics}
                      onChange={e => setMusicLyrics(e.target.value)}
                      placeholder="[Verse]&#10;Your lyrics here...&#10;[Chorus]&#10;Your chorus here..."
                      rows={4}
                      style={{ padding: "8px", backgroundColor: T.input, border: `1px solid ${T.border}`, color: "#e0e0e0", fontSize: "11px", resize: "none", fontFamily: "monospace" }}
                    />
                  )}
                  <button
                    onClick={generateMusic}
                    disabled={!musicPrompt.trim() || isGeneratingMusic}
                    style={{ padding: "8px", backgroundColor: musicPrompt.trim() && !isGeneratingMusic ? "#9b59b6" : "#2a1a2e", color: "white", border: "none", cursor: musicPrompt.trim() && !isGeneratingMusic ? "pointer" : "not-allowed", fontWeight: "bold", fontSize: "11px" }}
                  >
                    {isGeneratingMusic ? "⏳ Generating..." : "🎵 GENERATE MUSIC"}
                  </button>
                </div>

                {musicResult && (
                  <div style={{ border: `1px solid ${T.border}`, padding: "8px", backgroundColor: "rgba(155,89,182,0.08)" }}>
                    <div style={{ color: T.accent, fontSize: "9px", marginBottom: "4px" }}>RESULT</div>
                    {musicResult.status === 2 && musicResult.audio ? (
                      <audio controls style={{ width: "100%", marginBottom: "6px" }} src={musicResult.audio} />
                    ) : (
                      <div style={{ color: T.text, fontSize: "10px" }}>Status: {musicResult.status === 1 ? "Processing..." : "Unknown"}</div>
                    )}
                    {musicResult.extraInfo && (
                      <div style={{ color: T.text, fontSize: "8px", opacity: 0.7 }}>
                        Duration: {((musicResult.extraInfo as {music_duration?: number})?.music_duration ?? 0) / 1000}s · Sample rate: {(musicResult.extraInfo as {music_sample_rate?: number})?.music_sample_rate ?? "N/A"}Hz
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ color: T.accent, fontSize: "9px", letterSpacing: "1px", marginBottom: "6px" }}>ABOUT</div>
                <p style={{ color: T.text, fontSize: "10px", lineHeight: 1.6, marginBottom: "12px" }}>{selectedAgent.desc}</p>
              </>
            )}
            <div style={{ color: T.accent, fontSize: "9px", letterSpacing: "1px", marginBottom: "6px", marginTop: "12px" }}>ALL AGENTS</div>
            {AGENTS.map(a => (
              <button key={a.id} onClick={() => switchAgent(a)} style={{ width: "100%", textAlign: "left", padding: "5px 6px", marginBottom: "2px", display: "flex", alignItems: "center", gap: "6px", backgroundColor: "transparent", border: "none", cursor: "pointer" }}>
                <span style={{ fontSize: "13px" }}>{a.icon}</span>
                <span style={{ color: selectedAgent.id === a.id ? a.color : T.text, fontSize: "10px" }}>{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: ${T.bg}; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; }
        textarea:focus { border-color: ${T.link} !important; }
      `}</style>
    </div>
  );
}
