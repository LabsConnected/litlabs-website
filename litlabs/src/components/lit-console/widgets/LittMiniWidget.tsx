"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Send, Sparkles, CheckCircle, AlertTriangle, Info } from "lucide-react";
import { LiTTFace } from "@/components/litt/LiTTFace";
import { BentoCard } from "@/components/site/BentoCard";
import type { LiTTMood } from "@/lib/ai/litt-router";

const DIGEST_ITEMS = [
  { icon: CheckCircle, color: "#22c55e", text: "3 agents finished tasks" },
  { icon: CheckCircle, color: "#a3f546", text: "2 images generated" },
  { icon: Info, color: "#00f5ff", text: "Memory synced to Supermemory" },
  { icon: AlertTriangle, color: "#f59e0b", text: "Deploy pending approval" },
];

const GREETINGS = [
  "Hey builder, what's the move?",
  "Systems nominal. What are we building?",
  "All agents online. Ready.",
  "LiTT online. What's next?",
  "Ready to ship. What do you need?",
];

export function LittMiniWidget() {
  const { resolvedColors: T } = useTheme();
  const [mood, setMood] = useState<LiTTMood>("happy");
  const [input, setInput] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [greeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  const [showDigest, setShowDigest] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShowDigest(false), 6000);
    return () => clearTimeout(t);
  }, []);

  const handleAsk = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setShowDigest(false);
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
      setInput("");
    }
  };

  return (
    <BentoCard
      title="LiTT"
      icon={<Sparkles size={14} />}
      accent="#a3f546"
      action={
        <Link
          href="/studio?tool=chat"
          className="text-[10px] font-bold uppercase tracking-wider transition hover:opacity-70"
          style={{ color: "#a3f546" }}
        >
          Open Hub
        </Link>
      }
      className="row-span-2"
    >
      <div className="flex h-full flex-col items-center justify-between gap-2">
        <div className="flex flex-col items-center gap-1 w-full">
          <LiTTFace mood={mood} size={120} showBadge={false} />

          {/* Reply or greeting */}
          <p className="text-center text-xs leading-relaxed px-2" style={{ color: T.textMuted }}>
            {reply || greeting}
          </p>

          {/* Activity digest — fades out after 6s, re-appears when no reply */}
          {showDigest && !reply && (
            <div className="w-full mt-1 flex flex-col gap-1">
              {DIGEST_ITEMS.map((item, i) => {
                const Icon = item.icon;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px]"
                    style={{ backgroundColor: `${item.color}10`, borderLeft: `2px solid ${item.color}50` }}
                  >
                    <Icon size={10} style={{ color: item.color, flexShrink: 0 }} />
                    <span style={{ color: T.textColor }}>{item.text}</span>
                  </div>
                );
              })}
              <button
                onClick={() => setShowDigest(false)}
                className="text-[9px] text-center mt-0.5 opacity-40 hover:opacity-80 transition-opacity"
                style={{ color: T.textMuted }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        <div className="w-full">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Ask LiTT..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-xs outline-none"
              style={{ borderColor: `${T.borderColor}40`, color: T.textColor }}
            />
            <button
              onClick={handleAsk}
              disabled={loading || !input.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-50"
              style={{ backgroundColor: "#a3f546", color: "#000" }}
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      </div>
    </BentoCard>
  );
}
