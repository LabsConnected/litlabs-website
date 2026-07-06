"use client";

import { useState, useEffect } from "react";
import { Radio } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";
import { LC } from "../lit-console-theme";

const TELEMETRY_LINES = [
  { agent: "Forge",         msg: "Synchronized local Supabase client instance." },
  { agent: "Data Slayer",   msg: "Optimized ledger indexing. Uptime: 99.98%" },
  { agent: "LiTTree",       msg: "Orchestration thread compiled for boardroom session." },
  { agent: "Visionary",     msg: "Queued 3 image generation requests. Latency: 12ms" },
  { agent: "SocialPilot",   msg: "Posted to 4 channels. Impressions +1,247 this hour." },
  { agent: "Pulse",         msg: "Growth loop triggered — 3 new signups from referral." },
  { agent: "Music Producer",msg: "Audio render complete. Track duration: 2:47" },
  { agent: "Nexus",         msg: "Webhook delivered. Integration latency: 82ms" },
];

export function LiveTelemetryWidget() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % TELEMETRY_LINES.length), 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <BentoCard title="Live Telemetry" icon={<Radio size={14} />}>
      <div className="space-y-2">
        {TELEMETRY_LINES.map((line, i) => {
          const active = i === idx;
          return (
            <div
              key={i}
              className="rounded-lg px-2.5 py-2 transition-all"
              style={{
                backgroundColor: active ? `${LC.accentCyan}10` : `${LC.bgSecondary}80`,
                border: `1px solid ${active ? `${LC.accentCyan}30` : `${LC.border}20`}`,
              }}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: active ? LC.accentCyan : `${LC.textDim}40`,
                    boxShadow: active ? `0 0 6px ${LC.accentCyan}` : "none",
                  }}
                />
                <span
                  className="text-[9px] font-black truncate"
                  style={{ color: active ? LC.accentCyan : LC.text }}
                >
                  {line.agent}
                </span>
              </div>
              <p className="text-[8px] opacity-50 leading-relaxed pl-3" style={{ color: LC.textMuted }}>
                {line.msg}
              </p>
            </div>
          );
        })}
      </div>
    </BentoCard>
  );
}
