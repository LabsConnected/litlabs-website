"use client";

import { ScrollText, Trash2 } from "lucide-react";

interface LogsPanelProps {
  logs: string[];
}

export function LogsPanel({ logs }: LogsPanelProps) {
  return (
    <div className="flex h-full min-h-[200px] flex-col rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-orange-400" />
          <h2 className="font-bold">Logs</h2>
        </div>
        <button className="text-neutral-500 hover:text-white">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto text-xs text-neutral-400">
        {logs.map((log, i) => (
          <div key={i} className="rounded bg-black p-2 font-mono">
            {log}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-neutral-600">No logs yet.</div>
        )}
      </div>
    </div>
  );
}
