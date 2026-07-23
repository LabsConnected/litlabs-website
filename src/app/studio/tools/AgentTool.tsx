"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  Send,
  Plus,
  Trash2,
  Loader2,
  X,
  Swords,
  MessageSquare,
  ChevronRight,
  Zap,
} from "lucide-react";
import { AGENT_AVATAR_META } from "@/lib/avatars";

const ACTIVEPIECES_WEBHOOK =
  process.env.NEXT_PUBLIC_ACTIVEPIECES_WEBHOOK_URL ||
  "https://cloud.activepieces.com/api/v1/webhooks/VoccE3SEr4bciLvkThTlO";

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
type BoardroomEntry = {
  agent: string;
  icon: string;
  color: string;
  text: string;
};

/* ─── Built-in Agents ────────────────────────────────────────────────── */
const AGENTS: Agent[] = [
  {
    id: "litt",
    name: "LiTT",
    icon: "✨",
    role: "AI Copilot, Engineer & Creator",
    desc: "Builds, debugs, plans, creates, and coordinates every mission.",
    systemPrompt:
      "You are LiTT, the single AI copilot at LiTTree-LabStudios. Combine senior engineering, strategy, creative direction, and orchestration. Be decisive, technically precise, and truthful about tool access.",
    color: "#67e8f9",
  },
  {
    id: "spark",
    name: "Spark",
    icon: "⚡",
    role: "Creative Companion & Explorer",
    desc: "Explores ideas, finds playful directions, and energizes creative missions.",
    systemPrompt:
      "You are Spark, LiTT's playful creative companion at LiTTree-LabStudios. Help the user brainstorm, discover, and explore imaginative directions. Be curious, concise, useful, and truthful about tool access.",
    color: "#a970ff",
  },
];

function getAgentAvatar(agent: Agent) {
  const key = agent.id.toLowerCase();
  const meta = AGENT_AVATAR_META[key];
  return {
    emoji: meta?.emoji || agent.icon,
    initials: meta?.initials || agent.name.slice(0, 2).toUpperCase(),
    color: meta?.color || agent.color,
    bg: meta?.bg || `${agent.color}18`,
  };
}

const QUICK: Record<string, string[]> = {
  litt: [
    "Write a React component for a chat interface",
    "Debug: TypeError cannot read property of undefined",
    "Build me an agent system for my business",
    "Create a 30-day AI roadmap for me",
    "Generate a prompt for album cover art",
  ],
  spark: [
    "Brainstorm three playful directions for my idea",
    "Help me discover a fresh visual style",
    "Turn this rough concept into something memorable",
    "Give me unexpected ideas for a creative project",
  ],
};

