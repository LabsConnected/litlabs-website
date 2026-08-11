"use client";

/**
 * LiTT Copilot Panel — the AI assistant surface inside the Canvas.
 *
 * When LiTT is selected (right panel tab), it automatically knows:
 *   - whole Canvas document
 *   - selected component
 *   - parent/children
 *   - current breakpoint
 *   - project
 *   - current route/page
 *   - styles/theme
 *   - existing assets
 *   - conversation
 *   - existing components
 *   - undo history
 *
 * It shows:
 *   1. Context summary (what LiTT sees)
 *   2. Contextual agent buttons (change based on selection)
 *   3. Chat input ("Ask LiTT...")
 *   4. Conversation history
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles,
  Send,
  Wand2,
  Smartphone,
  RefreshCw,
  Plus,
  Copy,
  Trash2,
  Image as ImageIcon,
  Type,
  Layout,
  Palette,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useCanvasBuilderStore } from "./store";
import type { CanvasNode } from "./types";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ─── Contextual agent buttons per node type ──────────────────────

interface AgentButton {
  label: string;
  icon: typeof Wand2;
  prompt: string;
}

function getAgentButtonsForNode(node: CanvasNode | null): AgentButton[] {
  if (!node) {
    // Nothing selected — page-level actions
    return [
      { label: "Build Page", icon: Sparkles, prompt: "Build a complete page based on what this project needs" },
      { label: "Add Section", icon: Plus, prompt: "Add a new section that fits the current page" },
      { label: "Improve Design", icon: Palette, prompt: "Improve the overall design of this page — make it more polished and professional" },
      { label: "Finish Page", icon: Check, prompt: "Finish this page — add any missing sections like footer, CTA, or navigation" },
      { label: "Audit Page", icon: AlertCircle, prompt: "Audit this page for design issues, accessibility, and mobile responsiveness" },
    ];
  }

  switch (node.type) {
    case "heading":
      return [
        { label: "Rewrite", icon: Type, prompt: `Rewrite this heading to be more compelling: "${node.props?.text ?? ""}"` },
        { label: "Shorten", icon: Type, prompt: `Shorten this heading while keeping the message: "${node.props?.text ?? ""}"` },
        { label: "Make Catchier", icon: Wand2, prompt: `Make this heading catchier and more attention-grabbing: "${node.props?.text ?? ""}"` },
        { label: "Generate Variations", icon: Copy, prompt: `Generate 3 variations of this heading: "${node.props?.text ?? ""}"` },
      ];

    case "text":
      return [
        { label: "Rewrite", icon: Type, prompt: `Rewrite this text to be clearer and more engaging: "${node.props?.text ?? ""}"` },
        { label: "Shorten", icon: Type, prompt: `Shorten this text: "${node.props?.text ?? ""}"` },
        { label: "Expand", icon: Plus, prompt: `Expand this text with more detail: "${node.props?.text ?? ""}"` },
      ];

    case "image":
      return [
        { label: "Generate", icon: ImageIcon, prompt: "Generate a new AI image for this image element" },
        { label: "Replace", icon: RefreshCw, prompt: "Replace this image with a better alternative" },
        { label: "Remove Background", icon: Wand2, prompt: "Remove the background from this image" },
        { label: "Match Brand", icon: Palette, prompt: "Adjust this image to match the brand theme" },
      ];

    case "button":
      return [
        { label: "Rewrite", icon: Type, prompt: `Rewrite this button text to be more action-oriented: "${node.props?.text ?? ""}"` },
        { label: "Redesign", icon: Palette, prompt: "Redesign this button to look more premium" },
      ];

    case "section":
    case "container":
    case "card":
    case "columns":
    case "navbar":
    case "footer":
      return [
        { label: "Redesign", icon: Palette, prompt: `Redesign this ${node.type} to look more premium` },
        { label: "Add Content", icon: Plus, prompt: `Add relevant content inside this ${node.type}` },
        { label: "Duplicate", icon: Copy, prompt: `Duplicate this ${node.type}` },
        { label: "Change Layout", icon: Layout, prompt: `Change the layout of this ${node.type}` },
        { label: "Make Responsive", icon: Smartphone, prompt: "Fix this section for mobile and tablet views" },
      ];

    case "form":
      return [
        { label: "Add Field", icon: Plus, prompt: "Add a relevant form field" },
        { label: "Redesign", icon: Palette, prompt: "Redesign this form to look more modern" },
      ];

    case "table":
      return [
        { label: "Add Row", icon: Plus, prompt: "Add a new row to this table" },
        { label: "Redesign", icon: Palette, prompt: "Redesign this table to look more polished" },
      ];

    default:
      return [
        { label: "Redesign", icon: Palette, prompt: `Improve this ${node.type}` },
        { label: "Make Responsive", icon: Smartphone, prompt: "Fix this for mobile" },
      ];
  }
}

// ─── Context summary ──────────────────────────────────────────────

function getContextSummary(node: CanvasNode | null, breakpoint: string, route: string, nodeCount: number): string {
  if (!node) {
    return `Page: ${route} · ${nodeCount} elements · ${breakpoint} view · No selection`;
  }
  const path: string[] = [];
  let current: CanvasNode | null = node;
  while (current) {
    path.unshift(current.metadata?.name || current.type);
    current = current.parentId ? null : null; // simplified — store has getNodePath
  }
  return `Selected: ${node.type}${node.props?.text ? ` "${node.props.text.slice(0, 30)}"` : ""} · ${breakpoint} view · ${nodeCount} elements on page`;
}

// ─── Main Component ───────────────────────────────────────────────

export function LiTTCopilotPanel() {
  const selectedNodeId = useCanvasBuilderStore((s) => s.selectedNodeId);
  const node = useCanvasBuilderStore((s) => (s.selectedNodeId ? s.document.nodes[s.selectedNodeId] : null));
  const document = useCanvasBuilderStore((s) => s.document);
  const breakpoint = useCanvasBuilderStore((s) => s.breakpoint);
  const getNodePath = useCanvasBuilderStore((s) => s.getNodePath);
  const duplicateNode = useCanvasBuilderStore((s) => s.duplicateNode);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const nodeCount = Object.keys(document.nodes).length;
  const agentButtons = getAgentButtonsForNode(node);
  const contextSummary = getContextSummary(node, breakpoint, document.route, nodeCount);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendPrompt = useCallback(async (promptText: string) => {
    if (!promptText.trim() || isThinking) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: promptText,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsThinking(true);

    // TODO: Wire to actual LiTT AI endpoint
    // For now, simulate a response
    setTimeout(() => {
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        role: "assistant",
        content: `I understand you want to: "${promptText}". I'm analyzing the current canvas state and will make the changes. (AI integration pending — this is a placeholder response.)`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsThinking(false);
    }, 800);
  }, [isThinking]);

  const handleAgentButton = (btn: AgentButton) => {
    // Special handling for duplicate
    if (btn.label === "Duplicate" && selectedNodeId) {
      duplicateNode(selectedNodeId);
      return;
    }
    handleSendPrompt(btn.prompt);
  };

  return (
    <div
      className="flex h-full w-full flex-col glass-panel"
      style={{ borderLeft: "1px solid var(--glass-border)", borderRadius: 0 }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-2.5"
        style={{ borderBottom: "1px solid var(--studio-border)" }}
      >
        <Sparkles size={14} style={{ color: "var(--glass-purple)" }} />
        <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--glass-text-1)" }}>
          LiTT Copilot
        </span>
      </div>

      {/* Context summary */}
      <div
        className="shrink-0 px-3 py-2"
        style={{ borderBottom: "1px solid var(--glass-border)", backgroundColor: "rgba(139,92,246,0.04)" }}
      >
        <div className="text-[9px] font-bold uppercase tracking-[0.08em] mb-1" style={{ color: "var(--text-muted)" }}>
          LiTT sees
        </div>
        <div className="text-[10px]" style={{ color: "var(--glass-text-3)" }}>
          {contextSummary}
        </div>
        {node && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {getNodePath(selectedNodeId!).slice(-3).map((n, i, arr) => (
              <span key={n.id} className="text-[9px] font-bold" style={{ color: i === arr.length - 1 ? "var(--glass-purple)" : "var(--text-muted)" }}>
                {n.metadata?.name || n.type}
                {i < arr.length - 1 && " / "}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Contextual agent buttons */}
      <div className="shrink-0 p-2.5" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        <div className="flex flex-wrap gap-1.5">
          {agentButtons.map((btn) => {
            const Icon = btn.icon;
            return (
              <button
                key={btn.label}
                onClick={() => handleAgentButton(btn)}
                disabled={isThinking}
                className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition hover:bg-white/5 disabled:opacity-40"
                style={{
                  borderColor: "var(--glass-border)",
                  backgroundColor: "rgba(255,255,255,0.02)",
                  color: "var(--glass-text-2)",
                }}
              >
                <Icon size={11} style={{ color: "var(--glass-purple)" }} />
                {btn.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <Sparkles size={24} style={{ color: "var(--glass-purple)", opacity: 0.4 }} />
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Ask LiTT to build, redesign, or improve anything on your canvas.
            </p>
            <p className="text-[10px]" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
              Try: &quot;Make this hero look premium&quot;
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className="flex flex-col gap-1"
            style={{ alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}
          >
            <div
              className="max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px]"
              style={{
                backgroundColor: msg.role === "user" ? "var(--glass-purple-soft)" : "rgba(255,255,255,0.04)",
                color: msg.role === "user" ? "var(--glass-text-1)" : "var(--glass-text-2)",
                border: `1px solid ${msg.role === "user" ? "var(--glass-border-purple)" : "var(--glass-border)"}`,
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {isThinking && (
          <div className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={12} className="animate-spin" />
            <span className="text-[10px]">LiTT is thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 p-2.5" style={{ borderTop: "1px solid var(--glass-border)" }}>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendPrompt(input);
              }
            }}
            placeholder="Ask LiTT..."
            disabled={isThinking}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid var(--glass-border)",
              color: "var(--glass-text-1)",
              fontSize: 12,
              outline: "none",
            }}
          />
          <button
            onClick={() => handleSendPrompt(input)}
            disabled={!input.trim() || isThinking}
            className="flex items-center justify-center rounded-lg transition"
            style={{
              width: 32,
              height: 32,
              backgroundColor: "var(--glass-purple)",
              color: "#fff",
              border: "none",
              cursor: !input.trim() || isThinking ? "not-allowed" : "pointer",
              opacity: !input.trim() || isThinking ? 0.4 : 1,
            }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
