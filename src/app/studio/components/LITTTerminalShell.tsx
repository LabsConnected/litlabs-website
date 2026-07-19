"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import { parseLiTTActions } from "@/lib/litt-context";
import { AGENTS } from "@/lib/agents";
export type StudioTool =
  | "chat"
  | "image"
  | "video"
  | "audio"
  | "agents"
  | "terminal"
  | "builder"
  | "pipeline"
  | "gallery"
  | "canvas"
  | "clibridge"
  | "space"
  | "loops";


import {
  Terminal as TerminalIcon,
  Bot,
  Paperclip,
  Send,
  Plus,
  Camera,
  ScreenShare,
  Mic,
  MicOff,
  X,
  Square,
  Loader2,
  Settings2,
  Image as ImageIcon,
  Film,
  Music,
  Hammer,
  Home,
  ChevronLeft,
} from "lucide-react";
import Link from "next/link";

import dynamic from "next/dynamic";

const CameraSession = dynamic(() => import("./CameraSession"), { ssr: false });
import {
  PersonaProvider,
  usePersona,
} from "@/components/terminal/PersonaContext";

import TerminalToolDirect, {
  type TerminalToolHandle,
} from "../tools/TerminalTool";

const ChatShell = dynamic(() => import("./ChatShell"), { ssr: false });
const ImageGenPopover = dynamic(() => import("./ImageGenPopover"), {
  ssr: false,
});
const ProjectDrawer = dynamic(() => import("./ProjectDrawer"), {
  ssr: false,
});

type Message = {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  type?: "text" | "image" | "video" | "audio" | "error";
  mediaUrl?: string;
  status?: string;
};

type Attachment = {
  url: string; // data URL
  name: string;
  type: string;
};

type TerminalBlock = {
  id: string;
  command: string;
  startedBy: "user" | "litt";
  status: "running" | "completed" | "error";
  output?: string;
};

function createTerminalBlock(command: string, startedBy: "user" | "litt"): TerminalBlock {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    command,
    startedBy,
    status: "running",
  };
}

function updateTerminalBlock(block: TerminalBlock, updates: Partial<TerminalBlock>): TerminalBlock {
  return { ...block, ...updates };
}

function TelemetryBar() {
  return null;
}

function ActiveCommandTabs({
  tabs,
  onClose,
  onActivate,
}: {
  tabs: {
    id: string;
    label: string;
    tool?: string;
    payload?: Record<string, unknown>;
  }[];
  onClose: (id: string) => void;
  /**
   * Fired when the user clicks the chip body (not the close X). The
   * terminal's parent wires this to either (a) push the label into the
   * composer as a follow-up message, or (b) when the chip carries a
   * direct tool invocation, POST /api/agent-tool to dispatch it.
   */
  onActivate?: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-2">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="group flex items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/5 text-[10px] font-medium text-cyan-400"
        >
          <button
            onClick={() => onActivate?.(tab.id)}
            disabled={!onActivate}
            title={tab.tool ? `Run ${tab.tool}` : "Send as follow-up"}
            className="flex items-center gap-2 rounded-l-md px-2.5 py-1 transition hover:bg-cyan-500/10 disabled:cursor-default"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            {tab.label}
          </button>
          <button
            onClick={() => onClose(tab.id)}
            aria-label={`Close ${tab.label}`}
            className="rounded-r-md px-1.5 py-1 text-gray-300 transition hover:bg-rose-500/10 hover:text-rose-300"
          >
            <X size={10} />
          </button>
        </div>
      ))}
      <button
        aria-label="Add active command"
        className="flex h-5 w-5 items-center justify-center rounded-md border border-white/10 text-gray-300 transition hover:bg-white/5"
      >
        <Plus size={10} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Attachment previews — shown above the input row                    */
