"use client";

import { useState } from "react";
import { LITT } from "./litt-theme";

interface StudioIDEProps {
  onSendToLiTT?: (prompt: string) => void;
}

export function StudioIDE({ onSendToLiTT }: StudioIDEProps) {
  const [language, setLanguage] = useState("typescript");
  const [task, setTask] = useState("");

  const languages = ["typescript", "python", "css", "sql", "rust"];

  const handleAskLiTT = () => {
    const prompt = `Help me write ${language} code for this task: ${task}`;
    onSendToLiTT?.(prompt);
  };

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ borderColor: LITT.border, backgroundColor: LITT.bgPanel }}
    >
      <h3 className="mb-1 text-lg font-bold" style={{ color: LITT.text }}>
        Studio IDE
      </h3>
      <p className="mb-4 text-sm" style={{ color: LITT.textMuted }}>
        Describe a coding task and LiTT will draft the code.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {languages.map((l) => (
          <button
            key={l}
            onClick={() => setLanguage(l)}
            className="rounded-md border px-3 py-1 text-xs font-medium"
            style={{
              borderColor: language === l ? LITT.accentCyan : LITT.border,
              backgroundColor:
                language === l ? "rgba(163,245,70,0.12)" : LITT.bg,
              color: language === l ? LITT.accentCyan : LITT.textMuted,
            }}
          >
            {l}
          </button>
        ))}
      </div>

      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Describe what you want to build..."
        className="mb-4 min-h-[120px] w-full rounded-lg border p-3 font-mono text-sm outline-none"
        style={{
          backgroundColor: LITT.bg,
          borderColor: LITT.border,
          color: LITT.text,
          fontFamily: LITT.fontMono,
        }}
      />

      <button
        onClick={handleAskLiTT}
        disabled={!onSendToLiTT || !task.trim()}
        className="w-full rounded-lg px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
        style={{ backgroundColor: LITT.accentCyan, color: "#000" }}
      >
        Generate code with LiTT
      </button>
    </div>
  );
}
