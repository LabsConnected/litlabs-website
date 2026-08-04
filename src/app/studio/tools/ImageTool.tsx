"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { CSSProperties } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import {
  Wand2,
  Download,
  RefreshCw,
  Coins,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Sparkles,
  Gift,
  Terminal,
  Layers,
  Plus,
  X,
  Trash2,
  Zap,
  Upload,
  Palette,
  Layout,
  Flame,
  Paintbrush,
  History,
  Save,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  MoreVertical,
} from "lucide-react";
import { MediaProviderId, ProviderSelection } from "@/lib/media";
import { GENERATION_PRESETS } from "@/lib/visual-packs/generation-presets";
import { DEFAULT_MASCOT_DESCRIPTION } from "@/lib/visual-packs/types";
import GenerationHistoryCard from "../components/GenerationHistoryCard";

/* ─── Types ───────────────────────────────────────────────────────────── */

import { readApiResponse } from "../lib/create-api";

type Workspace = {
  id: string;
  name: string;
  prompt: string;
  negativePrompt: string;
  providerId: ProviderSelection;
  aspectRatio: string;
  imageSize: string;
  seed: number;
};

type RemixMode = "reskin" | "style" | "composition" | "mood";

type LogEntry = {
  id: string;
  time: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
};

type GenerationStatus =
  | "idle"
  | "submitting"
  | "polling"
  | "forging"
  | "succeeded"
  | "failed"
  | "saving";

type Generation = {
  id: string;
  prompt: string;
  negativePrompt: string;
  provider: ProviderSelection;
  fileUrl?: string;
  thumbUrl?: string;
  status: GenerationStatus;
  error?: string;
  createdAt: number;
  cost: number;
};

/* ─── Constants ───────────────────────────────────────────────────────── */

const STORAGE_KEY = "litlabs-generate-history";
const MAX_HISTORY = 20;

const PROMPT_PRESETS = [
  "A neon-lit cyberpunk city at midnight, rain-slicked streets reflecting holographic billboards, flying cars streaking through fog",
  "Ethereal floating islands with waterfalls cascading into the void, golden hour, Studio Ghibli inspired",
  "Ancient temple ruins reclaimed by bioluminescent jungle, fireflies, mist, mystical atmosphere",
  "Crystal cavern with underground lake, light refracting through quartz, peaceful and majestic",
  "A lone astronaut standing on Mars, Earth rising in the distance, ultra-realistic, cinematic lighting",
  "Massive space station orbiting a purple gas giant, fleets of ships, epic scale, sci-fi concept art",
  "Abandoned arcade with broken neon signs, dust motes in volumetric light, retro 80s aesthetic",
  "Underwater coral city with merfolk and bio-luminescent architecture, dreamlike and serene",
];

const REMIX_MODES: {
  id: RemixMode;
  label: string;
  icon: typeof Palette;
  desc: string;
}[] = [
  {
    id: "reskin",
    label: "Reskin",
    icon: Palette,
    desc: "Keep composition, change look",
  },
  {
    id: "style",
    label: "Style",
    icon: Paintbrush,
    desc: "Pull artistic style from ref",
  },
  {
    id: "composition",
    label: "Layout",
    icon: Layout,
    desc: "Keep structure, swap content",
  },
  {
    id: "mood",
    label: "Mood",
    icon: Flame,
    desc: "Transfer atmosphere & feeling",
  },
];

/* ─── Enhanced Style Presets ─────────────────────────────────────────────── */

const STYLE_PRESETS = [
  "Cyberpunk neon noir",
  "Oil painting Renaissance",
  "Japanese ukiyo-e",
  "Synthwave 80s",
  "Dark fantasy gothic",
  "Minimal clean vector",
  "Photorealistic",
  "Watercolor impressionist",
  "Pixel art 16-bit",
  "Comic halftone",
  "Art nouveau",
  "Charcoal sketch",
  "3D Render octane",
  "Cinematic film",
  "Anime studio ghibli",
  "Vaporwave aesthetic",
  "Steampunk industrial",
  "Bioluminescent ethereal",
  "Low poly geometric",
  "Double exposure artistic",
];

const LIGHTING_PRESETS = [
  "Golden hour warm",
  "Blue hour twilight",
  "Dramatic chiaroscuro",
  "Soft diffused studio",
  "Neon rim lighting",
  "Volumetric god rays",
  "Cinematic three-point",
  "High key bright",
  "Low key moody",
  "Backlit silhouette",
  "Overcast soft",
  "Strobe frozen action",
];

const MOOD_PRESETS = [
  "Epic grandiose",
  "Mysterious enigmatic",
  "Serene peaceful",
  "Melancholic somber",
  "Whimsical playful",
  "Tense dramatic",
  "Nostalgic dreamy",
  "Futuristic sleek",
  "Rustic cozy",
  "Eerie unsettling",
  "Romantic soft",
  "Chaotic energetic",
];

const CAMERA_PRESETS = [
  "Close-up macro",
  "Medium portrait",
  "Wide establishing",
  "Extreme wide aerial",
  "Low angle heroic",
  "High angle俯视",
  "Dutch tilt dynamic",
  "Overhead flat lay",
  "Bird's eye drone",
  "Worm's eye worm",
  "First person POV",
  "Telephoto compressed",
  "Fisheye distorted",
];

const QUALITY_TAGS = [
  "masterpiece best quality",
  "highly detailed intricate",
  "8k uhd sharp focus",
  "professional photography",
  "trending on artstation",
  "award winning",
];

const SAMPLER_OPTIONS = [
  { id: "euler", label: "Euler", desc: "Fast, good quality" },
  { id: "euler_a", label: "Euler a", desc: "Ancestral, creative" },
  { id: "dpmpp_2m", label: "DPM++ 2M", desc: "High quality default" },
  { id: "dpmpp_2m_karras", label: "DPM++ 2M Karras", desc: "Smooth, detailed" },
  { id: "dpmpp_sde", label: "DPM++ SDE", desc: "Stochastic, varied" },
  { id: "ddim", label: "DDIM", desc: "Deterministic, few steps" },
  { id: "lms", label: "LMS", desc: "Linear, stable" },
  { id: "heun", label: "Heun", desc: "Accurate, slower" },
  { id: "uni_pc", label: "UniPC", desc: "Fast convergence" },
];

const QUALITY_PRESETS = [
  { id: "fast", label: "Fast", steps: 20, cfg: 5, desc: "Quick drafts" },
  {
    id: "balanced",
    label: "Balanced",
    steps: 30,
    cfg: 7,
    desc: "Good default",
  },
  {
    id: "quality",
    label: "Quality",
    steps: 50,
    cfg: 7.5,
    desc: "Best results",
  },
  { id: "extreme", label: "Extreme", steps: 80, cfg: 8, desc: "Max detail" },
];

const ASPECT_OPTIONS = [
  { label: "1:1", value: "1:1" as const, width: 1024, height: 1024, icon: "▪" },
  {
    label: "16:9",
    value: "16:9" as const,
    width: 1344,
    height: 768,
    icon: "▬",
  },
  {
    label: "9:16",
    value: "9:16" as const,
    width: 768,
    height: 1344,
    icon: "▮",
  },
  { label: "4:3", value: "4:3" as const, width: 1024, height: 768, icon: "▭" },
  { label: "3:4", value: "3:4" as const, width: 768, height: 1024, icon: "▯" },
];

const PROVIDER_OPTIONS = [
  {
    id: "auto-free" as const,
    label: "Auto Best (Free)",
    tag: "AUTO",
    desc: "Cloudflare → Alibaba → Pollinations",
    cost: 0,
    ready: true,
  },
  {
    id: "auto-quality" as const,
    label: "Auto Best (Quality)",
    tag: "AUTO",
    desc: "Gemini → FAL → Recraft",
    cost: 1,
    ready: true,
  },
  {
    id: "cloudflare" as const,
    label: "Cloudflare",
    tag: "FREE",
    desc: "FLUX schnell · Workers AI",
    cost: 0,
    ready: false, // will be set dynamically from /api/media/providers/status
  },
  {
    id: "alibaba" as const,
    label: "Alibaba Qwen",
    tag: "Qwen",
    desc: "Qwen Image 2.0 · Model Studio",
    cost: 1,
    ready: false,
  },
  {
    id: "pollinations" as const,
    label: "Pollinations",
    tag: "FREE",
    desc: "FLUX · No key needed",
    cost: 0,
    ready: true,
  },
  {
    id: "gemini" as const,
    label: "Gemini",
    tag: "Flash Image",
    desc: "GEMINI_API_KEY",
    cost: 1,
    ready: false,
  },
  {
    id: "together" as const,
    label: "Together.ai",
    tag: "FLUX.1",
    desc: "TOGETHER_API_KEY",
    cost: 2,
    ready: false,
  },
  {
    id: "fal" as const,
    label: "FAL.ai",
    tag: "Pro",
    desc: "FAL_KEY",
    cost: 3,
    ready: false,
  },
  {
    id: "openai" as const,
    label: "DALL-E 3",
    tag: "OpenAI",
    desc: "OPENAI_API_KEY",
    cost: 5,
    ready: false,
  },
  {
    id: "recraft" as const,
    label: "Recraft",
    tag: "Vector",
    desc: "RECRAFT_API_KEY",
    cost: 3,
    ready: false,
  },
];

/* ─── Component ───────────────────────────────────────────────────────── */

