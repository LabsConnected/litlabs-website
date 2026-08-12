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
 *   5. Pending changes (preview/accept/reject)
 *   6. Change log (recent edits with revert)
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
  X,
  RotateCcw,
  History,
} from "lucide-react";
import { useCanvasBuilderStore } from "./store";
import type { CanvasNode, NodeStyles, SectionTemplate } from "./types";
import { SECTION_TEMPLATES, createNode } from "./types";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  pendingActions?: PendingAction[];
}

interface PendingAction {
  type: "addSection" | "editText" | "editStyles" | "deleteNode" | "reorder" | "duplicateNode";
  nodeId?: string;
  text?: string;
  styles?: Partial<NodeStyles>;
  template?: string;
  direction?: "up" | "down";
  afterNodeId?: string;
  label: string;
}

interface ChangeLogEntry {
  id: string;
  label: string;
  timestamp: number;
  historyIndex: number; // snapshot index for revert
}

// ─── Contextual agent buttons per node type + project type ─────────

interface AgentButton {
  label: string;
  icon: typeof Wand2;
  prompt: string;
}

function getAgentButtonsForProjectType(projectType: string): AgentButton[] {
  switch (projectType) {
    case "html":
      return [
        { label: "Build Project", icon: Sparkles, prompt: "Build a complete HTML project — create the HTML structure, CSS styling, and JavaScript interactivity" },
        { label: "Edit HTML", icon: Type, prompt: "Improve the HTML structure — add semantic elements and better markup" },
        { label: "Edit CSS", icon: Palette, prompt: "Improve the CSS styling — make it more polished, responsive, and modern" },
        { label: "Add JavaScript", icon: Wand2, prompt: "Add JavaScript interactivity — animations, event handlers, dynamic behavior" },
        { label: "Fix Errors", icon: AlertCircle, prompt: "Check for and fix any HTML, CSS, or JavaScript errors in this project" },
        { label: "Preview", icon: Check, prompt: "Review the current project and suggest improvements" },
      ];
    case "game2d":
    case "game3d":
      return [
        { label: "Build Game", icon: Sparkles, prompt: "Build a complete game with player controls, enemies, scoring, and sound" },
        { label: "Add Object", icon: Plus, prompt: "Add a new game object — player, enemy, platform, coin, or powerup" },
        { label: "Add Behavior", icon: Wand2, prompt: "Add a behavior to the selected object — movement, collision, health, or custom logic" },
        { label: "Generate Asset", icon: ImageIcon, prompt: "Generate a game asset — sprite, background, or sound effect" },
        { label: "Test Game", icon: AlertCircle, prompt: "Test the game and fix any issues" },
        { label: "Play", icon: Check, prompt: "Run the game in preview mode" },
      ];
    case "app":
      return [
        { label: "Build App", icon: Sparkles, prompt: "Build a complete web app with interactive components and state management" },
        { label: "Add Component", icon: Plus, prompt: "Add a new UI component to the app" },
        { label: "Improve Design", icon: Palette, prompt: "Improve the app's design — make it more polished and professional" },
        { label: "Make Responsive", icon: Smartphone, prompt: "Fix the app layout for mobile and tablet views" },
        { label: "Audit", icon: AlertCircle, prompt: "Audit this app for design issues, accessibility, and performance" },
      ];
    default:
      return [
        { label: "Build Page", icon: Sparkles, prompt: "Build a complete landing page with hero, features, testimonials, and CTA sections" },
        { label: "Add Section", icon: Plus, prompt: "Add a new section that fits the current page" },
        { label: "Improve Design", icon: Palette, prompt: "Improve the overall design of this page — make it more polished and professional" },
        { label: "Finish Page", icon: Check, prompt: "Finish this page — add any missing sections like footer, CTA, or navigation" },
        { label: "Audit Page", icon: AlertCircle, prompt: "Audit this page for design issues, accessibility, and mobile responsiveness" },
      ];
  }
}