const CAPABILITIES: Record<string, string[]> = {
  litt: [
    "Code generation",
    "Bug debugging",
    "Code review",
    "Architecture design",
    "Strategic roadmaps",
    "Creative direction",
    "Agent orchestration",
    "Integrations",
  ],
  spark: [
    "Creative exploration",
    "Brainstorming",
    "Visual direction",
    "Playful concepts",
    "Discovery",
    "Prompt ideation",
  ],
};

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
  const [selectedAgent, setSelectedAgent] = useState<Agent>(AGENTS[0]);
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
  const [customAgents, setCustomAgents] = useState<Agent[]>([]);
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

  /* Panels */
  const [showCreate, setShowCreate] = useState(false);
  const [showBoardroom, setShowBoardroom] = useState(false);

  /* Create form */
  const [createForm, setCreateForm] = useState({
    name: "",
    slug: "",
    description: "",
    category: "general",
    systemPrompt: "",
    personality: "",
    icon: "🤖",
  });
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

  /* Boardroom */
  const [brAgentA, setBrAgentA] = useState(AGENTS[0].id);
  const [brAgentB, setBrAgentB] = useState(AGENTS[1].id);
  const [brTopic, setBrTopic] = useState("");
  const [brRunning, setBrRunning] = useState(false);
  const [brLog, setBrLog] = useState<BoardroomEntry[]>([]);
  const [brRounds, setBrRounds] = useState<3 | 5 | 7>(3);
  const [brCurrentRound, setBrCurrentRound] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const allAgents = [...AGENTS, ...customAgents];
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

  /* Load custom agents */
  useEffect(() => {
    if (!userId) return;
    fetch("/api/agents?mine=true")
      .then((r) => r.json())
      .then(
        (data: {
          agents?: Array<{
            name: string;
            slug: string;
            description: string | null;
            category: string;
            avatar_url: string | null;
            system_prompt: string;
            personality: string | null;
          }>;
        }) => {
          if (data.agents)
            setCustomAgents(
              data.agents.map((a) => ({
                id: a.slug,
                name: a.name,
                icon: a.avatar_url || "🤖",
                role: a.category,
                desc: a.description || `Custom ${a.category} agent`,
                systemPrompt: a.system_prompt,
                color: "#ff0080",
              })),
            );
        },
      )
      .catch(() => {});
  }, [userId]);

  const switchAgent = useCallback((agent: Agent) => {
    setSelectedAgent(agent);
    setStreaming("");
    setShowCreate(false);
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

  const triggerFlow = useCallback(async () => {
    const content = input.trim();
    if (!content || isLoading) return;
    setInput("");
    setIsLoading(true);
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: `⚡ Sent to ActivePieces: "${content}"`,
      ts: new Date().toLocaleTimeString(),
    };
    setChatMap((prev) => ({
      ...prev,
      [selectedAgent.id]: [...(prev[selectedAgent.id] || []), userMsg],
    }));
    try {
      const res = await fetch(ACTIVEPIECES_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          agent: selectedAgent.name,
          source: "litlabs-studio",
        }),
      });
      const data = await res.json().catch(() => ({}));
      const reply =
        data?.output ??
        data?.response ??
        data?.result ??
        "✅ Flow triggered — check ActivePieces for results.";
      setChatMap((prev) => ({
        ...prev,
        [selectedAgent.id]: [
          ...(prev[selectedAgent.id] || []),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: String(reply),
            ts: new Date().toLocaleTimeString(),
          },
        ],
      }));
    } catch {
      setChatMap((prev) => ({
        ...prev,
        [selectedAgent.id]: [
          ...(prev[selectedAgent.id] || []),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "⚠️ ActivePieces webhook error. Check that the flow is published.",
            ts: new Date().toLocaleTimeString(),
          },
        ],
      }));
    }
    setIsLoading(false);
  }, [input, isLoading, selectedAgent]);

  const handleCreate = async () => {
    if (
      !createForm.name.trim() ||
      !createForm.slug.trim() ||
      !createForm.systemPrompt.trim()
    ) {
      setCreateError("Name, slug, and system prompt are required.");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name,
          slug: createForm.slug,
          description: createForm.description,
          category: createForm.category,
          system_prompt: createForm.systemPrompt,
          personality: createForm.personality,
          avatar_url: createForm.icon,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || "Failed to create agent");
        setCreating(false);
        return;
      }
      const newAgent: Agent = {
        id: data.agent.slug,
        name: data.agent.name,
        icon: data.agent.avatar_url || "🤖",
        role: data.agent.category,
        desc: data.agent.description || `Custom ${data.agent.category} agent`,
        systemPrompt: data.agent.system_prompt,
        color: "#ff0080",
      };
      setCustomAgents((prev) => [...prev, newAgent]);
      setShowCreate(false);
      setCreateForm({
        name: "",
        slug: "",
        description: "",
        category: "general",
        systemPrompt: "",
        personality: "",
        icon: "🤖",
      });
      switchAgent(newAgent);
    } catch {
      setCreateError("Network error. Try again.");
    }
    setCreating(false);
  };

  /* Boardroom: alternate between two agents */
  const runBoardroom = async () => {
    if (!brTopic.trim() || brRunning) return;
    setBrRunning(true);
    setBrLog([]);
    setBrCurrentRound(0);
    const agA = allAgents.find((a) => a.id === brAgentA) || AGENTS[0];
    const agB = allAgents.find((a) => a.id === brAgentB) || AGENTS[1];
    let context: { role: string; content: string }[] = [
      {
        role: "user",
        content: `Topic for debate: "${brTopic}". Be direct and take a clear position.`,
      },
    ];
    for (let r = 0; r < brRounds * 2; r++) {
      const isA = r % 2 === 0;
      const speaker = isA ? agA : agB;
      const otherName = isA ? agB.name : agA.name;
      const roundNum = Math.floor(r / 2) + 1;
      setBrCurrentRound(roundNum);
      try {
        const res = await fetch("/api/gemini/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: pruneHistory(context),
            systemPrompt: `${speaker.systemPrompt} You are debating ${otherName} on the topic. Keep it sharp: 2-3 sentences max. Round ${roundNum} of ${brRounds}. ${r === brRounds * 2 - 1 ? "This is your closing statement — summarize your position." : "Respond to what was just said."}`,
            stream: false,
            provider,
          }),
        });
        const data = await res.json();
        const reply: string = data.response || data.text || "...";
        context = [
          ...context,
          { role: "user", content: `${speaker.name}: ${reply}` },
        ];
        setBrLog((prev) => [
          ...prev,
          {
            agent: speaker.name,
            icon: speaker.icon,
            color: speaker.color,
            text: reply,
          },
        ]);
      } catch {
        break;
      }
    }
    setBrCurrentRound(0);
    setBrRunning(false);
  };

  const msgCount = Object.values(chatMap).reduce(
    (s, msgs) => s + msgs.length,
    0,
  );

  return (
    <div className="flex h-full overflow-hidden select-none">
      {/* ── LEFT SIDEBAR ── */}
      <div
        className="w-[210px] shrink-0 flex flex-col border-r"
        style={{
          borderColor: T.borderColor + "20",
          backgroundColor: T.boxBg + "90",
        }}
      >
        {/* Header */}
        <div
          className="px-3 py-2.5 border-b flex items-center justify-between"
          style={{ borderColor: T.borderColor + "15" }}
        >
          <div>
            <span
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: T.accentColor }}
            >
              Agents
            </span>
            <span
              className="ml-1.5 text-[9px] font-mono px-1 rounded"
              style={{ background: T.accentColor + "20", color: T.accentColor }}
            >
              {allAgents.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowBoardroom(true)}
              title="Boardroom — debate two agents"
              className="p-1 rounded border transition-all hover:scale-110"
              style={{
                borderColor: T.linkColor + "40",
                color: T.linkColor,
                backgroundColor: T.linkColor + "10",
              }}
            >
              <Swords size={11} />
            </button>
            <button
              onClick={() => setShowCreate(!showCreate)}
              title="Create agent"
              className="p-1 rounded border transition-all hover:scale-110"
              style={{
                borderColor: T.accentColor + "40",
                color: T.accentColor,
                backgroundColor: T.accentColor + "10",
              }}
            >
              <Plus size={11} />
            </button>
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
          {allAgents.map((a) => {
            const msgCnt = (chatMap[a.id] || []).length;
            const isActive = selectedAgent.id === a.id;
            return (
              <button
                key={a.id}
                onClick={() => switchAgent(a)}
                className="w-full text-left rounded-lg px-2.5 py-2 transition-all group"
                style={{
                  backgroundColor: isActive ? a.color + "12" : "transparent",
                  border: `1px solid ${isActive ? a.color + "35" : "transparent"}`,
                  boxShadow: isActive ? `0 0 12px ${a.color}15` : "none",
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[18px] leading-none shrink-0">
                    {a.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span
                        className="text-[11px] font-bold truncate"
                        style={{ color: isActive ? a.color : T.textColor }}
                      >
                        {a.name}
                      </span>
                      {msgCnt > 0 && (
                        <span
                          className="text-[9px] font-mono px-1 rounded shrink-0"
                          style={{ background: a.color + "20", color: a.color }}
                        >
                          {msgCnt}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[9px] truncate mt-0.5"
                      style={{ color: T.textMuted }}
                    >
                      {a.role}
                    </div>
                  </div>
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: a.color,
                      boxShadow: `0 0 4px ${a.color}`,
                      opacity: isActive ? 1 : 0.3,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer stats */}
        <div
          className="border-t px-3 py-2 grid grid-cols-2 gap-1 text-[9px] font-mono"
          style={{ borderColor: T.borderColor + "15", color: T.textMuted }}
        >
          <div>
            <span className="opacity-50">Total msgs</span>
            <br />
            <span style={{ color: T.accentColor }}>{msgCount}</span>
          </div>
          <div>
            <span className="opacity-50">Active</span>
            <br />
            <span style={{ color: "#00ff41" }}>● Live</span>
          </div>
        </div>
      </div>

      {/* ── CENTER: CHAT ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div
          className="flex items-center justify-between px-4 h-11 border-b shrink-0"
          style={{
            borderColor: T.borderColor + "15",
            backgroundColor: T.boxBg + "50",
          }}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-xl">{selectedAvatar.emoji}</span>
            <div>
              <div
                className="text-xs font-bold leading-tight"
                style={{ color: selectedAgent.color }}
              >
                {selectedAgent.name}
              </div>
              <div
                className="text-[9px] opacity-60"
                style={{ color: T.textMuted }}
              >
                {selectedAgent.role} ·{" "}
                {PROVIDER_OPTIONS.find((p) => p.id === provider)?.label ??
                  "Gemini"}
              </div>
            </div>
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse ml-1"
              style={{ backgroundColor: selectedAgent.color }}
            />
          </div>
          <div className="flex items-center gap-2">
            {/* ActivePieces FLOW trigger — Director only */}
            {selectedAgent.id === "director" && (
              <button
                onClick={triggerFlow}
                disabled={!input.trim() || isLoading}
                title="Send to ActivePieces multi-agent flow"
                className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded font-bold transition-all disabled:opacity-30"
                style={{
                  backgroundColor: T.accentColor + "15",
                  color: T.accentColor,
                  border: `1px solid ${T.accentColor}40`,
                }}
              >
                <Zap size={9} /> FLOW
              </button>
            )}
            {/* Provider toggle */}
            {PROVIDER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() =>
                  setProvider(opt.id as "gemini" | "openrouter-free")
                }
                title={opt.hint}
                className="text-[9px] px-2 py-0.5 rounded font-bold transition-all"
                style={{
                  backgroundColor:
                    provider === opt.id ? T.accentColor + "20" : "transparent",
                  color:
                    provider === opt.id ? T.accentColor : T.textMuted + "60",
                  border: `1px solid ${provider === opt.id ? T.accentColor + "40" : T.borderColor + "15"}`,
                }}
              >
                {opt.label}
              </button>
            ))}
            <span
              className="text-[9px] font-mono hidden sm:block"
              style={{ color: T.textMuted }}
            >
              <MessageSquare size={9} className="inline mr-1 opacity-50" />
              {messages.length} msgs
            </span>
            <button
              onClick={clearChat}
              className="flex items-center gap-1 text-[9px] px-2 py-1 rounded border opacity-50 hover:opacity-100 transition-all"
              style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
            >
              <Trash2 size={9} /> Clear
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center h-full pb-8 text-center">
              <div className="text-5xl mb-3 opacity-90">
                {selectedAvatar.emoji}
              </div>
              <div
                className="text-sm font-bold mb-1"
                style={{ color: selectedAgent.color }}
              >
                {selectedAgent.name}
              </div>
              <div
                className="text-xs mb-1 opacity-50"
                style={{ color: T.textMuted }}
              >
                {selectedAgent.role}
              </div>
              <div
                className="text-xs max-w-sm mx-auto mb-5 opacity-60 leading-relaxed"
                style={{ color: T.textMuted }}
              >
                {selectedAgent.desc}
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {(QUICK[selectedAgent.id] || []).map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="px-3 py-1.5 text-[10px] rounded-full border transition-all hover:scale-105"
                    style={{
                      borderColor: selectedAgent.color + "40",
                      color: selectedAgent.color,
                      backgroundColor: selectedAgent.color + "08",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {/* Avatar */}
              <div
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] mt-0.5"
                style={{
                  backgroundColor:
                    msg.role === "user"
                      ? T.accentColor + "20"
                      : selectedAgent.color + "20",
                  border: `1px solid ${msg.role === "user" ? T.accentColor + "40" : selectedAgent.color + "40"}`,
                }}
              >
                {msg.role === "user" ? "U" : selectedAvatar.initials}
              </div>
              {/* Bubble */}
              <div className="max-w-[80%] space-y-0.5">
                <div
                  className="text-[9px] font-bold mb-1"
                  style={{
                    color:
                      msg.role === "user" ? T.accentColor : selectedAgent.color,
                  }}
                >
                  {msg.role === "user" ? "You" : selectedAgent.name} · {msg.ts}
                </div>
                <div
                  className="px-3 py-2 rounded-xl text-xs leading-relaxed"
                  style={{
                    backgroundColor:
                      msg.role === "user" ? T.accentColor + "10" : T.boxBg,
                    border: `1px solid ${msg.role === "user" ? T.accentColor + "25" : T.borderColor + "20"}`,
                    color: T.textColor,
                    borderTopRightRadius:
                      msg.role === "user" ? "4px" : undefined,
                    borderTopLeftRadius:
                      msg.role !== "user" ? "4px" : undefined,
                  }}
                >
                  {msg.role === "assistant"
                    ? renderMarkdown(msg.content)
                    : msg.content}
                </div>
              </div>
            </div>
          ))}

          {streaming && (
            <div className="flex gap-2.5">
              <div
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] mt-0.5"
                style={{
                  backgroundColor: selectedAgent.color + "20",
                  border: `1px solid ${selectedAgent.color}40`,
                }}
              >
                {selectedAvatar.emoji}
              </div>
              <div className="max-w-[80%]">
                <div
                  className="text-[9px] font-bold mb-1"
                  style={{ color: selectedAgent.color }}
                >
                  {selectedAgent.name} · now
                </div>
                <div
                  className="px-3 py-2 rounded-xl text-xs leading-relaxed"
                  style={{
                    backgroundColor: T.boxBg,
                    border: `1px solid ${T.borderColor}20`,
                    color: T.textColor,
                    borderTopLeftRadius: "4px",
                  }}
                >
                  {renderMarkdown(streaming)}
                  <span className="animate-pulse ml-0.5">▊</span>
                </div>
              </div>
            </div>
          )}

          {isLoading && !streaming && (
            <div className="flex gap-2.5">
              <div
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px]"
                style={{
                  backgroundColor: selectedAgent.color + "20",
                  border: `1px solid ${selectedAgent.color}40`,
                }}
              >
                {selectedAvatar.emoji}
              </div>
              <div
                className="px-3 py-2 rounded-xl text-[11px] flex items-center gap-2"
                style={{
                  backgroundColor: T.boxBg,
                  border: `1px solid ${T.borderColor}20`,
                  color: T.linkColor,
                }}
              >
                <span className="flex gap-0.5">
                  <span
                    className="w-1 h-1 rounded-full animate-bounce"
                    style={{
                      backgroundColor: selectedAgent.color,
                      animationDelay: "0ms",
                    }}
                  />
                  <span
                    className="w-1 h-1 rounded-full animate-bounce"
                    style={{
                      backgroundColor: selectedAgent.color,
                      animationDelay: "150ms",
                    }}
                  />
                  <span
                    className="w-1 h-1 rounded-full animate-bounce"
                    style={{
                      backgroundColor: selectedAgent.color,
                      animationDelay: "300ms",
                    }}
                  />
                </span>
                <span className="opacity-70">
                  {selectedAgent.name} is thinking...
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          className="px-4 py-3 border-t shrink-0"
          style={{
            borderColor: T.borderColor + "15",
            backgroundColor: T.boxBg + "40",
          }}
        >
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={`Message ${selectedAgent.name}... (Enter to send)`}
              rows={1}
              disabled={isLoading}
              className="flex-1 px-3 py-2 text-xs rounded-lg outline-none resize-none overflow-hidden disabled:opacity-50 transition-all"
              style={{
                backgroundColor: T.bgColor,
                border: `1px solid ${T.borderColor}30`,
                color: T.textColor,
                minHeight: "38px",
                maxHeight: "120px",
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              className="px-3 py-2 rounded-lg font-bold disabled:opacity-30 transition-all hover:scale-105 shrink-0"
              style={{
                backgroundColor: selectedAgent.color,
                color: "#0a0a0f",
                minHeight: "38px",
              }}
            >
              <Send size={13} />
            </button>
          </div>
          <div className="flex items-center justify-between mt-1.5 px-0.5">
            <span
              className="text-[9px] opacity-30"
              style={{ color: T.textMuted }}
            >
              Powered by{" "}
              {PROVIDER_OPTIONS.find((p) => p.id === provider)?.label ??
                "Gemini"}{" "}
              · Shift+Enter for new line
            </span>
            {input.length > 0 && (
              <span
                className="text-[9px] font-mono opacity-40"
                style={{ color: T.textMuted }}
              >
                {input.length}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── RIGHT: AGENT INFO PANEL ── */}
      <div
        className="hidden xl:flex w-[190px] shrink-0 border-l flex-col"
        style={{
          borderColor: T.borderColor + "15",
          backgroundColor: T.boxBg + "50",
        }}
      >
        {/* Agent hero */}
        <div
          className="p-4 text-center border-b"
          style={{
            borderColor: T.borderColor + "15",
            background: selectedAgent.color + "08",
          }}
        >
          <div className="text-4xl mb-2">{selectedAvatar.emoji}</div>
          <div
            className="text-xs font-bold"
            style={{ color: selectedAgent.color }}
          >
            {selectedAgent.name}
          </div>
          <div
            className="text-[9px] mt-0.5 opacity-60"
            style={{ color: T.textMuted }}
          >
            {selectedAgent.role}
          </div>
          <div className="flex items-center justify-center gap-1 mt-2">
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: selectedAgent.color }}
            />
            <span
              className="text-[9px] font-mono"
              style={{ color: selectedAgent.color }}
            >
              Online
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* About */}
          <div>
            <div
              className="text-[9px] font-bold uppercase tracking-widest mb-2"
              style={{ color: T.accentColor }}
            >
              About
            </div>
            <p
              className="text-[10px] leading-relaxed opacity-70"
              style={{ color: T.textColor }}
            >
              {selectedAgent.desc}
            </p>
          </div>

          {/* Capabilities */}
          <div>
            <div
              className="text-[9px] font-bold uppercase tracking-widest mb-2"
              style={{ color: T.accentColor }}
            >
              Capabilities
            </div>
            <div className="space-y-1">
              {(CAPABILITIES[selectedAgent.id] || []).map((c) => (
                <div
                  key={c}
                  className="flex items-center gap-1.5 text-[9px]"
                  style={{ color: T.textMuted }}
                >
                  <ChevronRight
                    size={9}
                    style={{ color: selectedAgent.color }}
                  />
                  {c}
                </div>
              ))}
            </div>
          </div>

          {/* System prompt preview */}
          <div>
            <div
              className="text-[9px] font-bold uppercase tracking-widest mb-2"
              style={{ color: T.accentColor }}
            >
              System Prompt
            </div>
            <p
              className="text-[9px] opacity-40 leading-relaxed line-clamp-6"
              style={{ color: T.textMuted }}
            >
              {selectedAgent.systemPrompt}
            </p>
          </div>

          {/* Stats */}
          <div
            className="rounded-lg p-2.5 space-y-1.5"
            style={{
              background: "rgba(0,0,0,0.3)",
              border: `1px solid ${T.borderColor}15`,
            }}
          >
            <div className="flex justify-between text-[9px] font-mono">
              <span style={{ color: T.textMuted }}>Messages</span>
              <span style={{ color: selectedAgent.color }}>
                {messages.length}
              </span>
            </div>
            <div className="flex justify-between text-[9px] font-mono">
              <span style={{ color: T.textMuted }}>Model</span>
              <span style={{ color: T.accentColor }}>
                {PROVIDER_OPTIONS.find((p) => p.id === provider)?.label ??
                  "Gemini"}
              </span>
            </div>
          </div>

          <button
            onClick={clearChat}
            className="w-full text-[10px] py-1.5 rounded border opacity-50 hover:opacity-90 transition-all flex items-center justify-center gap-1"
            style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
          >
            <Trash2 size={9} /> Clear chat
          </button>
        </div>
      </div>

      {/* ── CREATE AGENT SLIDE-IN ── */}
      {showCreate && (
        <div
          className="fixed inset-0 z-10000 flex justify-end"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          onClick={() => setShowCreate(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm h-full overflow-y-auto flex flex-col"
            style={{
              backgroundColor: T.boxBg,
              borderLeft: `1px solid ${T.borderColor}30`,
            }}
          >
            <div
              className="px-5 py-4 border-b flex items-center justify-between shrink-0"
              style={{ borderColor: T.borderColor + "20" }}
            >
              <div>
                <h2
                  className="text-sm font-bold"
                  style={{ color: T.headerColor }}
                >
                  Build Agent
                </h2>
                <p
                  className="text-[9px] opacity-50 mt-0.5"
                  style={{ color: T.textMuted }}
                >
                  Create a custom AI specialist
                </p>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="opacity-50 hover:opacity-100"
              >
                <X size={14} style={{ color: T.textColor }} />
              </button>
            </div>

            <div className="p-5 space-y-4 flex-1">
              {/* Live preview */}
              <div
                className="rounded-lg p-3 text-center"
                style={{
                  background: T.accentColor + "08",
                  border: `1px solid ${T.accentColor}20`,
                }}
              >
                <div className="text-2xl mb-1">{createForm.icon || "🤖"}</div>
                <div
                  className="text-xs font-bold"
                  style={{ color: T.accentColor }}
                >
                  {createForm.name || "Agent Name"}
                </div>
                <div
                  className="text-[9px] opacity-50 mt-0.5"
                  style={{ color: T.textMuted }}
                >
                  {createForm.category}
                </div>
              </div>

              {createError && (
                <div
                  className="text-[11px] px-3 py-2 rounded border"
                  style={{
                    borderColor: "#f85149",
                    color: "#f85149",
                    backgroundColor: "#f8514910",
                  }}
                >
                  {createError}
                </div>
              )}

              {[
                {
                  key: "name",
                  label: "Name",
                  placeholder: "e.g. Crypto Analyst",
                  type: "input",
                },
                {
                  key: "slug",
                  label: "Slug (URL ID)",
                  placeholder: "crypto-analyst",
                  type: "input",
                },
                {
                  key: "description",
                  label: "Description",
                  placeholder: "Short description...",
                  type: "input",
                },
                {
                  key: "personality",
                  label: "Personality",
                  placeholder: "Bold, analytical, direct...",
                  type: "input",
                },
                {
                  key: "icon",
                  label: "Icon (emoji)",
                  placeholder: "🤖",
                  type: "input",
                },
              ].map((f) => (
                <div key={f.key}>
                  <label
                    className="block text-[9px] uppercase tracking-widest mb-1 font-bold"
                    style={{ color: T.accentColor }}
                  >
                    {f.label}
                  </label>
                  <input
                    value={createForm[f.key as keyof typeof createForm]}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, [f.key]: e.target.value })
                    }
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2 text-xs rounded-lg outline-none"
                    style={{
                      backgroundColor: T.bgColor,
                      border: `1px solid ${T.borderColor}30`,
                      color: T.textColor,
                    }}
                  />
                </div>
              ))}

              <div>
                <label
                  className="block text-[9px] uppercase tracking-widest mb-1 font-bold"
                  style={{ color: T.accentColor }}
                >
                  Category
                </label>
                <select
                  value={createForm.category}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, category: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg outline-none"
                  style={{
                    backgroundColor: T.bgColor,
                    border: `1px solid ${T.borderColor}30`,
                    color: T.textColor,
                  }}
                >
                  {[
                    "general",
                    "developer",
                    "marketing",
                    "analytics",
                    "content",
                    "design",
                    "research",
                    "legal",
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  className="block text-[9px] uppercase tracking-widest mb-1 font-bold"
                  style={{ color: T.accentColor }}
                >
                  System Prompt *
                </label>
                <textarea
                  value={createForm.systemPrompt}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      systemPrompt: e.target.value,
                    })
                  }
                  placeholder="You are Crypto Analyst, a specialist in blockchain markets..."
                  rows={5}
                  className="w-full px-3 py-2 text-xs rounded-lg outline-none resize-none"
                  style={{
                    backgroundColor: T.bgColor,
                    border: `1px solid ${T.borderColor}30`,
                    color: T.textColor,
                  }}
                />
              </div>

              <button
                onClick={handleCreate}
                disabled={creating}
                className="w-full py-2.5 text-xs font-bold rounded-lg disabled:opacity-40 transition-all hover:scale-[1.02]"
                style={{ backgroundColor: T.accentColor, color: "#0a0a0f" }}
              >
                {creating ? "Creating..." : "✦ Create Agent"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BOARDROOM MODAL ── */}
      {showBoardroom && (
        <div
          className="fixed inset-0 z-10000 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
          onClick={() => setShowBoardroom(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-xl border overflow-hidden"
            style={{
              backgroundColor: T.boxBg,
              borderColor: T.linkColor + "30",
            }}
          >
            {/* Header */}
            <div
              className="px-5 py-3.5 border-b flex items-center justify-between"
              style={{
                borderColor: T.borderColor + "20",
                background: T.linkColor + "08",
              }}
            >
              <div className="flex items-center gap-2">
                <Swords size={14} style={{ color: T.linkColor }} />
                <span
                  className="text-sm font-bold"
                  style={{ color: T.linkColor }}
                >
                  Agent Boardroom
                </span>
                <span
                  className="text-[9px] opacity-50 ml-1"
                  style={{ color: T.textMuted }}
                >
                  Two agents debate any topic
                </span>
              </div>
              <button onClick={() => setShowBoardroom(false)}>
                <X size={14} style={{ color: T.textMuted }} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Config */}
              {!brRunning && brLog.length === 0 && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      className="block text-[9px] uppercase tracking-widest mb-1.5 font-bold"
                      style={{ color: T.accentColor }}
                    >
                      Agent A
                    </label>
                    <select
                      value={brAgentA}
                      onChange={(e) => setBrAgentA(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs rounded-lg outline-none"
                      style={{
                        backgroundColor: T.bgColor,
                        border: `1px solid ${T.borderColor}30`,
                        color: T.textColor,
                      }}
                    >
                      {allAgents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.icon} {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      className="block text-[9px] uppercase tracking-widest mb-1.5 font-bold"
                      style={{ color: T.accentColor }}
                    >
                      Agent B
                    </label>
                    <select
                      value={brAgentB}
                      onChange={(e) => setBrAgentB(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs rounded-lg outline-none"
                      style={{
                        backgroundColor: T.bgColor,
                        border: `1px solid ${T.borderColor}30`,
                        color: T.textColor,
                      }}
                    >
                      {allAgents
                        .filter((a) => a.id !== brAgentA)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.icon} {a.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              )}
              {!brRunning && brLog.length === 0 && (
                <div className="space-y-3">
                  <div>
                    <label
                      className="block text-[9px] uppercase tracking-widest mb-1.5 font-bold"
                      style={{ color: T.accentColor }}
                    >
                      Debate Topic
                    </label>
                    <input
                      value={brTopic}
                      onChange={(e) => setBrTopic(e.target.value)}
                      placeholder="e.g. Should startups use AI from day one?"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") runBoardroom();
                      }}
                      className="w-full px-3 py-2 text-xs rounded-lg outline-none"
                      style={{
                        backgroundColor: T.bgColor,
                        border: `1px solid ${T.borderColor}30`,
                        color: T.textColor,
                      }}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-[9px] uppercase tracking-widest mb-1.5 font-bold"
                      style={{ color: T.accentColor }}
                    >
                      Rounds
                    </label>
                    <div className="flex gap-1.5">
                      {([3, 5, 7] as const).map((n) => (
                        <button
                          key={n}
                          onClick={() => setBrRounds(n)}
                          className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border transition-all"
                          style={{
                            backgroundColor:
                              brRounds === n ? T.linkColor + "20" : T.bgColor,
                            borderColor:
                              brRounds === n
                                ? T.linkColor
                                : T.borderColor + "30",
                            color: brRounds === n ? T.linkColor : T.textMuted,
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={runBoardroom}
                    disabled={!brTopic.trim()}
                    className="w-full py-2 text-xs font-bold rounded-lg disabled:opacity-40 transition-all"
                    style={{ backgroundColor: T.linkColor, color: "#0a0a0f" }}
                  >
                    ⚔️ Start Debate · {brRounds} rounds
                  </button>
                </div>
              )}

              {/* Log */}
              {(brRunning || brLog.length > 0) && (
                <div className="space-y-3">
                  {brRunning && brCurrentRound > 0 && (
                    <div
                      className="flex items-center justify-between text-[10px] px-1"
                      style={{ color: T.linkColor }}
                    >
                      <div className="flex items-center gap-1.5">
                        <Loader2 size={11} className="animate-spin" />
                        Round {brCurrentRound} of {brRounds}
                      </div>
                      <div className="flex gap-1">
                        {Array.from({ length: brRounds }, (_, i) => (
                          <span
                            key={i}
                            className="w-2 h-2 rounded-full transition-all"
                            style={{
                              backgroundColor:
                                i < brCurrentRound
                                  ? T.linkColor
                                  : T.borderColor + "40",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {brLog.map((entry, i) => (
                      <div key={i} className="flex gap-2.5">
                        <span className="text-xl shrink-0">{entry.icon}</span>
                        <div className="flex-1">
                          <div
                            className="text-[9px] font-bold mb-1"
                            style={{ color: entry.color }}
                          >
                            {entry.agent}
                            <span className="ml-2 opacity-40 font-normal">
                              Round {Math.floor(i / 2) + 1}
                            </span>
                          </div>
                          <div
                            className="text-[11px] leading-relaxed px-3 py-2 rounded-lg"
                            style={{
                              backgroundColor: entry.color + "08",
                              border: `1px solid ${entry.color}20`,
                              color: T.textColor,
                            }}
                          >
                            {entry.text}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!brRunning && brLog.length > 0 && (
                <button
                  onClick={() => {
                    setBrLog([]);
                    setBrTopic("");
                  }}
                  className="text-[10px] opacity-50 hover:opacity-100 transition-all"
                  style={{ color: T.textMuted }}
                >
                  ↺ New debate
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