export default function ImageTool() {
  const { resolvedColors: T } = useTheme();

  /* ── Prompt state ── */
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [remixMode, setRemixMode] = useState<RemixMode>("reskin");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Provider / format state ── */
  const [providerId, setProviderId] = useState<ProviderSelection>("auto-free");
  const [aspectRatio, setAspectRatio] = useState<
    "1:1" | "4:3" | "3:4" | "16:9" | "9:16"
  >("1:1");
  const [imageSize, setImageSize] = useState<"1K" | "2K">("1K");
  const [seed, setSeed] = useState<number>(0);
  const [batchSize, setBatchSize] = useState<1 | 2 | 4>(1);
  const [negativePromptOpen, setNegativePromptOpen] = useState(false);

  /* ── Advanced generation controls ── */
  const [guidanceScale, setGuidanceScale] = useState<number>(7.5);
  const [inferenceSteps, setInferenceSteps] = useState<number>(30);
  const [sampler, setSampler] = useState<string>("dpmpp_2m");
  const [strength, setStrength] = useState<number>(0.75);
  const [seedLocked, setSeedLocked] = useState<boolean>(false);
  const [qualityPreset, setQualityPreset] = useState<string>("balanced");

  /* ── Gallery save options ── */
  const [gallerySharePublic, setGallerySharePublic] = useState<boolean>(true);
  const [galleryCategory, setGalleryCategory] = useState<string>("abstract");

  /* ── Style enhancers ── */
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [selectedLighting, setSelectedLighting] = useState<string | null>(null);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [selectedQualityTag, setSelectedQualityTag] = useState<string | null>(
    "masterpiece best quality",
  );
  const [autoEnhance, setAutoEnhance] = useState<boolean>(true);

  /* ── Brand lock ── */
  const [brandLockEnabled, setBrandLockEnabled] = useState<boolean>(false);

  const currentAspect = ASPECT_OPTIONS.find((a) => a.value === aspectRatio)!;
  const currentProvider =
    PROVIDER_OPTIONS.find((p) => p.id === providerId) || PROVIDER_OPTIONS[0];
  const providerCost = currentProvider.cost;

  /* ── Dynamic provider status (fetched from server) ── */
  const [providerStatus, setProviderStatus] = useState<
    Record<string, { configured: boolean; model?: string }>
  >({});

  useEffect(() => {
    let cancelled = false;
    async function fetchStatus() {
      try {
        const res = await fetch("/api/media/providers/status", {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const map: Record<string, { configured: boolean; model?: string }> = {};
        for (const p of data.providers ?? []) {
          map[p.id] = { configured: p.configured, model: p.model };
        }
        setProviderStatus(map);
      } catch {
        // non-fatal — providers stay at their default ready state
      }
    }
    fetchStatus();
    return () => { cancelled = true; };
  }, []);

  // Helper: check if a provider is ready (dynamic status overrides hardcoded)
  const isProviderReady = useCallback(
    (id: string): boolean => {
      if (id === "auto-free" || id === "auto-quality") return true;
      if (id in providerStatus) return providerStatus[id].configured;
      return PROVIDER_OPTIONS.find((p) => p.id === id)?.ready ?? false;
    },
    [providerStatus],
  );

  /* ── Generation state ── */
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [imgError, setImgError] = useState<string | null>(null);

  /* ── UI state ── */
  // Use shared WalletContext rather than localStorage or ad-hoc fetches
  const { balance: coinBalance, refresh: refreshWallet } = useWallet();
  const [claiming, setClaiming] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"prompt" | "style" | "settings">(
    "prompt",
  );
  const [historyOpen, setHistoryOpen] = useState(true);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);

  /* ── Resizable panel widths ── */
  const [leftWidth, setLeftWidth] = useState(() => {
    if (typeof window === "undefined") return 288;
    try {
      const v = Number(localStorage.getItem("litlabs-studio-left-width"));
      return Number.isFinite(v) ? Math.max(200, Math.min(400, v)) : 288;
    } catch {
      return 288;
    }
  });
  const [rightWidth, setRightWidth] = useState(() => {
    if (typeof window === "undefined") return 208;
    try {
      const v = Number(localStorage.getItem("litlabs-studio-right-width"));
      return Number.isFinite(v) ? Math.max(160, Math.min(320, v)) : 208;
    } catch {
      return 208;
    }
  });
  const leftWRef = useRef(leftWidth);
  const rightWRef = useRef(rightWidth);
  useEffect(() => {
    leftWRef.current = leftWidth;
  }, [leftWidth]);
  useEffect(() => {
    rightWRef.current = rightWidth;
  }, [rightWidth]);
  const [draggingSide, setDraggingSide] = useState<"left" | "right" | null>(
    null,
  );
  const dragRef = useRef<{
    side: "left" | "right" | null;
    startX: number;
    startWidth: number;
  }>({
    side: null,
    startX: 0,
    startWidth: 0,
  });

  /* Persist widths on drag end */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d.side) return;
      if (d.side === "left") {
        const nw = Math.max(
          200,
          Math.min(400, d.startWidth + (e.clientX - d.startX)),
        );
        setLeftWidth(nw);
      } else {
        const nw = Math.max(
          160,
          Math.min(320, d.startWidth + (d.startX - e.clientX)),
        );
        setRightWidth(nw);
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d.side) return;
      try {
        if (d.side === "left") {
          localStorage.setItem(
            "litlabs-studio-left-width",
            String(leftWRef.current),
          );
        } else {
          localStorage.setItem(
            "litlabs-studio-right-width",
            String(rightWRef.current),
          );
        }
      } catch {
        /* ignore */
      }
      dragRef.current = { side: null, startX: 0, startWidth: 0 };
      setDraggingSide(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  /* ── Workspaces ── */
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
    const defaultWs: Workspace = {
      id: "ws_default",
      name: "Default",
      prompt: "",
      negativePrompt: "",
      providerId: "pollinations",
      aspectRatio: "1:1",
      imageSize: "1K",
      seed: 0,
    };
    if (typeof window === "undefined") return [defaultWs];
    try {
      const raw = localStorage.getItem("litlabs-workspaces");
      const p = raw ? JSON.parse(raw) : [];
      return p.length ? p : [defaultWs];
    } catch {
      return [defaultWs];
    }
  });
  const [activeWsId, setActiveWsId] = useState(() => {
    if (typeof window === "undefined") return "ws_default";
    try {
      const raw = localStorage.getItem("litlabs-workspaces");
      const p = raw ? JSON.parse(raw) : [];
      return p.length ? p[0].id : "ws_default";
    } catch {
      return "ws_default";
    }
  });
  const [editingWsName, setEditingWsName] = useState<string | null>(null);
  const [wsNameInput, setWsNameInput] = useState("");

  const promptValid = prompt.trim().length >= 3;
  const canAfford =
    coinBalance === null || coinBalance >= providerCost * batchSize;
  const isWorking =
    status === "submitting" || status === "polling" || status === "forging";

  /* ─── Effects ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    try {
      if (history.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(history.slice(0, MAX_HISTORY)),
      );
    } catch {
      // Storage unavailable — history remains in memory.
    }
  }, [history]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("litlabs:image:draft");
      if (!raw) return;
      const draft = JSON.parse(raw) as { prompt?: string; aspectRatio?: string; style?: string; referenceImage?: string | null };
      if (draft.prompt) setPrompt(draft.prompt);
      if (["1:1", "4:3", "3:4", "16:9", "9:16"].includes(draft.aspectRatio || "")) setAspectRatio(draft.aspectRatio as typeof aspectRatio);
      if (draft.style && draft.style !== "None" && draft.style !== "LiTLabs brand") setSelectedStyle(draft.style);
      if (draft.style === "LiTLabs brand") setSelectedStyle("Cyberpunk neon noir");
      if (draft.referenceImage) setReferenceImage(draft.referenceImage);
      sessionStorage.removeItem("litlabs:image:draft");
    } catch { /* ignore invalid drafts */ }
  }, []);

  // No longer fetch directly here; rely on WalletContext which already fetches /api/wallet and refreshes periodically.
  useEffect(() => {
    // Make sure WalletContext has refreshed at least once
    refreshWallet().catch(() => {});
  }, [refreshWallet]);

  /* Close mobile drawers on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileRightOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("litlabs-workspaces", JSON.stringify(workspaces));
    } catch {
      /* ignore */
    }
  }, [workspaces]);

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === activeWsId
            ? {
                ...w,
                prompt,
                negativePrompt,
                providerId,
                aspectRatio,
                imageSize,
                seed,
              }
            : w,
        ),
      ),
    );
    return () => cancelAnimationFrame(id);
  }, [
    prompt,
    negativePrompt,
    providerId,
    aspectRatio,
    imageSize,
    seed,
    activeWsId,
  ]);

  /* ─── Callbacks ───────────────────────────────────────────────────────── */

  const addLog = useCallback((level: LogEntry["level"], message: string) => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    setLogs((prev) =>
      [
        { id: `log_${Date.now()}_${Math.random()}`, time, level, message },
        ...prev,
      ].slice(0, 100),
    );
  }, []);

  const loadWorkspace = useCallback((ws: Workspace) => {
    setPrompt(ws.prompt);
    setNegativePrompt(ws.negativePrompt);
    setProviderId(ws.providerId);
    setAspectRatio(ws.aspectRatio as typeof aspectRatio);
    setImageSize(ws.imageSize as typeof imageSize);
    setSeed(ws.seed);
  }, []);

  const createWorkspace = useCallback(() => {
    const id = `ws_${Date.now()}`;
    const name = `Scene ${workspaces.length + 1}`;
    const newWs: Workspace = {
      id,
      name,
      prompt,
      negativePrompt,
      providerId,
      aspectRatio,
      imageSize,
      seed,
    };
    setWorkspaces((prev) => [...prev, newWs]);
    setActiveWsId(id);
    addLog("info", `Created workspace "${name}"`);
  }, [
    workspaces,
    prompt,
    negativePrompt,
    providerId,
    aspectRatio,
    imageSize,
    seed,
    addLog,
  ]);

  const deleteWorkspace = useCallback(
    (id: string) => {
      setWorkspaces((prev) => {
        const next = prev.filter((w) => w.id !== id);
        if (activeWsId === id && next.length > 0) {
          setActiveWsId(next[0].id);
          loadWorkspace(next[0]);
        }
        return next;
      });
    },
    [activeWsId, loadWorkspace],
  );

  const handleUsePrompt = useCallback(
    (p: string) => {
      setPrompt(p);
      setError(null);
      addLog("info", "Prompt loaded from preset");
    },
    [addLog],
  );

  const enhancePrompt = useCallback(() => {
    if (!prompt.trim()) return;
    const suffixes = [
      ", highly detailed, 8k resolution, cinematic lighting",
      ", ultra realistic, professional photography, sharp focus",
      ", digital art, concept art, trending on artstation",
      ", octane render, unreal engine 5, volumetric fog",
    ];
    const pick = suffixes[Math.floor(Math.random() * suffixes.length)];
    setPrompt((prev) => prev + pick);
    addLog("info", "Prompt enhanced");
  }, [prompt, addLog]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setReferenceImage(ev.target?.result as string);
        addLog("info", `Reference loaded: ${file.name}`);
      };
      reader.readAsDataURL(file);
    },
    [addLog],
  );

  const buildFinalPrompt = useCallback(
    (base: string, mode: RemixMode, hasRef: boolean): string => {
      const parts: string[] = [base];

      // Add selected style enhancers if auto-enhance is enabled
      if (autoEnhance) {
        if (selectedStyle) parts.push(selectedStyle);
        if (selectedLighting) parts.push(selectedLighting);
        if (selectedMood) parts.push(selectedMood);
        if (selectedCamera) parts.push(selectedCamera);
        if (selectedQualityTag) parts.push(selectedQualityTag);
      }

      const result = parts.join(", ");

      // Add remix prefix if reference image exists
      if (!hasRef) return result;

      const prefix: Record<RemixMode, string> = {
        reskin:
          "Reimagine this scene with a completely new look — different colors, textures, style — but keep the same composition",
        style:
          "Apply the artistic style and visual aesthetic from the reference to this new scene",
        composition:
          "Use the same spatial layout and structure as the reference, but with entirely new subject matter",
        mood: "Capture and transfer the atmosphere, emotional tone, and lighting from the reference to this scene",
      };
      return `${prefix[mode]}. Scene: ${result}`;
    },
    [
      autoEnhance,
      selectedStyle,
      selectedLighting,
      selectedMood,
      selectedCamera,
      selectedQualityTag,
    ],
  );

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
    addLog("info", "History cleared");
  }, [addLog]);

  /**
   * Remove a single generation from history by id.
   * Never touches other generations. If the deleted generation was the
   * currently selected one, the canvas selection is cleared.
   */
  const deleteGeneration = useCallback(
    (generationId: string) => {
      setHistory((previous) =>
        previous.filter((generation) => generation.id !== generationId),
      );
      setCurrentResult((current) =>
        current?.id === generationId ? null : current,
      );
      addLog("info", "Generation removed from history");
    },
    [addLog],
  );

  /**
   * Remove only failed generations from history, leaving successful ones intact.
   */
  const removeFailedGenerations = useCallback(() => {
    setHistory((previous) => previous.filter((g) => g.status !== "failed"));
    addLog("info", "Failed generations removed");
  }, [addLog]);

  /**
   * Clear all history — but only after explicit confirmation.
   */
  const confirmClearAllHistory = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      window.confirm(
        `Delete all ${history.length} generations from local history?`,
      )
    ) {
      handleClearHistory();
    }
  }, [history.length, handleClearHistory]);

  const handleGenerate = useCallback(async () => {
    if (!promptValid) {
      setError("Enter a prompt to generate.");
      return;
    }
    const totalCost = providerCost * batchSize;
    if (!canAfford) {
      setError(`Need ${totalCost} 🪙, have ${coinBalance ?? 0}.`);
      return;
    }

    setError(null);
    setImgError(null);
    setStatus("forging");
    addLog(
      "info",
      `⚡ Forging ${batchSize}× via ${currentProvider.label} · ${remixMode} mode`,
    );

    const finalPrompt = buildFinalPrompt(
      prompt.trim(),
      remixMode,
      !!referenceImage,
    );

    for (let i = 0; i < batchSize; i++) {
      const localId = `gen_${Date.now()}_${i}`;
      const newGen: Generation = {
        id: localId,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        provider: providerId,
        status: "submitting",
        createdAt: Date.now(),
        cost: providerCost,
      };
      setHistory((prev) => [newGen, ...prev].slice(0, MAX_HISTORY));
      if (i === 0) setCurrentResult(newGen);

      try {
        addLog("info", `[${i + 1}/${batchSize}] Dispatching...`);

        // Generate random seed if not locked
        const effectiveSeed = seedLocked
          ? seed
          : (seed || Math.floor(Math.random() * 2147483647)) + i;

        const body: Record<string, unknown> = {
          prompt: finalPrompt,
          negativePrompt: negativePrompt.trim(),
          seed: effectiveSeed,
          format: "image",
          width: currentAspect.width,
          height: currentAspect.height,
          aspectRatio: currentAspect.value,
          imageSize: providerId === "gemini" ? imageSize : undefined,
          // Advanced parameters
          guidanceScale,
          inferenceSteps,
          sampler,
        };

        // Handle auto modes vs manual provider selection
        if (providerId === "auto-free" || providerId === "auto-quality") {
          body.generationMode = providerId;
        } else {
          body.providerId = providerId;
        }

        if (referenceImage) {
          body.referenceUrl = referenceImage;
          body.strength = strength;
        }

        const res = await fetch("/api/media/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
          body: JSON.stringify(body),
        });
        const data = await readApiResponse(res, "Image");
        const downloadUrl = data.downloadUrl as string;
        const thumbUrl = data.thumbUrl as string | undefined;
        const isFree = data.free === true;
        const dataCost = typeof data.cost === "number" ? data.cost : 0;

        setHistory((prev) =>
          prev.map((g) =>
            g.id === localId
              ? {
                  ...g,
                  status: "succeeded",
                  fileUrl: downloadUrl,
                  thumbUrl,
                }
              : g,
          ),
        );
        if (i === 0)
          setCurrentResult((prev) =>
            prev?.id === localId
              ? {
                  ...prev,
                  status: "succeeded",
                  fileUrl: downloadUrl,
                  thumbUrl,
                }
              : prev,
          );

        addLog(
          "success",
          `[${i + 1}/${batchSize}] ✓ Done · ${isFree ? "FREE" : dataCost + " 🪙"}`,
        );
        refreshWallet().catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed";
        addLog("error", `[${i + 1}/${batchSize}] ${msg}`);
        setHistory((prev) =>
          prev.map((g) =>
            g.id === localId ? { ...g, status: "failed", error: msg } : g,
          ),
        );
        if (i === 0) {
          setError(msg);
          setCurrentResult((prev) =>
            prev?.id === localId
              ? { ...prev, status: "failed", error: msg }
              : prev,
          );
        }
      }
    }
    setStatus("succeeded");
    addLog("info", `Batch complete`);
  }, [
    prompt,
    negativePrompt,
    remixMode,
    referenceImage,
    providerId,
    seed,
    seedLocked,
    currentAspect,
    imageSize,
    batchSize,
    promptValid,
    canAfford,
    coinBalance,
    providerCost,
    currentProvider,
    buildFinalPrompt,
    addLog,
    guidanceScale,
    inferenceSteps,
    sampler,
    strength,
    refreshWallet,
  ]);

  const handleSaveToGallery = useCallback(
    async (gen: Generation) => {
      if (!gen.fileUrl) return;
      setStatus("saving");
      try {
        const res = await fetch("/api/gallery", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            url: gen.fileUrl,
            caption: gen.prompt.slice(0, 200),
            type: "image",
            isPublic: gallerySharePublic,
            category: galleryCategory,
          }),
        });
        await readApiResponse(res, "Image");
        setStatus("succeeded");
        setError(
          gallerySharePublic
            ? "Saved to Gallery ✓ (Public)"
            : "Saved to Gallery ✓ (Private)",
        );
        setTimeout(() => setError(null), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
        setStatus("succeeded");
      }
    },
    [gallerySharePublic, galleryCategory],
  );

  const handleDownload = useCallback(async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40)}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank");
    }
  }, []);

  const handleClaimBonus = useCallback(async () => {
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "daily" }),
      });
      const data = await res.json();
      if (res.ok && typeof data.balance === "number") {
        // Pull fresh balance from the shared WalletContext instead of
        // mutating local state (the context already reflects the server).
        refreshWallet().catch(() => {});
        setError("Daily bonus claimed! +50 LiTTBits");
        setTimeout(() => setError(null), 3000);
      } else {
        setError(data.error || "Failed to claim");
      }
    } catch {
      setError("Network error");
    } finally {
      setClaiming(false);
    }
  }, [refreshWallet]);

  /* ─── Shared style helpers ─────────────────────────────────────────── */

  const pill = (active: boolean) => ({
    backgroundColor: active ? T.accentColor + "22" : "transparent",
    borderColor: active ? T.accentColor : T.borderColor + "50",
    color: active ? T.accentColor : T.textMuted,
  });

  const sectionBox = {
    backgroundColor: T.boxBg,
    borderColor: T.borderColor + "40",
  };

  /* ─── Render ────────────────────────────────────────────────────────── */

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      {/* ── Top chrome ──────────────────────────────────────────────── */}
      <header
        className="shrink-0 flex items-center justify-between px-4 h-11 gap-3"
        style={{
          borderBottom: `1px solid ${T.borderColor}20`,
          backgroundColor: T.boxBg + "80",
        }}
      >
        {/* Left: title + workspace tabs */}
        <div className="flex items-center gap-3 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 shrink-0">
            <Sparkles size={13} style={{ color: T.accentColor }} />
            <span
              className="text-[11px] font-black uppercase tracking-widest"
              style={{ color: T.headerColor }}
            >
              Image Studio
            </span>
          </div>

          {/* Divider */}
          <span
            className="hidden md:block w-px h-4 shrink-0 opacity-20"
            style={{ backgroundColor: T.borderColor }}
          />

          {/* Workspace tabs — desktop only */}
          <div className="hidden md:flex items-center gap-1 overflow-x-auto no-scrollbar">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="flex items-center shrink-0 group relative"
              >
                {editingWsName === ws.id ? (
                  <input
                    autoFocus
                    value={wsNameInput}
                    onChange={(e) => setWsNameInput(e.target.value)}
                    onBlur={() => {
                      setWorkspaces((p) =>
                        p.map((w) =>
                          w.id === ws.id
                            ? { ...w, name: wsNameInput || w.name }
                            : w,
                        ),
                      );
                      setEditingWsName(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setWorkspaces((p) =>
                          p.map((w) =>
                            w.id === ws.id
                              ? { ...w, name: wsNameInput || w.name }
                              : w,
                          ),
                        );
                        setEditingWsName(null);
                      }
                    }}
                    aria-label="Workspace name"
                    title="Workspace name"
                    placeholder="Workspace name"
                    className="h-6 px-2 text-[10px] font-bold rounded outline-none w-20"
                    style={{
                      backgroundColor: T.bgColor,
                      border: `1px solid ${T.accentColor}`,
                      color: T.textColor,
                    }}
                  />
                ) : (
                  <div
                    onClick={() => {
                      if (activeWsId !== ws.id) {
                        setActiveWsId(ws.id);
                        loadWorkspace(ws);
                      }
                    }}
                    onDoubleClick={() => {
                      setEditingWsName(ws.id);
                      setWsNameInput(ws.name);
                    }}
                    className="flex items-center gap-1 h-6 px-2 rounded text-[10px] font-bold border cursor-pointer transition-all"
                    style={pill(activeWsId === ws.id)}
                  >
                    <Layers size={8} />
                    <span>{ws.name}</span>
                    {workspaces.length > 1 && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteWorkspace(ws.id);
                        }}
                        className="opacity-0 group-hover:opacity-60 hover:opacity-100! ml-0.5 flex items-center cursor-pointer"
                      >
                        <X size={8} />
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
            <button
              onClick={createWorkspace}
              className="h-6 px-2 flex items-center gap-0.5 text-[10px] font-bold rounded border transition-all hover:opacity-80"
              style={{ borderColor: T.borderColor + "40", color: T.textMuted }}
              title="New workspace"
            >
              <Plus size={9} />
            </button>
          </div>
        </div>

        {/* Mobile history toggle (only) — prompt form is always visible on mobile */}
        <div className="flex items-center gap-1.5 shrink-0 md:hidden">
          <button
            onClick={() => setMobileRightOpen((v) => !v)}
            className="h-8 px-2 flex items-center gap-1 rounded border text-[10px] font-bold transition-all"
            style={{
              borderColor: mobileRightOpen
                ? T.accentColor + "60"
                : T.borderColor + "40",
              color: mobileRightOpen ? T.accentColor : T.textMuted,
              backgroundColor: mobileRightOpen
                ? T.accentColor + "10"
                : "transparent",
            }}
            aria-label="Toggle history"
          >
            <History size={14} />
          </button>
        </div>

        {/* Right: coins + claim + log toggle — desktop only on mobile, just log toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className="hidden md:flex items-center gap-1 h-6 px-2 rounded border text-[10px] font-bold"
            style={{
              borderColor: T.borderColor + "40",
              color: T.accentColor,
              backgroundColor: T.accentColor + "08",
            }}
          >
            <Coins size={10} /> {coinBalance ?? "—"}
          </div>
          <button
            onClick={handleClaimBonus}
            disabled={claiming}
            className="hidden md:flex h-6 px-2 items-center gap-1 rounded border text-[10px] font-bold transition-all hover:opacity-80 disabled:opacity-40"
            style={{
              borderColor: T.accentColor + "60",
              color: T.accentColor,
              backgroundColor: T.accentColor + "12",
            }}
            title="Claim daily bonus"
          >
            <Gift size={9} /> {claiming ? "..." : "Claim"}
          </button>
          <button
            onClick={() => setShowLogs((v) => !v)}
            className="h-6 px-2 flex items-center gap-1 rounded border text-[10px] font-bold transition-all hover:opacity-80"
            style={{
              borderColor: showLogs
                ? T.accentColor + "60"
                : T.borderColor + "40",
              color: showLogs ? T.accentColor : T.textMuted,
              backgroundColor: showLogs ? T.accentColor + "10" : "transparent",
            }}
            title="Toggle generation log"
          >
            <Terminal size={9} />
          </button>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Mobile backdrop — only for history panel */}
        {mobileRightOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-10000 md:hidden"
            onClick={() => setMobileRightOpen(false)}
          />
        )}

        {/* ── MOBILE: Single-column workspace ──────────────────────── */}
        <div
          className="md:hidden flex-1 flex flex-col min-h-0 overflow-y-auto overscroll-contain"
          style={{ backgroundColor: T.bgColor }}
        >
          <div
            className="flex-1 px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))] space-y-4"
          >
            {/* Prompt textarea — first interactive element */}
            <div className="space-y-1.5">
              <label
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: T.textMuted }}
              >
                Prompt
              </label>
              <textarea
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); setError(null); }}
                placeholder="Describe what you want to create..."
                rows={4}
                disabled={isWorking}
                className="w-full min-h-28 px-3 py-3 text-sm rounded-xl outline-none resize-none disabled:opacity-50 transition-all focus:ring-1"
                style={{
                  backgroundColor: T.bgColor,
                  border: `1px solid ${T.borderColor}40`,
                  color: T.textColor,
                  lineHeight: "1.6",
                }}
                data-testid="image-prompt-input"
              />
              <div className="flex items-center justify-between">
                <button
                  onClick={enhancePrompt}
                  disabled={!prompt.trim() || isWorking}
                  className="flex items-center gap-1 h-6 px-2 rounded border text-[9px] font-bold transition-all hover:opacity-80 disabled:opacity-30"
                  style={{ borderColor: T.accentColor + "40", color: T.accentColor }}
                >
                  <Zap size={9} /> Enhance
                </button>
                <span className="text-[9px]" style={{ color: T.textMuted + "60" }}>
                  {prompt.length}
                </span>
              </div>
            </div>

            {/* Quick controls — compact chips */}
            <div className="space-y-2">
              <span
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: T.textMuted }}
              >
                Quick settings
              </span>
              <div className="flex flex-wrap gap-1.5">
                {/* Style chip */}
                <button
                  onClick={() => setActiveTab("style")}
                  className="h-8 px-3 flex items-center gap-1.5 rounded-lg border text-[10px] font-bold transition-all"
                  style={pill(!!selectedStyle)}
                >
                  <Palette size={11} />
                  {selectedStyle ? selectedStyle.split(" ").slice(0, 2).join(" ") : "Style"}
                </button>
                {/* Aspect ratio chip */}
                <button
                  onClick={() => setActiveTab("settings")}
                  className="h-8 px-3 flex items-center gap-1.5 rounded-lg border text-[10px] font-bold transition-all"
                  style={pill(false)}
                >
                  <Layout size={11} />
                  {aspectRatio}
                </button>
                {/* Model chip */}
                <button
                  onClick={() => setActiveTab("settings")}
                  className="h-8 px-3 flex items-center gap-1.5 rounded-lg border text-[10px] font-bold transition-all"
                  style={pill(false)}
                >
                  <Sparkles size={11} />
                  {currentProvider.label}
                </button>
                {/* Quality chip */}
                <button
                  onClick={() => setActiveTab("settings")}
                  className="h-8 px-3 flex items-center gap-1.5 rounded-lg border text-[10px] font-bold transition-all"
                  style={pill(false)}
                >
                  <Flame size={11} />
                  {qualityPreset}
                </button>
              </div>
            </div>

            {/* Reference image */}
            <div
              className="rounded-lg border overflow-hidden"
              style={sectionBox}
            >
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-[10px] font-bold" style={{ color: T.textMuted }}>
                  Reference image
                </span>
                {referenceImage && (
                  <button
                    onClick={() => { setReferenceImage(null); addLog("info", "Reference cleared"); }}
                    className="flex items-center gap-1 text-[9px]"
                    style={{ color: T.textMuted }}
                  >
                    <X size={9} /> Clear
                  </button>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileUpload}
                aria-label="Upload reference image"
                title="Upload reference image"
                className="hidden"
              />
              {referenceImage ? (
                <div className="mx-3 mb-3 rounded-md overflow-hidden border" style={{ borderColor: T.borderColor + "40" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={referenceImage} alt="Reference" className="w-full h-24 object-cover" />
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isWorking}
                  className="mx-3 mb-3 w-[calc(100%-24px)] py-3 rounded-md border border-dashed flex flex-col items-center gap-1 text-[10px] font-bold transition-all hover:opacity-80 disabled:opacity-40"
                  style={{ borderColor: T.borderColor + "60", color: T.textMuted }}
                >
                  <Upload size={14} /> Upload
                </button>
              )}
            </div>

            {/* Generate button — sticky above bottom nav */}
            <div className="sticky bottom-0 z-10 -mx-4 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] border-t" style={{ borderColor: T.borderColor + "24", backgroundColor: T.boxBg }}>
              <button
                onClick={handleGenerate}
                disabled={!promptValid || !canAfford || isWorking}
                className="w-full h-13 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: isWorking
                    ? T.accentColor + "60"
                    : `linear-gradient(135deg, ${T.accentColor} 0%, ${T.headerColor} 100%)`,
                  color: T.bgColor,
                  boxShadow: isWorking ? "none" : `0 0 24px ${T.accentColor}40`,
                }}
                data-testid="generate-image-button"
              >
                {isWorking ? (
                  <><Loader2 size={15} className="animate-spin" /> Forging...</>
                ) : (
                  <><Wand2 size={15} /> Generate{batchSize > 1 ? ` ${batchSize}×` : ""}</>
                )}
              </button>
              {error && (
                <div
                  className="mt-2 text-[10px] px-3 py-2.5 rounded-lg flex items-start gap-1.5"
                  style={{
                    backgroundColor: error.includes("✓") ? T.success + "15" : "#f8514915",
                    borderLeft: `3px solid ${error.includes("✓") ? T.success : "#f85149"}`,
                    color: error.includes("✓") ? T.success : "#f85149",
                  }}
                >
                  {error.includes("✓") ? <CheckCircle2 size={11} className="mt-px shrink-0" /> : <AlertTriangle size={11} className="mt-px shrink-0" />}
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Prompt starters — below generate */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                Try a prompt
              </span>
              <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1">
                {PROMPT_PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handleUsePrompt(p)}
                    disabled={isWorking}
                    className="w-[78%] shrink-0 snap-start text-left text-[11px] px-3 py-2.5 rounded-lg border hover:opacity-80 disabled:opacity-40 line-clamp-2 transition-all"
                    style={{
                      backgroundColor: T.bgColor,
                      borderColor: T.borderColor + "40",
                      color: T.textColor + "cc",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Style presets — compact horizontal scroll */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                  Style
                </span>
                {selectedStyle && (
                  <button onClick={() => setSelectedStyle(null)} className="text-[9px] opacity-60 hover:opacity-100" style={{ color: T.accentColor }}>
                    Clear
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {STYLE_PRESETS.map((style) => (
                  <button
                    key={style}
                    onClick={() => { setSelectedStyle(style); addLog("info", `Style: ${style}`); }}
                    disabled={isWorking}
                    className="shrink-0 px-2.5 py-1.5 text-[10px] font-bold rounded-full border transition-all hover:scale-105 disabled:opacity-40"
                    style={{
                      borderColor: selectedStyle === style ? T.accentColor : T.borderColor + "60",
                      color: selectedStyle === style ? T.accentColor : T.textMuted,
                      backgroundColor: selectedStyle === style ? T.accentColor + "15" : T.bgColor,
                    }}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            {/* Generated result / canvas */}
            {currentResult?.fileUrl ? (
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: T.borderColor + "40" }}>
                <div className="flex items-center justify-between px-3 h-9" style={{ borderBottom: `1px solid ${T.borderColor}15` }}>
                  <div className="flex items-center gap-2 text-[10px]" style={{ color: T.textMuted }}>
                    <ImageIcon size={10} />
                    <span className="font-bold uppercase tracking-widest">Result</span>
                    {currentResult.status === "succeeded" && (
                      <span className="flex items-center gap-1 text-[9px]" style={{ color: T.success }}>
                        <CheckCircle2 size={9} /> Ready
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => currentResult?.fileUrl && handleDownload(currentResult.fileUrl, currentResult.prompt)} className="h-6 px-2 flex items-center gap-1 rounded border text-[9px] font-bold" style={{ borderColor: T.borderColor + "50", color: T.textMuted }}>
                      <Download size={9} /> Save
                    </button>
                    <button onClick={handleGenerate} className="h-6 px-2 flex items-center gap-1 rounded border text-[9px] font-bold" style={{ borderColor: T.borderColor + "50", color: T.textMuted }}>
                      <RefreshCw size={9} /> Regen
                    </button>
                  </div>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={currentResult.fileUrl} alt={currentResult.prompt} className="w-full" onError={() => setImgError("Failed to load image")} data-testid="generated-image" />
                <div className="px-3 py-2 text-[10px] opacity-50" style={{ color: T.textMuted }}>
                  {currentResult.prompt}
                </div>
              </div>
            ) : isWorking ? (
              <div className="rounded-xl border flex flex-col items-center justify-center py-16" style={{ borderColor: T.borderColor + "40", backgroundColor: T.boxBg }}>
                <Loader2 size={32} className="animate-spin mb-3" style={{ color: T.accentColor }} />
                <span className="text-xs font-bold" style={{ color: T.textMuted }}>Generating...</span>
              </div>
            ) : null}

            {/* Recent generations — horizontal scroll */}
            {history.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                  Recent generations
                </span>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  {history.slice(0, 10).map((g) => (
                    <GenerationHistoryCard
                      key={g.id}
                      generation={g}
                      isSelected={currentResult?.id === g.id}
                      onSelect={(gen) => setCurrentResult(gen as Generation)}
                      onDelete={deleteGeneration}
                      accentColor={T.accentColor}
                      borderColor={T.borderColor}
                      bgColor={T.bgColor}
                      textMuted={T.textMuted}
                      className="w-20 h-20 shrink-0"
                      testId="canvas-recent-card"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── LEFT PANEL: Controls (desktop only) ─────────────────── */}
        <div
          className="hidden md:flex shrink-0 flex-col overflow-hidden"
          style={{
            "--left-panel-width": `${leftWidth}px`,
            borderRight: `1px solid ${T.borderColor}18`,
            backgroundColor: T.boxBg,
            backdropFilter: "blur(20px)",
            width: `${leftWidth}px`,
          } as CSSProperties}
        >

          {/* Tab nav */}
          <div className="flex shrink-0 gap-1.5 px-4 md:px-3 pt-2 md:pt-3 pb-3 md:pb-2">
            {(["prompt", "style", "settings"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex-1 h-11 md:h-7 rounded-xl md:rounded text-[10px] font-bold uppercase tracking-wide border transition-all"
                style={pill(activeTab === tab)}
              >
                {tab === "prompt"
                  ? "Prompt"
                  : tab === "style"
                    ? "Style"
                    : "Settings"}
              </button>
            ))}
          </div>

          {/* ── PROMPT TAB ── */}
          {activeTab === "prompt" && (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-3 pb-4 space-y-3">
              {/* Main prompt */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    className="text-[9px] font-bold uppercase tracking-widest"
                    style={{ color: T.textMuted }}
                  >
                    Prompt
                  </label>
                  <button
                    onClick={enhancePrompt}
                    disabled={!prompt.trim() || isWorking}
                    className="flex items-center gap-1 h-5 px-2 rounded border text-[9px] font-bold transition-all hover:opacity-80 disabled:opacity-30"
                    style={{
                      borderColor: T.accentColor + "40",
                      color: T.accentColor,
                    }}
                  >
                    <Zap size={8} /> Enhance
                  </button>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setError(null);
                  }}
                  placeholder="Describe what you want to generate..."
                  rows={4}
                  disabled={isWorking}
                  className="w-full min-h-28 px-3 py-3 text-sm md:text-[12px] rounded-xl md:rounded-lg outline-none resize-none disabled:opacity-50 transition-all focus:ring-1"
                  style={{
                    backgroundColor: T.bgColor,
                    border: `1px solid ${T.borderColor}40`,
                    color: T.textColor,
                    lineHeight: "1.6",
                  }}
                  data-testid="image-prompt-input"
                />
                <div
                  className="text-right text-[9px]"
                  style={{ color: T.textMuted + "60" }}
                >
                  {prompt.length}
                </div>
              </div>

              {/* Negative prompt toggle */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <button
                  onClick={() => setNegativePromptOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold"
                  style={{ color: T.textMuted }}
                >
                  <span>Negative prompt</span>
                  {negativePromptOpen ? (
                    <ChevronUp size={11} />
                  ) : (
                    <ChevronDown size={11} />
                  )}
                </button>
                {negativePromptOpen && (
                  <div className="px-3 pb-3">
                    <input
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      placeholder="blurry, low quality, distorted..."
                      disabled={isWorking}
                      className="w-full px-2.5 py-2 text-[11px] rounded-md outline-none disabled:opacity-50"
                      style={{
                        backgroundColor: T.bgColor,
                        border: `1px solid ${T.borderColor}40`,
                        color: T.textColor,
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Reference image */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Reference
                  </span>
                  {referenceImage && (
                    <button
                      onClick={() => {
                        setReferenceImage(null);
                        addLog("info", "Reference cleared");
                      }}
                      className="flex items-center gap-1 text-[9px]"
                      style={{ color: T.textMuted }}
                    >
                      <X size={9} /> Clear
                    </button>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  aria-label="Upload reference image"
                  title="Upload reference image"
                  className="hidden"
                />
                {referenceImage ? (
                  <div
                    className="mx-3 mb-3 rounded-md overflow-hidden border"
                    style={{ borderColor: T.borderColor + "40" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={referenceImage}
                      alt="Reference"
                      className="w-full h-24 object-cover"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isWorking}
                    className="mx-3 mb-3 w-[calc(100%-24px)] py-3 rounded-md border border-dashed flex flex-col items-center gap-1 text-[10px] font-bold transition-all hover:opacity-80 disabled:opacity-40"
                    style={{
                      borderColor: T.borderColor + "60",
                      color: T.textMuted,
                    }}
                  >
                    <Upload size={14} /> Upload
                  </button>
                )}
              </div>

              {/* Quick presets */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Quick Starters
                  </span>
                </div>
                <div className="px-3 pb-3 flex gap-2 overflow-x-auto snap-x snap-mandatory md:block md:space-y-1 md:max-h-40 md:overflow-y-auto">
                  {PROMPT_PRESETS.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => handleUsePrompt(p)}
                      disabled={isWorking}
                      className="w-[82%] shrink-0 snap-start text-left text-[11px] px-3 py-2.5 rounded-lg border hover:opacity-80 disabled:opacity-40 line-clamp-2 transition-all md:w-full"
                      style={{
                        backgroundColor: T.bgColor,
                        borderColor: T.borderColor + "40",
                        color: T.textColor + "cc",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Visual Pack Presets */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Visual Pack Presets
                  </span>
                </div>
                <div className="px-3 pb-3 flex gap-2 overflow-x-auto snap-x snap-mandatory md:block md:space-y-1 md:max-h-40 md:overflow-y-auto">
                  {GENERATION_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setPrompt(p.promptSuffix ?? p.prompt);
                        if (p.negativePrompt) setNegativePrompt(p.negativePrompt);
                        addLog("info", `Preset loaded: ${p.name}`);
                      }}
                      disabled={isWorking}
                      className="w-[82%] shrink-0 snap-start text-left text-[11px] px-3 py-2.5 rounded-lg border hover:opacity-80 disabled:opacity-40 transition-all md:w-full"
                      style={{
                        backgroundColor: T.bgColor,
                        borderColor: T.borderColor + "40",
                        color: T.textColor + "cc",
                      }}
                    >
                      <div className="font-bold text-[10px] uppercase tracking-wide" style={{ color: T.accentColor }}>
                        {p.name}
                      </div>
                      <div className="text-[9px] mt-0.5 line-clamp-2" style={{ color: T.textMuted }}>
                        {p.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Brand Lock */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <button
                  onClick={() => setBrandLockEnabled((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold"
                  style={{ color: T.textMuted }}
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles size={10} style={{ color: T.accentColor }} />
                    Brand Lock
                  </span>
                  <span
                    className="text-[9px] rounded-full px-2 py-0.5"
                    style={{
                      background: brandLockEnabled ? T.accentColor + "20" : T.borderColor + "20",
                      color: brandLockEnabled ? T.accentColor : T.textMuted,
                    }}
                  >
                    {brandLockEnabled ? "ON" : "OFF"}
                  </span>
                </button>
                {brandLockEnabled && (
                  <div className="px-3 pb-3 space-y-2">
                    <p className="text-[9px]" style={{ color: T.textMuted }}>
                      Enforces LiTT mascot identity, approved colors, and logo placement in every generation.
                    </p>
                    <div className="flex gap-1.5 flex-wrap">
                      {["#9a4dff", "#26e6ff", "#54ff83", "#ff7a1a"].map((c) => (
                        <div key={c} className="h-4 w-4 rounded-full border" style={{ background: c, borderColor: T.borderColor + "40" }} />
                      ))}
                    </div>
                    <p className="text-[9px] italic" style={{ color: T.textMuted + "80" }}>
                      Mascot: {DEFAULT_MASCOT_DESCRIPTION.slice(0, 60)}…
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STYLE TAB ── */}
          {activeTab === "style" && (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-3 pb-4 space-y-3">
              {/* Remix mode */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Remix Mode
                  </span>
                  <p
                    className="text-[9px] mt-0.5 opacity-60"
                    style={{ color: T.textMuted }}
                  >
                    How to use the reference image
                  </p>
                </div>
                <div className="px-3 pb-3 grid grid-cols-2 gap-1.5">
                  {REMIX_MODES.map((mode) => {
                    const Icon = mode.icon;
                    const active = remixMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        onClick={() => setRemixMode(mode.id)}
                        disabled={isWorking}
                        className="p-2.5 text-left rounded-md border transition-all hover:scale-[1.01] disabled:opacity-40"
                        style={pill(active)}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-[10px] mb-0.5">
                          <Icon size={10} /> {mode.label}
                        </div>
                        <div className="text-[9px] opacity-60">{mode.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Style presets */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Style Presets
                  </span>
                  {selectedStyle && (
                    <button
                      onClick={() => setSelectedStyle(null)}
                      className="text-[9px] opacity-60 hover:opacity-100"
                      style={{ color: T.accentColor }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                  {STYLE_PRESETS.map((style) => (
                    <button
                      key={style}
                      onClick={() => {
                        setSelectedStyle(style);
                        addLog("info", `Style: ${style}`);
                      }}
                      disabled={isWorking}
                      className="px-2.5 py-1 text-[9px] font-bold rounded-full border transition-all hover:scale-105 disabled:opacity-40"
                      style={{
                        borderColor:
                          selectedStyle === style
                            ? T.accentColor
                            : T.borderColor + "60",
                        color:
                          selectedStyle === style ? T.accentColor : T.textMuted,
                        backgroundColor:
                          selectedStyle === style
                            ? T.accentColor + "15"
                            : T.bgColor,
                      }}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lighting presets */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Lighting
                  </span>
                  {selectedLighting && (
                    <button
                      onClick={() => setSelectedLighting(null)}
                      className="text-[9px] opacity-60 hover:opacity-100"
                      style={{ color: T.accentColor }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                  {LIGHTING_PRESETS.map((lighting) => (
                    <button
                      key={lighting}
                      onClick={() => {
                        setSelectedLighting(lighting);
                        addLog("info", `Lighting: ${lighting}`);
                      }}
                      disabled={isWorking}
                      className="px-2.5 py-1 text-[9px] font-bold rounded-full border transition-all hover:scale-105 disabled:opacity-40"
                      style={{
                        borderColor:
                          selectedLighting === lighting
                            ? T.accentColor
                            : T.borderColor + "60",
                        color:
                          selectedLighting === lighting
                            ? T.accentColor
                            : T.textMuted,
                        backgroundColor:
                          selectedLighting === lighting
                            ? T.accentColor + "15"
                            : T.bgColor,
                      }}
                    >
                      {lighting}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mood presets */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Mood & Atmosphere
                  </span>
                  {selectedMood && (
                    <button
                      onClick={() => setSelectedMood(null)}
                      className="text-[9px] opacity-60 hover:opacity-100"
                      style={{ color: T.accentColor }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                  {MOOD_PRESETS.map((mood) => (
                    <button
                      key={mood}
                      onClick={() => {
                        setSelectedMood(mood);
                        addLog("info", `Mood: ${mood}`);
                      }}
                      disabled={isWorking}
                      className="px-2.5 py-1 text-[9px] font-bold rounded-full border transition-all hover:scale-105 disabled:opacity-40"
                      style={{
                        borderColor:
                          selectedMood === mood
                            ? T.accentColor
                            : T.borderColor + "60",
                        color:
                          selectedMood === mood ? T.accentColor : T.textMuted,
                        backgroundColor:
                          selectedMood === mood
                            ? T.accentColor + "15"
                            : T.bgColor,
                      }}
                    >
                      {mood}
                    </button>
                  ))}
                </div>
              </div>

              {/* Camera angle presets */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Camera Angle
                  </span>
                  {selectedCamera && (
                    <button
                      onClick={() => setSelectedCamera(null)}
                      className="text-[9px] opacity-60 hover:opacity-100"
                      style={{ color: T.accentColor }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                  {CAMERA_PRESETS.map((camera) => (
                    <button
                      key={camera}
                      onClick={() => {
                        setSelectedCamera(camera);
                        addLog("info", `Camera: ${camera}`);
                      }}
                      disabled={isWorking}
                      className="px-2.5 py-1 text-[9px] font-bold rounded-full border transition-all hover:scale-105 disabled:opacity-40"
                      style={{
                        borderColor:
                          selectedCamera === camera
                            ? T.accentColor
                            : T.borderColor + "60",
                        color:
                          selectedCamera === camera
                            ? T.accentColor
                            : T.textMuted,
                        backgroundColor:
                          selectedCamera === camera
                            ? T.accentColor + "15"
                            : T.bgColor,
                      }}
                    >
                      {camera}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quality tag */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Quality Tag
                  </span>
                  {selectedQualityTag && (
                    <button
                      onClick={() => setSelectedQualityTag(null)}
                      className="text-[9px] opacity-60 hover:opacity-100"
                      style={{ color: T.accentColor }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                  {QUALITY_TAGS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setSelectedQualityTag(tag);
                        addLog("info", `Quality: ${tag}`);
                      }}
                      disabled={isWorking}
                      className="px-2.5 py-1 text-[9px] font-bold rounded-full border transition-all hover:scale-105 disabled:opacity-40"
                      style={{
                        borderColor:
                          selectedQualityTag === tag
                            ? T.accentColor
                            : T.borderColor + "60",
                        color:
                          selectedQualityTag === tag
                            ? T.accentColor
                            : T.textMuted,
                        backgroundColor:
                          selectedQualityTag === tag
                            ? T.accentColor + "15"
                            : T.bgColor,
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto-enhance toggle */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-3 flex items-center justify-between">
                  <div>
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: T.textMuted }}
                    >
                      Auto-Enhance Prompt
                    </span>
                    <p
                      className="text-[9px] mt-0.5 opacity-60"
                      style={{ color: T.textMuted }}
                    >
                      Automatically append selected tags to prompt
                    </p>
                  </div>
                  <button
                    onClick={() => setAutoEnhance(!autoEnhance)}
                    aria-label="Toggle auto-enhance prompt"
                    aria-pressed={autoEnhance}
                    title={autoEnhance ? "Auto-enhance on" : "Auto-enhance off"}
                    className="relative w-10 h-5 rounded-full transition-colors"
                    style={{
                      backgroundColor: autoEnhance
                        ? T.accentColor
                        : T.borderColor + "60",
                    }}
                  >
                    <div
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                      style={{
                        left: autoEnhance
                          ? "calc(100% - 1.125rem)"
                          : "0.125rem",
                      }}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── SETTINGS TAB ── */}
          {activeTab === "settings" && (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-3 pb-4 space-y-3">
              {/* Provider */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Provider
                  </span>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: T.accentColor + "20",
                      color: T.accentColor,
                    }}
                  >
                    {providerCost === 0 ? "FREE" : `${providerCost} 🪙`}
                  </span>
                </div>
                <div className="px-3 pb-3 space-y-1">
                  {PROVIDER_OPTIONS.map((p) => {
                    const ready = isProviderReady(p.id);
                    return (
                    <button
                      key={p.id}
                      onClick={() => setProviderId(p.id)}
                      disabled={isWorking || (!ready && p.id !== "auto-free" && p.id !== "auto-quality")}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md border text-left transition-all hover:scale-[1.005] disabled:opacity-40"
                      style={pill(providerId === p.id)}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${ready ? "bg-green-400" : "bg-amber-400"}`}
                        title={ready ? "Configured" : "Not configured — set API key in Vercel env vars"}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold">
                            {p.label}
                          </span>
                          <span
                            className="text-[8px] px-1 py-px rounded font-bold opacity-60"
                            style={{ backgroundColor: T.bgColor }}
                          >
                            {p.tag}
                          </span>
                        </div>
                        <div className="text-[9px] opacity-50 truncate">
                          {p.desc} · {p.cost === 0 ? "FREE" : `${p.cost} 🪙`}
                        </div>
                      </div>
                    </button>
                    );
                  })}
                </div>
              </div>

              {/* Aspect ratio */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Aspect Ratio
                  </span>
                </div>
                <div className="px-3 pb-3 flex gap-1.5 flex-wrap">
                  {ASPECT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setAspectRatio(opt.value)}
                      disabled={isWorking}
                      className="flex flex-col items-center px-3 py-2 rounded-md border text-[10px] font-bold transition-all hover:scale-[1.03] disabled:opacity-40"
                      style={pill(aspectRatio === opt.value)}
                    >
                      <span className="text-base leading-none mb-0.5">
                        {opt.icon}
                      </span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Batch */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Batch Size
                  </span>
                </div>
                <div className="px-3 pb-3 flex gap-1.5">
                  {([1, 2, 4] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => setBatchSize(n)}
                      disabled={isWorking}
                      className="flex-1 py-2 rounded-md border text-[11px] font-bold transition-all hover:scale-[1.03] disabled:opacity-40"
                      style={pill(batchSize === n)}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
                <div
                  className="px-3 pb-3 text-[9px]"
                  style={{ color: T.textMuted + "60" }}
                >
                  Total:{" "}
                  {providerCost * batchSize === 0
                    ? "FREE"
                    : `${providerCost * batchSize} 🪙`}
                </div>
              </div>

              {/* Gemini resolution */}
              {providerId === "gemini" && (
                <div
                  className="rounded-lg border overflow-hidden"
                  style={sectionBox}
                >
                  <div className="px-3 py-2">
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: T.textMuted }}
                    >
                      Resolution
                    </span>
                  </div>
                  <div className="px-3 pb-3 flex gap-1.5">
                    {(["1K", "2K"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setImageSize(s)}
                        disabled={isWorking}
                        className="flex-1 py-2 rounded-md border text-[11px] font-bold transition-all hover:scale-[1.03] disabled:opacity-40"
                        style={pill(imageSize === s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quality Preset */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Quality Preset
                  </span>
                  <p
                    className="text-[9px] mt-0.5 opacity-60"
                    style={{ color: T.textMuted }}
                  >
                    Steps & guidance pre-configured
                  </p>
                </div>
                <div className="px-3 pb-3 grid grid-cols-2 gap-1.5">
                  {QUALITY_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setQualityPreset(preset.id);
                        setInferenceSteps(preset.steps);
                        setGuidanceScale(preset.cfg);
                      }}
                      disabled={isWorking}
                      className="p-2 text-left rounded-md border transition-all hover:scale-[1.01] disabled:opacity-40"
                      style={pill(qualityPreset === preset.id)}
                    >
                      <div className="font-bold text-[10px]">
                        {preset.label}
                      </div>
                      <div className="text-[9px] opacity-60">{preset.desc}</div>
                      <div className="text-[8px] opacity-40 mt-0.5">
                        {preset.steps} steps · CFG {preset.cfg}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Guidance Scale */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <div>
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: T.textMuted }}
                    >
                      Guidance Scale (CFG)
                    </span>
                    <p
                      className="text-[9px] mt-0.5 opacity-60"
                      style={{ color: T.textMuted }}
                    >
                      Adherence to prompt vs creativity
                    </p>
                  </div>
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: T.accentColor + "20",
                      color: T.accentColor,
                    }}
                  >
                    {guidanceScale.toFixed(1)}
                  </span>
                </div>
                <div className="px-3 pb-3">
                  <input
                    type="range"
                    min={1}
                    max={15}
                    step={0.5}
                    value={guidanceScale}
                    onChange={(e) =>
                      setGuidanceScale(parseFloat(e.target.value))
                    }
                    disabled={isWorking}
                    aria-label="Guidance scale (CFG)"
                    title="Guidance scale (CFG)"
                    aria-valuemin={1}
                    aria-valuemax={15}
                    aria-valuenow={guidanceScale}
                    className="w-full accent-current cursor-pointer"
                    style={{ accentColor: T.accentColor }}
                  />
                  <div
                    className="flex justify-between text-[8px] mt-1"
                    style={{ color: T.textMuted }}
                  >
                    <span>Creative (1)</span>
                    <span>Balanced (7.5)</span>
                    <span>Strict (15)</span>
                  </div>
                </div>
              </div>

              {/* Inference Steps */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <div>
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: T.textMuted }}
                    >
                      Inference Steps
                    </span>
                    <p
                      className="text-[9px] mt-0.5 opacity-60"
                      style={{ color: T.textMuted }}
                    >
                      More steps = more detail, slower
                    </p>
                  </div>
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: T.accentColor + "20",
                      color: T.accentColor,
                    }}
                  >
                    {inferenceSteps}
                  </span>
                </div>
                <div className="px-3 pb-3">
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={inferenceSteps}
                    onChange={(e) =>
                      setInferenceSteps(parseInt(e.target.value))
                    }
                    disabled={isWorking}
                    aria-label="Inference steps"
                    title="Inference steps"
                    aria-valuemin={10}
                    aria-valuemax={100}
                    aria-valuenow={inferenceSteps}
                    className="w-full accent-current cursor-pointer"
                    style={{ accentColor: T.accentColor }}
                  />
                  <div
                    className="flex justify-between text-[8px] mt-1"
                    style={{ color: T.textMuted }}
                  >
                    <span>Fast (10)</span>
                    <span>Draft (20)</span>
                    <span>Quality (50)</span>
                    <span>Extreme (100)</span>
                  </div>
                </div>
              </div>

              {/* Sampling Method */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Sampling Method
                  </span>
                  <p
                    className="text-[9px] mt-0.5 opacity-60"
                    style={{ color: T.textMuted }}
                  >
                    Algorithm for denoising (provider support varies)
                  </p>
                </div>
                <div className="px-3 pb-3 space-y-1">
                  {SAMPLER_OPTIONS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSampler(s.id)}
                      disabled={isWorking}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-md border text-left transition-all hover:scale-[1.005] disabled:opacity-40"
                      style={pill(sampler === s.id)}
                    >
                      <div>
                        <div className="text-[11px] font-bold">{s.label}</div>
                        <div className="text-[9px] opacity-50">{s.desc}</div>
                      </div>
                      {sampler === s.id && (
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: T.accentColor }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Img2Img Strength (when using reference) */}
              {referenceImage && (
                <div
                  className="rounded-lg border overflow-hidden"
                  style={sectionBox}
                >
                  <div className="px-3 py-2 flex items-center justify-between">
                    <div>
                      <span
                        className="text-[10px] font-bold"
                        style={{ color: T.textMuted }}
                      >
                        Img2Img Strength
                      </span>
                      <p
                        className="text-[9px] mt-0.5 opacity-60"
                        style={{ color: T.textMuted }}
                      >
                        How much to deviate from reference
                      </p>
                    </div>
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: T.accentColor + "20",
                        color: T.accentColor,
                      }}
                    >
                      {Math.round(strength * 100)}%
                    </span>
                  </div>
                  <div className="px-3 pb-3">
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={strength}
                      onChange={(e) => setStrength(parseFloat(e.target.value))}
                      disabled={isWorking}
                      aria-label="Img2Img strength"
                      title="Img2Img strength"
                      aria-valuemin={0.1}
                      aria-valuemax={1}
                      aria-valuenow={strength}
                      className="w-full accent-current cursor-pointer"
                      style={{ accentColor: T.accentColor }}
                    />
                    <div
                      className="flex justify-between text-[8px] mt-1"
                      style={{ color: T.textMuted }}
                    >
                      <span>Subtle (10%)</span>
                      <span>Balanced (50%)</span>
                      <span>Strong (75%)</span>
                      <span>Creative (100%)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Seed */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    Seed
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSeedLocked(!seedLocked)}
                      className="text-[9px] px-2 py-0.5 rounded border transition-all"
                      style={{
                        borderColor: seedLocked
                          ? T.accentColor
                          : T.borderColor + "60",
                        color: seedLocked ? T.accentColor : T.textMuted,
                        backgroundColor: seedLocked
                          ? T.accentColor + "15"
                          : "transparent",
                      }}
                    >
                      {seedLocked ? "Locked" : "Random"}
                    </button>
                    <button
                      onClick={() =>
                        setSeed(Math.floor(Math.random() * 2147483647))
                      }
                      disabled={isWorking || seedLocked}
                      className="text-[9px] px-2 py-0.5 rounded border transition-all hover:opacity-80 disabled:opacity-40"
                      style={{
                        borderColor: T.borderColor + "60",
                        color: T.accentColor,
                      }}
                    >
                      🎲 Randomize
                    </button>
                  </div>
                </div>
                <div className="px-3 pb-3">
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                    min={0}
                    max={2147483647}
                    disabled={isWorking}
                    aria-label="Seed for reproducible generation"
                    title="Seed for reproducible generation"
                    placeholder="0"
                    className="w-full px-2.5 py-2 text-[11px] rounded-md outline-none disabled:opacity-40"
                    style={{
                      backgroundColor: T.bgColor,
                      border: `1px solid ${T.borderColor}40`,
                      color: T.textColor,
                    }}
                  />
                  <p
                    className="text-[9px] mt-1.5 opacity-50"
                    style={{ color: T.textMuted }}
                  >
                    Same seed + settings = reproducible results
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Generate button — always visible ── */}
          <div className="shrink-0 px-4 md:px-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-3 pt-3 md:pt-1 space-y-2 border-t md:border-t-0" style={{ borderColor: T.borderColor + "24", backgroundColor: T.boxBg }}>
            <button
              onClick={handleGenerate}
              disabled={!promptValid || !canAfford || isWorking}
              className="w-full h-13 md:h-11 rounded-2xl md:rounded-xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: isWorking
                  ? T.accentColor + "60"
                  : `linear-gradient(135deg, ${T.accentColor} 0%, ${T.headerColor} 100%)`,
                color: T.bgColor,
                boxShadow: isWorking ? "none" : `0 0 24px ${T.accentColor}40`,
              }}
              data-testid="generate-image-button"
            >
              {isWorking ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Forging...
                </>
              ) : (
                <>
                  <Wand2 size={15} /> Generate{" "}
                  {batchSize > 1 ? `${batchSize}×` : ""}
                </>
              )}
            </button>

            {error && (
              <div
                className="text-[10px] px-3 py-2.5 rounded-lg flex items-start gap-1.5"
                style={{
                  backgroundColor: error.includes("✓")
                    ? T.success + "15"
                    : "#f8514915",
                  borderLeft: `3px solid ${error.includes("✓") ? T.success : "#f85149"}`,
                  color: error.includes("✓") ? T.success : "#f85149",
                }}
              >
                {error.includes("✓") ? (
                  <CheckCircle2 size={11} className="mt-px shrink-0" />
                ) : (
                  <AlertTriangle size={11} className="mt-px shrink-0" />
                )}
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        {/* Left resize handle */}
        <div
          className="hidden md:block w-1 shrink-0 cursor-col-resize relative z-10 group"
          onMouseDown={(e) => {
            e.preventDefault();
            dragRef.current = {
              side: "left",
              startX: e.clientX,
              startWidth: leftWRef.current,
            };
            setDraggingSide("left");
          }}
          style={{ backgroundColor: "transparent" }}
        >
          <div
            className="absolute inset-y-0 left-0 w-px group-hover:w-0.5 transition-all"
            style={{
              backgroundColor: T.accentColor + "20",
              boxShadow:
                draggingSide === "left" ? `0 0 6px ${T.accentColor}60` : "none",
            }}
          />
        </div>

        {/* ── CENTER + RIGHT: Canvas + History (desktop only) ──────── */}
        <div className="hidden md:flex flex-1 flex-col min-w-0 overflow-hidden">
          {/* Canvas area */}
          <div className="flex-1 flex items-stretch min-h-0 overflow-hidden">
            {/* Preview */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Preview header */}
              <div
                className="shrink-0 flex items-center justify-between px-4 h-9"
                style={{ borderBottom: `1px solid ${T.borderColor}15` }}
              >
                <div
                  className="flex items-center gap-2 text-[10px]"
                  style={{ color: T.textMuted }}
                >
                  <ImageIcon size={10} />
                  <span className="font-bold uppercase tracking-widest">
                    Canvas
                  </span>
                  {currentResult?.status === "succeeded" && (
                    <span
                      className="flex items-center gap-1 text-[9px]"
                      style={{ color: T.success }}
                    >
                      <CheckCircle2 size={9} /> Ready
                    </span>
                  )}
                  {isWorking && (
                    <span
                      className="flex items-center gap-1 text-[9px]"
                      style={{ color: T.accentColor }}
                    >
                      <Loader2 size={9} className="animate-spin" /> Rendering...
                    </span>
                  )}
                </div>
                {currentResult?.fileUrl && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        handleDownload(
                          currentResult.fileUrl!,
                          currentResult.prompt,
                        )
                      }
                      className="h-6 px-2.5 flex items-center gap-1 rounded border text-[9px] font-bold transition-all hover:opacity-80"
                      style={{
                        borderColor: T.accentColor + "50",
                        color: T.accentColor,
                        backgroundColor: T.accentColor + "10",
                      }}
                    >
                      <Download size={9} /> Save
                    </button>

                    {/* Gallery save with options */}
                    <div
                      className="flex items-center gap-0.5 rounded border overflow-hidden"
                      style={{ borderColor: T.borderColor + "50" }}
                    >
                      {/* Visibility toggle */}
                      <button
                        onClick={() =>
                          setGallerySharePublic(!gallerySharePublic)
                        }
                        className="h-6 px-1.5 flex items-center gap-1 text-[9px] transition-all"
                        style={{
                          backgroundColor: gallerySharePublic
                            ? "#22c55e20"
                            : T.bgColor,
                          color: gallerySharePublic ? "#22c55e" : T.textMuted,
                          borderRight: `1px solid ${T.borderColor}30`,
                        }}
                        title={
                          gallerySharePublic
                            ? "Public - visible to all"
                            : "Private - only you"
                        }
                      >
                        {gallerySharePublic ? "🌐" : "🔒"}
                      </button>

                      {/* Category selector */}
                      <select
                        value={galleryCategory}
                        onChange={(e) => setGalleryCategory(e.target.value)}
                        aria-label="Gallery category"
                        title="Gallery category"
                        className="h-6 px-1 text-[9px] outline-none cursor-pointer"
                        style={{
                          backgroundColor: T.bgColor,
                          color: T.textMuted,
                          border: "none",
                          borderRight: `1px solid ${T.borderColor}30`,
                        }}
                      >
                        <option value="abstract">Abstract</option>
                        <option value="character">Character</option>
                        <option value="landscape">Landscape</option>
                        <option value="360-worlds">360° Worlds</option>
                      </select>

                      {/* Save button */}
                      <button
                        onClick={() => handleSaveToGallery(currentResult)}
                        disabled={status === "saving"}
                        className="h-6 px-2 flex items-center gap-1 text-[9px] font-bold transition-all hover:opacity-80 disabled:opacity-40"
                        style={{
                          backgroundColor: T.bgColor,
                          color: T.textMuted,
                        }}
                      >
                        {status === "saving" ? (
                          <Loader2 size={9} className="animate-spin" />
                        ) : (
                          <Save size={9} />
                        )}
                        Gallery
                      </button>
                    </div>

                    <button
                      onClick={() => { setPrompt(currentResult.prompt); }}
                      className="h-6 px-2.5 flex items-center gap-1 rounded border text-[9px] font-bold transition-all hover:opacity-80"
                      style={{
                        borderColor: T.borderColor + "50",
                        color: T.textMuted,
                      }}
                    >
                      <Wand2 size={9} /> Edit
                    </button>
                    <button
                      onClick={handleGenerate}
                      className="h-6 px-2.5 flex items-center gap-1 rounded border text-[9px] font-bold transition-all hover:opacity-80"
                      style={{
                        borderColor: T.borderColor + "50",
                        color: T.textMuted,
                      }}
                    >
                      <RefreshCw size={9} /> Regen
                    </button>
                    <span
                      className="hidden sm:inline text-[9px] opacity-40"
                      style={{ color: T.textMuted }}
                    >
                      {currentResult.provider} · {aspectRatio}
                    </span>
                  </div>
                )}
              </div>

              {/* Canvas */}
              <div
                className="flex-1 flex items-center justify-center relative overflow-hidden"
                style={{ backgroundColor: T.bgColor }}
              >
                {currentResult?.fileUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={currentResult.fileUrl}
                      alt={currentResult.prompt}
                      className="max-w-full max-h-full object-contain"
                      style={{ borderRadius: "4px" }}
                      onError={() => setImgError("Image failed to load.")}
                      onLoad={() => setImgError(null)}
                    />
                    {imgError && (
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ backgroundColor: T.bgColor + "ee" }}
                      >
                        <div className="text-center">
                          <AlertTriangle
                            size={28}
                            className="mx-auto mb-2"
                            style={{ color: "#f85149" }}
                          />
                          <p
                            className="text-sm mb-3"
                            style={{ color: "#f85149" }}
                          >
                            {imgError}
                          </p>
                          <button
                            onClick={() => {
                              setImgError(null);
                              handleGenerate();
                            }}
                            className="px-4 py-2 text-xs font-bold rounded-lg"
                            style={{
                              backgroundColor: T.accentColor,
                              color: T.bgColor,
                            }}
                          >
                            <RefreshCw size={10} className="inline mr-1" />{" "}
                            Retry
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : isWorking ? (
                  <div className="text-center select-none">
                    <div className="relative w-24 h-24 mx-auto mb-4">
                      <div
                        className="absolute inset-0 rounded-full border-2 animate-ping opacity-30"
                        style={{ borderColor: T.accentColor }}
                      />
                      <div
                        className="absolute inset-2 rounded-full border animate-spin opacity-20"
                        style={{
                          borderColor: T.accentColor,
                          borderTopColor: "transparent",
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-3xl">
                        🎨
                      </div>
                    </div>
                    <p
                      className="text-sm font-bold"
                      style={{ color: T.textMuted }}
                    >
                      Forging...
                    </p>
                    <p
                      className="text-[10px] mt-1 opacity-50"
                      style={{ color: T.textMuted }}
                    >
                      {currentProvider.label}
                    </p>
                  </div>
                ) : status === "failed" ? (
                  <div className="text-center px-8">
                    <div
                      className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: "#f8514918" }}
                    >
                      <AlertTriangle size={26} style={{ color: "#f85149" }} />
                    </div>
                    <p
                      className="text-sm font-bold mb-1"
                      style={{ color: "#f85149" }}
                    >
                      Generation Failed
                    </p>
                    <p
                      className="text-[11px] opacity-60 mb-4"
                      style={{ color: T.textMuted }}
                    >
                      {error ||
                        "Check your API key or try a different provider."}
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={handleGenerate}
                        className="px-4 py-2 text-xs font-bold rounded-lg"
                        style={{
                          backgroundColor: T.accentColor,
                          color: T.bgColor,
                        }}
                      >
                        <RefreshCw size={10} className="inline mr-1" /> Retry
                      </button>
                      <button
                        onClick={() => setProviderId("pollinations")}
                        className="px-4 py-2 text-xs font-bold rounded-lg border"
                        style={{
                          borderColor: T.borderColor,
                          color: T.textMuted,
                        }}
                      >
                        <Zap size={10} className="inline mr-1" /> Use Free
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full overflow-y-auto p-4 space-y-4">
                    {/* Recent generations */}
                    {history.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                          <History size={10} />
                          <span>Recent</span>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                          {history.slice(0, 8).map((g) => (
                            <GenerationHistoryCard
                              key={g.id}
                              generation={g}
                              isSelected={currentResult?.id === g.id}
                              onSelect={(gen) => setCurrentResult(gen as Generation)}
                              onDelete={deleteGeneration}
                              accentColor={T.accentColor}
                              borderColor={T.borderColor}
                              bgColor={T.bgColor}
                              textMuted={T.textMuted}
                              testId="canvas-left-recent-card"
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Prompt presets */}
                    <div>
                      <div className="flex items-center gap-2 mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                        <Sparkles size={10} />
                        <span>Try a prompt</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {PROMPT_PRESETS.slice(0, 6).map((preset) => (
                          <button
                            key={preset}
                            onClick={() => { setPrompt(preset); }}
                            className="text-left p-2.5 rounded-lg border text-[10px] leading-relaxed transition-all hover:scale-[1.01]"
                            style={{
                              borderColor: T.borderColor + "30",
                              backgroundColor: T.bgColor,
                              color: T.textMuted,
                            }}
                          >
                            <span className="line-clamp-2">{preset}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Inspiration gallery */}
                    <div>
                      <div className="flex items-center gap-2 mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                        <Palette size={10} />
                        <span>Styles</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {STYLE_PRESETS.slice(0, 10).map((style) => (
                          <button
                            key={style}
                            onClick={() => { setPrompt(prompt ? `${prompt}, ${style}` : style); }}
                            className="px-2.5 py-1 text-[9px] font-bold rounded-full border transition-all hover:scale-105"
                            style={{
                              borderColor: T.borderColor + "60",
                              color: T.textMuted,
                              backgroundColor: T.bgColor,
                            }}
                          >
                            {style}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Empty hint */}
                    <div className="text-center pt-2">
                      <p className="text-[11px] font-bold" style={{ color: T.textMuted }}>
                        Create something original.
                      </p>
                      <p className="text-[10px] mt-0.5 opacity-50" style={{ color: T.textMuted }}>
                        Describe the image, choose a style, and generate.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right resize handle */}
            <div
              className="hidden md:block w-1 shrink-0 cursor-col-resize relative z-10 group"
              onMouseDown={(e) => {
                e.preventDefault();
                dragRef.current = {
                  side: "right",
                  startX: e.clientX,
                  startWidth: rightWRef.current,
                };
                setDraggingSide("right");
              }}
              style={{ backgroundColor: "transparent" }}
            >
              <div
                className="absolute inset-y-0 right-0 w-px group-hover:w-0.5 transition-all"
                style={{
                  backgroundColor: T.accentColor + "20",
                  boxShadow:
                    draggingSide === "right"
                      ? `0 0 6px ${T.accentColor}60`
                      : "none",
                }}
              />
            </div>

            {/* History sidebar (right) */}
            <div
              className={`shrink-0 flex flex-col transition-transform duration-300 ease-out md:relative md:translate-x-0 fixed inset-y-0 right-0 z-10000 ${mobileRightOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"}`}
              style={{
                width: rightWidth,
                borderLeft: `1px solid ${T.borderColor}15`,
                backgroundColor: T.boxBg + "30",
                backdropFilter: "blur(20px)",
              }}
            >
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="shrink-0 flex items-center justify-between px-3 h-9 text-[10px] font-bold uppercase tracking-widest"
                style={{
                  borderBottom: `1px solid ${T.borderColor}15`,
                  color: T.textMuted,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <History size={10} />
                  <span>History</span>
                  <span className="opacity-50">({history.length})</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMobileRightOpen(false);
                    }}
                    className="md:hidden p-1 rounded transition-all hover:bg-white/10"
                    style={{ color: T.textMuted }}
                    aria-label="Close history"
                  >
                    <X size={14} />
                  </button>
                  {history.length > 0 && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setHistoryMenuOpen((v) => !v);
                        }}
                        className="p-1 rounded transition-all hover:bg-white/10"
                        style={{ color: T.textMuted }}
                        aria-label="History options"
                        aria-haspopup="menu"
                        aria-expanded={historyMenuOpen}
                        data-testid="history-menu-trigger"
                      >
                        <MoreVertical size={12} />
                      </button>
                      {historyMenuOpen && (
                        <>
                          {/* Click-away backdrop */}
                          <div
                            className="fixed inset-0 z-40"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHistoryMenuOpen(false);
                            }}
                          />
                          <div
                            className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border shadow-xl overflow-hidden"
                            style={{
                              backgroundColor: T.boxBg,
                              borderColor: T.borderColor + "60",
                            }}
                            role="menu"
                            data-testid="history-menu"
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHistoryMenuOpen(false);
                                removeFailedGenerations();
                              }}
                              className="w-full text-left px-3 py-2 text-[10px] font-bold transition-colors hover:bg-white/5"
                              style={{ color: T.textMuted }}
                              role="menuitem"
                              data-testid="remove-failed-generations"
                            >
                              Remove failed generations
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHistoryMenuOpen(false);
                                confirmClearAllHistory();
                              }}
                              className="w-full text-left px-3 py-2 text-[10px] font-bold text-red-400 transition-colors hover:bg-red-500/10"
                              role="menuitem"
                              data-testid="clear-all-history"
                            >
                              Clear all history
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {historyOpen ? (
                    <ChevronUp size={10} />
                  ) : (
                    <ChevronDown size={10} />
                  )}
                </div>
              </button>

              {historyOpen && (
                <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-1.5 content-start">
                  {history.length === 0 ? (
                    <div
                      className="col-span-2 py-8 text-center text-[10px] opacity-40"
                      style={{ color: T.textMuted }}
                    >
                      No history yet
                    </div>
                  ) : (
                    history.map((g) => (
                      <GenerationHistoryCard
                        key={g.id}
                        generation={g}
                        isSelected={currentResult?.id === g.id}
                        onSelect={(gen) => setCurrentResult(gen as Generation)}
                        onDelete={deleteGeneration}
                        accentColor={T.accentColor}
                        borderColor={T.borderColor}
                        bgColor={T.bgColor}
                        textMuted={T.textMuted}
                        testId="history-grid-card"
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Generation Log (bottom) ── */}
          {showLogs && (
            <div
              className="shrink-0 border-t"
              style={{
                borderColor: T.borderColor + "20",
                backgroundColor: T.bgColor,
                fontFamily: "monospace",
                height: "140px",
              }}
            >
              <div
                className="flex items-center justify-between px-3 h-8"
                style={{ borderBottom: `1px solid ${T.borderColor}15` }}
              >
                <div
                  className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: T.accentColor }}
                >
                  <Terminal size={9} /> Generation Log
                </div>
                <button
                  onClick={() => setLogs([])}
                  className="text-[9px] opacity-40 hover:opacity-100"
                  style={{ color: T.textMuted }}
                >
                  Clear
                </button>
              </div>
              <div className="overflow-y-auto h-[calc(100%-32px)] p-2 space-y-px">
                {logs.length === 0 ? (
                  <div
                    className="text-[10px] opacity-30 italic px-1 pt-1"
                    style={{ color: T.textMuted }}
                  >
                    idle
                  </div>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-baseline gap-2 px-1 text-[10px]"
                    >
                      <span
                        className="opacity-30 shrink-0 tabular-nums"
                        style={{ color: T.textMuted }}
                      >
                        {log.time}
                      </span>
                      <span
                        className="shrink-0 font-bold w-12"
                        style={{
                          color:
                            log.level === "success"
                              ? "#3fb950"
                              : log.level === "error"
                                ? "#f85149"
                                : log.level === "warn"
                                  ? "#d29922"
                                  : T.textMuted,
                        }}
                      >
                        {log.level}
                      </span>
                      <span
                        className="opacity-80"
                        style={{ color: T.textColor }}
                      >
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