/* ------------------------------------------------------------------ */
function AttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (idx: number) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pb-1">
      {attachments.map((att, idx) => {
        const isImage = att.type.startsWith("image/");
        return (
          <div
            key={`${att.name}-${idx}`}
            className="group relative flex items-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-white/3 pr-7"
          >
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={att.url}
                alt={att.name}
                className="h-12 w-12 object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center bg-white/5 text-cyan-400">
                <ImageIcon size={18} />
              </div>
            )}
            <div className="flex min-w-0 flex-col py-1 pr-2">
              <span className="max-w-[140px] truncate text-[10px] font-medium text-neutral-200">
                {att.name}
              </span>
              <span className="text-[9px] text-gray-300">
                {att.type || "file"}
              </span>
            </div>
            <button
              onClick={() => onRemove(idx)}
              aria-label={`Remove ${att.name}`}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md bg-black/40 text-neutral-300 opacity-0 transition group-hover:opacity-100 hover:bg-black/70 hover:text-white"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function LITTTerminalShellInner({
  activeTool: _activeTool = "builder",
  onToolChangeAction,
}: {
  activeTool?: StudioTool;
  onToolChangeAction?: (tool: StudioTool) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { profile } = useProfile();
  const {
    voiceState,
    errorMessage,
    cooldownRemaining,
    speakText,
    startVoice,
    stopVoice,
    setOnTurn,
    setActivity,
  } = useVoiceSession();
  const { persona, switchPersona } = usePersona();
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem("litlab-builder-messages");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed as Message[];
      }
    } catch {}
    return [];
  });
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [terminalDrawerOpen, setTerminalDrawerOpen] = useState(false);
  const [micSetupOpen, setMicSetupOpen] = useState(false);
  const [, setTerminalBlocks] = useState<TerminalBlock[]>([]);
  const terminalRef = useRef<TerminalToolHandle | null>(null);
  const activeTerminalBlockRef = useRef<string | null>(null);
  type ActiveCommand = {
    id: string;
    label: string;
    tool?: string;
    payload?: Record<string, unknown>;
  };
  const [activeCommands, setActiveCommands] = useState<ActiveCommand[]>([]);
  const [agentId] = useState<keyof typeof AGENTS>("littcode");
  const [agentChats, setAgentChats] = useState<Record<string, Message[]>>({});
  const [pendingAgentQuery, setPendingAgentQuery] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevPersonaRef = useRef(persona.id);

  // Persist Builder messages so the stream survives refresh
  useEffect(() => {
    try {
      localStorage.setItem("litlab-builder-messages", JSON.stringify(messages));
    } catch {}
  }, [messages]);

  const activeAgent = useMemo(
    () => AGENTS[agentId] || AGENTS.littcode,
    [agentId],
  );
  const agentMessages = useMemo(
    () => agentChats[activeAgent.id] || [],
    [agentChats, activeAgent.id],
  );
  const chatMessages = useMemo(
    () =>
      messages.map((m) => ({
        id: `${m.role}-${m.createdAt ?? Math.random()}`,
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt,
        type: m.type,
        mediaUrl: m.mediaUrl,
        status: m.status,
      })),
    [messages],
  );
  const micActive = voiceState !== "idle";
  const micDisabled =
    voiceState === "transcribing" ||
    voiceState === "thinking" ||
    voiceState === "speaking" ||
    voiceState === "cooldown";

  // Auto-open the image generation popover when navigated with ?openImage=1
  useEffect(() => {
    if (searchParams?.get("openImage") === "1") {
      setImageGenOpen(true);
      // Clean the param so it doesn't re-open on every render
      const params = new URLSearchParams(searchParams.toString());
      params.delete("openImage");
      const query = params.toString();
      router.replace(`/studio${query ? `?${query}` : ""}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Sync active project from URL ?project=ID
  useEffect(() => {
    const urlProject = searchParams?.get("project");
    if (urlProject && urlProject !== activeProjectId) {
      setActiveProjectId(urlProject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Respect ?agent= param to switch persona and ?mission= to pre-load prompt
  useEffect(() => {
    const urlAgent = searchParams?.get("agent");
    const urlMission = searchParams?.get("mission");
    if (urlAgent && (urlAgent === "littcode" || urlAgent === "littlebit")) {
      if (persona.id !== urlAgent) {
        switchPersona(urlAgent);
      }
    }
    if (urlMission) {
      const missionPrompt = decodeURIComponent(urlMission);
      setMessages((prev) => {
        const hasMission = prev.some(
          (m) => m.role === "user" && m.content === missionPrompt,
        );
        if (hasMission) return prev;
        return [
          ...prev,
          { role: "user", content: missionPrompt, createdAt: Date.now() },
        ];
      });
      // Clean the mission param after consuming it
      const params = new URLSearchParams(searchParams.toString());
      params.delete("mission");
      const query = params.toString();
      router.replace(`/studio${query ? `?${query}` : ""}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, busy]);

  // Insert a divider when the user switches persona
  useEffect(() => {
    if (prevPersonaRef.current === persona.id) return;
    if (messages.length === 0) {
      prevPersonaRef.current = persona.id;
      return;
    }
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: `--- Switched to ${persona.name} ---`,
        createdAt: Date.now(),
      },
    ]);
    prevPersonaRef.current = persona.id;
  }, [persona, messages.length]);

  // Esc cancels an in-flight request
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        abortRef.current?.abort();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  // Auto-scroll agent conversation
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [agentMessages, busy]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const readers = files.map(
      (file) =>
        new Promise<Attachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              url: String(reader.result ?? ""),
              name: file.name,
              type: file.type,
            });
          reader.onerror = () =>
            reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(file);
        }),
    );
    Promise.all(readers)
      .then((items) =>
        setAttachments((prev) => [...prev, ...items].slice(0, 8)),
      )
      .catch(() => {
        // ignore read errors
      })
      .finally(() => {
        if (e.target) e.target.value = "";
      });
  }, []);

  const handleScreenCapture = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject();
      });
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      stream.getTracks().forEach((track) => track.stop());
      const dataUrl = canvas.toDataURL("image/png");
      setAttachments((prev) =>
        [...prev, { url: dataUrl, name: "screenshot.png", type: "image/png" }].slice(0, 8),
      );
    } catch {
      // ignore cancellation or errors
    }
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const addToolMessage = useCallback(
    (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    },
    [],
  );

  const updateLastToolMessage = useCallback(
    (updates: Partial<Message>) => {
      setMessages((current) => {
        if (current.length === 0) return current;
        const next = current.slice();
        next[next.length - 1] = { ...next[next.length - 1], ...updates };
        return next;
      });
    },
    [],
  );

  const executeTerminalCommand = useCallback(
    (command: string, startedBy: "user" | "litt" = "user") => {
      const block = createTerminalBlock(command, startedBy);
      activeTerminalBlockRef.current = block.id;
      setTerminalBlocks((prev) => [...prev, block]);
      setTerminalDrawerOpen(true);

      setTerminalBlocks((prev) =>
        prev.map((b) =>
          b.id === block.id ? updateTerminalBlock(b, { status: "running" }) : b,
        ),
      );

      const handle = terminalRef.current;
      if (handle) {
        handle.runCommand(command);
      }
    },
    [],
  );

  const handleTerminalOutput = useCallback((data: string) => {
    const blockId = activeTerminalBlockRef.current;
    if (!blockId) return;
    setTerminalBlocks((prev) =>
      prev.map((block) =>
        block.id === blockId
          ? updateTerminalBlock(block, {
              status: "running",
              output: `${block.output || ""}${data}`.slice(-12000),
            })
          : block,
      ),
    );
  }, []);

  // Run slash commands like /image, /audio, /video inline in the chat
  const runSlashCommand = useCallback(
    async (text: string) => {
      const match = text.match(
        /^\/(image|audio|video|build|code|agent|terminal|clear|new)\s*(.*)/i,
      );
      if (!match) return false;
      const [, cmd, raw] = match;
      const prompt = raw.trim();

      if (cmd === "agent") {
        if (!prompt) {
          addToolMessage({
            role: "assistant",
            content:
              "Add a prompt after `/agent`, e.g. `/agent review my React component`.",
            createdAt: Date.now(),
          });
          return true;
        }
        addToolMessage({
          role: "assistant",
          content: `Asking ${activeAgent.name}…`,
          createdAt: Date.now(),
          status: "pending",
        });
        try {
          const res = await fetch("/api/agents/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentId: activeAgent.id,
              message: prompt,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(
              err.error || err.detail || "Agent service error",
            );
          }
          const data = (await res.json()) as {
            response?: string;
            agent?: { name?: string };
          };
          const reply = data.response || "I'm on it.";
          updateLastToolMessage({
            content: reply,
            status: "complete",
          });
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : "Agent service unavailable";
          updateLastToolMessage({
            content: msg,
            type: "error",
            status: "error",
          });
        }
        return true;
      }

      // Show the user's command as a user message first
      {
        addToolMessage({
          role: "user",
          content: text,
          createdAt: Date.now(),
        });
      }

      if (cmd === "image") {
        if (!prompt) {
          addToolMessage({
            role: "assistant",
            content:
              "Add a prompt after `/image`, e.g. `/image a futuristic city at sunset`.",
            createdAt: Date.now(),
          });
          return true;
        }
        addToolMessage({
          role: "assistant",
          content: prompt,
          createdAt: Date.now(),
          type: "image",
          status: "pending",
        });
        try {
          const res = await fetch("/api/media/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              format: "image",
              providerId: "pollinations",
              width: 1024,
              height: 1024,
              aspectRatio: "1:1",
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Image generation failed");
          updateLastToolMessage({
            content: prompt,
            mediaUrl: data.downloadUrl,
            status: "complete",
            type: "image",
          });
        } catch (err) {
          updateLastToolMessage({
            content:
              err instanceof Error ? err.message : "Image generation failed",
            type: "error",
            status: "error",
          });
        }
        return true;
      }

      if (cmd === "audio") {
        if (!prompt) {
          addToolMessage({
            role: "assistant",
            content:
              "Add a prompt after `/audio`, e.g. `/audio a cinematic sci-fi trailer voiceover`.",
            createdAt: Date.now(),
          });
          return true;
        }
        addToolMessage({
          role: "assistant",
          content: `Generating audio: "${prompt}"…`,
          createdAt: Date.now(),
          type: "audio",
          status: "pending",
        });
        try {
          const res = await fetch("/api/media/generate-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Audio generation failed");
          updateLastToolMessage({
            content: `Generated audio: ${prompt}`,
            mediaUrl: data.audioBase64,
            status: "complete",
          });
        } catch (err) {
          updateLastToolMessage({
            content:
              err instanceof Error ? err.message : "Audio generation failed",
            type: "error",
            status: "error",
          });
        }
        return true;
      }

      if (cmd === "video") {
        if (!prompt) {
          addToolMessage({
            role: "assistant",
            content:
              "Add a prompt after `/video`, e.g. `/video a drone flying over a neon city`.",
            createdAt: Date.now(),
          });
          return true;
        }
        addToolMessage({
          role: "assistant",
          content: `Starting video generation: "${prompt}"…`,
          createdAt: Date.now(),
          type: "video",
          status: "pending",
        });
        try {
          const res = await fetch("/api/media/generate-video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              aspectRatio: "16:9",
              resolution: "720p",
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Video generation failed");

          const poll = async () => {
            const start = Date.now();
            while (Date.now() - start < 300_000) {
              await new Promise((r) => setTimeout(r, 4000));
              const pollRes = await fetch("/api/media/video-status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ operationName: data.operationName }),
              });
              const pollData = await pollRes.json().catch(() => ({}));
              if (pollData.error) throw new Error(pollData.error);
              if (pollData.done && pollData.videoUri) {
                updateLastToolMessage({
                  content: `Generated video: ${prompt}`,
                  mediaUrl: pollData.videoUri,
                  status: "complete",
                });
                return;
              }
            }
            throw new Error("Video generation timed out");
          };

          void poll().catch((err) => {
            updateLastToolMessage({
              content:
                err instanceof Error
                  ? err.message
                  : "Video generation failed",
              type: "error",
              status: "error",
            });
          });
        } catch (err) {
          updateLastToolMessage({
            content:
              err instanceof Error ? err.message : "Video generation failed",
            type: "error",
            status: "error",
          });
        }
        return true;
      }

      if (cmd === "build") {
        onToolChangeAction?.("builder");
        addToolMessage({
          role: "assistant",
          content: prompt
            ? `Switched to the Build tool. Use it to build: ${prompt}`
            : "Switched to the Build tool.",
          createdAt: Date.now(),
        });
        return true;
      }

      if (cmd === "code") {
        onToolChangeAction?.("canvas");
        addToolMessage({
          role: "assistant",
          content: prompt
            ? `Switched to the Code tool. Prompt: ${prompt}`
            : "Switched to the Code tool.",
          createdAt: Date.now(),
        });
        return true;
      }

      if (cmd === "terminal") {
        setTerminalDrawerOpen(true);
        if (prompt) {
          executeTerminalCommand(prompt, "user");
        }
        return true;
      }

      if (cmd === "clear" || cmd === "new") {
        setMessages([]);
        setActiveCommands([]);
        try {
          localStorage.removeItem("litlab-builder-messages");
        } catch {}
        addToolMessage({
          role: "assistant",
          content:
            cmd === "clear"
              ? "Chat cleared. What's next?"
              : "New conversation started. What are we building?",
          createdAt: Date.now(),
        });
        return true;
      }

      return false;
    },
    [
      addToolMessage,
      updateLastToolMessage,
      onToolChangeAction,
      activeAgent.id,
      activeAgent.name,
      executeTerminalCommand,
    ],
  );

  const sendAgent = useCallback(
    async (value: string) => {
      const text = value.trim();
      const agent = activeAgent;
      const userMessage: Message = {
        role: "user",
        content: text || "(image attachment)",
        createdAt: Date.now(),
      };
      setAgentChats((prev) => ({
        ...prev,
        [agent.id]: [...(prev[agent.id] || []), userMessage],
      }));
      setBusy(true);
      setActivity({ type: "thinking" });

      try {
        const res = await fetch("/api/agents/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: agent.id,
            message: text || "Describe what you see.",
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.detail || "Agent service error");
        }
        const data = (await res.json()) as {
          response?: string;
          agent?: { name?: string };
          imageUrl?: string;
          imagePrompt?: string;
          imageProvider?: string;
        };
        const reply = data.response || "I'm on it.";
        const assistantMessage: Message = data.imageUrl
          ? {
              role: "assistant",
              content: reply,
              createdAt: Date.now(),
              type: "image",
              mediaUrl: data.imageUrl,
            }
          : { role: "assistant", content: reply, createdAt: Date.now() };
        setAgentChats((prev) => ({
          ...prev,
          [agent.id]: [...(prev[agent.id] || []), assistantMessage],
        }));
        return reply;
      } catch (err) {
        const reply =
          err instanceof Error ? err.message : "Agent service unavailable";
        setAgentChats((prev) => ({
          ...prev,
          [agent.id]: [
            ...(prev[agent.id] || []),
            { role: "assistant", content: reply, createdAt: Date.now() },
          ],
        }));
        return reply;
      } finally {
        setBusy(false);
        setActivity({ type: "idle" });
      }
    },
    [activeAgent, setActivity],
  );

  // Route a pending /agent query
  useEffect(() => {
    if (pendingAgentQuery) {
      const query = pendingAgentQuery;
      setPendingAgentQuery("");
      void sendAgent(query || "...");
    }
  }, [pendingAgentQuery, sendAgent]);

  const send = useCallback(
    async (value: string, attachmentsArg?: string[]) => {
      const text = value.trim();
      const attachList =
        attachmentsArg ?? attachments.map((a) => a.url).filter(Boolean);
      if ((!text && !attachList.length) || busy) return "";

      // Terminal commands: "$ command" or "/run command"
      const termMatch = text.match(/^\$\s+(.+)/) || text.match(/^\/run\s+(.+)/i);
      if (termMatch) {
        const cmd = termMatch[1].trim();
        executeTerminalCommand(cmd, "user");
        setInput("");
        setAttachments([]);
        return "";
      }

      const userMessage = text || "(image attachment)";

      // Let creators ask for the common project build in plain English. Keep
      // this deliberately narrow so ordinary discussion never executes code.
      const buildIntent = /^(?:please\s+)?(?:run|start|do)\s+(?:the\s+)?build\b/i.test(text)
        || /^(?:please\s+)?build\s+(?:the\s+)?(?:project|app|site|repo|from here)\b/i.test(text);
      if (buildIntent) {
        setMessages((current) => [
          ...current,
          { role: "user", content: text, createdAt: Date.now() },
          {
            role: "assistant",
            content: "Running the project build in the Studio terminal. You can watch it live below.",
            createdAt: Date.now(),
          },
        ]);
        executeTerminalCommand("pnpm build", "litt");
        setInput("");
        setAttachments([]);
        return "Running the project build in the Studio terminal.";
      }

      // Multimodal snapshots go through the Gemini image-chat path because the
      // unified streaming endpoint does not accept image data yet.
      if (attachList.length > 0) {
        const historyForApi = messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
        setMessages((current) => [
          ...current,
          {
            role: "user" as const,
            content: userMessage,
            createdAt: Date.now(),
          },
        ]);
        setBusy(true);
        setInput("");
        setAttachments((prev) => (attachmentsArg ? prev : []));
        setActivity({ type: "thinking" });

        try {
          const response = await fetch("/api/gemini/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentSlug: persona.id,
              message: userMessage,
              history: historyForApi,
              images: attachList,
              userName: profile.displayName || "Creator",
            }),
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || err.error || "Image chat failed");
          }
          const data = (await response.json()) as { response?: string };
          const reply =
            data.response ||
            "I\u2019m ready. Tell me what we\u2019re building.";
          setMessages((current) => [
            ...current,
            {
              role: "assistant" as const,
              content: reply,
              createdAt: Date.now(),
            },
          ]);
          return reply;
        } catch (error) {
          const reply =
            error instanceof Error ? error.message : "LiTT is reconnecting";
          setMessages((current) => [
            ...current,
            {
              role: "assistant" as const,
              content: reply,
              createdAt: Date.now(),
            },
          ]);
          return reply;
        } finally {
          setBusy(false);
          setActivity({ type: "idle" });
        }
      }

      const historyForApi = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      setMessages((current) => [
        ...current,
        { role: "user" as const, content: userMessage, createdAt: Date.now() },
      ]);
      setBusy(true);
      setInput("");
      setAttachments((prev) => (attachmentsArg ? prev : []));
      setActivity({ type: "thinking" });

      // Handle slash commands inline before falling back to the chat API
      if (text && (await runSlashCommand(text))) {
        setBusy(false);
        setActivity({ type: "idle" });
        return "";
      }

      const controller = new AbortController();
      abortRef.current = controller;

      // Insert a streaming placeholder for the assistant turn
      const placeholderIndex = messages.length + 1; // +1 for the user message we just appended
      setMessages((current) => [
        ...current,
        { role: "assistant" as const, content: "", createdAt: Date.now() },
      ]);

      let fullText = "";
      try {
        const response = await fetch("/api/chat/unified", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "llm",
            agentSlug: persona.id,
            message: text || "Describe what you see.",
            history: historyForApi,
            stream: true,
            userName: profile.displayName || "Creator",
            images: attachList,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.detail || err.error || "LiTT is reconnecting");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        setActivity({ type: "generating_response" });
        // Read the full stream
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split("\n\n");
          buf = events.pop() ?? "";
          for (const ev of events) {
            const trimmed = ev.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload) as {
                text?: string;
                error?: string;
                done?: boolean;
              };
              if (typeof json.text === "string" && json.text.length > 0) {
                fullText += json.text;
                setMessages((current) => {
                  if (placeholderIndex >= current.length) return current;
                  const next = current.slice();
                  next[placeholderIndex] = {
                    ...next[placeholderIndex],
                    content: fullText,
                  };
                  return next;
                });
              } else if (typeof json.error === "string") {
                throw new Error(json.error);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message) {
                // Only rethrow server-reported errors
                const msg = parseErr.message;
                if (
                  msg !== "Unexpected token" &&
                  msg !== "Unexpected end of JSON input"
                ) {
                  throw parseErr;
                }
              }
            }
          }
        }
        // The action-chips emitted by parseLiTTActions are *user-driven* next
        // steps, not model function calls. The model emits them as
        // structured JSON; the user clicks one and the terminal sends the
        // label back as a follow-up turn. We attach the original action
        // object so the click handler can do something smarter (run a
        // command, ask for confirmation, etc.) when the shape allows.
        const actionObjects = parseLiTTActions(fullText);
        setActiveCommands(
          actionObjects.map((a, i) => ({
            id: `${a.type}-${i}`,
            label: a.label,
            tool: a.type,
            payload: {
              command: a.command,
              filePath: a.filePath,
              content: a.content,
              goalTitle: a.goalTitle,
              memoryContent: a.memoryContent,
            },
          })),
        );

        // Post-processing: detect and override "I can't build/execute" refusals.
        // The system prompt already says NEVER to say this, but some models
        // (especially Gemini) ignore it. Same pattern as the image refusal filter.
        const buildRefusal =
          /\b(can't|cannot|unable to|don't have|do not have|won't|will not)\b.*\b(execute|run|build|perform|carry out)\b.*\b(command|build|shell|terminal|from here|from this)\b/i.test(
            fullText,
          ) ||
          /\bI (?:can't|cannot|am unable to|don't have)\b.*\b(?:build|run|execute|compile|lint|test)\b/i.test(
            fullText,
          );
        if (buildRefusal) {
          fullText =
            "Yes, I can — through the Studio terminal. Type any of these:\n\n- `$ pnpm build` — runs a production build\n- `$ pnpm lint` — runs ESLint\n- `$ pnpm test` — runs Vitest\n- `$ npx tsc --noEmit` — type-check\n- `/run <any command>` — runs any shell command\n\nOr just tell me what you want to build and I'll run it.";
          setMessages((current) => {
            if (placeholderIndex >= current.length) return current;
            const next = current.slice();
            next[placeholderIndex] = {
              ...next[placeholderIndex],
              content: fullText,
            };
            return next;
          });
        }

        return fullText;
      } catch (error) {
        const isAbort =
          error instanceof DOMException && error.name === "AbortError";
        if (isAbort) {
          setMessages((current) => {
            if (placeholderIndex >= current.length) return current;
            const next = current.slice();
            const cur = next[placeholderIndex];
            const stamp = cur.content
              ? `${cur.content}\n\n_(cancelled)_`
              : "_(cancelled)_";
            next[placeholderIndex] = { ...cur, content: stamp };
            return next;
          });
          return "";
        }
        const reply =
          error instanceof Error ? error.message : "LiTT is reconnecting";
        setMessages((current) => {
          if (placeholderIndex >= current.length) return current;
          const next = current.slice();
          next[placeholderIndex] = {
            ...next[placeholderIndex],
            content: reply,
          };
          return next;
        });
        return reply;
      } finally {
        setBusy(false);
        abortRef.current = null;
        setActivity({ type: "idle" });
      }
    },
    [
      busy,
      messages,
      attachments,
      profile.displayName,
      persona.id,
      setActivity,
      runSlashCommand,
      executeTerminalCommand,
    ],
  );

  // Voice transcripts are finalised after a silence gap — auto-send and speak reply
  useEffect(() => {
    setOnTurn((text) => {
      if (!text) return;
      void send(text).then((reply) => {
        if (reply) speakText(reply);
      });
    });
    return () => setOnTurn(() => {});
  }, [send, speakText, setOnTurn]);

  const handleChatSend = useCallback(
    async (text: string) => {
      return send(text);
    },
    [send],
  );

  const handleSend = () => {
    if (busy) {
      cancel();
      return;
    }
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;

    void send(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };


  const closeCommand = (id: string) => {
    setActiveCommands((prev) => prev.filter((c) => c.id !== id));
  };

  const toggleMic = () => {
    if (micDisabled) return;
    if (micActive) {
      stopVoice();
    } else {
      void startVoice();
    }
  };

  const plusActions = [
    {
      id: "image",
      label: "Image",
      icon: ImageIcon,
      onClick: () => setImageGenOpen(true),
    },
    {
      id: "video",
      label: "Video",
      icon: Film,
      onClick: () => {
        setInput("/video ");
        textInputRef.current?.focus();
      },
    },
    {
      id: "audio",
      label: "Audio",
      icon: Music,
      onClick: () => {
        setInput("/audio ");
        textInputRef.current?.focus();
      },
    },
    {
      id: "build",
      label: "Build",
      icon: Hammer,
      onClick: () => {
        setInput("/build ");
        textInputRef.current?.focus();
      },
    },
    {
      id: "agent",
      label: "Agent",
      icon: Bot,
      onClick: () => {
        setInput("/agent ");
        textInputRef.current?.focus();
      },
    },
    {
      id: "terminal",
      label: "Terminal",
      icon: TerminalIcon,
      onClick: () => {
        setInput("/terminal ");
        textInputRef.current?.focus();
      },
    },
    {
      id: "camera",
      label: "Camera",
      icon: Camera,
      onClick: () => setCameraOpen(true),
    },
    {
      id: "screen",
      label: "Screen",
      icon: ScreenShare,
      onClick: handleScreenCapture,
    },
    {
      id: "files",
      label: "Files",
      icon: Paperclip,
      onClick: () => fileInputRef.current?.click(),
    },
  ];

  // When the user clicks a chip body, we treat it as a follow-up turn so
  // the chat path picks up the chip's intent. Destructive action types
  // (anything that would run a shell command, edit a file, or build/deploy)
  // are gated behind window.confirm() — the user has to explicitly say
  // yes before the action fires. A richer in-app confirmation dialog
  // can replace this later without touching the loop logic.
  const activateCommand = useCallback(
    (id: string) => {
      const chip = activeCommands.find((c) => c.id === id);
      if (!chip) return;
      const destructive = new Set([
        "run_command",
        "edit_file",
        "create_file",
        "shell_command",
        "npm_run",
        "run_build",
        "run_lint",
      ]);
      const cmdText =
        typeof chip.payload?.command === "string"
          ? chip.payload.command
          : undefined;
      const hasCommand =
        typeof cmdText === "string" && cmdText.trim().length > 0;
      const isDestructive =
        (chip.tool && destructive.has(chip.tool)) || hasCommand;
      if (isDestructive) {
        const desc =
          hasCommand && cmdText
            ? `This will run: \`${cmdText}\``
            : `This will run: ${chip.label}`;

        if (
          typeof window !== "undefined" &&
          !window.confirm(`${desc}\n\nAllow?`)
        ) {
          return;
        }
      }
      // Send the chip's label back as a follow-up message. The chat path
      // will see the label in history and the model can either (a)
      // decide to call a tool, or (b) answer with a clarification.
      void send(chip.label);
    },
    [activeCommands, send],
  );

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent text-neutral-100"
      style={{ color: T.textColor }}
    >
      {/* Hidden file input — driven by the toolbar buttons */}
      <input
        ref={fileInputRef}
        type="file"
        name="file-attachment"
        id="litt-file-attachment"
        multiple
        hidden
        aria-label="File attachment"
        accept="image/*,application/pdf,text/*"
        onChange={handleFiles}
      />
      <input
        ref={cameraInputRef}
        type="file"
        name="camera-capture"
        id="litt-camera-capture"
        hidden
        aria-label="Camera capture"
        accept="image/*"
        capture="environment"
        onChange={handleFiles}
      />

      {/* ── BODY ── */}
      <div className="flex min-h-0 flex-1">
        {/* MAIN STAGE */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Ambient background - simplified on mobile to reduce paint */}
          <div
            className="pointer-events-none absolute inset-0 hidden opacity-50 sm:block"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 30%, rgba(34,211,238,0.12) 0%, transparent 40%), radial-gradient(circle at 80% 20%, rgba(168,85,247,0.12) 0%, transparent 35%), radial-gradient(circle at 60% 80%, rgba(236,72,153,0.08) 0%, transparent 45%), linear-gradient(to bottom, transparent, rgba(3,3,8,0.9))",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 hidden opacity-[0.04] sm:block"
            style={{
              backgroundImage:
                "linear-gradient(rgba(34,211,238,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.4) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />

          {/* Stage header */}
          <div className="relative z-10 flex min-h-14 shrink-0 items-center justify-between border-b border-white/5 px-4 py-2 sm:px-6 sm:pt-5 sm:border-0">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-400 transition hover:bg-white/10 hover:text-white"
                aria-label="Back to home"
                title="Back to home"
              >
                <ChevronLeft size={16} />
              </Link>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
                <TerminalIcon size={16} className="text-cyan-400" />
              </div>
              <div>
                <div className="text-sm font-black tracking-wide text-white">
                  Builder
                </div>
                <div className="hidden text-[10px] text-gray-300 sm:block">
                  {activeProjectId
                    ? `Project · ${activeProjectId.slice(0, 12)}`
                    : "Your intelligent workspace. One command away."}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <Link
                href="/"
                className="hidden items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white sm:flex"
                aria-label="Go to homepage"
              >
                <Home size={12} />
                <span>Home</span>
              </Link>
              <UserButton
                afterSignOutUrl="/sign-in"
                appearance={{
                  elements: {
                    userButtonAvatarBox:
                      "h-7 w-7 rounded-full border border-white/10",
                  },
                }}
              />
            </div>
          </div>

          {cameraOpen && (
            <div className="absolute right-4 top-14 z-60 w-64 sm:top-16">
              <CameraSession
                compact
                onSnapshot={(url) => {
                  void send("Describe what you see.", [url]).then(
                    (reply) => {
                      if (reply) speakText(reply);
                    },
                  );
                  setCameraOpen(false);
                }}
                onClose={() => setCameraOpen(false)}
                modelName={persona.name}
              />
            </div>
          )}

          {/* Project drawer — opened from the Projects rail item */}
          <ProjectDrawer
            open={projectDrawerOpen}
            onClose={() => setProjectDrawerOpen(false)}
            activeProjectId={activeProjectId}
            onSelect={(projectId) => {
              setActiveProjectId(projectId);
              setProjectDrawerOpen(false);
              // Update URL with project param
              const params = new URLSearchParams(
                searchParams?.toString() ?? "",
              );
              params.set("project", projectId);
              router.push(`/studio?${params.toString()}`, { scroll: false });
            }}
          />

          {/* Scrollable content */}
          <div
            ref={transcriptRef}
            className="relative z-10 min-h-0 flex-1 overflow-y-auto px-0 py-0"
          >
            <ChatShell
              embedded
              hideDock
              builderMode={true}
              messages={chatMessages}
              sending={busy}
              systemLines={[]}
              onSend={handleChatSend}
              onToolSelect={onToolChangeAction}
              onOpenImageGen={() => setImageGenOpen(true)}
            />
          </div>

          {/* Mobile tool rail removed in favor of the global bottom nav. */}

          {/* COMMAND BAR — centered floating creative dock */}
              <div className="relative z-20 shrink-0 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-1.5 sm:px-6 sm:py-3">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-1.5 rounded-t-2xl border-x border-t border-white/10 bg-[#060a16]/80 p-2.5 shadow-[0_-18px_60px_rgba(0,0,0,.3)] backdrop-blur-xl">
              {/* Compact voice state strip — replaces the old giant panel */}
              {micActive && (
                <div className="flex items-center gap-2 px-1 text-[11px]">
                  {(() => {
                    if (voiceState === "cooldown") {
                      return (
                        <>
                          <span className="text-amber-400 font-bold">Voice limit reached</span>
                          <span className="text-amber-400">· Retry available in {cooldownRemaining}s</span>
                        </>
                      );
                    }
                    if (voiceState === "error") {
                      return (
                        <span className="text-rose-400 truncate">
                          {errorMessage || "Voice session error"}
                        </span>
                      );
                    }
                    const steps = [
                      { label: "Listening", active: voiceState === "listening" },
                      { label: "Transcribing", active: voiceState === "transcribing" },
                      { label: "Thinking", active: voiceState === "thinking" },
                      { label: "Speaking", active: voiceState === "speaking" },
                    ];
                    const activeIdx = steps.findIndex((s) => s.active);
                    return steps.map((step, idx) => (
                      <span key={step.label} className="flex shrink-0 items-center gap-1">
                        <span className={idx <= activeIdx && activeIdx >= 0 ? "text-cyan-400" : idx < activeIdx ? "text-emerald-400" : "text-white/20"}>
                          {idx < activeIdx ? "✓" : idx === activeIdx ? "●" : "○"}
                        </span>
                        <span className={idx === activeIdx ? "text-neutral-200 font-bold" : idx < activeIdx ? "text-neutral-400" : "text-white/20"}>{step.label}</span>
                        {idx < steps.length - 1 && <span className="text-white/10">›</span>}
                      </span>
                    ));
                  })()}
                </div>
              )}

              <AttachmentStrip
                attachments={attachments}
                onRemove={removeAttachment}
              />

              {/* Mic setup panel — sits directly beside the mic button */}
              {micSetupOpen && (
                <div className="mb-1 rounded-xl border border-violet-300/20 bg-[#0b0c16]/85 p-3 shadow-2xl">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <strong className="block text-xs text-white">Microphone setup</strong>
                      <span className="text-[9px] text-white/40">
                        Click the mic to start. Tap again to stop.
                      </span>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-wider ${voiceState === "error" ? "bg-red-400/10 text-red-300" : voiceState === "idle" ? "bg-amber-400/10 text-amber-300" : "bg-emerald-400/10 text-emerald-300"}`}>
                      {voiceState === "error" ? "Needs attention" : voiceState === "idle" ? "Ready" : "Active"}
                    </span>
                  </div>
                  <p className="text-[9px] leading-4 text-white/40">
                    If the mic doesn&apos;t respond, click it once and choose Allow in the browser prompt. In Firefox, use the microphone icon beside the address bar to reset a blocked permission.
                  </p>
                </div>
              )}

              <div className="flex items-end gap-2 sm:items-center">
                {/* + button — single, opens bottom sheet */}
                <div className="relative">
                  <button
                    aria-label="Open creation menu"
                    aria-expanded={plusMenuOpen}
                    onClick={() => setPlusMenuOpen((v) => !v)}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${
                      plusMenuOpen
                        ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-400"
                        : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
                    }`}
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                  {plusMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-90 bg-black/60 sm:bg-transparent"
                        onClick={() => setPlusMenuOpen(false)}
                        aria-hidden="true"
                      />
                      <div
                        className="fixed bottom-0 left-0 right-0 z-100 rounded-t-2xl border border-white/10 bg-[#0a0a0f] p-4 shadow-2xl sm:absolute sm:bottom-full sm:left-0 sm:top-auto sm:mb-2 sm:w-56 sm:rounded-xl sm:p-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between pb-2 sm:hidden">
                          <span className="text-xs font-black text-white">
                            Create & attach
                          </span>
                          <button
                            onClick={() => setPlusMenuOpen(false)}
                            aria-label="Close creation menu"
                            className="rounded-md p-1 text-neutral-300 hover:bg-white/10"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-1">
                          {plusActions.map((action) => {
                            const Icon = action.icon;
                            return (
                              <button
                                key={action.id}
                                onClick={() => {
                                  setPlusMenuOpen(false);
                                  action.onClick();
                                }}
                                className="flex flex-col items-center gap-1 rounded-lg p-2 text-[10px] text-neutral-200 transition hover:bg-white/5 sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-xs"
                              >
                                <Icon size={16} className="text-cyan-400" />
                                <span>{action.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Text input — placeholder shows voice state when mic active */}
                <div className="relative flex min-w-0 flex-1 items-end">
                  <textarea
                    ref={textInputRef}
                    name="litt-message"
                    id="litt-message-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    aria-label="Message LITT"
                    placeholder={
                      micActive
                        ? voiceState === "speaking"
                          ? "LiTT is speaking..."
                          : voiceState === "transcribing"
                            ? "Transcribing..."
                            : voiceState === "thinking"
                              ? "LiTT is thinking..."
                              : voiceState === "listening"
                                ? "Listening..."
                                : voiceState === "cooldown"
                                  ? "Voice temporarily unavailable"
                                  : "Voice active..."
                        : "Ask LiTT anything..."
                    }
                    rows={1}
                    className="max-h-32 min-h-11 w-full resize-none rounded-2xl border border-white/15 bg-white/4 py-2.5 pl-3 pr-12 text-sm leading-5 text-neutral-100 outline-none transition-all placeholder:text-gray-400 focus:border-cyan-300/30 focus:bg-white/5 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)] sm:min-h-12 sm:py-3 sm:pl-4 sm:text-base"
                  />
                  {/* Contextual send/stop button inside textarea */}
                  <button
                    aria-label={busy ? "Stop" : "Send message"}
                    onClick={handleSend}
                    disabled={
                      !busy && !input.trim() && attachments.length === 0
                    }
                    className={`absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-40 sm:bottom-2 sm:h-9 sm:w-9 ${
                      busy
                        ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                        : "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"
                    }`}
                  >
                    {busy ? (
                      <Square size={12} aria-hidden="true" />
                    ) : (
                      <Send size={15} aria-hidden="true" />
                    )}
                  </button>
                </div>

                {/* Mic setup gear — sits directly beside the mic button */}
                <button
                  aria-label="Microphone setup"
                  title="Microphone setup"
                  onClick={() => setMicSetupOpen((v) => !v)}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${micSetupOpen ? "border-violet-400/40 bg-violet-400/10 text-violet-300" : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"}`}
                >
                  <Settings2 size={15} aria-hidden="true" />
                </button>

                {/* Mic button — tap to start, tap again to cancel */}
                <button
                  aria-label={
                    micDisabled ? "Voice busy" : micActive ? "Cancel voice" : "Start voice"
                  }
                  onClick={toggleMic}
                  disabled={micDisabled}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${
                    micDisabled
                      ? "border-white/5 bg-white/5 text-neutral-500 cursor-not-allowed"
                      : micActive
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                        : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
                  }`}
                >
                  {micDisabled ? (
                    <Loader2 size={15} aria-hidden="true" />
                  ) : micActive ? (
                    <MicOff size={15} aria-hidden="true" />
                  ) : (
                    <Mic size={15} aria-hidden="true" />
                  )}
                </button>
              </div>

              {/* Compact command hint — slash commands still work when typed manually */}
              <div className="flex items-center justify-between px-1 text-[9px] text-white/25">
                <span>Press / for exact commands</span>
                <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
              </div>
            </div>

            <ActiveCommandTabs
              tabs={activeCommands}
              onClose={closeCommand}
              onActivate={activateCommand}
            />
          </div>

          {/* FOOTER TELEMETRY */}
          <div className="relative z-20 hidden h-8 shrink-0 items-center border-t border-white/5 bg-[#030308]/70 backdrop-blur-md">
            <TelemetryBar />
            <div className="ml-auto flex items-center gap-2 px-4 text-[10px] text-gray-400">
              <span>&ldquo;Greatness is built, not generated.&rdquo;</span>
              <span className="font-black tracking-widest text-cyan-500/60">
                LITT
              </span>
            </div>
          </div>

          {/* Persistent terminal drawer. It stays mounted so PTY sessions and
              command history survive closing and reopening the panel. */}
          <div
            className={`fixed inset-0 z-50 flex items-end justify-center transition ${terminalDrawerOpen ? "pointer-events-auto bg-black/50 backdrop-blur-sm" : "pointer-events-none bg-transparent"}`}
            onClick={() => setTerminalDrawerOpen(false)}
            aria-hidden={!terminalDrawerOpen}
          >
              <div
                className={`relative flex h-[72dvh] max-h-[760px] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#05050a] shadow-2xl transition-transform duration-300 ${terminalDrawerOpen ? "translate-y-0" : "translate-y-full"}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-cyan-400">
                    <TerminalIcon size={14} /> Terminal
                  </div>
                  <button
                    onClick={() => setTerminalDrawerOpen(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-400 transition hover:bg-white/10 hover:text-white"
                    aria-label="Close terminal"
                  >
                    ✕
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <TerminalToolDirect ref={terminalRef} onOutput={handleTerminalOutput} />
                </div>
              </div>
          </div>
        </main>
      </div>

      {/* Image generation popover — rendered outside overflow-hidden main so fixed positioning works */}
      <ImageGenPopover
        open={imageGenOpen}
        onClose={() => setImageGenOpen(false)}
        initialPrompt={input}
        onInsert={(url, _name) => {
          addToolMessage({
            role: "assistant",
            content: input || "Generated image",
            createdAt: Date.now(),
            type: "image",
            mediaUrl: url,
            status: "complete",
          });
        }}
      />
    </div>
  );
}

export default function LITTTerminalShell(props: {
  activeTool?: StudioTool;
  onToolChangeAction?: (tool: StudioTool) => void;
}) {
  return (
    <PersonaProvider>
      <LITTTerminalShellInner {...props} />
    </PersonaProvider>
  );
}
