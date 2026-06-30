"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/context/ThemeContext";
import { AGENTS as REAL_AGENTS } from "@/lib/agents";
import {
  Terminal,
  Mic,
  Camera,
  Send,
  Bot,
  Activity,
  StopCircle,
  Volume2,
  VolumeX,
  ChevronDown,
  Speaker,
} from "lucide-react";

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  lang: string;
  interimResults: boolean;
  onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown)
    | null;
  onerror: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: "system" | "user" | "agent" | "error" | "success" | "brain";
  text: string;
  agentName?: string;
}

function getTimestamp() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const chars =
      "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモ";
    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize);
    const drops = Array(columns)
      .fill(0)
      .map(() => Math.random() * -50);
    let animId: number;
    const draw = () => {
      ctx.fillStyle = "rgba(5, 5, 5, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        const alpha = Math.max(0.05, 1 - y / canvas.height);
        ctx.fillStyle = `rgba(0, 255, 157, ${alpha})`;
        ctx.font = `${fontSize}px monospace`;
        ctx.fillText(text, x, y);
        if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none opacity-25"
    />
  );
}

function Particles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      alpha: number;
    }[] = [];
    for (let i = 0; i < 30; i++)
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -Math.random() * 0.5 - 0.2,
        size: Math.random() * 2 + 1,
        alpha: Math.random() * 0.4 + 0.15,
      });
    let animId: number;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) {
          p.y = canvas.height + 10;
          p.x = Math.random() * canvas.width;
        }
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 255, 157, ${p.alpha})`;
        ctx.fill();
      });
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}

function AudioBars() {
  const [bars, setBars] = useState<number[]>(Array(10).fill(4));
  useEffect(() => {
    const interval = setInterval(() => {
      setBars(
        Array(10)
          .fill(0)
          .map(() => Math.random() * 18 + 3),
      );
    }, 100);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="flex items-end gap-[2px] h-4">
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-[2px] bg-[#00ff9d] transition-all duration-100"
          style={{ height: `${h}px`, opacity: 0.5 + h / 40 }}
        />
      ))}
    </div>
  );
}

function buildBootLogs(): LogEntry[] {
  const bootLogs: LogEntry[] = [
    {
      id: uid(),
      timestamp: getTimestamp(),
      type: "system",
      text: "INITIALIZING LiTTree CORE v3.0-MAD...",
    },
    {
      id: uid(),
      timestamp: getTimestamp(),
      type: "system",
      text: "MOUNTING NEURAL INTERFACE...",
    },
    {
      id: uid(),
      timestamp: getTimestamp(),
      type: "system",
      text: "HANDSHAKE WITH AGENT CLUSTER...",
    },
    {
      id: uid(),
      timestamp: getTimestamp(),
      type: "success",
      text: ">> CONNECTION ESTABLISHED — TLS 1.3 verified",
    },
  ];
  Object.values(REAL_AGENTS).forEach((agent, i) => {
    bootLogs.push({
      id: `boot-agent-${i}`,
      timestamp: getTimestamp(),
      type: "agent",
      text: `${agent.status === "online" ? "ONLINE" : "STANDBY"} // ${agent.role}`,
      agentName: agent.name,
    });
  });
  bootLogs.push({
    id: uid(),
    timestamp: getTimestamp(),
    type: "success",
    text: "WELCOME BACK, OVERLORD. ALL AGENTS NOMINAL. AWAITING COMMAND.",
  });
  return bootLogs;
}

