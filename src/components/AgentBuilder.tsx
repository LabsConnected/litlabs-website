"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Plus,
  Save,
  X,
  Wand2,
  Brain,
  Sparkles,
  Tag,
  Code,
  Image,
  BarChart3,
  Music,
  Pencil,
  TrendingUp,
  Globe,
  Zap,
  Target,
  Shield,
} from "lucide-react";

interface CustomAgent {
  id: string;
  name: string;
  slug: string;
  role: string;
  description: string;
  systemPrompt: string;
  color: string;
  icon: string;
  tags: string[];
  model: string;
  temperature: number;
  status: "active" | "draft";
}

const AGENT_ICONS = [
  { id: "brain", icon: Brain, label: "Brain" },
  { id: "sparkles", icon: Sparkles, label: "Sparkles" },
  { id: "code", icon: Code, label: "Code" },
  { id: "image", icon: Image, label: "Image" },
  { id: "chart", icon: BarChart3, label: "Analytics" },
  { id: "music", icon: Music, label: "Music" },
  { id: "pencil", icon: Pencil, label: "Writing" },
  { id: "trending", icon: TrendingUp, label: "Growth" },
  { id: "globe", icon: Globe, label: "Web" },
  { id: "zap", icon: Zap, label: "Speed" },
  { id: "target", icon: Target, label: "Target" },
  { id: "shield", icon: Shield, label: "Security" },
];

const PRESET_COLORS = [
  "#00ffff",
  "#22d3ee",
  "#f472b6",
  "#e879f9",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#60a5fa",
  "#fb923c",
];

