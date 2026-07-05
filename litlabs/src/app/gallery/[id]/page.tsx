"use client";

import { useState, useRef, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import { AGENT_AVATARS } from "@/lib/avatars";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const GALLERY_AGENTS = [
  {
    id: "code-champion",
    name: "Code Champion",
    avatar: AGENT_AVATARS["code-champion"],
    greeting:
      "Code Champion online. Transmit your technical problem or architecture idea. How can I help you build today?",
  },
  {
    id: "social-dominator",
    name: "Social Dominator",
    avatar: AGENT_AVATARS["social-dominator"],
    greeting:
      "What's the vibe? Give me a topic and I'll craft something worth sharing. Let's make you go viral.",
  },
  {
    id: "data-slayer",
    name: "Data Slayer",
    avatar: AGENT_AVATARS["data-slayer"],
    greeting:
      "Data Slayer initialized. Transmit your dataset or analytical problem. I'll extract the insights you need.",
  },
  {
    id: "writing-coach",
    name: "Writing Coach",
    avatar: AGENT_AVATARS["writing-coach"],
    greeting:
      "Neural link established. Ready to refine your linguistic output. What are we working on?",
  },
  {
    id: "support-agent",
    name: "Support Agent",
    avatar: AGENT_AVATARS["support-agent"],
    greeting: "Support Node active. How can I assist you or your users today?",
  },
  {
    id: "trading-oracle",
    name: "Trading Oracle",
    avatar: AGENT_AVATARS.champion,
    greeting:
      "Market analysis node online. Transmit the asset or sector you want me to evaluate.",
  },
];

export default function AgentDeploymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const agent = GALLERY_AGENTS.find((a) => a.id === id) || GALLERY_AGENTS[0];

  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: agent.greeting },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, loading]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/gallery");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return (
      <PageShell title="Loading...">
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-3xl mb-4 animate-pulse">🎨</div>
            <div>Loading agent...</div>
          </div>
        </div>
      </PageShell>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell title="Sign In">
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
          <p className="text-sm opacity-60">
            Please sign in to chat with gallery agents.
          </p>
          <Link
            href="/sign-in?redirect_url=/gallery"
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={{ backgroundColor: "#6366f1", color: "#fff" }}
          >
            Sign In
          </Link>
        </div>
      </PageShell>
    );
  }

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setMessages((p) => [...p, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agent: id }),
      });
      const data = await res.json();
      setMessages((p) => [
        ...p,
        {
          role: "assistant",
          content: data.reply || data.message || "No response.",
        },
      ]);
    } catch {
      setMessages((p) => [
        ...p,
        {
          role: "assistant",
          content:
            "Error: Neural Link Interrupted. Check backend connectivity.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell
      title={agent.name}
      subtitle="Gallery Agent Chat"
      className="bg-cyber-bg selection:bg-neon-cyan/30"
    >
      <main className="flex-1 max-w-4xl w-full mx-auto flex flex-col p-4 sm:p-6 lg:py-10">
        {/* Agent Info Header */}
        <div className="flex items-center justify-between gap-4 p-4 sm:p-6 glass-panel rounded-2xl border-white/5 mb-6">
          <div className="flex items-center gap-4 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={agent.avatar}
              alt={agent.name}
              className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl object-cover border border-neon-cyan/30 shrink-0 shadow-[0_0_20px_rgba(0,242,254,0.1)]"
            />
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs font-bold text-neon-cyan tracking-[0.3em] uppercase mb-1">
                Active_Deployment
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight truncate">
                {agent.name}
              </h1>
            </div>
          </div>
          <div className="hidden sm:block text-right">
            <div className="text-[10px] font-bold text-text-muted tracking-widest uppercase opacity-40">
              Node_v3.0.4
            </div>
            <div className="text-[10px] font-bold text-green-400 tracking-widest uppercase mt-1">
              ● STATUS_ONLINE
            </div>
          </div>
        </div>

        {/* Chat Interface */}
        <div className="flex-1 flex flex-col min-h-0 glass-panel rounded-3xl border-white/5 overflow-hidden">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scrollbar-hide">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-500`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 text-sm sm:text-base leading-relaxed ${
                    m.role === "user"
                      ? "bg-neon-cyan text-cyber-bg rounded-br-sm font-bold shadow-[0_0_20px_rgba(0,242,254,0.1)]"
                      : "bg-white/3 border border-white/10 text-text-primary rounded-tl-sm backdrop-blur-md"
                  }`}
                >
                  {m.role === "assistant" && (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[10px] font-bold text-neon-cyan tracking-[0.2em] uppercase">
                        {agent.name}
                      </span>
                      <div className="h-px flex-1 bg-neon-cyan/20" />
                    </div>
                  )}
                  <div className="whitespace-pre-wrap wrap-break-word">
                    {m.content}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start animate-in fade-in duration-300">
                <div className="bg-white/3 border border-white/10 rounded-2xl rounded-tl-sm p-4 min-w-[140px]">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-bold text-neon-cyan tracking-[0.2em] uppercase">
                      Neural_Link
                    </span>
                    <div className="h-px flex-1 bg-neon-cyan/20" />
                  </div>
                  <div className="flex items-center gap-3 text-text-muted">
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-bounce [animation-delay:0.4s]" />
                    </span>
                    <span className="text-[10px] font-bold tracking-widest uppercase opacity-40">
                      Transmitting...
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input Area */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="p-4 sm:p-6 bg-black/40 border-t border-white/5"
          >
            <div className="flex gap-2 items-center bg-black/60 rounded-2xl border border-white/10 p-1.5 sm:p-2 focus-within:border-neon-cyan/40 transition-all duration-300 shadow-inner">
              <input
                className="flex-1 bg-transparent border-none px-4 py-2.5 sm:py-3 text-sm sm:text-base text-text-primary outline-none placeholder:text-text-muted font-medium"
                placeholder={`Initialize command sequence for ${agent.name.split(" ")[0]}...`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-xl bg-neon-cyan text-cyber-bg hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:grayscale shadow-[0_0_20px_rgba(0,242,254,0.2)] shrink-0"
              >
                <svg
                  className="w-5 h-5 sm:w-6 sm:h-6 rotate-90"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </main>
    </PageShell>
  );
}
