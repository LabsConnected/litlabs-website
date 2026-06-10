"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import PageShell from "@/components/PageShell";
import { AGENT_AVATARS } from "@/lib/avatars";

type Agent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  avatar_url: string;
  system_prompt: string;
  personality: string;
  price_cents: number;
  features: string[];
};

export default function AgentDetail() {
  const params = useParams();
  const slug = params.slug as string;
  const { resolvedColors: theme } = useTheme();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<{role: string; text: string}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [crtEnabled, setCrtEnabled] = useState(true);

  useEffect(() => {
    if (slug) {
      fetchAgent();
    }
    // Check local storage for persistent CRT configuration
    const val = localStorage.getItem("crt_global_scanlines");
    if (val !== null) {
      setCrtEnabled(val === "true");
    }
  }, [slug]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chatMessages]);

  async function sendChat() {
    if (!chatInput.trim() || !agent) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setChatLoading(true);
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          message: userMsg,
          systemPrompt: agent.system_prompt || `You are ${agent.name}. ${agent.personality}`,
        }),
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: "agent", text: data.response || data.error || "..." }]);
    } catch {
      setChatMessages(prev => [...prev, { role: "agent", text: "Connection error. Try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  const DEMO_FALLBACK: Record<string, Agent> = {
    director:       { id: "1",  slug: "director",         name: "Director",         description: "The master orchestrator. Coordinates strategy, builds agent systems, and delegates tasks across your entire platform.", category: "orchestrator", avatar_url: AGENT_AVATARS.director, system_prompt: "You are Director, the master orchestrator of LiTTree Lab Studios. You coordinate all AI agents, assign tasks, and ensure smooth operation.", personality: "Strategic, decisive, concise", price_cents: 0, features: ["Multi-agent orchestration", "Strategy planning", "Workflow automation"] },
    champion:       { id: "2",  slug: "champion",         name: "Champion",          description: "Your all-purpose AI partner. Brainstorm, research, plan, and execute any task with unlimited versatility.", category: "general",      avatar_url: AGENT_AVATARS.champion, system_prompt: "You are Champion, a versatile AI assistant. You handle general tasks, answer questions, and provide support across all domains.", personality: "Helpful, thorough, direct", price_cents: 0, features: ["General assistance", "Brainstorming", "Research"] },
    "code-champion":{ id: "3",  slug: "code-champion",    name: "Code Champion",     description: "Senior software engineer. Writes, reviews, debugs, and explains code across all languages and frameworks.", category: "developer",    avatar_url: AGENT_AVATARS['code-champion'], system_prompt: "You are Code Champion, an expert software developer. You write clean, production-ready code.", personality: "Precise, clean, practical", price_cents: 0, features: ["Code generation", "Debugging", "Architecture"] },
    "social-dominator":{ id:"4",slug: "social-dominator", name: "Social Dominator",  description: "Growth hacker and content creator. Writes viral posts, crafts strategies, and helps you dominate social media.", category: "marketing",   avatar_url: AGENT_AVATARS['social-dominator'], system_prompt: "You are Social Dominator, a marketing and social media expert.", personality: "Bold, creative, results-driven", price_cents: 0, features: ["Viral content", "Growth strategy", "Analytics"] },
    "data-slayer":  { id: "5",  slug: "data-slayer",      name: "Data Slayer",       description: "Data scientist. Analyzes data, builds models, creates visualizations, and surfaces actionable insights.", category: "analytics",   avatar_url: AGENT_AVATARS['data-slayer'], system_prompt: "You are Data Slayer, a data analytics expert.", personality: "Precise, analytical, data-driven", price_cents: 0, features: ["Data analysis", "Modeling", "Visualization"] },
    "writing-coach":{ id: "6",  slug: "writing-coach",    name: "Writing Coach",     description: "Master copywriter. Elevates writing quality — editing, tone adjustment, copywriting, and storytelling.", category: "content",     avatar_url: AGENT_AVATARS['writing-coach'], system_prompt: "You are Writing Coach, a content creation expert.", personality: "Constructive, articulate, refined", price_cents: 0, features: ["Editing", "Tone adjustment", "Copywriting"] },
    "music-producer":{ id: "7", slug: "music-producer",   name: "Music Producer",    description: "Creates original music from text prompts and lyrics. Generates songs, instrumentals, and covers with AI.", category: "music",       avatar_url: AGENT_AVATARS['music-producer'], system_prompt: "You are Music Producer, a creative music expert.", personality: "Creative, musical, expressive", price_cents: 0, features: ["Music generation", "Lyrics writing", "Style guidance"] },
    "pixel-forge":  { id: "8",  slug: "pixel-forge",      name: "Pixel Forge",       description: "AI image and 3D world generation specialist. Creates stunning visuals, textures, and immersive environments.", category: "design",      avatar_url: AGENT_AVATARS['pixel-forge'], system_prompt: "You are Pixel Forge, an AI image and world generation expert.", personality: "Visionary, artistic, detailed", price_cents: 0, features: ["Image generation", "360 worlds", "Texture design"] },
    "legal-shield": { id: "10", slug: "legal-shield",     name: "Legal Shield",      description: "Legal assistant for contracts, compliance, and regulatory guidance. Not a lawyer, but a powerful research aide.", category: "legal",       avatar_url: AGENT_AVATARS['legal-shield'], system_prompt: "You are Legal Shield, a legal research assistant.", personality: "Cautious, precise, thorough", price_cents: 499, features: ["Contract review", "Compliance", "Legal research"] },
  };

  async function fetchAgent() {
    try {
      const res = await fetch(`/api/agents/${slug}`);
      const data = await res.json();
      
      if (data.agent) {
        setAgent(data.agent);
        checkIfInstalled(data.agent.id);
      } else {
        // Fallback to demo data
        const fallback = DEMO_FALLBACK[slug];
        if (fallback) setAgent(fallback);
      }
    } catch {
      // Fallback to demo data on network error
      const fallback = DEMO_FALLBACK[slug];
      if (fallback) setAgent(fallback);
    } finally {
      setIsLoading(false);
    }
  }

  async function checkIfInstalled(agentId: string) {
    try {
      const res = await fetch("/api/user-agents");
      const data = await res.json();
      
      if (data.agents) {
        const installed = data.agents.some((ua: { agent_id: string }) => ua.agent_id === agentId);
        setIsInstalled(installed);
      }
    } catch (error) {
      console.error("Error checking installation:", error);
    }
  }

  async function installAgent() {
    if (!agent) return;
    
    try {
      const res = await fetch("/api/user-agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agentId: agent.id }),
      });

      if (res.ok) {
        setIsInstalled(true);
      }
    } catch (error) {
      console.error("Error installing agent:", error);
    }
  }

  function formatPrice(cents: number): string {
    if (cents === 0) return "FREE";
    return `$${(cents / 100).toFixed(0)}/mo`;
  }

  if (isLoading) {
    return (
      <div style={{ backgroundColor: theme.bgColor, minHeight: "100vh", padding: "20px" }}>
        <div className="text-center" style={{ color: theme.textColor }}>
          Loading agent...
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div style={{ backgroundColor: theme.bgColor, minHeight: "100vh", padding: "20px" }}>
        <div className="text-center" style={{ color: theme.textColor }}>
          Agent not found
        </div>
      </div>
    );
  }

  return (
    <PageShell title={agent?.name || "Agent"} subtitle={agent ? `${agent.category.toUpperCase()} AGENT` : undefined}>
      {/* Header */}
      <div className="lit-box mb-6" style={{ borderColor: theme.borderColor, backgroundColor: theme.boxBg }}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <img src={agent.avatar_url} alt={agent.name} className="w-14 h-14 rounded-xl object-cover border" style={{ borderColor: theme.borderColor }} />
            <div>
              <h1 style={{ color: theme.headerColor, fontSize: "24px", fontWeight: "bold" }}>
                {agent.name.toUpperCase()}
              </h1>
              <p style={{ color: theme.textColor, fontSize: "12px" }}>
                {agent.category.toUpperCase()} AGENT
              </p>
            </div>
          </div>
          <Link 
            href="/marketplace" 
            style={{ color: theme.linkColor, fontSize: "12px" }}
            className="hover:underline"
          >
            ← Back to Marketplace
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Agent Info */}
        <div className="lg:col-span-2">
          <div className="lit-box mb-4" style={{ borderColor: theme.borderColor, backgroundColor: theme.boxBg }}>
            <div className="lit-header" style={{ color: "white" }}>📋 ABOUT</div>
            <div className="p-4">
              <p style={{ color: theme.textColor, lineHeight: "1.6", marginBottom: "20px" }}>
                {agent.description}
              </p>
              
              <div className="mb-4">
                <h4 style={{ color: theme.headerColor, fontSize: "12px", marginBottom: "8px" }}>
                  PERSONALITY
                </h4>
                <p style={{ color: theme.textColor, fontSize: "11px" }}>
                  {agent.personality}
                </p>
              </div>

              {agent.features && agent.features.length > 0 && (
                <div>
                  <h4 style={{ color: theme.headerColor, fontSize: "12px", marginBottom: "8px" }}>
                    ✨ FEATURES
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    {agent.features.map((feature, i) => (
                      <div 
                        key={i}
                        className="p-2 text-xs"
                        style={{ 
                          backgroundColor: "rgba(0,255,65,0.1)", 
                          border: `1px solid ${theme.textColor}`,
                          color: theme.textColor
                        }}
                      >
                        ✓ {feature}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Live Chat */}
          <div className="lit-box" style={{ borderColor: theme.borderColor, backgroundColor: theme.boxBg }}>
            <div className="lit-header" style={{ color: "white" }}>💬 CHAT WITH {agent.name.toUpperCase()}</div>
            <div className="p-4">
              <div className="mb-4 overflow-y-auto" style={{ maxHeight: "280px", minHeight: "100px" }}>
                {chatMessages.length === 0 && (
                  <div className="p-3" style={{ backgroundColor: "rgba(255,0,128,0.08)", borderLeft: `3px solid ${theme.linkColor}` }}>
                    <div style={{ color: theme.linkColor, fontSize: "11px", marginBottom: "4px" }}>
                      <strong>{agent.name}:</strong>
                    </div>
                    <p style={{ color: theme.textColor, fontSize: "11px" }}>
                      Hey! I'm {agent.name}. {agent.description} Ask me anything!
                    </p>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className="mb-3 p-3" style={{
                    backgroundColor: msg.role === "user" ? "rgba(0,0,0,0.3)" : "rgba(255,0,128,0.08)",
                    borderLeft: `3px solid ${msg.role === "user" ? theme.borderColor : theme.linkColor}`
                  }}>
                    <div style={{ color: msg.role === "user" ? theme.accentColor : theme.linkColor, fontSize: "11px", marginBottom: "4px", fontWeight: "bold" }}>
                      {msg.role === "user" ? "You" : agent.name}:
                    </div>
                    <p style={{ color: theme.textColor, fontSize: "11px", lineHeight: 1.5 }}>{msg.text}</p>
                  </div>
                ))}
                {chatLoading && (
                  <div className="p-3" style={{ color: theme.accentColor, fontSize: "11px" }}>⏳ {agent.name} is typing...</div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendChat()}
                  placeholder={`Ask ${agent.name}...`}
                  className="flex-1 p-2 text-xs"
                  style={{ backgroundColor: theme.bgColor, color: theme.textColor, border: `1px solid ${theme.borderColor}`, outline: "none" }}
                />
                <button
                  onClick={sendChat}
                  disabled={chatLoading}
                  className="px-4 py-2 text-xs font-bold"
                  style={{ backgroundColor: theme.linkColor, color: "white", border: "none", cursor: chatLoading ? "not-allowed" : "pointer", opacity: chatLoading ? 0.6 : 1 }}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Purchase Panel */}
        <div className="lg:col-span-1">
          <div className="lit-box sticky top-4" style={{ borderColor: theme.borderColor, backgroundColor: theme.boxBg }}>
            <div className="p-4 text-center">
              <div 
                className="text-3xl font-bold mb-2"
                style={{ color: agent.price_cents === 0 ? theme.accentColor : theme.headerColor }}
              >
                {formatPrice(agent.price_cents)}
              </div>
              
              {agent.price_cents > 0 && (
                <p style={{ color: theme.textColor, fontSize: "10px", marginBottom: "16px" }}>
                  Billed monthly • Cancel anytime
                </p>
              )}

              {isInstalled ? (
                <Link
                  href="/builder"
                  className="block w-full py-3 text-center font-bold mb-3"
                  style={{ 
                    backgroundColor: theme.accentColor,
                    color: "black",
                    textDecoration: "none"
                  }}
                >
                  🚀 OPEN IN WORKSPACE
                </Link>
              ) : (
                <button
                  onClick={installAgent}
                  className="block w-full py-3 text-center font-bold mb-3"
                  style={{ 
                    backgroundColor: theme.linkColor,
                    color: "white",
                    border: "none",
                    cursor: "pointer"
                  }}
                >
                  {agent.price_cents === 0 ? "🚀 INSTALL FREE" : "💰 SUBSCRIBE NOW"}
                </button>
              )}

              <div className="text-left mt-4" style={{ color: theme.textColor, fontSize: "10px" }}>
                <div className="mb-2">✓ Included in subscription:</div>
                <ul className="space-y-1 ml-2">
                  <li>• Unlimited conversations</li>
                  <li>• Persistent memory</li>
                  <li>• Priority responses</li>
                  <li>• 24/7 availability</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
