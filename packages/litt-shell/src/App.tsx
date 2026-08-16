import React, { useState, useEffect, useRef, useCallback } from "react";
import { desktopRuntime, type ConnectionState, type WorkspaceState, type RuntimeState } from "./runtime-client";

// Status indicator helper
const getStatusIcon = (connected: boolean) => connected ? "?" : "?";

// Phase display names
const getPhaseLabel = (phase: string) => {
  const labels: Record<string, string> = {
    idle: "IDLE",
    thinking: "THINKING",
    verifying: "VERIFYING",
    complete: "COMPLETE",
    failed: "FAILED",
    running: "RUNNING"
  };
  return labels[phase] || phase.toUpperCase();
};

// Conversation message type
interface Message {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("OFFLINE");
  const [workspace, setWorkspace] = useState<WorkspaceState>({ name: "Desktop", path: "", branch: null, status: "loading" });
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [phase, setPhase] = useState<string>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Subscribe to streaming chat events from terminal-server
  // Correlation by event.turnId, not stale activeTurnId closure
  useEffect(() => {
    const unsubChat = desktopRuntime.subscribeChatEvent((event) => {
      // Skip events for other turns - correlate using event.turnId directly
      if (event.type === "delta" && event.text) {
        // Append streamed text to the current assistant message
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === "assistant" && lastMsg.id === event.turnId) {
            return [...prev.slice(0, -1), { ...lastMsg, content: lastMsg.content + event.text }];
          }
          return prev;
        });
      } else if (event.type === "done") {
        setIsStreaming(false);
        setActiveTurnId(null);
      } else if (event.type === "error") {
        setMessages(prev => {
          // Check if the last message is the empty assistant placeholder for this turn
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === "assistant" && lastMsg.id === event.turnId && !lastMsg.content) {
            // Replace the empty placeholder with the error message
            return [...prev.slice(0, -1), {
              id: event.turnId,
              role: "assistant",
              content: event.message || "Error",
              timestamp: Date.now()
            }];
          }
          // Otherwise add a new error message
          return [...prev, {
            id: event.turnId,
            role: "assistant",
            content: event.message || "Error",
            timestamp: Date.now()
          }];
        });
        setIsStreaming(false);
        setActiveTurnId(null);
      }
    });
    return unsubChat;
  }, []);

  useEffect(() => {
    const unsubState = desktopRuntime.subscribe("state", (state: ConnectionState) => setConnectionState(state));
    const unsubWorkspace = desktopRuntime.subscribe("workspace", (ws: WorkspaceState) => setWorkspace(ws));
    desktopRuntime.connect();
    return () => { unsubState(); unsubWorkspace(); };
  }, []);

  // Get runtime state when connected
  useEffect(() => {
    if (connectionState === "SHARED") {
      const state = desktopRuntime.runtimeState;
      setRuntimeState(state);
      if (state) {
        setPhase(state.phase || "idle");
      }
    }
  }, [connectionState]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || connectionState !== "SHARED") return;

    const turnId = crypto.randomUUID();
    const userMessage: Message = {
      id: turnId,
      role: "user",
      content: inputValue.trim(),
      timestamp: Date.now()
    }

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsStreaming(true);
    setActiveTurnId(turnId);

    // Add placeholder assistant message for streaming append
    setMessages(prev => [...prev, {
      id: turnId,
      role: "assistant",
      content: "",
      timestamp: Date.now()
    }]);

    // REAL CALL: send to terminal-server for LLM processing
    await desktopRuntime.sendMessage(turnId, inputValue.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isStreaming) {
      handleSendMessage();
    } else if (e.key === "Enter" && e.shiftKey) {
      setInputValue(prev => prev + "\n");
    }
  };

  const isShared = connectionState === "SHARED";
  const statusColor = isShared ? "text-green-400" : "text-red-400";

  return (
    <div className="litt-shell-container">
      {/* Window Header */}
      <div className="litt-shell-header">
        <span className="litt-title">LiTT</span>
        <span className="litt-footer-label">DESKTOP</span>
      </div>

      {/* Main Content */}
      <div className="litt-shell-content">
        {/* LiTT Brand */}
        <div className="litt-brand">
          <div className="litt-logo">?</div>
          <span className="litt-name">LiTT</span>
        </div>

        {/* Desktop Shell Section */}
        <div className="litt-shell-section">
          <h2 className="litt-shell-title">Desktop Shell</h2>
        </div>

        {/* Status Section */}
        <div className="litt-status-section">
          <div className="litt-status-item">
            <span className="litt-status-label">Runtime:</span>
            <span className={`litt-status-value ${statusColor}`}>
              <span className="litt-status-icon">{getStatusIcon(isShared)}</span>
              {isShared ? "SHARED" : connectionState}
            </span>
          </div>
          <div className="litt-status-item">
            <span className="litt-status-label">Workspace:</span>
            <span className="litt-status-value">{workspace.name || "not loaded"}</span>
          </div>
          {runtimeState && (
            <div className="litt-status-item">
              <span className="litt-status-label">Phase:</span>
              <span className="litt-status-value">{getPhaseLabel(phase)}</span>
            </div>
          )}
        </div>

        {/* Conversation Area */}
        <div className="litt-conversation-area">
          <div className="litt-messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`litt-message ${msg.role}-message`}>
                <div className="litt-message-content">
                  {msg.role === "assistant" && !msg.content && isStreaming ? "Streaming..." : msg.content}
                </div>
                <div className="litt-message-timestamp">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="litt-input-area">
          <textarea
            ref={inputRef}
            className="litt-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isShared ? "Ask LiTT anything..." : "Connecting..."}
            disabled={!isShared || isStreaming}
            rows={2}
          />
          <button
            className="litt-send-btn"
            onClick={handleSendMessage}
            disabled={!isShared || isStreaming || !inputValue.trim()}
          >
            {isStreaming ? "Sending..." : "Send"}
          </button>
        </div>
      </div>

      {/* Window Footer */}
      <div className="litt-shell-footer">
        <span>LiTT Shell v0.1.0</span>
      </div>
    </div>
  );
}

export default App;