function getAgentButtonsForNode(node: CanvasNode | null): AgentButton[] {
  if (!node) {
    return [
      { label: "Build Page", icon: Sparkles, prompt: "Build a complete landing page with hero, features, testimonials, and CTA sections" },
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
      ];
    case "text":
      return [
        { label: "Rewrite", icon: Type, prompt: `Rewrite this text to be clearer and more engaging: "${node.props?.text ?? ""}"` },
        { label: "Shorten", icon: Type, prompt: `Shorten this text: "${node.props?.text ?? ""}"` },
        { label: "Expand", icon: Plus, prompt: `Expand this text with more detail: "${node.props?.text ?? ""}"` },
      ];
    case "image":
      return [
        { label: "Replace", icon: RefreshCw, prompt: "Replace this image with a better alternative" },
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
        { label: "Change Layout", icon: Layout, prompt: `Change the layout of this ${node.type}` },
        { label: "Make Responsive", icon: Smartphone, prompt: "Fix this section for mobile and tablet views" },
      ];
    default:
      return [
        { label: "Redesign", icon: Palette, prompt: `Improve this ${node.type}` },
        { label: "Make Responsive", icon: Smartphone, prompt: "Fix this for mobile" },
      ];
  }
}

function getContextSummary(node: CanvasNode | null, breakpoint: string, route: string, nodeCount: number): string {
  if (!node) {
    return `Page: ${route} · ${nodeCount} elements · ${breakpoint} view · No selection`;
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
  const updateNodeProps = useCanvasBuilderStore((s) => s.updateNodeProps);
  const updateNodeStyles = useCanvasBuilderStore((s) => s.updateNodeStyles);
  const removeNode = useCanvasBuilderStore((s) => s.removeNode);
  const addSectionTemplate = useCanvasBuilderStore((s) => s.addSectionTemplate);
  const addNodeObject = useCanvasBuilderStore((s) => s.addNodeObject);
  const moveNode = useCanvasBuilderStore((s) => s.moveNode);
  const undo = useCanvasBuilderStore((s) => s.undo);
  const history = useCanvasBuilderStore((s) => s.history);
  const historyIndex = useCanvasBuilderStore((s) => s.historyIndex);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);
  const [showChangeLog, setShowChangeLog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const nodeCount = Object.keys(document.nodes).length;
  const projectType = useCanvasBuilderStore((s) => s.projectType);
  // For HTML and Game modes, use project-type-specific buttons (no node selection).
  // For Website/App/Component modes, use the existing node-contextual buttons.
  const agentButtons = (projectType === "html" || projectType === "game2d" || projectType === "game3d")
    ? getAgentButtonsForProjectType(projectType)
    : getAgentButtonsForNode(node);
  const contextSummary = getContextSummary(node, breakpoint, document.route, nodeCount);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Apply a single pending action to the canvas
  const applyAction = useCallback((action: PendingAction): boolean => {
    try {
      switch (action.type) {
        case "addSection": {
          const template = SECTION_TEMPLATES.find((t) => t.id === action.template);
          if (!template) return false;
          const rootId = document.rootNodeIds[0];
          if (!rootId) return false;
          // Find insertion index
          let index: number | undefined;
          if (action.afterNodeId) {
            const root = document.nodes[rootId];
            const afterIdx = root.children.indexOf(action.afterNodeId);
            if (afterIdx >= 0) index = afterIdx + 1;
          }
          addSectionTemplate(template, rootId);
          return true;
        }
        case "editText": {
          if (!action.nodeId) return false;
          updateNodeProps(action.nodeId, { text: action.text });
          return true;
        }
        case "editStyles": {
          if (!action.nodeId || !action.styles) return false;
          updateNodeStyles(action.nodeId, action.styles);
          return true;
        }
        case "deleteNode": {
          if (!action.nodeId) return false;
          removeNode(action.nodeId);
          return true;
        }
        case "duplicateNode": {
          if (!action.nodeId) return false;
          duplicateNode(action.nodeId);
          return true;
        }
        case "reorder": {
          if (!action.nodeId) return false;
          const node = document.nodes[action.nodeId];
          if (!node?.parentId) return false;
          const parent = document.nodes[node.parentId];
          const idx = parent.children.indexOf(action.nodeId);
          if (action.direction === "up" && idx > 0) {
            moveNode(action.nodeId, node.parentId, idx - 1);
          } else if (action.direction === "down" && idx < parent.children.length - 1) {
            moveNode(action.nodeId, node.parentId, idx + 1);
          }
          return true;
        }
        default:
          return false;
      }
    } catch (err) {
      console.error("[canvas-ai] Failed to apply action:", err);
      return false;
    }
  }, [document, addSectionTemplate, updateNodeProps, updateNodeStyles, removeNode, duplicateNode, moveNode]);

  // Apply all pending actions from a message
  const handleAcceptAll = useCallback((msgId: string) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msgId || !m.pendingActions) return m;
      const applied: ChangeLogEntry[] = [];
      for (const action of m.pendingActions) {
        const success = applyAction(action);
        if (success) {
          applied.push({
            id: `cl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            label: action.label,
            timestamp: Date.now(),
            historyIndex: useCanvasBuilderStore.getState().historyIndex,
          });
        }
      }
      if (applied.length > 0) {
        setChangeLog((prevLog) => [...applied.reverse(), ...prevLog].slice(0, 20));
      }
      return { ...m, pendingActions: undefined };
    }));
  }, [applyAction]);

  // Reject (dismiss) pending actions
  const handleRejectAll = useCallback((msgId: string) => {
    setMessages((prev) => prev.map((m) =>
      m.id === msgId ? { ...m, pendingActions: undefined } : m
    ));
  }, []);

  // Revert to a specific change log entry
  const handleRevert = useCallback((entry: ChangeLogEntry) => {
    // Undo back to the history index before this change
    const currentState = useCanvasBuilderStore.getState();
    while (currentState.historyIndex > entry.historyIndex && currentState.historyIndex > 0) {
      currentState.undo();
    }
    setChangeLog((prev) => prev.filter((e) => e.timestamp !== entry.timestamp));
  }, []);

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

    try {
      // HTML project mode — send files to the HTML AI endpoint
      if (projectType === "html") {
        const htmlProject = useCanvasBuilderStore.getState().htmlProject;
        const res = await fetch("/api/canvas/html-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: promptText,
            files: htmlProject.files.map((f) => ({
              name: f.name,
              content: f.content,
              language: f.language,
            })),
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Request failed (${res.status})`);
        }

        const data = await res.json();
        const updatedFiles = (data.files || []) as Array<{ name: string; content: string }>;

        // Apply returned file updates to the store
        if (updatedFiles.length > 0) {
          const currentProject = useCanvasBuilderStore.getState().htmlProject;
          const newFiles = currentProject.files.map((f) => {
            const updated = updatedFiles.find((uf) => uf.name === f.name);
            return updated ? { ...f, content: updated.content } : f;
          });
          useCanvasBuilderStore.getState().setHtmlProject({
            ...currentProject,
            files: newFiles,
          });
        }

        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}-ai`,
          role: "assistant",
          content: data.reply || `Updated ${updatedFiles.length} file(s).`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        // Canvas mode — send document to the canvas AI endpoint
        const res = await fetch("/api/canvas/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: promptText,
            document,
            selectedNodeId,
            breakpoint,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Request failed (${res.status})`);
        }

        const data = await res.json();
        const pendingActions: PendingAction[] = (data.actions || []).map((a: PendingAction & { label?: string }) => ({
          type: a.type,
          nodeId: a.nodeId,
          text: a.text,
          styles: a.styles,
          template: a.template,
          direction: a.direction,
          afterNodeId: a.afterNodeId,
          label: a.label || a.type,
        }));

        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}-ai`,
          role: "assistant",
          content: data.reply || "Done.",
          timestamp: Date.now(),
          pendingActions: pendingActions.length > 0 ? pendingActions : undefined,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reach LiTT";
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-err`,
        role: "assistant",
        content: `I couldn't process that: ${msg}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsThinking(false);
    }
  }, [isThinking, document, selectedNodeId, breakpoint, projectType]);

  const handleAgentButton = (btn: AgentButton) => {
    if (btn.label === "Duplicate" && selectedNodeId) {
      duplicateNode(selectedNodeId);
      setChangeLog((prev) => [{
        id: `cl-${Date.now()}`,
        label: `Duplicated ${node?.type ?? "node"}`,
        timestamp: Date.now(),
        historyIndex: useCanvasBuilderStore.getState().historyIndex,
      }, ...prev].slice(0, 20));
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
        <div className="flex-1" />
        <button
          onClick={() => setShowChangeLog(!showChangeLog)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold transition hover:bg-white/5"
          style={{
            color: showChangeLog ? "var(--glass-purple)" : "var(--text-muted)",
            backgroundColor: showChangeLog ? "var(--glass-purple-soft)" : "transparent",
          }}
          title="Change log"
        >
          <History size={11} />
          {changeLog.length > 0 && (
            <span style={{ color: "var(--glass-purple)" }}>{changeLog.length}</span>
          )}
        </button>
      </div>

      {/* Change Log Panel (collapsible) */}
      {showChangeLog && (
        <div
          className="shrink-0 px-3 py-2 max-h-[200px] overflow-y-auto"
          style={{ borderBottom: "1px solid var(--glass-border)", backgroundColor: "rgba(255,255,255,0.02)" }}
        >
          <div className="text-[9px] font-bold uppercase tracking-[0.08em] mb-2" style={{ color: "var(--text-muted)" }}>
            Recent Changes
          </div>
          {changeLog.length === 0 ? (
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>No changes yet.</p>
          ) : (
            <div className="space-y-1">
              {changeLog.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-[10px]"
                  style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
                >
                  <span className="flex-1 truncate" style={{ color: "var(--glass-text-2)" }}>{entry.label}</span>
                  <button
                    onClick={() => handleRevert(entry)}
                    className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold transition hover:bg-red-500/10"
                    style={{ color: "var(--text-muted)" }}
                    title="Revert this change"
                  >
                    <RotateCcw size={9} />
                    Revert
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
        {node && selectedNodeId && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {getNodePath(selectedNodeId).slice(-3).map((n, i, arr) => (
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

            {/* Pending actions — preview/accept/reject */}
            {msg.pendingActions && msg.pendingActions.length > 0 && (
              <div
                className="w-full rounded-lg border p-2.5 space-y-2"
                style={{
                  borderColor: "var(--glass-border-purple)",
                  backgroundColor: "rgba(139,92,246,0.06)",
                }}
              >
                <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--glass-purple)" }}>
                  Proposed Changes ({msg.pendingActions.length})
                </div>
                {msg.pendingActions.map((action, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]" style={{ color: "var(--glass-text-2)" }}>
                    <span className="h-1 w-1 rounded-full" style={{ backgroundColor: "var(--glass-purple)" }} />
                    <span className="flex-1">{action.label}</span>
                  </div>
                ))}
                <div className="flex gap-1.5 pt-1">
                  <button
                    onClick={() => handleAcceptAll(msg.id)}
                    className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-bold transition"
                    style={{
                      backgroundColor: "var(--glass-purple)",
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <Check size={11} />
                    Apply All
                  </button>
                  <button
                    onClick={() => handleRejectAll(msg.id)}
                    className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-bold transition hover:bg-white/5"
                    style={{
                      backgroundColor: "transparent",
                      color: "var(--text-muted)",
                      border: "1px solid var(--glass-border)",
                      cursor: "pointer",
                    }}
                  >
                    <X size={11} />
                    Reject
                  </button>
                </div>
              </div>
            )}
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
