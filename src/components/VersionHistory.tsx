"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { History, RotateCcw, Clock, Save, Trash2 } from "lucide-react";

interface Version {
  id: string;
  name: string;
  description?: string;
  timestamp: Date;
  data: Record<string, unknown>;
  thumbnail?: string;
}

interface VersionHistoryProps {
  currentData: Record<string, unknown>;
  onRestore?: (version: Version) => void;
  onSave?: (name: string, description: string) => void;
}

export default function VersionHistory({ currentData, onRestore, onSave }: VersionHistoryProps) {
  const { resolvedColors: T } = useTheme();
  const [versions, setVersions] = useState<Version[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("versionHistory");
      if (saved) {
        setVersions(JSON.parse(saved));
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("versionHistory", JSON.stringify(versions));
  }, [versions]);

  const saveVersion = () => {
    if (!saveName.trim()) return;
    const newVersion: Version = {
      id: Date.now().toString(),
      name: saveName,
      description: saveDescription,
      timestamp: new Date(),
      data: currentData,
    };
    setVersions([newVersion, ...versions].slice(0, 20));
    setSaveName("");
    setSaveDescription("");
    onSave?.(saveName, saveDescription);
  };

  const restoreVersion = (version: Version) => {
    onRestore?.(version);
  };

  const deleteVersion = (id: string) => {
    setVersions(versions.filter(v => v.id !== id));
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000 / 60);
    if (diff < 1) return "Just now";
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ago`;
  };

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-xl border"
        style={{ backgroundColor: T.boxBg + "40", borderColor: T.borderColor + "30" }}>
        <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
          Save Version
        </div>
        <input
          type="text"
          placeholder="Version name (e.g. Hero Banner v2)"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none mb-2"
          style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
        />
        <textarea
          placeholder="Description (optional)"
          value={saveDescription}
          onChange={(e) => setSaveDescription(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none mb-2 resize-none"
          style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
          rows={2}
        />
        <button
          onClick={saveVersion}
          disabled={!saveName.trim()}
          className="w-full py-2 rounded-lg text-xs font-bold transition-all hover:scale-105 disabled:opacity-50"
          style={{ backgroundColor: T.accentColor, color: "#000" }}
        >
          <Save size={12} className="inline mr-1" />
          Save Version
        </button>
      </div>

      <div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
          style={{
            backgroundColor: showHistory ? T.accentColor + "15" : T.boxBg + "40",
            color: showHistory ? T.accentColor : T.textMuted,
            border: showHistory ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30",
          }}
        >
          <History size={12} />
          Version History ({versions.length})
        </button>

        {showHistory && (
          <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
            {versions.length === 0 ? (
              <div className="text-center py-4">
                <History size={20} className="mx-auto mb-2" style={{ color: T.textMuted }} />
                <p className="text-xs" style={{ color: T.textMuted }}>No versions saved yet</p>
              </div>
            ) : (
              versions.map((version) => (
                <div
                  key={version.id}
                  className="p-3 rounded-lg border"
                  style={{ backgroundColor: T.boxBg + "30", borderColor: T.borderColor + "20" }}
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1">
                      <div className="text-xs font-bold" style={{ color: T.textColor }}>
                        {version.name}
                      </div>
                      {version.description && (
                        <div className="text-[10px]" style={{ color: T.textMuted }}>
                          {version.description}
                        </div>
                      )}
                      <div className="flex items-center gap-1 mt-1 text-[9px]" style={{ color: T.textMuted }}>
                        <Clock size={8} />
                        {formatTime(version.timestamp)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => restoreVersion(version)}
                        className="p-1.5 rounded transition-all hover:scale-110"
                        style={{ color: T.accentColor }}
                        title="Restore"
                      >
                        <RotateCcw size={12} />
                      </button>
                      <button
                        onClick={() => deleteVersion(version.id)}
                        className="p-1.5 rounded transition-all hover:scale-110"
                        style={{ color: "#ef4444" }}
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
