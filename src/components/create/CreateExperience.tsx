"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Code2,
  Gamepad2,
  Globe,
  Image as ImageIcon,
  Music,
  Palette,
  Video,
  type LucideIcon,
} from "lucide-react";

type CreateIntent = {
  label: string;
  description: string;
  seed: string;
  icon: LucideIcon;
};

export const CREATE_INTENTS: CreateIntent[] = [
  {
    label: "Website",
    description: "Landing pages, sites, and web apps — built, previewed, and deployed.",
    seed: "Build me a website",
    icon: Globe,
  },
  {
    label: "Image",
    description: "Generate and edit images, then drop them into a project.",
    seed: "Generate artwork",
    icon: ImageIcon,
  },
  {
    label: "Video",
    description: "Clips and motion content generated into your asset library.",
    seed: "Make a video",
    icon: Video,
  },
  {
    label: "Music & Audio",
    description: "Songs, loops, and sound — saved as reusable assets.",
    seed: "Make me a song",
    icon: Music,
  },
  {
    label: "Code",
    description: "Start from the code workspace with LiTT alongside.",
    seed: "Build me an app",
    icon: Code2,
  },
  {
    label: "Design",
    description: "Freeform design canvas for layouts and visuals.",
    seed: "Design a new interface",
    icon: Palette,
  },
  {
    label: "Game",
    description: "Describe a game — LiTT builds it as a playable web project.",
    seed: "Build me a game",
    icon: Gamepad2,
  },
];

export function CreateExperience({
  initialPrompt = "",
  initialIntent,
}: {
  initialPrompt?: string;
  initialIntent?: string | null;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isRouting, setIsRouting] = useState(false);
  const [routingMessage, setRoutingMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || isRouting) return;
    setIsRouting(true);
    setRoutingMessage(null);
    try {
      const response = await fetch("/api/litt/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const payload = (await response.json()) as {
        type?: "intent" | "clarification";
        request?: { question?: string };
        result?: { primaryIntent?: string };
        plan?: { id?: string };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "LiTT could not route that request.");
      if (payload.type === "clarification") {
        setRoutingMessage(payload.request?.question || "Tell LiTT what you want to work on.");
        return;
      }
      const params = new URLSearchParams({ tool: "chat", prompt: text });
      if (payload.result?.primaryIntent) params.set("intent", payload.result.primaryIntent);
      if (payload.plan?.id) params.set("planId", payload.plan.id);
      router.push(`/studio?${params.toString()}`);
    } catch (error) {
      setRoutingMessage(error instanceof Error ? error.message : "LiTT could not route that request.");
    } finally {
      setIsRouting(false);
    }
  };

  return (
    <section id="dashboard-guided-start" className="scroll-mt-24" data-testid="quick-create">
      <div
        className="rounded-2xl border p-5 shadow-2xl md:p-7"
        style={{
          background: "linear-gradient(135deg, rgba(30,24,48,0.92), rgba(18,18,21,0.86))",
          borderColor: "rgba(167,139,250,0.2)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "#a78bfa" }}>
              Start building
            </p>
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl" style={{ color: "#fafafa" }}>
              What do you want to build?
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: "#a1a1aa" }}>
              Tell LiTT what you need, or choose a starting point below. It will open the same Studio surface used by every creation flow.
            </p>
          </div>
          {initialIntent && (
            <span className="hidden rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider sm:block" style={{ borderColor: "rgba(167,139,250,0.25)", color: "#c4b5fd" }}>
              {initialIntent}
            </span>
          )}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row" data-testid="quick-create-form">
          <label htmlFor="dashboard-create-prompt" className="sr-only">What do you want to build?</label>
          <input
            id="dashboard-create-prompt"
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Build a landing page for my coffee roastery…"
            className="min-h-12 min-w-0 flex-1 rounded-xl border bg-black/20 px-4 text-sm outline-none transition focus:ring-2 focus:ring-violet-400/50"
            style={{ borderColor: "rgba(255,255,255,0.1)", color: "#fafafa" }}
          />
          <button
            type="submit"
            disabled={!prompt.trim() || isRouting}
            aria-busy={isRouting}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "#a78bfa", color: "#0a0012" }}
          >
            {isRouting ? "Routing…" : "Build with LiTT"} <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
        {routingMessage && (
          <p className="mt-3 text-sm" role="status" aria-live="polite" style={{ color: "#fbbf24" }}>
            {routingMessage}
          </p>
        )}

        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label="Quick create options">
          {CREATE_INTENTS.map((intent) => {
            const Icon = intent.icon;
            return (
              <button
                key={intent.label}
                type="button"
                onClick={() => {
                  setPrompt(intent.seed);
                  setRoutingMessage(null);
                }}
                className="group flex min-h-24 items-center gap-3 rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(18,18,21,0.6)" }}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: "rgba(167,139,250,0.12)", color: "#c4b5fd" }}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold" style={{ color: "#fafafa" }}>{intent.label}</span>
                  <span className="mt-1 line-clamp-2 block text-[11px] leading-4" style={{ color: "#71717a" }}>{intent.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