export default function JarvisTerminal() {
  const { resolvedColors: T } = useTheme();
  const [logs, setLogs] = useState<LogEntry[]>(buildBootLogs);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("director");
  const [stats, setStats] = useState({ cpu: 12, mem: 4.2 });
  const [flicker, setFlicker] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [brainText, setBrainText] = useState("");
  const [isBrainStreaming, setIsBrainStreaming] = useState(false);
  const [continuousMode, setContinuousMode] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [alexaOutEnabled, setAlexaOutEnabled] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<
    SpeechSynthesisVoice[]
  >([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>("");
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [voicePickerStyle, setVoicePickerStyle] = useState<Record<string, string | number>>({});
  const [micPermission, setMicPermission] = useState<
    "prompt" | "granted" | "denied" | "unknown"
  >("unknown");
  const voicePickerRef = useRef<HTMLDivElement>(null);

  const terminalRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ttsQueue = useRef<string[]>([]);
  const isSpeaking = useRef(false);
  const pushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, brainText, isBrainStreaming]);

  /* Position voice picker in a portal so it escapes the terminal's stacking context */
  useLayoutEffect(() => {
    if (!showVoicePicker || !voicePickerRef.current) return;
    const position = () => {
      if (!voicePickerRef.current) return;
      const rect = voicePickerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeAbove = spaceBelow < 260;
      setVoicePickerStyle({
        position: "fixed",
        right: Math.max(8, window.innerWidth - rect.right),
        top: placeAbove ? undefined : rect.bottom + 6,
        bottom: placeAbove ? window.innerHeight - rect.top + 6 : undefined,
        width: Math.min(320, window.innerWidth - 16),
        maxHeight: 240,
        overflowY: "auto",
        zIndex: 9999,
      });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [showVoicePicker]);

  /* Load available TTS voices */
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      if (voices.length > 0 && !selectedVoiceURI) {
        const preferred =
          voices.find((v) => v.name.includes("Google UK English Male")) ||
          voices.find((v) => v.name.includes("Microsoft David")) ||
          voices.find(
            (v) => v.name.includes("Male") && v.lang.startsWith("en"),
          ) ||
          voices[0];
        if (preferred) setSelectedVoiceURI(preferred.voiceURI);
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [selectedVoiceURI]);

  /* Close voice picker on outside click */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        voicePickerRef.current &&
        !voicePickerRef.current.contains(e.target as Node)
      ) {
        setShowVoicePicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* Check mic permission */
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        setMicPermission(result.state as "prompt" | "granted" | "denied");
        result.onchange = () =>
          setMicPermission(result.state as "prompt" | "granted" | "denied");
      })
      .catch(() => setMicPermission("unknown"));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      setStats((s) => ({
        cpu: Math.min(100, Math.max(5, s.cpu + (Math.random() - 0.5) * 14)),
        mem: Math.min(16, Math.max(2, s.mem + (Math.random() - 0.5) * 0.6)),
      }));
      if (Math.random() > 0.97) {
        setFlicker(true);
        setTimeout(() => setFlicker(false), 60);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!ttsEnabled || typeof window === "undefined") return;

      if (alexaOutEnabled) {
        /* Route speech to Alexa speaker via Voice Monkey */
        fetch("/api/voice-monkey/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notification: text }),
        }).catch(() => {});
        /* Estimate Alexa speech duration (~150 WPM) and restart mic if continuous */
        if (continuousMode) {
          const words = text.trim().split(/\s+/).length;
          const durationMs = Math.max(2000, (words / 150) * 60 * 1000);
          window.setTimeout(() => {
            if (recognitionRef.current && !isListening && !isSpeaking.current) {
              try {
                recognitionRef.current.start();
              } catch {
                /* ignore */
              }
            }
          }, durationMs);
        }
        return;
      }

      const synth = window.speechSynthesis;
      if (!synth) return;
      ttsQueue.current.push(text);
      if (isSpeaking.current) return;
      const processQueue = () => {
        if (ttsQueue.current.length === 0) {
          isSpeaking.current = false;
          /* Auto-restart listening after speaking if continuous mode is on */
          if (continuousMode && recognitionRef.current && !isListening) {
            try {
              recognitionRef.current.start();
            } catch {
              /* ignore restart failures */
            }
          }
          return;
        }
        isSpeaking.current = true;
        const utterance = new SpeechSynthesisUtterance(
          ttsQueue.current.shift()!,
        );
        utterance.rate = 1.15;
        utterance.pitch = 0.85;
        const voice =
          availableVoices.find((v) => v.voiceURI === selectedVoiceURI) ||
          availableVoices[0];
        if (voice) utterance.voice = voice;
        utterance.onend = processQueue;
        utterance.onerror = processQueue;
        synth.speak(utterance);
      };
      processQueue();
    },
    [
      ttsEnabled,
      selectedVoiceURI,
      availableVoices,
      continuousMode,
      isListening,
      alexaOutEnabled,
    ],
  );

  const addLog = useCallback((entry: Omit<LogEntry, "id" | "timestamp">) => {
    setLogs((prev) => [
      ...prev,
      { ...entry, id: uid(), timestamp: getTimestamp() },
    ]);
  }, []);

  const streamBrain = useCallback(
    async (msg: string) => {
      setIsBrainStreaming(true);
      setBrainText("");
      setIsProcessing(true);
      try {
        const res = await fetch("/api/gemini/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentSlug: selectedAgent,
            message: msg,
            provider: "gemini",
            stream: true,
          }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter((l) => l.trim());
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              const text = data.text || "";
              if (text) {
                fullText += text;
                setBrainText(fullText);
              }
            } catch {
              /* ignore malformed SSE */
            }
          }
        }
        addLog({
          type: "brain",
          text: fullText || "No response received.",
          agentName: "JARVIS",
        });
        speak(fullText);
      } catch (err) {
        addLog({
          type: "error",
          text: err instanceof Error ? err.message : "Neural link severed.",
        });
      } finally {
        setIsBrainStreaming(false);
        setBrainText("");
        setIsProcessing(false);
      }
    },
    [selectedAgent, addLog, speak],
  );

  const triggerAlexa = useCallback(
    async (command: string) => {
      addLog({ type: "system", text: `Sending to Alexa: "${command}"...` });
      try {
        const res = await fetch("/api/voice-monkey/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notification: command }),
        });
        const data = await res.json();
        if (res.ok) {
          addLog({
            type: "success",
            text: `Alexa triggered: ${data.message || "OK"}`,
          });
        } else {
          addLog({
            type: "error",
            text: `Alexa error: ${data.error || "Unknown error"}`,
          });
        }
      } catch (err) {
        addLog({
          type: "error",
          text: `Alexa trigger failed: ${err instanceof Error ? err.message : "Network error"}`,
        });
      }
    },
    [addLog],
  );

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isProcessing) return;
    const msg = input.trim();
    setInput("");
    addLog({ type: "user", text: msg });
    setIsProcessing(true);

    if (msg.startsWith("/")) {
      const [cmd, ...rest] = msg.slice(1).split(" ");
      const arg = rest.join(" ");
      switch (cmd.toLowerCase()) {
        case "help":
          addLog({
            type: "success",
            text: "Available commands:\n  /scan              - Analyze your codebase\n  /status            - Check system health\n  /image <prompt>    - Open image generator\n  /code <prompt>     - Open code agent\n  /agent <name>      - Switch active agent\n  /voice [n]         - List or switch TTS voice\n  /alexa <cmd>       - Trigger Alexa via Voice Monkey\n  /clear             - Clear terminal\n  /tts               - Toggle voice output\n\nButtons:\n  ALEXA  - Route JARVIS speech to your Alexa speaker\n  ● Continuous - Auto-restart mic after response\n  ● Wake Word  - Say 'Hey JARVIS' to activate",
          });
          setIsProcessing(false);
          return;
        case "clear":
          setLogs([]);
          setIsProcessing(false);
          return;
        case "tts":
          setTtsEnabled((v) => {
            const next = !v;
            addLog({
              type: "success",
              text: `Voice output ${next ? "ENABLED" : "MUTED"}.`,
            });
            return next;
          });
          setIsProcessing(false);
          return;
        case "agent": {
          if (arg && REAL_AGENTS[arg as keyof typeof REAL_AGENTS]) {
            const a = REAL_AGENTS[arg as keyof typeof REAL_AGENTS];
            setSelectedAgent(arg);
            addLog({
              type: "success",
              text: `Switched to ${a.name} (${a.role})`,
            });
          } else {
            const list = Object.entries(REAL_AGENTS)
              .map(([id, a]) => `  ${id} - ${a.name}`)
              .join("\n");
            addLog({
              type: "error",
              text: `Unknown agent. Available:\n${list}`,
            });
          }
          setIsProcessing(false);
          return;
        }
        case "image":
          addLog({ type: "system", text: "Opening Image Forge..." });
          window.open(
            `/studio?tool=image${arg ? "&prompt=" + encodeURIComponent(arg) : ""}`,
            "_blank",
          );
          addLog({ type: "success", text: "Image Forge opened in new tab." });
          setIsProcessing(false);
          return;
        case "code":
          addLog({ type: "system", text: "Opening Code Agent..." });
          window.open(
            `/studio?tool=agents${arg ? "&prompt=" + encodeURIComponent(arg) : ""}`,
            "_blank",
          );
          addLog({ type: "success", text: "Code Agent opened in new tab." });
          setIsProcessing(false);
          return;
        case "status": {
          try {
            const [health, wallet] = await Promise.all([
              fetch("/api/llm/health").then((r) => (r.ok ? r.json() : null)),
              fetch("/api/wallet").then((r) => (r.ok ? r.json() : null)),
            ]);
            const lines = [
              `LLM Health: ${health?.gemini?.available ? "ONLINE" : health?.openrouter?.available ? "FALLBACK" : "OFFLINE"}`,
              `Wallet: ${wallet?.balance ?? "-"} LBC`,
              `Agents online: ${Object.values(REAL_AGENTS).filter((a) => a.status === "online").length}/${Object.values(REAL_AGENTS).length}`,
            ];
            addLog({ type: "success", text: lines.join("\n") });
          } catch {
            addLog({ type: "error", text: "Could not fetch status." });
          }
          setIsProcessing(false);
          return;
        }
        case "voice": {
          const enVoices = availableVoices.filter((v) =>
            v.lang.startsWith("en"),
          );
          if (enVoices.length === 0) {
            addLog({
              type: "error",
              text: "No voices available yet. Try again in a moment.",
            });
            setIsProcessing(false);
            return;
          }
          if (arg) {
            const idx = parseInt(arg, 10) - 1;
            if (idx >= 0 && idx < enVoices.length) {
              const voice = enVoices[idx]!;
              setSelectedVoiceURI(voice.voiceURI);
              addLog({
                type: "success",
                text: `Voice switched to: ${voice.name}`,
              });
              const u = new SpeechSynthesisUtterance("Voice activated.");
              u.voice = voice;
              u.rate = 1.15;
              u.pitch = 0.85;
              window.speechSynthesis.speak(u);
            } else {
              addLog({
                type: "error",
                text: `Invalid voice number. Use 1-${enVoices.length}.`,
              });
            }
          } else {
            const list = enVoices
              .map(
                (v, i) =>
                  `  ${i + 1}. ${v.name} (${v.lang})${v.voiceURI === selectedVoiceURI ? " [ACTIVE]" : ""}`,
              )
              .join("\n");
            addLog({
              type: "success",
              text: `Available voices:\n${list}\n\nUse /voice <number> to switch.`,
            });
          }
          setIsProcessing(false);
          return;
        }
        case "alexa": {
          if (!arg) {
            addLog({
              type: "error",
              text: "Usage: /alexa <command to send to Alexa>",
            });
          } else {
            await triggerAlexa(arg);
          }
          setIsProcessing(false);
          return;
        }
        case "scan": {
          try {
            addLog({
              type: "system",
              text: "Scanning codebase... this may take a moment.",
            });
            const res = await fetch("/api/jarvis/scan");
            if (!res.ok) throw new Error("Scan failed");
            const data = await res.json();
            const report = [
              `Project: ${data.projectName}`,
              `Files: ${data.totalFiles} | Lines: ${data.totalLines.toLocaleString()}`,
              `Tech: ${data.techStack.join(", ")}`,
              `Features: ${data.keyFeatures.join(" | ")}`,
              `Agents: ${data.agents.slice(0, 5).join(", ")}${data.agents.length > 5 ? "..." : ""}`,
              `Routes: ${data.routes.slice(0, 5).join(", ")}${data.routes.length > 5 ? "..." : ""}`,
              `APIs: ${data.apiEndpoints.length} endpoints`,
              `Build: ${data.health.buildStatus}`,
              data.health.envVarsMissing.length > 0
                ? `Missing: ${data.health.envVarsMissing.join(", ")}`
                : "All env vars configured",
              data.recentChanges.length > 0
                ? `Recent commits:\n  ${data.recentChanges.slice(0, 3).join("\n  ")}`
                : "",
            ]
              .filter(Boolean)
              .join("\n");
            addLog({ type: "agent", text: report, agentName: "JARVIS" });
          } catch (err) {
            addLog({
              type: "error",
              text: err instanceof Error ? err.message : "Scan failed.",
            });
          }
          setIsProcessing(false);
          return;
        }
        default:
          addLog({
            type: "error",
            text: `Unknown command: /${cmd}. Type /help for available commands.`,
          });
          setIsProcessing(false);
          return;
      }
    }

    await streamBrain(msg);
  }, [
    input,
    isProcessing,
    addLog,
    streamBrain,
    triggerAlexa,
    availableVoices,
    selectedVoiceURI,
  ]);

  /* ── Speech recognition setup ── */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR =
      (
        window as unknown as {
          SpeechRecognition?: SpeechRecognitionConstructor;
          webkitSpeechRecognition?: SpeechRecognitionConstructor;
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          SpeechRecognition?: SpeechRecognitionConstructor;
          webkitSpeechRecognition?: SpeechRecognitionConstructor;
        }
      ).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = false;
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.onstart = () => setIsListening(true);
    rec.onend = () => {
      setIsListening(false);
      if (continuousMode && recognitionRef.current && !isSpeaking.current) {
        try {
          recognitionRef.current.start();
        } catch {
          /* ignore restart failures */
        }
      }
    };
    rec.onerror = (event: Event) => {
      const err = (event as SpeechRecognitionErrorEvent).error;
      setIsListening(false);
      if (err === "not-allowed") {
        setMicPermission("denied");
        addLog({
          type: "error",
          text: "Microphone access denied. Check browser permissions.",
        });
      }
    };
    rec.onresult = (event: SpeechRecognitionEvent) => {
      const results = event.results;
      if (!results.length) return;
      const transcript = results[results.length - 1][0].transcript.trim();
      setInput(transcript);
      if (results[results.length - 1].isFinal) {
        if (wakeWordEnabled) {
          const lower = transcript.toLowerCase();
          if (lower.startsWith("hey jarvis") || lower.startsWith("jarvis")) {
            const cmd = transcript
              .replace(/^(hey\s+)?jarvis[,\s]*/i, "")
              .trim();
            setInput(cmd);
            if (cmd) {
              setTimeout(() => sendMessage(), 200);
            } else {
              addLog({
                type: "system",
                text: "Wake word detected. Awaiting command.",
              });
            }
          }
        } else {
          setTimeout(() => sendMessage(), 200);
        }
      }
    };
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    };
  }, [sendMessage, wakeWordEnabled, continuousMode, addLog]);

  const startMic = async () => {
    if (!recognitionRef.current) {
      addLog({
        type: "error",
        text: "Voice API not supported in this browser.",
      });
      return;
    }
    /* Pre-flight: try to getUserMedia so the browser shows the permission prompt */
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission("granted");
    } catch {
      setMicPermission("denied");
      addLog({
        type: "error",
        text: "Microphone permission denied. Enable it in browser settings.",
      });
      return;
    }
    try {
      recognitionRef.current.start();
    } catch {
      addLog({ type: "error", text: "Mic already active or denied." });
    }
  };

  const stopMic = () => {
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* ignore */
      }
    }
  };

  const toggleMic = () => {
    if (isListening) stopMic();
    else startMic();
  };

  const handleMicPointerDown = () => {
    if (pushTimerRef.current) window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = window.setTimeout(() => startMic(), 150);
  };

  const handleMicPointerUp = () => {
    if (pushTimerRef.current) {
      window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }
    if (isListening) stopMic();
  };

  const toggleCamera = async () => {
    if (cameraOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current = null;
      setCameraOn(false);
      addLog({ type: "system", text: "Camera feed terminated." });
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraOn(true);
        addLog({
          type: "success",
          text: "Visual sensors online. Ready for scan/analysis.",
        });
      } catch {
        addLog({ type: "error", text: "Camera access denied or unavailable." });
      }
    }
  };

  const agentList = Object.values(REAL_AGENTS);
  const onlineCount = agentList.filter((a) => a.status === "online").length;
  return (
    <div
      className={`relative flex flex-col h-full gap-2 overflow-hidden ${flicker ? "brightness-125" : ""} transition-all duration-75`}
    >
      <MatrixRain />
      <Particles />
      <div
        className="pointer-events-none absolute inset-0 z-20"
        style={{
          background:
            "linear-gradient(rgba(18,16,16,0) 50%, rgba(0,0,0,0.25) 50%), linear-gradient(90deg, rgba(255,0,0,0.04), rgba(0,255,0,0.01), rgba(0,0,255,0.04))",
          backgroundSize: "100% 2px, 3px 100%",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.5) 100%)",
        }}
      />

      {/* Status bar */}
      <div
        className="relative z-30 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 rounded-lg border backdrop-blur-md"
        style={{
          backgroundColor: "rgba(0,0,0,0.4)",
          borderColor: `${T.accentColor}30`,
          boxShadow: `0 0 15px ${T.accentColor}10`,
        }}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <Terminal
            size={16}
            className="text-[#00ff9d] drop-shadow-[0_0_6px_#00ff9d]"
          />
          <span className="text-xs font-mono uppercase tracking-[0.2em] font-bold text-white">
            JARVIS<span className="text-[#00ff9d]">.MAD</span>
          </span>
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{
              backgroundColor: T.success,
              boxShadow: `0 0 8px ${T.success}`,
            }}
          />
          <span
            className="hidden sm:inline text-[10px] font-mono uppercase"
            style={{ color: T.success }}
          >
            NEURAL LINK ACTIVE
          </span>
        </div>
        <div className="flex items-center gap-3 sm:gap-5 text-[10px] font-mono">
          <AudioBars />
          <div className="hidden sm:flex items-center gap-1.5">
            <span className="opacity-40">CPU</span>
            <span className="font-bold text-white drop-shadow-[0_0_4px_rgba(0,255,157,0.5)]">
              {stats.cpu.toFixed(0)}%
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
            <span className="opacity-40">MEM</span>
            <span className="font-bold text-white">
              {stats.mem.toFixed(1)} GB
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Bot size={10} className="text-[#00b8ff]" />
            <span className="font-bold text-[#00b8ff] drop-shadow-[0_0_4px_rgba(0,184,255,0.5)]">
              {onlineCount} ACTIVE
            </span>
          </div>
          <button
            onClick={() => setTtsEnabled((v) => !v)}
            className="transition-opacity hover:opacity-100"
            style={{ opacity: ttsEnabled ? 1 : 0.4 }}
            title={ttsEnabled ? "Mute voice" : "Enable voice"}
          >
            {ttsEnabled ? (
              <Volume2 size={12} className="text-[#00ff9d]" />
            ) : (
              <VolumeX size={12} className="text-gray-500" />
            )}
          </button>
          {/* Voice picker */}
          <div ref={voicePickerRef} className="relative">
            <button
              onClick={() => setShowVoicePicker((v) => !v)}
              className="flex items-center gap-0.5 transition-opacity hover:opacity-100"
              style={{ opacity: 0.7 }}
              title="Select voice"
            >
              <Speaker size={12} className="text-[#00b8ff]" />
              <ChevronDown size={10} className="text-white/40" />
            </button>
            {showVoicePicker &&
              availableVoices.length > 0 &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  className="fixed rounded-lg border border-white/10 overflow-hidden shadow-xl z-50 min-w-[220px] max-h-[240px] overflow-y-auto"
                  style={{
                    backgroundColor: "rgba(10,15,20,0.95)",
                    backdropFilter: "blur(12px)",
                    ...voicePickerStyle,
                  }}
                >
                  <div className="px-2 py-1.5 text-[10px] font-mono uppercase text-white/30 border-b border-white/5">
                    Voices
                  </div>
                  {availableVoices
                    .filter((v) => v.lang.startsWith("en"))
                    .map((voice) => (
                      <button
                        key={voice.voiceURI}
                        onClick={() => {
                          setSelectedVoiceURI(voice.voiceURI);
                          setShowVoicePicker(false);
                          addLog({
                            type: "success",
                            text: `Voice set to: ${voice.name}`,
                          });
                          /* Preview voice */
                          const u = new SpeechSynthesisUtterance(
                            "Voice activated.",
                          );
                          u.voice = voice;
                          u.rate = 1.15;
                          u.pitch = 0.85;
                          window.speechSynthesis.speak(u);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 text-[10px] font-mono transition-colors hover:bg-white/5 ${voice.voiceURI === selectedVoiceURI ? "text-[#00ff9d] bg-[#00ff9d]/5" : "text-white/70"}`}
                      >
                        {voice.name}
                      </button>
                    ))}
                </div>,
                document.body,
              )}
          </div>
          {/* Alexa output toggle */}
          <button
            onClick={() => {
              setAlexaOutEnabled((v) => {
                const next = !v;
                addLog({
                  type: "success",
                  text: `Alexa speaker output ${next ? "ENABLED" : "DISABLED"}.`,
                });
                return next;
              });
            }}
            className="transition-opacity hover:opacity-100"
            style={{ opacity: alexaOutEnabled ? 1 : 0.4 }}
            title={alexaOutEnabled ? "Alexa output ON" : "Alexa output OFF"}
          >
            <span
              className={`text-[10px] font-mono font-bold ${alexaOutEnabled ? "text-[#00b8ff]" : "text-gray-500"}`}
            >
              ALEXA
            </span>
          </button>
          {/* Mobile agent toggle */}
          <button
            onClick={() => setShowAgents((v) => !v)}
            className="md:hidden p-1 rounded transition-all"
            style={{
              opacity: showAgents ? 1 : 0.5,
              color: showAgents ? "#00ff9d" : "#fff",
            }}
            title="Toggle agent panel"
          >
            <Bot size={14} />
          </button>
        </div>
      </div>

      {/* Main workspace */}
      <div className="relative z-30 flex-1 flex flex-col md:flex-row gap-3 min-h-0">
        {/* Terminal column */}
        <div className="flex-1 flex flex-col min-w-0 gap-3 order-1">
          <div
            ref={terminalRef}
            className="relative scanlines flex-1 rounded-lg border p-4 overflow-y-auto font-mono text-[12px] space-y-1.5 min-h-0 group"
            style={{
              backgroundColor: "rgba(10,15,20,0.7)",
              borderColor: `${T.accentColor}20`,
              boxShadow: `inset 0 0 30px ${T.accentColor}05, 0 0 20px ${T.accentColor}05`,
              backdropFilter: "blur(8px)",
            }}
          >
            <div
              className="absolute inset-0 rounded-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                boxShadow: `inset 0 0 20px ${T.accentColor}08, 0 0 30px ${T.accentColor}08`,
              }}
            />
            <div className="absolute top-3 right-3 text-[10px] text-[#00ff9d]/30 select-none tracking-widest font-bold">
              LOG_STREAM_V.3.0-MAD
            </div>
            {logs.map((log) => (
              <div key={log.id} className="wrap-break-word leading-relaxed">
                <span className="opacity-30 mr-1.5 text-[10px]">
                  [{log.timestamp}]
                </span>
                {log.type === "user" && (
                  <span className="font-bold text-white">
                    <span className="text-[#00ff9d] drop-shadow-[0_0_4px_#00ff9d]">
                      &gt;&gt;
                    </span>{" "}
                    {log.text}
                  </span>
                )}
                {log.type === "agent" && (
                  <>
                    <span className="font-bold mr-1 text-[#00b8ff] drop-shadow-[0_0_4px_rgba(0,184,255,0.5)]">
                      [{log.agentName}]
                    </span>
                    <span className="text-gray-300">{log.text}</span>
                  </>
                )}
                {log.type === "brain" && (
                  <>
                    <span className="font-bold mr-1 text-[#ff66cc] drop-shadow-[0_0_4px_rgba(255,102,204,0.5)]">
                      [JARVIS]
                    </span>
                    <span className="text-gray-200">{log.text}</span>
                  </>
                )}
                {log.type === "system" && (
                  <span className="text-gray-400">
                    <span className="opacity-50 text-[#ff66cc]">[SYS]</span>{" "}
                    {log.text}
                  </span>
                )}
                {log.type === "success" && (
                  <span className="text-[#00ff9d] drop-shadow-[0_0_4px_rgba(0,255,157,0.3)]">
                    <span className="opacity-70">[OK]</span> {log.text}
                  </span>
                )}
                {log.type === "error" && (
                  <span className="text-[#ff0055]">
                    <span className="opacity-70">[ERR]</span> {log.text}
                  </span>
                )}
              </div>
            ))}
            {isBrainStreaming && (
              <div className="text-[#ff66cc] wrap-break-word leading-relaxed">
                <span className="opacity-30 mr-1.5 text-[10px]">
                  [{getTimestamp()}]
                </span>
                <span className="font-bold mr-1 text-[#ff66cc]">[JARVIS]</span>
                <span className="text-gray-200">{brainText}</span>
                <span className="inline-block w-1.5 h-4 bg-[#ff66cc] ml-0.5 animate-pulse" />
              </div>
            )}
            {isProcessing && !isBrainStreaming && (
              <div className="flex items-center gap-2 animate-pulse text-gray-400">
                <Activity size={12} className="animate-spin" />
                <span>Processing request...</span>
              </div>
            )}
          </div>

          {/* Command hint pills */}
          <div className="flex flex-wrap gap-1.5 text-[10px] font-mono select-none">
            {[
              "/scan",
              "/status",
              "/image",
              "/code",
              "/agent",
              "/voice",
              "/alexa",
              "/clear",
            ].map((cmd) => (
              <button
                key={cmd}
                onClick={() => {
                  setInput(cmd);
                }}
                className="px-2 py-0.5 rounded border border-[#00ff9d]/20 text-[#00ff9d]/60 hover:text-[#00ff9d] hover:border-[#00ff9d]/50 hover:bg-[#00ff9d]/5 transition-all"
              >
                {cmd}
              </button>
            ))}
          </div>

          {/* Mobile listening indicator bar */}
          {isListening && (
            <div className="md:hidden w-full h-1 rounded-full overflow-hidden bg-white/5">
              <div
                className="h-full bg-[#ff0055] animate-pulse rounded-full"
                style={{
                  boxShadow: "0 0 8px #ff0055",
                  width: "100%",
                }}
              />
            </div>
          )}

          {/* Voice mode toggles */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
            <button
              onClick={() => {
                setContinuousMode((v) => {
                  const next = !v;
                  addLog({
                    type: "success",
                    text: `Continuous conversation ${next ? "ENABLED" : "DISABLED"}.`,
                  });
                  return next;
                });
              }}
              className={`px-2 py-0.5 rounded border transition-all ${continuousMode ? "border-[#00ff9d]/40 text-[#00ff9d] bg-[#00ff9d]/5" : "border-white/10 text-white/40 hover:text-white/60"}`}
            >
              {continuousMode ? "●" : "○"} Continuous
            </button>
            <button
              onClick={() => {
                setWakeWordEnabled((v) => {
                  const next = !v;
                  addLog({
                    type: "success",
                    text: `Wake word ${next ? "ENABLED" : "DISABLED"} — say "Hey JARVIS".`,
                  });
                  return next;
                });
              }}
              className={`px-2 py-0.5 rounded border transition-all ${wakeWordEnabled ? "border-[#00ff9d]/40 text-[#00ff9d] bg-[#00ff9d]/5" : "border-white/10 text-white/40 hover:text-white/60"}`}
            >
              {wakeWordEnabled ? "●" : "○"} Wake Word
            </button>
            {isListening && (
              <span className="text-[#ff0055] animate-pulse font-bold">
                LISTENING...
              </span>
            )}
          </div>

          {/* Mic permission warning */}
          {micPermission === "denied" && (
            <div className="text-[10px] font-mono text-[#ff0055] bg-[#ff0055]/5 border border-[#ff0055]/20 rounded px-2.5 py-1.5">
              Microphone blocked. Enable it in your browser settings and reload.
            </div>
          )}

          {/* Input row */}
          <div
            className="flex items-center gap-2 rounded-lg border p-2 backdrop-blur-md relative z-30"
            style={{
              backgroundColor: "rgba(0,0,0,0.4)",
              borderColor: `${T.accentColor}25`,
              boxShadow: `0 0 12px ${T.accentColor}08`,
            }}
          >
            <span className="text-[#00ff9d] font-mono text-sm shrink-0 pl-1 select-none">
              &gt;&gt;
            </span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMessage();
              }}
              placeholder="Command JARVIS... (try /scan, /help)"
              className="flex-1 bg-transparent border-none outline-none text-white text-sm font-mono placeholder:text-white/20 min-w-0"
            />
            <button
              onClick={toggleMic}
              onMouseDown={handleMicPointerDown}
              onMouseUp={handleMicPointerUp}
              onMouseLeave={handleMicPointerUp}
              onTouchStart={(e) => {
                e.preventDefault();
                handleMicPointerDown();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                handleMicPointerUp();
              }}
              className={`p-3 sm:p-2.5 rounded-md transition-all select-none touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center ${isListening ? "bg-[#ff0055]/20 text-[#ff0055] ring-2 ring-[#ff0055]/30" : "text-white/40 hover:text-[#00ff9d] hover:bg-white/5"}`}
              style={{
                WebkitTapHighlightColor: "transparent",
              }}
              title={isListening ? "Stop listening" : "Push & hold to talk"}
              aria-label={
                isListening ? "Stop listening" : "Push and hold to talk"
              }
            >
              {isListening ? <StopCircle size={20} /> : <Mic size={20} />}
            </button>
            <button
              onClick={toggleCamera}
              className={`p-3 sm:p-2.5 rounded-md transition-all min-w-[44px] min-h-[44px] flex items-center justify-center ${cameraOn ? "bg-[#00b8ff]/20 text-[#00b8ff]" : "text-white/40 hover:text-[#00ff9d] hover:bg-white/5"}`}
              aria-label="Toggle camera"
            >
              <Camera size={20} />
            </button>
            <button
              onClick={sendMessage}
              disabled={isProcessing}
              className="p-3 sm:p-2.5 rounded-md bg-[#00ff9d]/10 text-[#00ff9d] hover:bg-[#00ff9d]/20 transition-all disabled:opacity-30 min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Send message"
            >
              <Send size={20} />
            </button>
          </div>
        </div>

        {/* Right panel: Agent cards + Camera */}
        <div
          className={`flex flex-col gap-3 shrink-0 md:w-64 ${showAgents ? "flex" : "hidden md:flex"}`}
        >
          {/* Camera feed */}
          <div
            className="relative rounded-lg border overflow-hidden h-40 shrink-0 group"
            style={{
              borderColor: `${T.accentColor}25`,
              boxShadow: `0 0 15px ${T.accentColor}05`,
            }}
          >
            {cameraOn ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-[#ff0055]/80 text-white text-[10px] font-bold font-mono uppercase animate-pulse">
                  Live Feed
                </div>
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#00ff9d]/50" />
                  <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#00ff9d]/50" />
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#00ff9d]/50" />
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#00ff9d]/50" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 border border-[#ff0055]/40 rounded-full" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-[#ff0055] rounded-full" />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/20 font-mono text-[10px]">
                <div className="text-center space-y-1">
                  <Camera size={24} className="mx-auto opacity-30" />
                  <div>CAMERA OFFLINE</div>
                  <div className="text-white/10 text-[9px]">
                    Click camera button to activate
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Agent cards */}
          <div
            className="flex-1 rounded-lg border p-3 overflow-y-auto space-y-2 backdrop-blur-md"
            style={{
              backgroundColor: "rgba(0,0,0,0.35)",
              borderColor: `${T.accentColor}20`,
              boxShadow: `inset 0 0 20px ${T.accentColor}05`,
            }}
          >
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-1">
              Agent Cluster
            </div>
            {Object.entries(REAL_AGENTS).map(([slug, agent]) => (
              <button
                key={agent.id}
                onClick={() => {
                  setSelectedAgent(slug);
                  addLog({
                    type: "system",
                    text: `Selected agent: ${agent.name}`,
                  });
                }}
                className={`w-full text-left rounded-md border px-2.5 py-2 transition-all group hover:scale-[1.02] ${selectedAgent === slug ? "border-[#00ff9d]/40 bg-[#00ff9d]/5" : "border-white/5 hover:border-white/15"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white group-hover:text-[#00ff9d] transition-colors">
                    {agent.name}
                  </span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${agent.status === "online" ? "bg-[#00ff9d]" : "bg-gray-600"}`}
                    style={{
                      boxShadow:
                        agent.status === "online" ? "0 0 6px #00ff9d" : "none",
                    }}
                  />
                </div>
                <div className="text-[10px] text-white/40 font-mono mt-0.5">
                  {agent.role}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
