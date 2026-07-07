"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";

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
};

const LiTAssistantContext = createContext<LiTAssistantContextValue | null>(null);

const STORAGE_KEY = "lit-assistant-state";

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function LiTAssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<LiTMessage[]>([]);
  const [tasks, setTasks] = useState<LiTTask[]>([]);
  const [loaded, setLoaded] = useState(false);

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

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      addMessage("user", text);
      setOpen(true);

      const taskId = addTask({
        title: "Thinking...",
        status: "running",
        progress: 10,
      });

      try {
        const res = await fetch("/api/gemini/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, stream: false }),
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

        if (reply) {
          addMessage("assistant", reply);
        } else {
          addMessage(
            "assistant",
            "I'm LiT. I can help you build, create, chat, and navigate. What do you want to work on?",
          );
        }

        // Route common intents locally
        const lower = text.toLowerCase();
        if (lower.includes("build") || lower.includes("app")) {
          addMessage(
            "progress",
            "🛠️ Suggestion: Open Builder with /studio?tool=builder",
          );
        } else if (lower.includes("image") || lower.includes("generate")) {
          addMessage(
            "progress",
            "🎨 Suggestion: Open Studio Image with /studio?tool=image",
          );
        } else if (lower.includes("agent") || lower.includes("agents")) {
          addMessage(
            "progress",
            "🤖 Suggestion: Browse agents at /agents",
          );
        }
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
    [addMessage, addTask, updateTask],
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