const MODELS = [
  { id: "adaptive", name: "Adaptive" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
];

interface AgentBuilderProps {
  onAgentCreated?: (agent: CustomAgent) => void;
  onClose?: () => void;
}

export default function AgentBuilder({
  onAgentCreated,
  onClose,
}: AgentBuilderProps) {
  const { resolvedColors: T } = useTheme();
  const [step, setStep] = useState(1);
  const [agent, setAgent] = useState<Partial<CustomAgent>>({
    name: "",
    slug: "",
    role: "",
    description: "",
    systemPrompt: "",
    color: PRESET_COLORS[0],
    icon: "brain",
    tags: [],
    model: "adaptive",
    temperature: 0.7,
    status: "draft",
  });
  const [tagInput, setTagInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [saved, setSaved] = useState(false);

  const generateFromRole = async () => {
    if (!agent.role) return;
    setIsGenerating(true);
    setTimeout(() => {
      const role = agent.role || "assistant";
      setAgent((prev) => ({
        ...prev,
        name: prev.name || `${role} Agent`,
        description:
          prev.description ||
          `A specialized AI agent focused on ${role.toLowerCase()}.`,
        systemPrompt:
          prev.systemPrompt ||
          `You are an expert ${role.toLowerCase()}. You are helpful, precise, and focused on delivering high-quality results.`,
      }));
      setIsGenerating(false);
      setStep(2);
    }, 1500);
  };

  const addTag = () => {
    if (!tagInput.trim()) return;
    setAgent((prev) => ({
      ...prev,
      tags: [...(prev.tags || []), tagInput.trim()],
    }));
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setAgent((prev) => ({
      ...prev,
      tags: (prev.tags || []).filter((t) => t !== tag),
    }));
  };

  const saveAgent = () => {
    if (!agent.name || !agent.role || !agent.systemPrompt) return;
    const newAgent: CustomAgent = {
      id: Date.now().toString(),
      name: agent.name,
      slug: agent.slug || agent.name.toLowerCase().replace(/\s+/g, "-"),
      role: agent.role,
      description: agent.description || "",
      systemPrompt: agent.systemPrompt,
      color: agent.color || PRESET_COLORS[0],
      icon: agent.icon || "brain",
      tags: agent.tags || [],
      model: agent.model || "adaptive",
      temperature: agent.temperature || 0.7,
      status: "active",
    };
    onAgentCreated?.(newAgent);
    setSaved(true);
    setTimeout(() => {
      onClose?.();
    }, 1000);
  };

  const SelectedIcon =
    AGENT_ICONS.find((i) => i.id === agent.icon)?.icon || Brain;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plus size={20} style={{ color: T.accentColor }} />
          <span className="text-lg font-black" style={{ color: T.textColor }}>
            Agent Builder
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg transition-all hover:scale-110"
          style={{ color: T.textMuted }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <button
            key={s}
            onClick={() => setStep(s)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              backgroundColor:
                step === s ? T.accentColor + "15" : T.boxBg + "40",
              color: step === s ? T.accentColor : T.textMuted,
              border:
                step === s
                  ? "1px solid " + T.accentColor + "30"
                  : "transparent",
            }}
          >
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
              style={{
                backgroundColor:
                  step === s ? T.accentColor : T.borderColor + "30",
                color: step === s ? T.bgColor : T.textMuted,
              }}
            >
              {s}
            </div>
            {s === 1 ? "Basics" : s === 2 ? "Persona" : "Style"}
          </button>
        ))}
      </div>

      {/* Step 1: Basics */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <label
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Role / Specialty
            </label>
            <input
              value={agent.role || ""}
              onChange={(e) => setAgent({ ...agent, role: e.target.value })}
              placeholder="e.g. Code Reviewer, Creative Writer, Data Analyst"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                backgroundColor: T.bgColor + "40",
                border: "1px solid " + T.borderColor + "30",
                color: T.textColor,
              }}
            />
          </div>
          <div className="space-y-1">
            <label
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Agent Name
            </label>
            <input
              value={agent.name || ""}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  name: e.target.value,
                  slug: e.target.value.toLowerCase().replace(/\s+/g, "-"),
                })
              }
              placeholder="Name your agent"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                backgroundColor: T.bgColor + "40",
                border: "1px solid " + T.borderColor + "30",
                color: T.textColor,
              }}
            />
          </div>
          <div className="space-y-1">
            <label
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Short Description
            </label>
            <textarea
              value={agent.description || ""}
              onChange={(e) =>
                setAgent({ ...agent, description: e.target.value })
              }
              placeholder="What does this agent do?"
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
              style={{
                backgroundColor: T.bgColor + "40",
                border: "1px solid " + T.borderColor + "30",
                color: T.textColor,
              }}
            />
          </div>
          <button
            onClick={generateFromRole}
            disabled={!agent.role || isGenerating}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
            style={{
              backgroundColor: T.accentColor + "15",
              color: T.accentColor,
              border: "1px solid " + T.accentColor + "30",
            }}
          >
            <Wand2 size={14} className={isGenerating ? "animate-spin" : ""} />
            {isGenerating ? "Generating..." : "Auto-Generate from Role"}
          </button>
          <button
            onClick={() => setStep(2)}
            disabled={!agent.name || !agent.role}
            className="w-full py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 2: Persona */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <label
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              System Prompt
            </label>
            <textarea
              value={agent.systemPrompt || ""}
              onChange={(e) =>
                setAgent({ ...agent, systemPrompt: e.target.value })
              }
              placeholder="Define the agent's personality, rules, and expertise..."
              rows={6}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none font-mono"
              style={{
                backgroundColor: T.bgColor + "40",
                border: "1px solid " + T.borderColor + "30",
                color: T.textColor,
              }}
            />
          </div>
          <div className="space-y-1">
            <label
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Tags
            </label>
            <div className="flex items-center gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                placeholder="Add a tag and press Enter"
                className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  backgroundColor: T.bgColor + "40",
                  border: "1px solid " + T.borderColor + "30",
                  color: T.textColor,
                }}
              />
              <button
                onClick={addTag}
                className="p-2 rounded-lg"
                style={{
                  backgroundColor: T.accentColor + "15",
                  color: T.accentColor,
                }}
              >
                <Tag size={14} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {(agent.tags || []).map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                  style={{
                    backgroundColor: T.accentColor + "15",
                    color: T.accentColor,
                  }}
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="hover:scale-110"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-2 rounded-lg text-sm font-bold transition-all"
              style={{ backgroundColor: T.boxBg + "40", color: T.textMuted }}
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!agent.systemPrompt}
              className="flex-1 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Style */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Icon */}
          <div className="space-y-2">
            <label
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Icon
            </label>
            <div className="grid grid-cols-6 gap-2">
              {AGENT_ICONS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setAgent({ ...agent, icon: id })}
                  className="p-2 rounded-lg transition-all hover:scale-110"
                  style={{
                    backgroundColor:
                      agent.icon === id ? T.accentColor + "15" : T.boxBg + "40",
                    border:
                      agent.icon === id
                        ? "1px solid " + T.accentColor + "30"
                        : "1px solid " + T.borderColor + "30",
                    color: agent.icon === id ? T.accentColor : T.textMuted,
                  }}
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div className="space-y-2">
            <label
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Accent Color
            </label>
            <div className="grid grid-cols-5 gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setAgent({ ...agent, color })}
                  className="w-full aspect-square rounded-lg transition-all hover:scale-110"
                  style={{
                    backgroundColor: color,
                    border:
                      agent.color === color
                        ? "2px solid " + T.textColor
                        : "2px solid transparent",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Model */}
          <div className="space-y-1">
            <label
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Default Model
            </label>
            <select
              value={agent.model}
              onChange={(e) => setAgent({ ...agent, model: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                backgroundColor: T.bgColor + "40",
                border: "1px solid " + T.borderColor + "30",
                color: T.textColor,
              }}
            >
              {MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          {/* Preview */}
          <div
            className="p-4 rounded-xl border"
            style={{
              backgroundColor: T.boxBg + "40",
              borderColor: T.borderColor + "30",
            }}
          >
            <div
              className="text-[10px] font-bold uppercase tracking-wider mb-2"
              style={{ color: T.textMuted }}
            >
              Preview
            </div>
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{
                  backgroundColor: (agent.color || PRESET_COLORS[0]) + "15",
                  border:
                    "1px solid " + (agent.color || PRESET_COLORS[0]) + "30",
                }}
              >
                <SelectedIcon
                  size={22}
                  style={{ color: agent.color || PRESET_COLORS[0] }}
                />
              </div>
              <div>
                <div className="font-bold" style={{ color: T.textColor }}>
                  {agent.name || "Agent Name"}
                </div>
                <div
                  className="text-[10px]"
                  style={{ color: agent.color || PRESET_COLORS[0] }}
                >
                  {agent.role || "Role"}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-2 rounded-lg text-sm font-bold transition-all"
              style={{ backgroundColor: T.boxBg + "40", color: T.textMuted }}
            >
              Back
            </button>
            <button
              onClick={saveAgent}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              {saved ? <Sparkles size={14} /> : <Save size={14} />}
              {saved ? "Saved!" : "Create Agent"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
