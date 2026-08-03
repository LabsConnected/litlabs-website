"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  Send,
  Trash2,
  Loader2,
  X,
  ChevronRight,
  Package,
  Brain,
  Shield,
  Activity,
  Volume2,
  Sparkles,
  Code,
  Image as ImageIcon,
  Terminal,
  FolderOpen,
  Wand2,
  Cpu,
} from "lucide-react";
import { MyAITeam } from "../components/MyAITeam";
import { AGENT_AVATAR_META } from "@/lib/avatars";
import Link from "next/link";

/* ─── Types ──────────────────────────────────────────────────────────── */
type PrimaryAssistantId = "litt" | "spark";

type AssistantConfig = {
  id: PrimaryAssistantId;
  name: string;
  icon: string;
  role: string;
  desc: string;
  systemPrompt: string;
  color: string;
  purpose: string;
  access: string[];
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
};

type InstalledCapability = {
  id: string;
  capability_key: string;
  name: string;
  icon: string;
  enabled: boolean;
  status: string;
  required_connections: string[];
};

const PRIMARY_ASSISTANTS: AssistantConfig[] = [
  {
    id: "litt",
    name: "LiTT",
    icon: "✨",
    role: "AI operator",
    desc: "Primary AI operator for projects, code, automation, research, terminal, deployment, and coordination.",
    systemPrompt:
      "You are LiTT, the single AI copilot at LiTTree-LabStudios. Combine senior engineering, strategy, creative direction, and orchestration. Be decisive, technically precise, and truthful about tool access.",
    color: "#67e8f9",
    purpose: "Coordinates tools and completes Missions.",
    access: ["GitHub unavailable", "PTY unavailable", "Writes require approval"],
  },
  {
    id: "spark",
    name: "Spark",
    icon: "⚡",
    role: "Creative partner",
    desc: "Creative partner for images, branding, music, writing, social content, and visual direction.",
    systemPrompt:
      "You are Spark, LiTT's playful creative companion at LiTTree-LabStudios. Help the user brainstorm, discover, and explore imaginative directions. Be curious, concise, useful, and truthful about tool access.",
    color: "#a970ff",
    purpose: "Creates visuals, refines brands, writes content.",
    access: ["Creative tools ready", "Image generation available", "No project required"],
  },
];

function getAgentAvatar(agent: AssistantConfig) {
  const key = agent.id.toLowerCase();
  const meta = AGENT_AVATAR_META[key];
  return {
    emoji: meta?.emoji || agent.icon,
    initials: meta?.initials || agent.name.slice(0, 2).toUpperCase(),
    color: meta?.color || agent.color,
    bg: meta?.bg || `${agent.color}18`,
  };
}

const QUICK_ACTIONS: Record<PrimaryAssistantId, { label: string; icon: typeof Code }[]> = {
  litt: [
    { label: "Start a project", icon: FolderOpen },
    { label: "Connect GitHub", icon: Code },
    { label: "Review code", icon: Shield },
    { label: "Plan a Mission", icon: Brain },
    { label: "Open terminal", icon: Terminal },
  ],
  spark: [
    { label: "Create image", icon: ImageIcon },
    { label: "Build brand kit", icon: Sparkles },
    { label: "Write social post", icon: Send },
    { label: "Generate music concept", icon: Volume2 },
    { label: "Use wallpaper tool", icon: Wand2 },
  ],
};

type InspectorTab = "overview" | "capabilities" | "memory" | "voice" | "permissions" | "activity";

const STORAGE_KEY = "litlabs-agent-chat-v2";
const PROVIDER_STORAGE_KEY = "litlabs-agent-tool-provider";

const PROVIDER_OPTIONS = [
  { id: "gemini", label: "Gemini 2.5", hint: "Primary, fast" },
  { id: "openrouter-free", label: "OpenRouter Free", hint: "Fallback pool" },
];

/* ─── Context window management ──────────────────────────────────────── */
const MAX_TOKENS_APPROX = 100_000; // Gemini 2.5 Flash context
const TOKEN_THRESHOLD = 0.8; // prune at 80% capacity

