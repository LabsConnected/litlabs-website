"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Send, Sparkles } from "lucide-react";
import { LiTTFace } from "@/components/litt/LiTTFace";
import { BentoCard } from "@/components/site/BentoCard";
import type { LiTTMood } from "@/lib/ai/litt-router";

export function LittMiniWidget() {
  const { resolvedColors: T } = useTheme();
  const [mood, setMood] = useState<LiTTMood>("happy");
  const [input, setInput] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAsk = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setMood("thinking");
    try {
      const res = await fetch("/api/litt/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input.trim() }),
      });
      const data = await res.json();
      setReply(data.reply || "LiTT is thinking...");
      if (data.mood) setMood(data.mood);
    } catch {
      setReply("LiTT is here, but the brain is taking a nap. Try again?");
      setMood("sleepy");
    } finally {
      setLoading(false);
    }
  };

  return (
    <BentoCard
      title="LiTT"
      icon={<Sparkles size={14} />}
      accent="#a3f546"
      action={
        <Link
          href="/litt"
          className="text-[10px] font-bold uppercase tracking-wider transition hover:opacity-70"
          style={{ color: "#a3f546" }}
        >
          Open Hub
        </Link>
      }
      className="row-span-2"
    >
      <div className="flex h-full flex-col items-center justify-between gap-3">
        <div className="flex flex-col items-center gap-2">
          <LiTTFace mood={mood} size={100} showBadge={false} />
          <div
            className="text-center text-xs"
            style={{ color: T.textMuted }}
          >
            {reply || "Hey builder, what's the move?"}
          </div>
        </div>

        <div className="w-full">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Ask LiTT..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none"
              style={{
                borderColor: `${T.borderColor}40`,
                color: T.textColor,
              }}
            />
            <button
              onClick={handleAsk}
              disabled={loading || !input.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-lg transition disabled:opacity-50"
              style={{
                backgroundColor: "#a3f546",
                color: "#000",
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </BentoCard>
  );
}
