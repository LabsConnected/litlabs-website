"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { History, Sparkles, Copy, Trash2, Save, Wand2 } from "lucide-react";

interface PromptHistory {
  id: string;
  prompt: string;
  timestamp: Date;
  tags?: string[];
}

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onGenerate?: (prompt: string) => void;
  onSave?: (prompt: string) => void;
  placeholder?: string;
}

export default function PromptComposer({ 
  value, 
  onChange, 
  onGenerate, 
  onSave,
  placeholder = "Describe what you want to create..."
}: PromptComposerProps) {
  const { resolvedColors: T } = useTheme();
  const [history, setHistory] = useState<PromptHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("promptHistory");
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("promptHistory", JSON.stringify(history));
  }, [history]);

  const addToHistory = (prompt: string) => {
    if (!prompt.trim()) return;
    const newEntry: PromptHistory = {
      id: Date.now().toString(),
      prompt,
      timestamp: new Date(),
    };
    setHistory([newEntry, ...history].slice(0, 20));
  };

  const handleGenerate = () => {
    if (!value.trim()) return;
    addToHistory(value);
    onGenerate?.(value);
  };

  const handleEnhance = async () => {
    if (!value.trim()) return;
    setIsEnhancing(true);
    setTimeout(() => {
      const enhanced = `Create a ${value} with high detail, professional quality, and cinematic lighting. Use vibrant colors and smooth gradients. Ensure the composition is balanced and visually appealing.`;
      onChange(enhanced);
      setIsEnhancing(false);
    }, 1500);
  };

  const loadFromHistory = (entry: PromptHistory) => {
    onChange(entry.prompt);
    setShowHistory(false);
  };

  const deleteFromHistory = (id: string) => {
    setHistory(history.filter(h => h.id !== id));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
          style={{
            backgroundColor: T.bgColor + "40",
            border: "1px solid " + T.borderColor + "30",
            color: T.textColor,
            minHeight: "120px",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleGenerate();
            }
          }}
        />
        
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
              style={{
                backgroundColor: showHistory ? T.accentColor + "15" : T.boxBg + "40",
                color: showHistory ? T.accentColor : T.textMuted,
                border: showHistory ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30",
              }}
            >
              <History size={12} />
              History ({history.length})
            </button>
            <button
              onClick={handleEnhance}
              disabled={isEnhancing || !value.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 disabled:opacity-50"
              style={{
                backgroundColor: T.accentColor + "15",
                color: T.accentColor,
                border: "1px solid " + T.accentColor + "30",
              }}
            >
              <Wand2 size={12} className={isEnhancing ? "animate-spin" : ""} />
              {isEnhancing ? "Enhancing..." : "Enhance"}
            </button>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => copyToClipboard(value)}
              className="p-1.5 rounded-lg transition-all hover:scale-110"
              style={{ color: T.textMuted }}
              title="Copy"
            >
              <Copy size={12} />
            </button>
            <button
              onClick={() => onSave?.(value)}
              className="p-1.5 rounded-lg transition-all hover:scale-110"
              style={{ color: T.textMuted }}
              title="Save"
            >
              <Save size={12} />
            </button>
            <button
              onClick={handleGenerate}
              disabled={!value.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 disabled:opacity-50"
              style={{
                backgroundColor: T.accentColor,
                color: "#000",
              }}
            >
              <Sparkles size={12} />
              Generate
            </button>
          </div>
        </div>
      </div>

      {showHistory && (
        <div
          className="rounded-xl border p-3"
          style={{ backgroundColor: T.boxBg + "60", borderColor: T.borderColor + "30" }}
        >
          <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
            Recent Prompts
          </div>
          {history.length === 0 ? (
            <div className="text-center py-4">
              <History size={20} className="mx-auto mb-2" style={{ color: T.textMuted }} />
              <p className="text-xs" style={{ color: T.textMuted }}>No history yet</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 p-2 rounded-lg"
                  style={{ backgroundColor: T.bgColor + "30" }}
                >
                  <button
                    onClick={() => loadFromHistory(entry)}
                    className="flex-1 text-left text-xs hover:opacity-70"
                    style={{ color: T.textColor }}
                  >
                    {entry.prompt}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => copyToClipboard(entry.prompt)}
                      className="p-1 rounded transition-all hover:scale-110"
                      style={{ color: T.textMuted }}
                    >
                      <Copy size={10} />
                    </button>
                    <button
                      onClick={() => deleteFromHistory(entry.id)}
                      className="p-1 rounded transition-all hover:scale-110"
                      style={{ color: "#ef4444" }}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="text-[9px]" style={{ color: T.textMuted }}>
        Tip: Press Ctrl+Enter to generate quickly
      </div>
    </div>
  );
}
