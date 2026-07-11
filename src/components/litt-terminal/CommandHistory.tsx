"use client";

import { useEffect, useState } from "react";
import { History, Terminal, RefreshCw } from "lucide-react";

interface HistoryItem {
  id: string;
  command: string;
  exit_code: number | null;
  created_at: string;
}

interface CommandHistoryProps {
  commands?: string[];
}

export function CommandHistory({ commands: liveCommands = [] }: CommandHistoryProps) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = () => {
    let active = true;
    setLoading(true);
    fetch("/api/terminal/history?limit=50")
      .then((res) => res.json())
      .then((data) => {
        if (active && Array.isArray(data.commands)) {
          setHistory(data.commands);
        }
      })
      .catch((err) => {
        console.error("Failed to load command history", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  };

  useEffect(() => {
    const cancel = fetchHistory();
    return cancel;
  }, []);

  useEffect(() => {
    if (liveCommands.length > 0) {
      const latest = liveCommands[liveCommands.length - 1];
      setHistory((prev) => {
        const item: HistoryItem = {
          id: `live-${Date.now()}`,
          command: latest,
          exit_code: null,
          created_at: new Date().toISOString(),
        };
        return [item, ...prev].slice(0, 50);
      });
    }
  }, [liveCommands]);

  const formatTime = (date: string) => {
    try {
      return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className="flex h-full min-h-[200px] flex-col rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-orange-400" />
          <h2 className="font-bold">Command History</h2>
        </div>
        <button
          onClick={fetchHistory}
          disabled={loading}
          className="text-neutral-500 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto text-xs text-neutral-400">
        {history.length === 0 && (
          <div className="text-neutral-600">No commands yet.</div>
        )}
        {history.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded bg-black p-2 font-mono"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Terminal className="h-3 w-3 shrink-0 text-orange-500" />
              <span className="truncate">{item.command}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {item.exit_code !== null && (
                <span className={`${item.exit_code === 0 ? "text-green-400" : "text-red-400"}`}>
                  {item.exit_code}
                </span>
              )}
              <span className="text-neutral-600">{formatTime(item.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
