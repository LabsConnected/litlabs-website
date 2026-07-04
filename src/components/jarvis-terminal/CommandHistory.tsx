"use client";

import { History, Terminal } from "lucide-react";

interface CommandHistoryProps {
  commands: string[];
}

export function CommandHistory({ commands }: CommandHistoryProps) {
  return (
    <div className="flex h-full min-h-[200px] flex-col rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-orange-400" />
        <h2 className="font-bold">Command History</h2>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto text-xs text-neutral-400">
        {commands.length === 0 && (
          <div className="text-neutral-600">No commands yet.</div>
        )}
        {commands.map((cmd, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded bg-black p-2 font-mono"
          >
            <div className="flex items-center gap-2">
              <Terminal className="h-3 w-3 text-orange-500" />
              <span className="truncate">{cmd}</span>
            </div>
            <span className="text-neutral-600">now</span>
          </div>
        ))}
      </div>
    </div>
  );
}
