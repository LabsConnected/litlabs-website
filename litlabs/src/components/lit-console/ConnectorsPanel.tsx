"use client";

import { useState } from "react";
import { useLitConsoleTheme } from "./useLitConsoleTheme";
import {
  DEFAULT_CONNECTORS,
  CONNECTOR_CATEGORIES,
  getConnectorsByCategory,
  type Connector,
} from "@/lib/connectors";
import { Check, Plug, X } from "lucide-react";

export default function ConnectorsPanel({ onClose }: { onClose?: () => void }) {
  const LC = useLitConsoleTheme();
  const [connectors, setConnectors] = useState<Connector[]>(DEFAULT_CONNECTORS);
  const grouped = getConnectorsByCategory(connectors);

  const toggle = (id: string) => {
    setConnectors((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)),
    );
  };

  const enabledCount = connectors.filter((c) => c.enabled).length;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4" style={{ color: LC.text }}>
      <div className="rounded-xl border p-4" style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}>
        <div className="flex items-center gap-2 mb-2">
          <Plug size={16} style={{ color: LC.accentCyan }} />
          <span className="text-xs font-black" style={{ color: LC.text }}>Connectors</span>
          <span
            className="ml-auto rounded-full px-2.5 py-1 text-[10px] font-bold"
            style={{ backgroundColor: LC.accentCyan + "20", color: LC.accentCyan }}
          >
            {enabledCount} active
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-md p-1.5 transition-colors hover:bg-white/10"
              style={{ color: LC.textMuted }}
              title="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: LC.textMuted }}>
          Enable services so LiTTree can read, write, and deploy on your behalf.
        </p>
      </div>

      {(Object.keys(grouped) as Array<keyof typeof grouped>).map((category) => (
        <div key={category}>
          <div className="mb-2 text-[10px] font-black uppercase tracking-widest" style={{ color: LC.textMuted }}>
            {CONNECTOR_CATEGORIES[category]}
          </div>
          <div className="space-y-2">
            {grouped[category].map((c) => (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all hover:scale-[1.01]"
                style={{
                  backgroundColor: c.enabled ? `${c.color}10` : LC.bgPanel,
                  borderColor: c.enabled ? `${c.color}40` : LC.border,
                }}
              >
                <span className="text-base leading-none pt-0.5">{c.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold" style={{ color: LC.text }}>{c.name}</span>
                    {c.enabled && <Check size={12} style={{ color: c.color }} />}
                  </div>
                  <div className="text-[10px] leading-snug" style={{ color: LC.textMuted }}>
                    {c.description}
                  </div>
                  {c.envKey && (
                    <div className="mt-1 text-[9px] font-mono" style={{ color: LC.textDim }}>
                      {c.envKey}
                    </div>
                  )}
                </div>
                <div
                  className="mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors"
                  style={{ backgroundColor: c.enabled ? c.color : LC.borderSubtle }}
                >
                  <div
                    className="h-3 w-3 rounded-full transition-transform"
                    style={{
                      backgroundColor: "#fff",
                      transform: c.enabled ? "translateX(12px)" : "translateX(0)",
                    }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
