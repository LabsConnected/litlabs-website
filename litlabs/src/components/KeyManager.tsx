"use client";

import { useMemo, useState } from "react";
import { Copy, Eye, EyeOff, Plus, ShieldCheck, TestTube2, Trash2 } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

type ProviderKey = {
  provider: "OpenAI" | "Anthropic" | "Google" | "OpenRouter" | "Local";
  label: string;
  keyHint: string;
  defaultSelected?: boolean;
  status: "active" | "missing" | "testing";
};

const INITIAL_KEYS: ProviderKey[] = [
  { provider: "Google", label: "Gemini", keyHint: "••••••••••••••", defaultSelected: true, status: "active" },
  { provider: "OpenAI", label: "GPT-4o", keyHint: "••••••••••••••", status: "active" },
  { provider: "Anthropic", label: "Claude", keyHint: "not configured", status: "missing" },
  { provider: "OpenRouter", label: "Fallback", keyHint: "••••••••••••••", status: "testing" },
];

export default function KeyManager() {
  const { resolvedColors: T } = useTheme();
  const [keys, setKeys] = useState(INITIAL_KEYS);
  const [reveal, setReveal] = useState(false);
  const [newProvider, setNewProvider] = useState("OpenAI");
  const [newLabel, setNewLabel] = useState("");
  const [newSecret, setNewSecret] = useState("");

  const activeCount = useMemo(() => keys.filter((k) => k.status === "active").length, [keys]);

  const addKey = () => {
    if (!newProvider.trim() || !newSecret.trim()) return;
    setKeys((prev) => [
      {
        provider: newProvider as ProviderKey["provider"],
        label: newLabel || newProvider,
        keyHint: reveal ? newSecret : "••••••••••••••",
        status: "active",
      },
      ...prev,
    ]);
    setNewLabel("");
    setNewSecret("");
  };

  return (
    <section
      className="rounded-3xl border p-4"
      style={{
        backgroundColor: T.boxBg + "86",
        borderColor: T.borderColor + "24",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.18em]" style={{ color: T.headerColor }}>
            Key Manager
          </div>
          <div className="text-[11px] mt-1" style={{ color: T.textMuted }}>
            Manage provider keys and defaults from one place.
          </div>
        </div>
        <div className="rounded-full border px-3 py-1 text-[10px] font-black uppercase" style={{ borderColor: T.borderColor + "30", color: T.accentColor }}>
          {activeCount} active
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {keys.map((entry) => (
          <div
            key={`${entry.provider}-${entry.label}`}
            className="flex items-center justify-between gap-3 rounded-2xl border px-3 py-3"
            style={{ borderColor: T.borderColor + "20", backgroundColor: T.bgColor + "45" }}
          >
            <div>
              <div className="text-sm font-bold">{entry.label}</div>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: T.textMuted }}>
                {entry.provider}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2 py-1 text-[10px] font-black uppercase"
                style={{
                  backgroundColor:
                    entry.status === "active" ? "#34d39918" : entry.status === "testing" ? "#f59e0b18" : "#ef444418",
                  color: entry.status === "active" ? "#34d399" : entry.status === "testing" ? "#f59e0b" : "#ef4444",
                }}
              >
                {entry.status}
              </span>
              {entry.defaultSelected && <ShieldCheck size={14} style={{ color: T.accentColor }} />}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={newProvider}
            onChange={(e) => setNewProvider(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm outline-none"
            style={{ backgroundColor: T.bgColor + "60", borderColor: T.borderColor + "24", color: T.textColor }}
          >
            <option>OpenAI</option>
            <option>Anthropic</option>
            <option>Google</option>
            <option>OpenRouter</option>
            <option>Local</option>
          </select>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label"
            className="rounded-xl border px-3 py-2 text-sm outline-none"
            style={{ backgroundColor: T.bgColor + "60", borderColor: T.borderColor + "24", color: T.textColor }}
          />
        </div>
        <div className="flex gap-2">
          <input
            value={newSecret}
            onChange={(e) => setNewSecret(e.target.value)}
            type={reveal ? "text" : "password"}
            placeholder="API key"
            className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none"
            style={{ backgroundColor: T.bgColor + "60", borderColor: T.borderColor + "24", color: T.textColor }}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="rounded-xl border px-3 py-2"
            style={{ borderColor: T.borderColor + "24", color: T.textMuted }}
          >
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            onClick={addKey}
            className="rounded-xl px-3 py-2 font-bold text-white"
            style={{ backgroundColor: T.accentColor }}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: T.borderColor + "24", color: T.textColor }}>
          <TestTube2 size={13} className="inline mr-1" />
          Test
        </button>
        <button className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: T.borderColor + "24", color: T.textColor }}>
          <Copy size={13} className="inline mr-1" />
          Copy
        </button>
        <button className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: T.borderColor + "24", color: "#ef4444" }}>
          <Trash2 size={13} className="inline mr-1" />
          Reset
        </button>
      </div>
    </section>
  );
}
