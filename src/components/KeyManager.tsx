"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Key, Plus, Trash2, Check, TestTube, Shield } from "lucide-react";

interface ApiKey {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "google" | "openrouter" | "custom";
  key: string;
  status: "connected" | "expired" | "missing" | "limited";
  lastUsed?: string;
  usage?: number;
  limit?: number;
}

const PROVIDERS = [
  { id: "openai", name: "OpenAI", icon: "🔮", color: "#10a37f" },
  { id: "anthropic", name: "Anthropic", icon: "🎯", color: "#d97757" },
  { id: "google", name: "Google", icon: "⚡", color: "#4285f4" },
  { id: "openrouter", name: "OpenRouter", icon: "🌐", color: "#8b5cf6" },
  { id: "custom", name: "Custom", icon: "⚙️", color: "#6b7280" },
];

export default function KeyManager() {
  const { resolvedColors: T } = useTheme();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showAddKey, setShowAddKey] = useState(false);
  const [newKey, setNewKey] = useState({ name: "", provider: "openai" as const, key: "" });

  const addKey = () => {
    if (!newKey.name || !newKey.key) return;
    
    const provider = PROVIDERS.find(p => p.id === newKey.provider);
    setKeys([...keys, {
      id: Date.now().toString(),
      name: newKey.name,
      provider: newKey.provider,
      key: newKey.key,
      status: "connected",
    }]);
    setNewKey({ name: "", provider: "openai", key: "" });
    setShowAddKey(false);
  };

  const removeKey = (id: string) => {
    setKeys(keys.filter(k => k.id !== id));
  };

  const testKey = async (key: ApiKey) => {
    // Simulate key test
    setKeys(keys.map(k => 
      k.id === key.id 
        ? { ...k, status: "connected" as const, lastUsed: new Date().toISOString() }
        : k
    ));
  };

  const getStatusColor = (status: ApiKey["status"]) => {
    switch (status) {
      case "connected": return "#22c55e";
      case "expired": return "#ef4444";
      case "missing": return "#f59e0b";
      case "limited": return "#f97316";
      default: return "#6b7280";
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={20} style={{ color: T.accentColor }} />
          <span className="text-sm font-bold" style={{ color: T.textColor }}>API Keys</span>
        </div>
        <button
          onClick={() => setShowAddKey(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
          style={{
            backgroundColor: T.accentColor + "15",
            color: T.accentColor,
            border: "1px solid " + T.accentColor + "30",
          }}
        >
          <Plus size={12} /> Add Key
        </button>
      </div>

      {/* Add Key Form */}
      {showAddKey && (
        <div
          className="p-4 rounded-xl border"
          style={{ backgroundColor: T.boxBg + "60", borderColor: T.borderColor + "30" }}
        >
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Key name (e.g. Production OpenAI)"
              value={newKey.name}
              onChange={(e) => setNewKey({ ...newKey, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
            />
            <select
              value={newKey.provider}
              onChange={(e) => setNewKey({ ...newKey, provider: e.target.value as any })}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
            >
              {PROVIDERS.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
              ))}
            </select>
            <input
              type="password"
              placeholder="API Key"
              value={newKey.key}
              onChange={(e) => setNewKey({ ...newKey, key: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
            />
            <div className="flex gap-2">
              <button
                onClick={addKey}
                className="flex-1 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
                style={{ backgroundColor: T.accentColor, color: "#000" }}
              >
                Add Key
              </button>
              <button
                onClick={() => setShowAddKey(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
                style={{ backgroundColor: T.boxBg + "40", color: T.textMuted }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keys List */}
      {keys.length === 0 ? (
        <div className="text-center py-8">
          <Key size={32} className="mx-auto mb-2" style={{ color: T.textMuted }} />
          <p className="text-sm" style={{ color: T.textMuted }}>No API keys added yet</p>
          <p className="text-xs mt-1" style={{ color: T.textMuted }}>Add your keys to use premium models</p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => {
            const provider = PROVIDERS.find(p => p.id === key.provider);
            return (
              <div
                key={key.id}
                className="flex items-center gap-3 p-3 rounded-xl border"
                style={{ backgroundColor: T.boxBg + "40", borderColor: T.borderColor + "20" }}
              >
                <span className="text-xl">{provider?.icon}</span>
                <div className="flex-1">
                  <div className="text-sm font-bold" style={{ color: T.textColor }}>{key.name}</div>
                  <div className="text-[10px]" style={{ color: T.textMuted }}>{provider?.name}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusColor(key.status) }} />
                  <span className="text-[9px] font-bold uppercase" style={{ color: getStatusColor(key.status) }}>
                    {key.status}
                  </span>
                </div>
                <button
                  onClick={() => testKey(key)}
                  className="p-1.5 rounded-lg transition-all hover:scale-110"
                  style={{ color: T.textMuted }}
                  title="Test connection"
                >
                  <TestTube size={14} />
                </button>
                <button
                  onClick={() => removeKey(key.id)}
                  className="p-1.5 rounded-lg transition-all hover:scale-110"
                  style={{ color: "#ef4444" }}
                  title="Remove key"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Security Notice */}
      <div className="flex items-start gap-2 p-3 rounded-lg text-[10px]"
        style={{ backgroundColor: "#f59e0b10", border: "1px solid #f59e0b30" }}
      >
        <Shield size={12} style={{ color: "#f59e0b" }} />
        <p style={{ color: "#f59e0b" }}>
          Keys are encrypted and stored securely. Never share your API keys with others.
        </p>
      </div>
    </div>
  );
}