/** Rough token estimate: ~4 chars per token */
function estimateTokens(messages: { role: string; content: string }[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

/**
 * Trims oldest non-system messages to stay under 80% of max context.
 * Always keeps the first message (user framing) and the last 6 messages
 * for continuity.
 */
function pruneHistory(
  messages: { role: string; content: string }[],
): { role: string; content: string }[] {
  const limit = Math.floor(MAX_TOKENS_APPROX * TOKEN_THRESHOLD);
  if (estimateTokens(messages) <= limit) return messages;
  // Keep first message + last 6 for continuity, prune from the middle
  const head = messages.slice(0, 1);
  const tail = messages.slice(-6);
  const middle = messages.slice(1, -6);
  let pruned = [...middle];
  while (
    pruned.length > 0 &&
    estimateTokens([...head, ...pruned, ...tail]) > limit
  ) {
    pruned = pruned.slice(2); // drop oldest pair (user + assistant)
  }
  return [...head, ...pruned, ...tail];
}

/* ─── Markdown renderer (minimal inline) ───────────────────────────── */
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let codeBlock: string[] = [];
  let inCode = false;

  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      if (inCode) {
        nodes.push(
          <pre
            key={`code-${i}`}
            className="my-2 p-2 rounded text-[10px] font-mono overflow-x-auto"
            style={{
              background: "rgba(0,0,0,0.5)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <code>{codeBlock.join("\n")}</code>
          </pre>,
        );
        codeBlock = [];
        inCode = false;
      } else {
        inCode = true;
      }
      return;
    }
    if (inCode) {
      codeBlock.push(line);
      return;
    }

    if (line.startsWith("### ")) {
      nodes.push(
        <p
          key={i}
          className="font-bold text-[11px] mt-2 mb-0.5"
          style={{ color: "inherit" }}
        >
          {line.slice(4)}
        </p>,
      );
      return;
    }
    if (line.startsWith("## ")) {
      nodes.push(
        <p
          key={i}
          className="font-bold text-xs mt-2 mb-0.5"
          style={{ color: "inherit" }}
        >
          {line.slice(3)}
        </p>,
      );
      return;
    }
    if (line.startsWith("# ")) {
      nodes.push(
        <p
          key={i}
          className="font-bold text-sm mt-2 mb-0.5"
          style={{ color: "inherit" }}
        >
          {line.slice(2)}
        </p>,
      );
      return;
    }
    if (line.match(/^[-*] /)) {
      nodes.push(
        <p
          key={i}
          className="pl-3 text-[11px] leading-relaxed before:content-['•'] before:mr-2 before:opacity-50"
        >
          {line.slice(2)}
        </p>,
      );
      return;
    }
    if (line.match(/^\d+\. /)) {
      nodes.push(
        <p key={i} className="pl-3 text-[11px] leading-relaxed">
          {line}
        </p>,
      );
      return;
    }
    if (line.trim() === "") {
      nodes.push(<div key={i} className="h-1.5" />);
      return;
    }

    // inline bold + code
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    nodes.push(
      <p key={i} className="text-[11px] leading-relaxed">
        {parts.map((p, j) => {
          if (p.startsWith("**") && p.endsWith("**"))
            return <strong key={j}>{p.slice(2, -2)}</strong>;
          if (p.startsWith("`") && p.endsWith("`"))
            return (
              <code
                key={j}
                className="px-1 rounded text-[10px] font-mono"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {p.slice(1, -1)}
              </code>
            );
          return p;
        })}
      </p>,
    );
  });
  return nodes;
}

