"use client";

import { useState } from "react";
import { Send, Sparkles, Command, Wrench, Bot, Rocket } from "lucide-react";

const quickActions = [
  { label: "Explain error", icon: Sparkles },
  { label: "Generate command", icon: Command },
  { label: "Create agent", icon: Bot },
  { label: "Deploy app", icon: Rocket },
];

export function JarvisAssistantPanel() {
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState(
    "Ask me to explain errors, write commands, create files, or run agent workflows."
  );
  const [loading, setLoading] = useState(false);

  async function askJarvis() {
    if (!prompt.trim()) return;
    setLoading(true);
    setAnswer("Thinking...");

    try {
      const res = await fetch("/api/jarvis/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      setAnswer(data.answer || "No response.");
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : "Failed to reach Jarvis.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-4 flex items-center gap-2">
        <div className="rounded-lg bg-orange-600/20 p-1.5">
          <Wrench className="h-4 w-4 text-orange-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Ask Jarvis</h2>
          <p className="text-xs text-neutral-500">AI command helper</p>
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Example: install shadcn and create a dashboard..."
        className="h-28 w-full resize-none rounded-lg border border-neutral-800 bg-black p-3 text-sm outline-none focus:border-orange-600"
      />

      <button
        onClick={askJarvis}
        disabled={loading || !prompt.trim()}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 font-bold text-white disabled:opacity-50 hover:bg-orange-500"
      >
        <Send className="h-4 w-4" />
        {loading ? "Jarvis is thinking..." : "Ask Jarvis"}
      </button>

      <div className="mt-4 whitespace-pre-wrap rounded-lg border border-neutral-800 bg-black p-3 text-sm text-neutral-300">
        {answer}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {quickActions.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              onClick={() => setPrompt(item.label)}
              className="flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-left text-xs text-neutral-300 hover:border-orange-600 hover:text-orange-400"
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
