"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { routeFromText } from "@/lib/lit-router";

export type LiTMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "progress" | "error";
  content: string;
  timestamp: number;
};

export type LiTTask = {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "error";
  progress?: number;
  message?: string;
  timestamp: number;
};

type OnNavigate = (href: string) => void;

type LiTAssistantContextValue = {
  open: boolean;
  setOpen: (v: boolean) => void;
  messages: LiTMessage[];
  tasks: LiTTask[];
  sendMessage: (text: string) => Promise<void>;
  addTask: (task: Omit<LiTTask, "id" | "timestamp">) => string;
  updateTask: (id: string, patch: Partial<LiTTask>) => void;
  clearChat: () => void;
  clearTasks: () => void;
  onNavigate?: OnNavigate;
  setOnNavigate: (fn: OnNavigate | undefined) => void;
  voiceMode: boolean;
  setVoiceMode: (v: boolean) => void;
};

const LiTAssistantContext = createContext<LiTAssistantContextValue | null>(null);

const STORAGE_KEY = "lit-assistant-state";
const GENERIC_REPLY =
  "I’m connected. Tell me the next concrete thing you want changed, and I’ll use the current page, recent chat, and saved memory to move it forward.";

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function LiTAssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<LiTMessage[]>([]);
  const [tasks, setTasks] = useState<LiTTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [onNavigate, setOnNavigate] = useState<OnNavigate | undefined>(undefined);
  const [voiceMode, setVoiceMode] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.messages) setMessages(parsed.messages);
        if (parsed.tasks) setTasks(parsed.tasks);
      }
    } catch {
      // ignore corrupt storage
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages, tasks }),
    );
  }, [messages, tasks, loaded]);

  const addMessage = useCallback(
    (role: LiTMessage["role"], content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: generateId(), role, content, timestamp: Date.now() },
      ]);
    },
    [],
  );

  const addTask = useCallback((task: Omit<LiTTask, "id" | "timestamp">) => {
    const id = generateId();
    setTasks((prev) => [
      ...prev,
      { ...task, id, timestamp: Date.now() },
    ]);
    return id;
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<LiTTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }, []);

  const clearChat = useCallback(() => setMessages([]), []);
  const clearTasks = useCallback(() => setTasks([]), []);

  const normalizeReply = useCallback((reply: string, priorMessages: LiTMessage[]) => {
    const trimmed = reply.trim();
    if (!trimmed) return GENERIC_REPLY;
    const genericPatterns = [
      /i('|’)m lit/i,
      /i am lit/i,
      /i can help you/i,
      /what do you want to work on/i,
      /what would you like to achieve/i,
    ];
    const assistantHistory = priorMessages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content.toLowerCase());
    const alreadyUsedGeneric = assistantHistory.some((content) =>
      genericPatterns.some((pattern) => pattern.test(content)),
    );
    const isGeneric = genericPatterns.some((pattern) => pattern.test(trimmed));
    const repeatedExact = assistantHistory.some((content) => content === trimmed.toLowerCase());
    if ((alreadyUsedGeneric && isGeneric) || repeatedExact) return GENERIC_REPLY;
    return trimmed;
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const historySnapshot = messages;
      addMessage("user", text);
      setOpen(true);

      // Local navigation routing
      const routed = routeFromText(text);
      if (routed && routed.type === "navigate") {
        const taskId = addTask({
          title: `Opening ${routed.label}...`,
          status: "running",
          progress: 50,
        });
        await new Promise((r) => setTimeout(r, 300));
        onNavigate?.(routed.href);
        updateTask(taskId, {
          title: `Opened ${routed.label}`,
          status: "done",
          progress: 100,
        });
        addMessage(
          "assistant",
          `Got you — opening ${routed.label}.`,
        );
        return;
      }

      const taskId = addTask({
        title: "Thinking...",
        status: "running",
        progress: 10,
      });

      try {
        const res = await fetch("/api/gemini/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            stream: false,
            history: historySnapshot
              .filter((m) => m.role === "user" || m.role === "assistant")
              .slice(-12)
              .map((m) => ({
                role: m.role === "user" ? "user" : "assistant",
                content: m.content,
              })),
          }),
        });
        const data = await res.json();

        updateTask(taskId, {
          title: "Understanding request...",
          progress: 40,
        });

        await new Promise((r) => setTimeout(r, 400));

        updateTask(taskId, {
          title: "Routing to best tool...",
          progress: 70,
        });

        await new Promise((r) => setTimeout(r, 400));

        updateTask(taskId, {
          title: "Ready",
          status: "done",
          progress: 100,
        });

        const reply =
          data.response || data.text || data.reply || data.message || "";

        addMessage("assistant", normalizeReply(reply, historySnapshot));
      } catch (e) {
        updateTask(taskId, {
          title: "Failed to reach LiT",
          status: "error",
          progress: 0,
        });
        addMessage(
          "error",
          `LiT is offline: ${e instanceof Error ? e.message : "Unknown error"}`,
        );
      }
    },
    [addMessage, addTask, updateTask, onNavigate, messages, normalizeReply],
  );

  return (
    <LiTAssistantContext.Provider
      value={{
        open,
        setOpen,
        messages,
        tasks,
        sendMessage,
        addTask,
        updateTask,
        clearChat,
        clearTasks,
        onNavigate,
        setOnNavigate,
        voiceMode,
        setVoiceMode,
      }}
    >
      {children}
    </LiTAssistantContext.Provider>
  );
}

export function useLiTAssistant() {
  const ctx = useContext(LiTAssistantContext);
  if (!ctx) {
    throw new Error("useLiTAssistant must be used within LiTAssistantProvider");
  }
  return ctx;
}