/* ─── Main Component ─────────────────────────────────────────────────── */
export default function AgentTool() {
  const { resolvedColors: T } = useTheme();
  const { userId } = useClerkAuth();
  const [selectedAgent, setSelectedAgent] = useState<AssistantConfig>(PRIMARY_ASSISTANTS[0]);
  const [chatMap, setChatMap] = useState<Record<string, Message[]>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [provider, setProvider] = useState<"gemini" | "openrouter-free">(() => {
    try {
      return (
        (localStorage.getItem(PROVIDER_STORAGE_KEY) as
          | "gemini"
          | "openrouter-free") || "gemini"
      );
    } catch {
      return "gemini";
    }
  });

  /* Inspector */
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<InstalledCapability[]>([]);
  const [capsLoading, setCapsLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = useMemo(
    () => chatMap[selectedAgent.id] || [],
    [chatMap, selectedAgent.id],
  );
  const selectedAvatar = getAgentAvatar(selectedAgent);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chatMap));
    } catch {}
  }, [chatMap]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);
  useEffect(() => {
    try {
      localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
    } catch {}
  }, [provider]);

  /* Auto-resize textarea */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  /* Load installed capabilities from Marketplace API */
  useEffect(() => {
    if (!userId) return;
    setCapsLoading(true);
    fetch("/api/marketplace/installations")
      .then((r) => r.json())
      .then((data: { installations?: Array<{ id: string; enabled: boolean; marketplace_items?: { capability_key: string; name: string; icon: string; status: string; required_connections: string[]; compatible_assistants: string[] } }> }) => {
        if (data.installations) {
          const caps: InstalledCapability[] = data.installations
            .filter((inst) => {
              const item = inst.marketplace_items;
              if (!item) return false;
              return item.compatible_assistants?.includes(selectedAgent.id);
            })
            .map((inst) => ({
              id: inst.id,
              capability_key: inst.marketplace_items?.capability_key ?? "",
              name: inst.marketplace_items?.name ?? "Unknown",
              icon: inst.marketplace_items?.icon ?? "📦",
              enabled: inst.enabled,
              status: inst.marketplace_items?.status ?? "available",
              required_connections: inst.marketplace_items?.required_connections ?? [],
            }));
          setCapabilities(caps);
        }
      })
      .catch(() => {})
      .finally(() => setCapsLoading(false));
  }, [userId, selectedAgent.id]);

  const switchAgent = useCallback((agent: AssistantConfig) => {
    setSelectedAgent(agent);
    setStreaming("");
    setInspectorTab("overview");
  }, []);
  const clearChat = useCallback(() => {
    setChatMap((prev) => ({ ...prev, [selectedAgent.id]: [] }));
    setStreaming("");
  }, [selectedAgent.id]);

  const sendMessage = useCallback(
    async (text?: string, retryCount = 0) => {
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
      setChatMap((prev) => ({
        ...prev,
        [selectedAgent.id]: [...(prev[selectedAgent.id] || []), userMsg],
      }));

      async function attempt(): Promise<boolean> {
        try {
          const rawHistory = [
            ...(chatMap[selectedAgent.id] || []),
            userMsg,
          ].map((m) => ({ role: m.role, content: m.content }));
          const history = pruneHistory(rawHistory);
          const res = await fetch("/api/gemini/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: history,
              systemPrompt: selectedAgent.systemPrompt,
              stream: true,
              provider,
            }),
          });
          if (!res.ok) throw new Error(`API error ${res.status}`);
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
                const d = line.slice(6);
                if (d === "[DONE]") continue;
                try {
                  const p = JSON.parse(d);
                  if (p.text) {
                    full += p.text;
                    setStreaming(full);
                  }
                } catch {}
              }
            }
          }
          if (full) {
            setChatMap((prev) => ({
              ...prev,
              [selectedAgent.id]: [
                ...(prev[selectedAgent.id] || []),
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: full,
                  ts: new Date().toLocaleTimeString(),
                },
              ],
            }));
            setStreaming("");
          }
          return true;
        } catch (err) {
          if (retryCount < 1) {
            await new Promise((r) => setTimeout(r, 1200));
            return attempt();
          }
          const msg = err instanceof Error ? err.message : "Connection error";
          setChatMap((prev) => ({
            ...prev,
            [selectedAgent.id]: [
              ...(prev[selectedAgent.id] || []),
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `⚠️ ${msg}. Try again or switch provider.`,
                ts: new Date().toLocaleTimeString(),
              },
            ],
          }));
          setStreaming("");
          return false;
        }
      }

      await attempt();
      setIsLoading(false);
    },
    [input, isLoading, selectedAgent, chatMap, provider],
  );

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const enabledCapCount = capabilities.filter((c) => c.enabled).length;

  /* ── Inspector content renderers ── */
  const renderOverview = () => (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-3xl mb-1.5">{selectedAvatar.emoji}</div>
        <div className="text-xs font-bold" style={{ color: selectedAgent.color }}>
          {selectedAgent.name}
        </div>
        <div className="text-[9px] mt-0.5 opacity-60" style={{ color: T.textMuted }}>
          {selectedAgent.role}
        </div>
        <div className="flex items-center justify-center gap-1 mt-2">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: selectedAgent.color }} />
          <span className="text-[9px] font-mono" style={{ color: selectedAgent.color }}>Online</span>
        </div>
      </div>
      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: T.accentColor }}>Purpose</div>
        <p className="text-[10px] leading-relaxed opacity-70" style={{ color: T.textColor }}>{selectedAgent.purpose}</p>
      </div>
      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: T.accentColor }}>Current Access</div>
        <div className="space-y-1">
          {selectedAgent.access.map((a) => (
            <div key={a} className="flex items-center gap-1.5 text-[9px]" style={{ color: T.textMuted }}>
              <ChevronRight size={9} style={{ color: selectedAgent.color }} />
              {a}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: T.accentColor }}>Capabilities</div>
        <div className="text-[10px] opacity-60" style={{ color: T.textMuted }}>
          {enabledCapCount} enabled · {capabilities.length} installed
        </div>
      </div>
    </div>
  );

  const renderCapabilities = () => (
    <div className="space-y-2">
      {capsLoading && (
        <div className="flex items-center gap-2 text-[10px] opacity-50" style={{ color: T.textMuted }}>
          <Loader2 size={12} className="animate-spin" /> Loading capabilities...
        </div>
      )}
      {!capsLoading && capabilities.length === 0 && (
        <div className="text-center py-6">
          <Package size={20} className="mx-auto mb-2 opacity-30" style={{ color: T.textMuted }} />
          <p className="text-[10px] opacity-50 mb-3" style={{ color: T.textMuted }}>No capabilities installed</p>
          <Link
            href={`/marketplace?assistant=${selectedAgent.id}`}
            className="text-[10px] px-3 py-1.5 rounded border inline-flex items-center gap-1 transition-all hover:opacity-80"
            style={{ borderColor: selectedAgent.color + "40", color: selectedAgent.color }}
          >
            <Package size={10} /> Manage in Marketplace
          </Link>
        </div>
      )}
      {capabilities.map((cap) => (
        <div
          key={cap.id}
          className="rounded-lg p-2.5 space-y-1"
          style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${cap.enabled ? selectedAgent.color + "20" : T.borderColor + "15"}` }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">{cap.icon}</span>
              <span className="text-[10px] font-bold" style={{ color: cap.enabled ? T.textColor : T.textMuted }}>{cap.name}</span>
            </div>
            <span
              className="text-[8px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: cap.enabled ? selectedAgent.color + "15" : T.borderColor + "10",
                color: cap.enabled ? selectedAgent.color : T.textMuted,
              }}
            >
              {cap.enabled ? "ON" : "OFF"}
            </span>
          </div>
          {cap.required_connections.length > 0 && (
            <div className="text-[8px] opacity-50" style={{ color: T.textMuted }}>
              Needs: {cap.required_connections.join(", ")}
            </div>
          )}
        </div>
      ))}
      {capabilities.length > 0 && (
        <Link
          href={`/marketplace?assistant=${selectedAgent.id}`}
          className="block text-center text-[10px] py-2 rounded border transition-all hover:opacity-80"
          style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
        >
          <Package size={10} className="inline mr-1" /> Manage in Marketplace
        </Link>
      )}
    </div>
  );

  const renderMemory = () => (
    <div className="space-y-2">
      <p className="text-[10px] opacity-50" style={{ color: T.textMuted }}>
        Memory persistence is managed at the project level. LiTT and Spark share conversation context within each project.
      </p>
      <div className="rounded-lg p-2.5 text-[9px] font-mono" style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${T.borderColor}15`, color: T.textMuted }}>
        <div className="flex justify-between mb-1"><span>Messages in thread</span><span style={{ color: selectedAgent.color }}>{messages.length}</span></div>
        <div className="flex justify-between"><span>Provider</span><span style={{ color: T.accentColor }}>{PROVIDER_OPTIONS.find((p) => p.id === provider)?.label ?? "Gemini"}</span></div>
      </div>
    </div>
  );

  const renderVoice = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[10px]" style={{ color: T.textMuted }}>
        <Volume2 size={14} style={{ color: selectedAgent.color }} />
        Voice settings are configured in Settings → Voice.
      </div>
      <Link
        href="/settings/agents/voice"
        className="block text-center text-[10px] py-2 rounded border transition-all hover:opacity-80"
        style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
      >
        <Volume2 size={10} className="inline mr-1" /> Open Voice Settings
      </Link>
    </div>
  );

  const renderPermissions = () => (
    <div className="space-y-2">
      <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: T.accentColor }}>Access Control</div>
      {selectedAgent.access.map((a) => (
        <div key={a} className="flex items-center gap-2 text-[10px]" style={{ color: T.textMuted }}>
          <Shield size={10} style={{ color: selectedAgent.color }} />
          {a}
        </div>
      ))}
      <div className="mt-3 rounded-lg p-2.5 text-[9px]" style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${T.borderColor}15`, color: T.textMuted }}>
        Approval behavior: Writes require explicit user approval before execution.
      </div>
    </div>
  );

  const renderActivity = () => (
    <div className="space-y-2">
      <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: T.accentColor }}>Recent Activity</div>
      {messages.length === 0 ? (
        <p className="text-[10px] opacity-50" style={{ color: T.textMuted }}>No recent activity</p>
      ) : (
        <div className="space-y-1.5">
          {messages.slice(-5).reverse().map((m) => (
            <div key={m.id} className="text-[9px] flex items-start gap-2" style={{ color: T.textMuted }}>
              <Activity size={9} className="mt-0.5 shrink-0" style={{ color: m.role === "user" ? T.accentColor : selectedAgent.color }} />
              <div className="flex-1 min-w-0">
                <span className="opacity-60">{m.ts}</span>
                <p className="truncate opacity-70">{m.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const inspectorTabs: { id: InspectorTab; label: string; icon: typeof Code }[] = [
    { id: "overview", label: "Overview", icon: Cpu },
    { id: "capabilities", label: "Capabilities", icon: Package },
    { id: "memory", label: "Memory", icon: Brain },
    { id: "voice", label: "Voice", icon: Volume2 },
    { id: "permissions", label: "Permissions", icon: Shield },
    { id: "activity", label: "Activity", icon: Activity },
  ];

  const renderInspectorContent = () => {
    switch (inspectorTab) {
      case "overview": return renderOverview();
      case "capabilities": return renderCapabilities();
      case "memory": return renderMemory();
      case "voice": return renderVoice();
      case "permissions": return renderPermissions();
      case "activity": return renderActivity();
    }
  };

  return (
    <div className="flex h-full overflow-hidden select-none">
      {/* ── LEFT: MY AI TEAM RAIL (desktop) ── */}
      <div
        className="hidden md:flex w-[260px] shrink-0 flex-col border-r"
        style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "90" }}
      >
        <MyAITeam />
      </div>

      {/* ── CENTER: CHAT WORKSPACE ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div
          className="flex items-center justify-between px-4 h-12 border-b shrink-0"
          style={{ borderColor: T.borderColor + "15", backgroundColor: T.boxBg + "50" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-lg shrink-0">{selectedAvatar.emoji}</span>
            <div className="min-w-0">
              <div className="text-xs font-bold leading-tight truncate" style={{ color: selectedAgent.color }}>
                {selectedAgent.name}
              </div>
              <div className="text-[9px] opacity-60 truncate" style={{ color: T.textMuted }}>
                {selectedAgent.role} · {PROVIDER_OPTIONS.find((p) => p.id === provider)?.label ?? "Gemini"} · {enabledCapCount} capabilities
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setProvider(provider === "gemini" ? "openrouter-free" : "gemini")}
              title="Switch provider"
              className="text-[9px] px-2 py-0.5 rounded font-bold transition-all"
              style={{ backgroundColor: T.accentColor + "15", color: T.accentColor, border: `1px solid ${T.accentColor}30` }}
            >
              {PROVIDER_OPTIONS.find((p) => p.id === provider)?.label ?? "Gemini"}
            </button>
            <button
              onClick={clearChat}
              className="flex items-center gap-1 text-[9px] px-2 py-1 rounded border opacity-50 hover:opacity-100 transition-all"
              style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
            >
              <Trash2 size={9} /> Clear
            </button>
            {/* Mobile inspector toggle */}
            <button
              onClick={() => setInspectorOpen(true)}
              className="md:hidden flex items-center gap-1 text-[9px] px-2 py-1 rounded border opacity-60 hover:opacity-100 transition-all"
              style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
            >
              <Cpu size={11} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center h-full pb-8 text-center px-4">
              <div className="text-3xl mb-2 opacity-90">{selectedAvatar.emoji}</div>
              <div className="text-sm font-bold mb-1" style={{ color: selectedAgent.color }}>
                {selectedAgent.name} is ready.
              </div>
              <div className="text-[10px] mb-4 opacity-50 max-w-xs" style={{ color: T.textMuted }}>
                {selectedAgent.id === "litt"
                  ? "Build, inspect, automate, or continue a project."
                  : "Create visuals, refine your brand, write content, or generate media."}
              </div>
              <div className="w-full max-w-sm grid grid-cols-1 gap-1.5">
                {(QUICK_ACTIONS[selectedAgent.id] || []).map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendMessage(action.label)}
                    className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-[11px] rounded-lg border transition-all hover:scale-[1.01]"
                    style={{ borderColor: selectedAgent.color + "30", color: T.textColor, backgroundColor: selectedAgent.color + "06" }}
                  >
                    <action.icon size={13} style={{ color: selectedAgent.color }} />
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] mt-0.5"
                style={{
                  backgroundColor: msg.role === "user" ? T.accentColor + "20" : selectedAgent.color + "20",
                  border: `1px solid ${msg.role === "user" ? T.accentColor + "40" : selectedAgent.color + "40"}`,
                }}
              >
                {msg.role === "user" ? "U" : selectedAvatar.initials}
              </div>
              <div className="max-w-[80%] space-y-0.5">
                <div className="text-[9px] font-bold mb-1" style={{ color: msg.role === "user" ? T.accentColor : selectedAgent.color }}>
                  {msg.role === "user" ? "You" : selectedAgent.name} · {msg.ts}
                </div>
                <div
                  className="px-3 py-2 rounded-xl text-xs leading-relaxed"
                  style={{
                    backgroundColor: msg.role === "user" ? T.accentColor + "10" : T.boxBg,
                    border: `1px solid ${msg.role === "user" ? T.accentColor + "25" : T.borderColor + "20"}`,
                    color: T.textColor,
                    borderTopRightRadius: msg.role === "user" ? "4px" : undefined,
                    borderTopLeftRadius: msg.role !== "user" ? "4px" : undefined,
                  }}
                >
                  {msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content}
                </div>
              </div>
            </div>
          ))}

          {streaming && (
            <div className="flex gap-2.5">
              <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] mt-0.5" style={{ backgroundColor: selectedAgent.color + "20", border: `1px solid ${selectedAgent.color}40` }}>
                {selectedAvatar.emoji}
              </div>
              <div className="max-w-[80%]">
                <div className="text-[9px] font-bold mb-1" style={{ color: selectedAgent.color }}>{selectedAgent.name} · now</div>
                <div className="px-3 py-2 rounded-xl text-xs leading-relaxed" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, color: T.textColor, borderTopLeftRadius: "4px" }}>
                  {renderMarkdown(streaming)}
                  <span className="animate-pulse ml-0.5">▊</span>
                </div>
              </div>
            </div>
          )}

          {isLoading && !streaming && (
            <div className="flex gap-2.5">
              <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px]" style={{ backgroundColor: selectedAgent.color + "20", border: `1px solid ${selectedAgent.color}40` }}>
                {selectedAvatar.emoji}
              </div>
              <div className="px-3 py-2 rounded-xl text-[11px] flex items-center gap-2" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}20`, color: T.linkColor }}>
                <span className="flex gap-0.5">
                  {[0, 150, 300].map((delay) => (
                    <span key={delay} className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: selectedAgent.color, animationDelay: `${delay}ms` }} />
                  ))}
                </span>
                <span className="opacity-70">{selectedAgent.name} is thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: T.borderColor + "15", backgroundColor: T.boxBg + "40" }}>
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={`Message ${selectedAgent.name}… (Enter to send)`}
              rows={1}
              disabled={isLoading}
              className="flex-1 px-3 py-2 text-xs rounded-lg outline-none resize-none overflow-hidden disabled:opacity-50 transition-all"
              style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor, minHeight: "38px", maxHeight: "120px" }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              className="px-3 py-2 rounded-lg font-bold disabled:opacity-30 transition-all hover:scale-105 shrink-0"
              style={{ backgroundColor: selectedAgent.color, color: "#0a0a0f", minHeight: "38px" }}
            >
              <Send size={13} />
            </button>
          </div>
          <div className="flex items-center justify-between mt-1.5 px-0.5">
            <span className="text-[9px] opacity-30" style={{ color: T.textMuted }}>
              {PROVIDER_OPTIONS.find((p) => p.id === provider)?.label ?? "Gemini"} · Shift+Enter for new line
            </span>
            {input.length > 0 && <span className="text-[9px] font-mono opacity-40" style={{ color: T.textMuted }}>{input.length}</span>}
          </div>
        </div>
      </div>

      {/* ── RIGHT: INSPECTOR (desktop) ── */}
      <div
        className="hidden md:flex w-[320px] shrink-0 border-l flex-col"
        style={{ borderColor: T.borderColor + "15", backgroundColor: T.boxBg + "50" }}
      >
        {/* Inspector tabs */}
        <div className="flex items-center gap-0.5 px-2 py-2 border-b shrink-0 overflow-x-auto" style={{ borderColor: T.borderColor + "15" }}>
          {inspectorTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setInspectorTab(tab.id)}
              className="flex items-center gap-1 text-[9px] px-2 py-1.5 rounded font-bold transition-all whitespace-nowrap"
              style={{
                backgroundColor: inspectorTab === tab.id ? selectedAgent.color + "15" : "transparent",
                color: inspectorTab === tab.id ? selectedAgent.color : T.textMuted,
              }}
            >
              <tab.icon size={10} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Inspector content */}
        <div className="flex-1 overflow-y-auto p-3">
          {renderInspectorContent()}
        </div>
      </div>

      {/* ── MOBILE: TOP ASSISTANT SWITCHER ── */}
      <div className="md:hidden absolute top-0 left-0 right-0 z-10 flex items-center gap-1 px-3 py-2 border-b" style={{ borderColor: T.borderColor + "15", backgroundColor: T.boxBg }}>
        {PRIMARY_ASSISTANTS.map((a) => (
          <button
            key={a.id}
            onClick={() => switchAgent(a)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-all"
            style={{
              backgroundColor: selectedAgent.id === a.id ? a.color + "15" : "transparent",
              color: selectedAgent.id === a.id ? a.color : T.textMuted,
              border: `1px solid ${selectedAgent.id === a.id ? a.color + "30" : "transparent"}`,
            }}
          >
            <span>{getAgentAvatar(a).emoji}</span>
            {a.name}
          </button>
        ))}
        <Link
          href="/marketplace"
          className="flex items-center justify-center px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all"
          style={{ color: T.accentColor }}
        >
          +
        </Link>
      </div>

      {/* ── MOBILE: INSPECTOR BOTTOM SHEET ── */}
      {inspectorOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} onClick={() => setInspectorOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-t-xl max-h-[70vh] flex flex-col" style={{ backgroundColor: T.boxBg, borderTop: `1px solid ${T.borderColor}30` }}>
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: T.borderColor + "15" }}>
              <span className="text-xs font-bold" style={{ color: selectedAgent.color }}>{selectedAgent.name} · Inspector</span>
              <button onClick={() => setInspectorOpen(false)} className="opacity-50 hover:opacity-100"><X size={16} style={{ color: T.textColor }} /></button>
            </div>
            <div className="flex items-center gap-0.5 px-2 py-2 border-b shrink-0 overflow-x-auto" style={{ borderColor: T.borderColor + "15" }}>
              {inspectorTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setInspectorTab(tab.id)}
                  className="flex items-center gap-1 text-[9px] px-2 py-1.5 rounded font-bold transition-all whitespace-nowrap"
                  style={{ backgroundColor: inspectorTab === tab.id ? selectedAgent.color + "15" : "transparent", color: inspectorTab === tab.id ? selectedAgent.color : T.textMuted }}
                >
                  <tab.icon size={10} />
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-3">{renderInspectorContent()}</div>
          </div>
        </div>
      )}
    </div>
  );
}
