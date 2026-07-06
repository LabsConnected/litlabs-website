"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Target, CheckCircle2 } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";

const MISSIONS = [
  { id: "run-agent", label: "Run an agent", xp: 100 },
  { id: "open-project", label: "Open a project", xp: 50 },
  { id: "play-game", label: "Play a game", xp: 75 },
  { id: "ask-litt", label: "Ask LiTT", xp: 50 },
  { id: "build", label: "Build something", xp: 150 },
];

const STORAGE_KEY = "litlabs-daily-missions";

function loadCompleted(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveCompleted(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export function DailyMissionsWidget() {
  const { resolvedColors: T } = useTheme();
  const [completed, setCompleted] = useState<string[]>([]);

  useEffect(() => {
    setCompleted(loadCompleted());
  }, []);

  const toggle = (id: string) => {
    const next = completed.includes(id)
      ? completed.filter((c) => c !== id)
      : [...completed, id];
    setCompleted(next);
    saveCompleted(next);
  };

  const totalXp = completed.reduce((sum, id) => {
    const mission = MISSIONS.find((m) => m.id === id);
    return sum + (mission?.xp || 0);
  }, 0);

  return (
    <BentoCard
      title="Daily Missions"
      icon={<Target size={14} />}
      footer={`${completed.length}/${MISSIONS.length} completed • ${totalXp} XP`}
    >
      <div className="flex flex-col gap-2">
        {MISSIONS.map((mission) => {
          const isDone = completed.includes(mission.id);
          return (
            <button
              key={mission.id}
              onClick={() => toggle(mission.id)}
              className="flex items-center justify-between rounded-xl border p-2.5 text-left transition"
              style={{
                borderColor: isDone ? `${T.success}40` : `${T.borderColor}25`,
                backgroundColor: isDone ? `${T.success}10` : `${T.borderColor}08`,
              }}
            >
              <div className="flex items-center gap-2">
                <div style={{ color: isDone ? T.success : T.textMuted }}>
                  {isDone ? <CheckCircle2 size={16} /> : <Target size={16} />}
                </div>
                <div>
                  <div
                    className="text-xs font-bold"
                    style={{ color: isDone ? T.success : T.textColor }}
                  >
                    {mission.label}
                  </div>
                  <div className="text-[9px]" style={{ color: T.textMuted }}>
                    +{mission.xp} XP
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </BentoCard>
  );
}
