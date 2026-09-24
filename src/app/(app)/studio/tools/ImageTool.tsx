"use client";

import Image from "next/image";
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
  ImagePlus,
  SlidersHorizontal,
  MoreVertical,
  Maximize2,
  Copy,
  Eraser,
} from "lucide-react";
import { MediaProviderId, ProviderSelection } from "@/lib/media";
import { GENERATION_PRESETS } from "@/lib/visual-packs/generation-presets";
import { DEFAULT_MASCOT_DESCRIPTION } from "@/lib/visual-packs/types";
import GenerationHistoryCard from "../components/GenerationHistoryCard";

/* ─── Types ───────────────────────────────────────────────────────────── */

import { apiFetch, type ApiJson } from "@/lib/api-response";
import { notifyAssetsChanged } from "../hooks/useAssetsRefresh";
import { useStudioContext } from "../context/StudioContext";

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
  { label: "4:5", value: "4:5" as const, width: 1024, height: 1280, icon: "▯" },
  { label: "3:2", value: "3:2" as const, width: 1152, height: 768, icon: "▭" },
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

const LITT_QUICK_ACTIONS = [
  { label: "Make Cinematic", promptSuffix: ", cinematic lighting, film grain, dramatic atmosphere, anamorphic lens flare" },
  { label: "More Realistic", promptSuffix: ", photorealistic, ultra detailed, professional photography, 8k, sharp focus" },
  { label: "Change Background", promptSuffix: ", with a new background: lush tropical garden, soft bokeh, natural lighting" },
  { label: "Fix Hands", promptSuffix: ", correct hand anatomy, detailed fingers, natural pose" },
  { label: "Remove Object", promptSuffix: ", remove distracting objects, clean composition, minimalist background" },
  { label: "Upscale 4K", promptSuffix: ", 4k upscale, ultra high resolution, enhanced details, crisp edges" },
  { label: "Create Variations", promptSuffix: ", alternative composition, different angle, same subject and mood" },
  { label: "Add Text", promptSuffix: ", with elegant typography overlay, bold sans-serif title text" },
];

/* ─── Component ───────────────────────────────────────────────────────── */

/** LiTT robot mascot SVG — illustrated robot with glowing eyes, antenna, chest light. */
function LiTTRobotMascot({ size = 80, color = "#a855f7" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      {/* Antenna */}
      <line x1="60" y1="8" x2="60" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="60" cy="6" r="3" fill={color}>
        <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
      </circle>
      {/* Head */}
      <rect x="32" y="22" width="56" height="44" rx="14" fill="#1a1530" stroke={color} strokeWidth="2" />
      {/* Eyes */}
      <circle cx="48" cy="42" r="5" fill={color}>
        <animate attributeName="opacity" values="1;0.6;1" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="72" cy="42" r="5" fill={color}>
        <animate attributeName="opacity" values="1;0.6;1" dur="3s" repeatCount="indefinite" />
      </circle>
      {/* Eye glow */}
      <circle cx="48" cy="42" r="8" fill={color} opacity="0.2" />
      <circle cx="72" cy="42" r="8" fill={color} opacity="0.2" />
      {/* Mouth */}
      <path d="M50 54 Q60 58 70 54" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6" />
      {/* Body */}
      <rect x="36" y="68" width="48" height="36" rx="10" fill="#1a1530" stroke={color} strokeWidth="2" />
      {/* Chest light */}
      <circle cx="60" cy="86" r="6" fill="#22d3ee">
        <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="60" cy="86" r="10" fill="#22d3ee" opacity="0.15" />
      {/* Arms */}
      <line x1="36" y1="76" x2="28" y2="84" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="84" y1="76" x2="92" y2="84" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Inspiration grid with real Unsplash photos and gradient fallbacks. */
const INSPIRATION_IMAGES = [
  { url: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=400&fit=crop", label: "Cyberpunk street", prompt: "Cyberpunk street at night, neon signs, rain reflections, cinematic", fallback: "linear-gradient(135deg, #0a0014, #ff006e)" },
  { url: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=400&h=400&fit=crop", label: "Forest cabin", prompt: "Cozy forest cabin in autumn, golden light, misty trees, photorealistic", fallback: "linear-gradient(135deg, #1a2e00, #4a7c00)" },
  { url: "https://images.unsplash.com/photo-1451187580459-9546f5f4f4f4?w=400&h=400&fit=crop", label: "Space station", prompt: "Space station interior, futuristic, blue glow, zero gravity, sci-fi", fallback: "linear-gradient(135deg, #000033, #0066ff)" },
  { url: "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400&h=400&fit=crop", label: "Neon portrait", prompt: "Neon lit portrait, magenta and cyan lighting, moody, cinematic", fallback: "linear-gradient(135deg, #1a0033, #ff00ff)" },
  { url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&h=400&fit=crop", label: "Mountain sunrise", prompt: "Mountain sunrise, golden hour, misty peaks, landscape photography", fallback: "linear-gradient(135deg, #2a1a00, #ff8800)" },
  { url: "https://images.unsplash.com/photo-1547036967-23d11aacaee0?w=400&h=400&fit=crop", label: "Abstract art", prompt: "Abstract 3D render, flowing shapes, iridescent, octane, vibrant", fallback: "linear-gradient(135deg, #001a33, #00ffcc)" },
];

/** Visual style cards — top 6 styles with image backgrounds. */
const VISUAL_STYLE_CARDS = [
  { label: "Cinematic", url: "https://images.unsplash.com/photo-1536440136628-849c29e73647?w=300&h=200&fit=crop", prompt: "cinematic film still", fallback: "linear-gradient(135deg, #1a0000, #8b0000)" },
  { label: "LiTTree Cyberpunk", url: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&h=200&fit=crop", prompt: "cyberpunk neon noir", fallback: "linear-gradient(135deg, #0a0014, #ff006e)" },
  { label: "Photoreal", url: "https://images.unsplash.com/photo-1502134249127-cc8f4c66a1c3?w=300&h=200&fit=crop", prompt: "photorealistic", fallback: "linear-gradient(135deg, #1a1a1a, #4a4a4a)" },
  { label: "Illustration", url: "https://images.unsplash.com/photo-1567095761124-6fd5d6fb8b14?w=300&h=200&fit=crop", prompt: "digital illustration", fallback: "linear-gradient(135deg, #1a0033, #6600ff)" },
  { label: "3D Render", url: "https://images.unsplash.com/photo-1547036967-23d11aacaee0?w=300&h=200&fit=crop", prompt: "3D render octane", fallback: "linear-gradient(135deg, #001a33, #00ddff)" },
  { label: "Anime", url: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=300&h=200&fit=crop", prompt: "anime studio ghibli", fallback: "linear-gradient(135deg, #001a00, #00ff88)" },
];

export default function ImageTool({ initialPrompt }: { initialPrompt?: string | null }) {
  const { resolvedColors: T } = useTheme();
  const { setActiveAssetId, projectId } = useStudioContext();

  /* ── Prompt state ── */
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const lastInitialPromptRef = useRef(initialPrompt);
  // P1-1: the chat image intent opens this surface with the user's prompt
  // prefilled. Sync when a NEW prefill arrives (e.g. a second "generate an
  // image" while the tool is already open) — never clobber in-progress
  // typing otherwise.
  useEffect(() => {
    if (initialPrompt && initialPrompt !== lastInitialPromptRef.current) {
      lastInitialPromptRef.current = initialPrompt;
      setPrompt(initialPrompt);
    }
  }, [initialPrompt]);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [remixMode, setRemixMode] = useState<RemixMode>("reskin");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // P1-1: synchronous double-submit guard. React state updates are async,
  // so two rapid taps on Generate before re-render would both pass the
  // isWorking check and double-bill. A ref flips synchronously.
  const generateInFlightRef = useRef(false);
  /* Auto-expand the mobile prompt box while typing (capped) */
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, [prompt]);

  /* ── Provider / format state ── */
  const [providerId, setProviderId] = useState<ProviderSelection>("auto-free");
  const [aspectRatio, setAspectRatio] = useState<
    "1:1" | "4:5" | "3:2" | "16:9" | "9:16"
  >("1:1");
  const [imageSize, setImageSize] = useState<"1K" | "2K">("1K");
  const [seed, setSeed] = useState<number>(0);
  const [batchSize, setBatchSize] = useState<1 | 2 | 4>(1);
  const [negativePromptOpen, setNegativePromptOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  const [imageHovered, setImageHovered] = useState(false);
  // Mobile: which generation is open in the full-screen preview (null = closed)
  const [previewGen, setPreviewGen] = useState<Generation | null>(null);
  // "Use in Project" save state per generation id (idle entries are absent)
  const [useInProjectState, setUseInProjectState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [useInProjectError, setUseInProjectError] = useState<Record<string, string>>({});
  // Mobile: which design section is expanded (accordion — one at a time)
  const [designOpen, setDesignOpen] = useState<"style" | "mood" | "ratio" | null>(null);

  /* ── UI state ── */
  // Use shared WalletContext rather than localStorage or ad-hoc fetches
  const { balance: coinBalance, refresh: refreshWallet } = useWallet();
  const [claiming, setClaiming] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"prompt" | "style" | "settings">(
    "prompt",
  );
  const [historyOpen, setHistoryOpen] = useState(false);
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
      if (["1:1", "4:5", "3:2", "16:9", "9:16"].includes(draft.aspectRatio || "")) setAspectRatio(draft.aspectRatio as typeof aspectRatio);
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

  const surpriseMe = useCallback(() => {
    const random = PROMPT_PRESETS[Math.floor(Math.random() * PROMPT_PRESETS.length)];
    setPrompt(random);
    setError(null);
    addLog("info", "Surprise prompt loaded");
  }, [addLog]);

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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setReferenceImage(ev.target?.result as string);
        addLog("info", `Reference dropped: ${file.name}`);
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

  // P1-1: promptOverride lets Regenerate call this directly with the
  // prompt it just loaded — React state updates are async, so reading
  // `prompt` here would see the stale pre-load value.
  const handleGenerate = useCallback(async (promptOverride?: string) => {
    const activePrompt = (promptOverride ?? prompt).trim();
    if (activePrompt.length < 3) {
      setError("Enter a prompt to generate.");
      return;
    }
    const totalCost = providerCost * batchSize;
    if (!canAfford) {
      setError(`Need ${totalCost} 🪙, have ${coinBalance ?? 0}.`);
      return;
    }

    // P1-1: synchronous double-submit guard — a ref flips instantly, while
    // the isWorking state (used by the button's disabled prop) lags a
    // render. Without this, two rapid taps both dispatch and double-bill.
    if (generateInFlightRef.current) {
      addLog("warn", "Generation already in flight — ignoring duplicate submit.");
      return;
    }
    generateInFlightRef.current = true;
    // P1-1: stable client-generated idempotency key for the logical
    // operation. The server (image-service) claims idempotency on
    // requestId, so a retry after a dropped response cannot double-charge.
    const requestId = crypto.randomUUID();

    setError(null);
    setImgError(null);
    setStatus("forging");
    addLog(
      "info",
      `⚡ Forging ${batchSize}× via ${currentProvider.label} · ${remixMode} mode`,
    );

    const finalPrompt = buildFinalPrompt(
      activePrompt,
      remixMode,
      !!referenceImage,
    );

    try {
    for (let i = 0; i < batchSize; i++) {
      const localId = `gen_${Date.now()}_${i}`;
      const newGen: Generation = {
        id: localId,
        prompt: activePrompt,
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
        // P1-1: send the stable idempotency key — server dedupes replays.
        body.requestId = requestId;

        if (referenceImage) {
          body.referenceUrl = referenceImage;
          body.strength = strength;
        }

        const data = await apiFetch<ApiJson>("/api/media/generate", {
          method: "POST",
          credentials: "include",
          body: JSON.stringify(body),
          // P1-1: providers take longer than the 30s default — a client
          // timeout while the server completes AND debits is the classic
          // "nothing happened" report. Never auto-retry a billed POST.
          timeoutMs: 120_000,
          retries: 0,
        });
        const downloadUrl = data.downloadUrl as string;
        const thumbUrl = data.thumbUrl as string | undefined;
        const isFree = data.free === true;
        const dataCost = typeof data.cost === "number" ? data.cost : 0;
        const assetId = data.assetId as string | null | undefined;
        const assetPersistenceFailed = data.assetPersistenceFailed === true;

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

        // Notify the Asset Lake that a new persistent asset exists.
        // The server already created a generation_jobs row — the
        // Assets panel just needs to refresh to pick it up.
        // Only notify if persistence actually succeeded.
        if (!assetPersistenceFailed) {
          notifyAssetsChanged();
        }

        // Auto-select the newly generated asset as the active asset.
        // Do NOT auto-select if persistence failed — there is no
        // canonical asset to select.
        if (assetId && !assetPersistenceFailed) {
          setActiveAssetId(assetId);
        }
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
    } finally {
      // P1-1: always release the double-submit guard, even on throw.
      generateInFlightRef.current = false;
    }
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
        await apiFetch<ApiJson>("/api/gallery", {
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            url: gen.fileUrl,
            caption: gen.prompt.slice(0, 200),
            type: "image",
            isPublic: gallerySharePublic,
            category: galleryCategory,
          }),
        });
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

  const handleQuickAction = useCallback(
    (suffix: string) => {
      setPrompt((prev) => prev + suffix);
      addLog("info", `LiTT quick action applied`);
    },
    [addLog],
  );

  const handleUseAsReference = useCallback(
    (url: string) => {
      setReferenceImage(url);
      addLog("info", "Image set as reference");
    },
    [addLog],
  );

  /* ── "Use in Project": save the generated image into the real project
   * workspace via POST /api/studio-projects/[projectId]/assets/insert, which
   * downloads the asset server-side and writes it as a binary file under
   * public/assets/images/. Returns true only when the image actually landed.
   * Callers must NOT close previews or claim success unless this returns true.
   */
  const handleUseInProject = useCallback(async (
    url: string,
    genId: string,
    name: string,
  ): Promise<boolean> => {
    if (!url) return false;
    const fail = (message: string, level: LogEntry["level"] = "error") => {
      setUseInProjectState((prev) => ({ ...prev, [genId]: "error" }));
      setUseInProjectError((prev) => ({ ...prev, [genId]: message }));
      addLog(level, message);
      return false;
    };
    if (!projectId) {
      return fail("No project open — open a Studio project to save this image into it.", "warn");
    }
    // Free providers return generated images as inline data:image/* URLs —
    // the bytes are already available to the server, so they insert the same
    // way as a public https URL.
    const isDataImage = /^data:image\//i.test(url);
    if (!url.startsWith("https://") && !isDataImage) {
      return fail("This image has no public URL, so it can't be saved into the project.");
    }
    setUseInProjectState((prev) => ({ ...prev, [genId]: "saving" }));
    setUseInProjectError((prev) => {
      const next = { ...prev };
      delete next[genId];
      return next;
    });
    const safeName =
      (name || "litt-image")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "litt-image";
    const dataMimeExt = isDataImage
      ? (/^data:image\/([a-z0-9]+)/i.exec(url)?.[1] ?? "").toLowerCase()
      : "";
    const urlExt = (url.split(".").pop()?.split("?")[0] || "").toLowerCase();
    const ext =
      dataMimeExt ||
      (urlExt && urlExt.length <= 5 && /^[a-z0-9]+$/.test(urlExt) ? urlExt : "png");
    const targetPath = `public/assets/images/${safeName}-${genId.slice(0, 8)}.${ext}`;
    try {
      const res = await fetch(`/api/studio-projects/${projectId}/assets/insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, path: targetPath, kind: "image", name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setUseInProjectState((prev) => ({ ...prev, [genId]: "saved" }));
      addLog("success", `Saved to project: ${targetPath}`);
      notifyAssetsChanged();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save image into the project.";
      return fail(`Use in Project failed: ${message}`);
    }
  }, [projectId, addLog]);

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
        setError("Daily bonus claimed! +50 AI credits");
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
      style={{ backgroundColor: "var(--glass-bg-0)", color: "var(--glass-text-1)" }}
    >
      {/* ── Top chrome ──────────────────────────────────────────────── */}
      <header
        className="shrink-0 flex items-center justify-between px-4 h-10 gap-3 glass-toolbar"
        style={{
          borderBottom: "1px solid var(--glass-border)",
          borderRadius: 0,
        }}
      >
        {/* Left: title + workspace tabs */}
        <div className="flex items-center gap-3 min-w-0 overflow-hidden">
          <div className="hidden md:flex items-center gap-1.5 shrink-0">
            <Sparkles size={13} className="text-accent" />
            <span
              className="text-[11px] font-black uppercase tracking-widest"
              style={{ color: "var(--glass-text-1)" }}
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
              borderColor: "var(--glass-border-green)",
              color: "var(--glass-green)",
              backgroundColor: "var(--glass-green-soft)",
            }}
          >
            <Coins size={10} /> {coinBalance ?? "—"}
          </div>
          <button
            onClick={handleClaimBonus}
            disabled={claiming}
            className="hidden md:flex h-6 px-2 items-center gap-1 rounded border text-[10px] font-bold transition-all hover:opacity-80 disabled:opacity-40"
            style={{
              borderColor: "var(--glass-border-purple)",
              color: "var(--glass-purple)",
              backgroundColor: "var(--glass-purple-soft)",
            }}
            title="Claim daily bonus"
          >
            <Gift size={9} /> {claiming ? "..." : "Claim"}
          </button>
          <button
            onClick={() => setShowLogs((v) => !v)}
            className="h-6 px-2 hidden md:flex items-center gap-1 rounded border text-[10px] font-bold transition-all hover:opacity-80"
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

        {/* ── MOBILE: Single-column workspace ────────────────────────
            Single vertical scroll container for the whole mobile image
            surface. overflow-x-clip keeps the edge-bleed chip rows from
            creating a page-level horizontal scroll context (which can trap
            vertical swipe gestures on Android); overflow-y-auto owns the
            vertical scroll. overscroll-contain blocks pull-to-refresh. */}
        <div
          className="md:hidden flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-clip overscroll-contain"
          style={{ backgroundColor: T.bgColor }}
          data-testid="image-mobile-scroller"
        >
          <div
            className="flex-1 px-4 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))] space-y-3"
          >
            {/* ══ MOBILE REBUILD — dedicated AI image generator ══ */}

            {/* 1 ── Prompt + Generate — first viewport */}
            <div className="space-y-2">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); setError(null); }}
                placeholder="Describe what you want to create..."
                rows={2}
                disabled={isWorking}
                className="w-full min-h-[3.25rem] max-h-32 px-3 py-2.5 text-sm rounded-xl outline-none resize-none overflow-y-auto disabled:opacity-50 transition-all focus:ring-1"
                style={{
                  backgroundColor: T.bgColor,
                  border: `1px solid ${T.borderColor}40`,
                  color: T.textColor,
                  lineHeight: "1.5",
                }}
                data-testid="image-prompt-input"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={enhancePrompt}
                    disabled={!prompt.trim() || isWorking}
                    className="flex items-center gap-1 min-h-[44px] px-3 rounded-xl border text-[11px] font-bold transition-all hover:opacity-80 disabled:opacity-30"
                    style={{ borderColor: T.accentColor + "40", color: T.accentColor }}
                  >
                    <Zap size={12} /> Enhance
                  </button>
                  <button
                    onClick={surpriseMe}
                    disabled={isWorking}
                    className="flex items-center gap-1 min-h-[44px] px-3 rounded-xl border text-[11px] font-bold transition-all hover:opacity-80 disabled:opacity-30"
                    style={{ borderColor: T.accentColor + "40", color: T.accentColor }}
                  >
                    <Sparkles size={12} /> Surprise
                  </button>
                </div>
                <span className="text-[10px] shrink-0" style={{ color: prompt.length > 900 ? "#e3b341" : T.textMuted + "60" }}>
                  {prompt.length} / 1000
                </span>
              </div>
              <button
                onClick={() => void handleGenerate()}
                disabled={!promptValid || !canAfford || isWorking}
                className="w-full min-h-[52px] rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed bg-accent text-on-accent hover:bg-accent-strong shadow-accent-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
                data-testid="generate-image-button"
              >
                {isWorking ? (
                  <><Loader2 size={16} className="animate-spin" /> Forging...</>
                ) : (
                  <><Sparkles size={16} /> Generate{batchSize > 1 ? ` ${batchSize}×` : ""}</>
                )}
              </button>
              {error && (
                <div
                  className="text-[11px] px-3 py-2.5 rounded-xl border"
                  style={{
                    backgroundColor: error.includes("✓") ? T.success + "12" : "#f8514912",
                    borderColor: error.includes("✓") ? T.success + "40" : "#f8514940",
                    color: error.includes("✓") ? T.success : "#f85149",
                  }}
                  role="alert"
                >
                  <div className="flex items-start gap-2">
                    {error.includes("✓") ? <CheckCircle2 size={13} className="mt-px shrink-0" /> : <AlertTriangle size={13} className="mt-px shrink-0" />}
                    <span className="flex-1">{error}</span>
                  </div>
                  {!error.includes("✓") && (
                    <button
                      onClick={() => void handleGenerate()}
                      disabled={isWorking}
                      className="mt-2 w-full min-h-[44px] rounded-lg border font-bold flex items-center justify-center gap-2 disabled:opacity-40"
                      style={{ borderColor: "#f8514960", color: "#f85149" }}
                    >
                      <RefreshCw size={13} /> Try again
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 2 ── Result hero — the artwork is the focus */}
            <div data-testid="image-result-hero">
              {currentResult?.fileUrl ? (
                <div>
                  <button
                    onClick={() => setPreviewGen(currentResult)}
                    className="block w-full text-left rounded-2xl overflow-hidden border transition-transform active:scale-[0.99]"
                    style={{ borderColor: T.borderColor + "40" }}
                    aria-label="Open image preview"
                    data-testid="image-hero-open-preview"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={currentResult.fileUrl}
                      alt={currentResult.prompt}
                      className="w-full object-cover"
                      style={{ aspectRatio: `${currentAspect.width} / ${currentAspect.height}` }}
                      onError={() => setImgError("Failed to load image")}
                      data-testid="generated-image"
                    />
                  </button>
                  {imgError ? (
                    <div className="mt-1.5 text-[11px] px-3 py-2 rounded-lg" style={{ backgroundColor: "#f8514912", color: "#f85149" }}>
                      {imgError}
                    </div>
                  ) : (
                    <p className="px-1 pt-1.5 text-[11px] line-clamp-2" style={{ color: T.textMuted }}>
                      {currentResult.prompt}
                    </p>
                  )}
                </div>
              ) : isWorking ? (
                <div
                  className="rounded-2xl border overflow-hidden"
                  style={{
                    borderColor: T.borderColor + "40",
                    backgroundColor: T.boxBg,
                    aspectRatio: `${currentAspect.width} / ${currentAspect.height}`,
                    maxHeight: 420,
                  }}
                  aria-busy="true"
                  aria-label="Generating image"
                  data-testid="image-generating-skeleton"
                >
                  <div className="h-full w-full flex flex-col items-center justify-center gap-2 animate-pulse">
                    <Loader2 size={28} className="animate-spin text-accent" />
                    <span className="text-xs font-bold" style={{ color: T.textMuted }}>
                      Forging your image…
                    </span>
                    <span className="text-[10px]" style={{ color: T.textMuted + "80" }}>
                      {currentAspect.label} · {providerId === "auto-free" ? "Free" : providerId === "auto-quality" ? "Quality" : "Pro"} model
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  className="rounded-2xl border border-dashed flex flex-col items-center justify-center gap-1.5 py-8"
                  style={{ borderColor: T.borderColor + "50", color: T.textMuted }}
                  data-testid="image-empty-state"
                >
                  <ImagePlus size={26} style={{ color: T.accentColor + "80" }} />
                  <span className="text-xs font-bold">Your creation appears here</span>
                  <span className="text-[10px] opacity-70">Describe it above and hit Generate</span>
                </div>
              )}
            </div>

            {/* 3 ── Design controls — Style / Mood / Ratio (wrapping, collapsed) */}
            <div className="rounded-2xl border p-3 space-y-1" style={sectionBox}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                  Design
                </span>
                {(selectedStyle || selectedMood) && (
                  <button
                    onClick={() => { setSelectedStyle(null); setSelectedMood(null); addLog("info", "Style & mood cleared"); }}
                    disabled={isWorking}
                    className="min-h-[44px] px-2 text-[10px] font-bold disabled:opacity-40"
                    style={{ color: T.accentColor }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Style */}
              <div className="rounded-xl overflow-hidden">
                <button
                  onClick={() => setDesignOpen(designOpen === "style" ? null : "style")}
                  className="w-full min-h-[48px] flex items-center justify-between px-1"
                  aria-expanded={designOpen === "style"}
                >
                  <span className="flex items-center gap-2 text-xs font-bold" style={{ color: T.textColor }}>
                    <Palette size={13} style={{ color: T.accentColor }} /> Style
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] truncate max-w-[55%]" style={{ color: T.textMuted }}>
                    <span className="truncate">{selectedStyle ?? "None"}</span>
                    <ChevronDown size={13} className={`shrink-0 transition-transform ${designOpen === "style" ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {designOpen === "style" && (
                  <div className="flex flex-wrap gap-1.5 pb-2 pt-1">
                    {STYLE_PRESETS.map((style) => (
                      <button
                        key={style}
                        onClick={() => { setSelectedStyle(selectedStyle === style ? null : style); addLog("info", `Style: ${style}`); }}
                        disabled={isWorking}
                        className="min-h-[44px] px-3 text-[11px] font-bold rounded-full border transition-all disabled:opacity-40"
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
                )}
              </div>

              {/* Mood */}
              <div className="rounded-xl overflow-hidden" style={{ borderTop: `1px solid ${T.borderColor}20` }}>
                <button
                  onClick={() => setDesignOpen(designOpen === "mood" ? null : "mood")}
                  className="w-full min-h-[48px] flex items-center justify-between px-1"
                  aria-expanded={designOpen === "mood"}
                >
                  <span className="flex items-center gap-2 text-xs font-bold" style={{ color: T.textColor }}>
                    <Flame size={13} style={{ color: T.accentColor }} /> Mood
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] truncate max-w-[55%]" style={{ color: T.textMuted }}>
                    <span className="truncate">{selectedMood ?? "None"}</span>
                    <ChevronDown size={13} className={`shrink-0 transition-transform ${designOpen === "mood" ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {designOpen === "mood" && (
                  <div className="flex flex-wrap gap-1.5 pb-2 pt-1">
                    {MOOD_PRESETS.map((mood) => (
                      <button
                        key={mood}
                        onClick={() => { setSelectedMood(selectedMood === mood ? null : mood); addLog("info", `Mood: ${mood}`); }}
                        disabled={isWorking}
                        className="min-h-[44px] px-3 text-[11px] font-bold rounded-full border transition-all disabled:opacity-40"
                        style={{
                          borderColor: selectedMood === mood ? T.accentColor : T.borderColor + "60",
                          color: selectedMood === mood ? T.accentColor : T.textMuted,
                          backgroundColor: selectedMood === mood ? T.accentColor + "15" : T.bgColor,
                        }}
                      >
                        {mood}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Ratio */}
              <div className="rounded-xl overflow-hidden" style={{ borderTop: `1px solid ${T.borderColor}20` }}>
                <button
                  onClick={() => setDesignOpen(designOpen === "ratio" ? null : "ratio")}
                  className="w-full min-h-[48px] flex items-center justify-between px-1"
                  aria-expanded={designOpen === "ratio"}
                >
                  <span className="flex items-center gap-2 text-xs font-bold" style={{ color: T.textColor }}>
                    <Layout size={13} style={{ color: T.accentColor }} /> Ratio
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px]" style={{ color: T.textMuted }}>
                    {aspectRatio}
                    <ChevronDown size={13} className={`shrink-0 transition-transform ${designOpen === "ratio" ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {designOpen === "ratio" && (
                  <div className="flex flex-wrap gap-1.5 pb-2 pt-1">
                    {ASPECT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { setAspectRatio(opt.value); addLog("info", `Aspect ratio: ${opt.label}`); }}
                        disabled={isWorking}
                        className="min-h-[44px] px-3 text-[11px] font-bold rounded-xl border transition-all disabled:opacity-40"
                        style={pill(aspectRatio === opt.value)}
                      >
                        {opt.icon} {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* More — opens the bottom sheet */}
              <button
                onClick={() => setAdvancedOpen(true)}
                className="w-full min-h-[48px] mt-1 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all"
                style={pill(false)}
              >
                <SlidersHorizontal size={13} /> More settings
              </button>
            </div>

            {/* 4 ── Reference image — compact row */}
            <div
              className="rounded-2xl border flex items-center gap-2.5 pl-2 pr-2.5 min-h-[3.5rem] overflow-hidden"
              style={sectionBox}
            >
              {referenceImage ? (
                <Image src={referenceImage} alt="Reference" width={40} height={40} unoptimized={referenceImage.startsWith("blob:") || referenceImage.startsWith("data:")} className="w-10 h-10 rounded-lg object-cover shrink-0" />
              ) : (
                <div
                  className="w-10 h-10 rounded-lg border border-dashed flex items-center justify-center shrink-0"
                  style={{ borderColor: T.borderColor + "60", color: T.textMuted }}
                >
                  <ImagePlus size={16} />
                </div>
              )}
              <span className="flex-1 min-w-0 text-[11px] font-bold truncate" style={{ color: T.textMuted }}>
                {referenceImage ? "Reference attached" : "Reference image (optional)"}
              </span>
              <button
                onClick={() => {
                  if (referenceImage) {
                    setReferenceImage(null);
                    addLog("info", "Reference cleared");
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                disabled={isWorking}
                className="min-h-[44px] px-4 rounded-xl border text-[11px] font-bold transition-all hover:opacity-80 disabled:opacity-40 shrink-0"
                style={pill(!!referenceImage)}
              >
                {referenceImage ? "Remove" : "Upload"}
              </button>
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

            {/* 5 ── Recent generations — responsive grid */}
            {history.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                  Recent generations
                </span>
                <div className="grid grid-cols-3 gap-2" data-testid="image-recents-grid">
                  {history.slice(0, 9).map((g) => (
                    <button
                      key={g.id}
                      onClick={() => { if (g.fileUrl) setPreviewGen(g as Generation); }}
                      disabled={!g.fileUrl}
                      className="relative aspect-square rounded-xl overflow-hidden border min-h-[44px] transition-transform active:scale-[0.98] disabled:opacity-60"
                      style={{
                        borderColor: currentResult?.id === g.id ? T.accentColor : T.borderColor + "40",
                        backgroundColor: T.boxBg,
                      }}
                      aria-label={`Preview: ${g.prompt.slice(0, 60)}`}
                      data-testid="canvas-recent-card"
                    >
                      {g.thumbUrl || g.fileUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.thumbUrl || g.fileUrl} alt={g.prompt} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <AlertTriangle size={16} style={{ color: "#f85149" }} />
                        </div>
                      )}
                      {g.status !== "succeeded" && g.fileUrl && (
                        <span className="absolute bottom-1 left-1 text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(0,0,0,.6)", color: "#e3b341" }}>
                          {g.status}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 6 ── Prompt suggestions — responsive cards */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                Try a prompt
              </span>
              <div className="grid grid-cols-1 gap-2">
                {PROMPT_PRESETS.slice(0, 4).map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handleUsePrompt(p)}
                    disabled={isWorking}
                    className="min-h-[52px] text-left text-[12px] leading-snug px-3 py-2.5 rounded-xl border hover:opacity-80 disabled:opacity-40 line-clamp-2 transition-all"
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
          </div>
        </div>

        {/* ── MOBILE: More-settings bottom sheet ─────────────────────── */}
        {advancedOpen && (
          <div className="md:hidden fixed inset-0 z-[10030]" data-testid="image-more-sheet" role="dialog" aria-label="More image settings">
            <div className="absolute inset-0 bg-black/60" onClick={() => setAdvancedOpen(false)} aria-hidden />
            <div
              className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
              style={{ backgroundColor: T.bgColor, borderColor: T.borderColor + "40" }}
            >
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" aria-hidden />
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-black" style={{ color: T.textColor }}>More settings</span>
                <button
                  onClick={() => setAdvancedOpen(false)}
                  className="min-h-[44px] min-w-[44px] grid place-items-center rounded-xl border"
                  style={{ borderColor: T.borderColor + "40", color: T.textMuted }}
                  aria-label="Close settings"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-4">
                {/* Lighting */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                    Lighting{selectedLighting ? `: ${selectedLighting}` : ""}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {LIGHTING_PRESETS.map((l) => (
                      <button
                        key={l}
                        onClick={() => { setSelectedLighting(selectedLighting === l ? null : l); addLog("info", `Lighting: ${l}`); }}
                        disabled={isWorking}
                        className="min-h-[44px] px-3 text-[11px] font-bold rounded-full border transition-all disabled:opacity-40"
                        style={{
                          borderColor: selectedLighting === l ? T.accentColor : T.borderColor + "60",
                          color: selectedLighting === l ? T.accentColor : T.textMuted,
                          backgroundColor: selectedLighting === l ? T.accentColor + "15" : T.bgColor,
                        }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Camera */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                    Camera{selectedCamera ? `: ${selectedCamera}` : ""}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {CAMERA_PRESETS.map((c) => (
                      <button
                        key={c}
                        onClick={() => { setSelectedCamera(selectedCamera === c ? null : c); addLog("info", `Camera: ${c}`); }}
                        disabled={isWorking}
                        className="min-h-[44px] px-3 text-[11px] font-bold rounded-full border transition-all disabled:opacity-40"
                        style={{
                          borderColor: selectedCamera === c ? T.accentColor : T.borderColor + "60",
                          color: selectedCamera === c ? T.accentColor : T.textMuted,
                          backgroundColor: selectedCamera === c ? T.accentColor + "15" : T.bgColor,
                        }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Model */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                    Model
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {PROVIDER_OPTIONS.map((p) => {
                      const ready = isProviderReady(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => setProviderId(p.id)}
                          disabled={isWorking || (!ready && p.id !== "auto-free" && p.id !== "auto-quality")}
                          className="min-h-[44px] px-3 text-[11px] font-bold rounded-full border transition-all disabled:opacity-40"
                          style={pill(providerId === p.id)}
                        >
                          {p.label}{p.cost === 0 ? "" : ` · ${p.cost}🪙`}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Quality + Batch */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                      Quality
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {QUALITY_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => {
                            setQualityPreset(preset.id);
                            setInferenceSteps(preset.steps);
                            setGuidanceScale(preset.cfg);
                          }}
                          disabled={isWorking}
                          className="min-h-[44px] rounded-xl border text-[11px] font-bold transition-all disabled:opacity-40"
                          style={pill(qualityPreset === preset.id)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                      Batch
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([1, 2, 4] as const).map((n) => (
                        <button
                          key={n}
                          onClick={() => setBatchSize(n)}
                          disabled={isWorking}
                          className="min-h-[44px] rounded-xl border text-[11px] font-bold transition-all disabled:opacity-40"
                          style={pill(batchSize === n)}
                        >
                          {n}×
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {(selectedStyle || selectedLighting || selectedMood || selectedCamera || selectedQualityTag) && (
                  <button
                    onClick={() => {
                      setSelectedStyle(null);
                      setSelectedLighting(null);
                      setSelectedMood(null);
                      setSelectedCamera(null);
                      setSelectedQualityTag(null);
                      addLog("info", "All enhancements cleared");
                    }}
                    disabled={isWorking}
                    className="w-full min-h-[44px] rounded-xl border text-[11px] font-bold disabled:opacity-40"
                    style={{ borderColor: T.borderColor + "40", color: T.textMuted }}
                  >
                    Clear all enhancements
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── MOBILE: full-screen preview ────────────────────────────── */}
        {previewGen && (
          <div className="md:hidden fixed inset-0 z-[10040]" data-testid="image-preview" role="dialog" aria-label="Image preview">
            <div className="absolute inset-0 bg-black/90" onClick={() => setPreviewGen(null)} aria-hidden />
            <div className="absolute inset-0 flex flex-col p-4 pt-[calc(12px+env(safe-area-inset-top))] pb-[calc(12px+env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <span className="text-sm font-black text-white">Preview</span>
                <button
                  onClick={() => setPreviewGen(null)}
                  className="min-h-[44px] min-w-[44px] grid place-items-center rounded-xl border border-white/15 text-white/80"
                  aria-label="Close preview"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 min-h-0 flex items-center justify-center">
                {previewGen.fileUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewGen.fileUrl}
                    alt={previewGen.prompt}
                    className="max-h-full max-w-full rounded-2xl object-contain"
                    data-testid="image-preview-img"
                  />
                ) : (
                  <div className="text-white/60 text-xs">No image available</div>
                )}
              </div>
              <p className="shrink-0 px-1 py-2 text-[11px] line-clamp-2 text-white/70">
                {previewGen.prompt}
              </p>
              {useInProjectError[previewGen.id] && (
                <p className="shrink-0 px-1 pb-1 text-[11px] font-semibold text-red-300" role="alert" data-testid="use-in-project-error">
                  Couldn&apos;t save to project: {useInProjectError[previewGen.id]} — tap Use in Project to retry.
                </p>
              )}
              <div className="shrink-0 grid grid-cols-2 gap-2">
                <button
                  onClick={async () => {
                    if (!previewGen.fileUrl) return;
                    // Only close the preview when the image REALLY landed in the project.
                    const ok = await handleUseInProject(previewGen.fileUrl, previewGen.id, previewGen.prompt);
                    if (ok) setPreviewGen(null);
                  }}
                  disabled={useInProjectState[previewGen.id] === "saving"}
                  data-testid="use-in-project-button"
                  className="min-h-[48px] rounded-xl font-bold text-[12px] flex items-center justify-center gap-2 text-on-accent disabled:opacity-40 bg-accent hover:bg-accent-strong border border-accent"
                >
                  {useInProjectState[previewGen.id] === "saving"
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Palette size={14} />}
                  {useInProjectState[previewGen.id] === "saving" ? "Saving…" : "Use in Project"}
                </button>
                <button
                  onClick={() => { if (previewGen.fileUrl) handleDownload(previewGen.fileUrl, previewGen.prompt); }}
                  className="min-h-[48px] rounded-xl font-bold text-[12px] flex items-center justify-center gap-2 text-white"
                  style={{ backgroundColor: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.14)" }}
                >
                  <Download size={14} /> Download
                </button>
                <button
                  onClick={() => {
                    const g = previewGen;
                    setPreviewGen(null);
                    setPrompt(g.prompt);
                    setError(null);
                    addLog("info", "Prompt loaded for regenerate");
                    setTimeout(() => {
                      document.getElementById("image-mobile-scroller")?.scrollTo({ top: 0, behavior: "smooth" });
                      // P1-1: call the handler directly with the loaded
                      // prompt. The old document.querySelector(...).click()
                      // silently no-ops when the generate button is not
                      // mounted — a true "tap, nothing happens" dead flow.
                      void handleGenerate(g.prompt);
                    }, 60);
                  }}
                  disabled={isWorking}
                  className="min-h-[48px] rounded-xl font-bold text-[12px] flex items-center justify-center gap-2 text-white disabled:opacity-40"
                  style={{ backgroundColor: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.14)" }}
                >
                  <RefreshCw size={14} /> Regenerate
                </button>
                <button
                  onClick={() => {
                    const g = previewGen;
                    setPreviewGen(null);
                    setPrompt(g.prompt);
                    setError(null);
                    setTimeout(() => {
                      document.getElementById("image-mobile-scroller")?.scrollTo({ top: 0, behavior: "smooth" });
                      promptRef.current?.focus();
                    }, 60);
                  }}
                  className="min-h-[48px] rounded-xl font-bold text-[12px] flex items-center justify-center gap-2 text-white"
                  style={{ backgroundColor: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.14)" }}
                >
                  <Wand2 size={14} /> Edit
                </button>
                <button
                  onClick={() => { deleteGeneration(previewGen.id); setPreviewGen(null); }}
                  className="col-span-2 min-h-[48px] rounded-xl font-bold text-[12px] flex items-center justify-center gap-2"
                  style={{ backgroundColor: "rgba(248,81,73,.12)", border: "1px solid rgba(248,81,73,.35)", color: "#f85149" }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── LEFT PANEL: Controls (desktop only) ─────────────────── */}
        <div
          className="hidden md:flex shrink-0 flex-col overflow-hidden glass-panel"
          style={{
            "--left-panel-width": `${leftWidth}px`,
            borderRight: "1px solid var(--glass-border)",
            borderRadius: 0,
            width: `${leftWidth}px`,
          } as CSSProperties}
        >

          {/* Tab nav — segmented control */}
          <div className="flex shrink-0 gap-0.5 px-3 pt-3 pb-2">
            <div className="flex w-full items-center gap-0.5 rounded-lg p-0.5" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
              {(["prompt", "style", "settings"] as const).map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className="flex-1 h-7 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all"
                    style={{
                      backgroundColor: isActive ? "var(--glass-purple-soft)" : "transparent",
                      border: isActive ? "1px solid var(--glass-border-purple)" : "1px solid transparent",
                      color: isActive ? "var(--glass-purple)" : "var(--glass-text-2)",
                    }}
                  >
                    {tab === "prompt" ? "Prompt" : tab === "style" ? "Style" : "Settings"}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── PROMPT TAB ── */}
          {activeTab === "prompt" && (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-24 space-y-3">
              {/* Main prompt */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    className="text-[9px] font-bold uppercase tracking-widest"
                    style={{ color: T.textMuted }}
                  >
                    Prompt
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={surpriseMe}
                      disabled={isWorking}
                      className="flex items-center gap-1 h-5 px-2 rounded border text-[9px] font-bold transition-all hover:opacity-80 disabled:opacity-30"
                      style={{
                        borderColor: T.accentColor + "40",
                        color: T.accentColor,
                      }}
                    >
                      <Sparkles size={8} /> Surprise Me
                    </button>
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
                  style={{ color: prompt.length > 900 ? "#e3b341" : T.textMuted + "60" }}
                >
                  {prompt.length} / 1000
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
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
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
                    <Image
                      src={referenceImage}
                      alt="Reference"
                      width={400}
                      height={96}
                      unoptimized={referenceImage.startsWith("blob:") || referenceImage.startsWith("data:")}
                      className="object-cover"
                      style={{ width: "100%", height: "6rem" }}
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
                    <Upload size={14} /> Upload or drag & drop
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
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-24 space-y-3">
              {/* Visual style cards — thumbnail grid */}
              <div className="rounded-lg border overflow-hidden" style={sectionBox}>
                <div className="px-3 py-2">
                  <span className="text-[10px] font-bold" style={{ color: T.textMuted }}>
                    Style Presets
                  </span>
                  <p className="text-[9px] mt-0.5 opacity-60" style={{ color: T.textMuted }}>
                    Tap a visual style to apply
                  </p>
                </div>
                <div className="px-3 pb-3 grid grid-cols-3 gap-1.5">
                  {VISUAL_STYLE_CARDS.map((card) => {
                    const isSelected = selectedStyle === card.prompt;
                    return (
                      <button
                        key={card.label}
                        onClick={() => { setSelectedStyle(card.prompt); addLog("info", `Style: ${card.label}`); }}
                        disabled={isWorking}
                        className="relative aspect-[16/10] rounded-lg overflow-hidden border transition-all hover:scale-[1.03] disabled:opacity-40 group"
                        style={{
                          borderColor: isSelected ? "var(--glass-border-purple)" : "var(--glass-border)",
                          boxShadow: isSelected ? "0 0 12px rgba(139,92,246,0.25)" : "none",
                          backgroundColor: "rgba(20,15,30,0.82)",
                        }}
                      >
                        <div className="absolute inset-0" style={{ background: card.fallback }} />
                        <Image
                          src={card.url}
                          alt={card.label}
                          fill
                          sizes="160px"
                          className="object-cover transition-opacity duration-300 opacity-0"
                          onLoad={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "1"; }}
                          onError={(e) => {
                            const img = e.currentTarget as HTMLImageElement;
                            img.style.display = "none";
                            img.parentElement?.classList.add("style-card-error");
                          }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                        <span className="absolute bottom-1 left-1.5 text-[8px] font-bold text-white drop-shadow leading-tight">
                          {card.label}
                        </span>
                        {isSelected && (
                          <div className="absolute top-1 right-1 grid h-4 w-4 place-items-center rounded-full" style={{ backgroundColor: "var(--glass-purple)" }}>
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* More style presets — text pills */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: T.textMuted }}
                  >
                    More Styles
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
                        className="p-2 text-left rounded-md border transition-all hover:scale-[1.01] disabled:opacity-40"
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
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-24 space-y-3">
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

              {/* Advanced settings drawer */}
              <div
                className="rounded-lg border overflow-hidden"
                style={sectionBox}
              >
                <button
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-[10px] font-bold"
                  style={{ color: T.textMuted }}
                >
                  <span className="flex items-center gap-1.5">
                    <Layers size={11} style={{ color: T.accentColor }} />
                    Advanced
                  </span>
                  {advancedOpen ? (
                    <ChevronUp size={11} />
                  ) : (
                    <ChevronDown size={11} />
                  )}
                </button>
                {advancedOpen && (
                  <div className="px-3 pb-3 space-y-3">
                    {/* Quality Preset */}
                    <div>
                      <span className="text-[9px] font-bold" style={{ color: T.textMuted }}>
                        Quality Preset
                      </span>
                      <div className="grid grid-cols-2 gap-1.5 mt-1.5">
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
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold" style={{ color: T.textMuted }}>
                          Guidance (CFG)
                        </span>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: T.accentColor + "20",
                            color: T.accentColor,
                          }}
                        >
                          {guidanceScale.toFixed(1)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={15}
                        step={0.5}
                        value={guidanceScale}
                        onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                        disabled={isWorking}
                        aria-label="Guidance scale (CFG)"
                        title="Guidance scale (CFG)"
                        className="w-full accent-current cursor-pointer mt-1.5"
                        style={{ accentColor: T.accentColor }}
                      />
                    </div>

                    {/* Inference Steps */}
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold" style={{ color: T.textMuted }}>
                          Steps
                        </span>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: T.accentColor + "20",
                            color: T.accentColor,
                          }}
                        >
                          {inferenceSteps}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        step={5}
                        value={inferenceSteps}
                        onChange={(e) => setInferenceSteps(parseInt(e.target.value))}
                        disabled={isWorking}
                        aria-label="Inference steps"
                        title="Inference steps"
                        className="w-full accent-current cursor-pointer mt-1.5"
                        style={{ accentColor: T.accentColor }}
                      />
                    </div>

                    {/* Sampling Method */}
                    <div>
                      <span className="text-[9px] font-bold" style={{ color: T.textMuted }}>
                        Sampler
                      </span>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {SAMPLER_OPTIONS.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setSampler(s.id)}
                            disabled={isWorking}
                            className="px-2 py-1 text-[9px] font-bold rounded border transition-all disabled:opacity-40"
                            style={pill(sampler === s.id)}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Img2Img Strength (when using reference) */}
                    {referenceImage && (
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold" style={{ color: T.textMuted }}>
                            Img2Img Strength
                          </span>
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: T.accentColor + "20",
                              color: T.accentColor,
                            }}
                          >
                            {Math.round(strength * 100)}%
                          </span>
                        </div>
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
                          className="w-full accent-current cursor-pointer mt-1.5"
                          style={{ accentColor: T.accentColor }}
                        />
                      </div>
                    )}

                    {/* Seed */}
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold" style={{ color: T.textMuted }}>
                          Seed
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setSeedLocked(!seedLocked)}
                            className="text-[8px] px-1.5 py-0.5 rounded border transition-all"
                            style={{
                              borderColor: seedLocked ? T.accentColor : T.borderColor + "60",
                              color: seedLocked ? T.accentColor : T.textMuted,
                              backgroundColor: seedLocked ? T.accentColor + "15" : "transparent",
                            }}
                          >
                            {seedLocked ? "Locked" : "Random"}
                          </button>
                          <button
                            onClick={() => setSeed(Math.floor(Math.random() * 2147483647))}
                            disabled={isWorking || seedLocked}
                            className="text-[8px] px-1.5 py-0.5 rounded border transition-all hover:opacity-80 disabled:opacity-40"
                            style={{ borderColor: T.borderColor + "60", color: T.accentColor }}
                          >
                            🎲
                          </button>
                        </div>
                      </div>
                      <input
                        type="number"
                        value={seed}
                        onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                        min={0}
                        max={2147483647}
                        disabled={isWorking}
                        aria-label="Seed"
                        title="Seed for reproducible generation"
                        placeholder="0"
                        className="w-full px-2.5 py-1.5 text-[10px] rounded-md outline-none disabled:opacity-40 mt-1.5"
                        style={{
                          backgroundColor: T.bgColor,
                          border: `1px solid ${T.borderColor}40`,
                          color: T.textColor,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Generate button — always visible ── */}
          <div className="shrink-0 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-3 pt-2 space-y-2 border-t" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--glass-surface-3)" }}>
            <button
              onClick={() => void handleGenerate()}
              disabled={!promptValid || !canAfford || isWorking}
              className="w-full h-11 rounded-xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed bg-accent text-on-accent hover:bg-accent-strong shadow-accent-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
              data-testid="generate-image-button"
            >
              {isWorking ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Forging...
                </>
              ) : (
                <>
                  <Sparkles size={16} /> Generate{" "}
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
                className="shrink-0 flex items-center justify-between px-4 h-9 glass-toolbar"
                style={{ borderBottom: "1px solid var(--glass-border)", borderRadius: 0 }}
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
                      onClick={() => void handleGenerate()}
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
                style={{
                  background: "radial-gradient(circle at 50% 35%, rgba(139,92,246,0.09), transparent 40%), var(--glass-bg-0)",
                }}
              >
                {currentResult?.fileUrl ? (
                  <>
                    <div
                      className="relative max-w-full max-h-full"
                      onMouseEnter={() => setImageHovered(true)}
                      onMouseLeave={() => setImageHovered(false)}
                    >
                      <Image
                        src={currentResult.fileUrl}
                        alt={currentResult.prompt}
                        width={1024}
                        height={1024}
                        unoptimized={currentResult.fileUrl.startsWith("blob:") || currentResult.fileUrl.startsWith("data:")}
                        className="object-contain"
                        style={{ borderRadius: "4px", maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" }}
                        onError={() => setImgError("Image failed to load.")}
                        onLoad={() => setImgError(null)}
                      />
                      {/* Favorite heart button — top right */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const id = currentResult.id;
                          if (!id) return;
                          setFavoritedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          });
                        }}
                        className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-lg transition-all"
                        style={{
                          backgroundColor: "rgba(8,6,15,.55)",
                          border: "none",
                        }}
                        aria-label="Favorite"
                        title="Favorite"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill={favoritedIds.has(currentResult.id ?? "") ? "#FF5263" : "none"} stroke={favoritedIds.has(currentResult.id ?? "") ? "#FF5263" : "rgba(255,255,255,.7)"} strokeWidth="2" aria-hidden>
                          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
                        </svg>
                      </button>
                      {/* Hover action overlay — bottom bar with quick actions */}
                      {imageHovered && !imgError && (
                        <div
                          className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3"
                          style={{
                            background: "linear-gradient(to top, rgba(8,6,15,.88) 0%, rgba(8,6,15,.5) 60%, transparent 100%)",
                          }}
                        >
                          {/* LiTT quick actions row */}
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-[9px] font-bold uppercase tracking-wider mr-1" style={{ color: "var(--glass-text-3)" }}>LiTT</span>
                            {LITT_QUICK_ACTIONS.slice(0, 4).map((action) => (
                              <button
                                key={action.label}
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleQuickAction(action.promptSuffix); }}
                                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold transition hover:bg-white/20"
                                style={{
                                  backgroundColor: "rgba(139,92,246,.18)",
                                  border: "1px solid rgba(139,92,246,.35)",
                                  color: "rgba(200,160,255,.95)",
                                }}
                                aria-label={action.label}
                                title={action.label}
                              >
                                <Sparkles size={8} className="pointer-events-none" />
                                {action.label}
                              </button>
                            ))}
                          </div>
                          {/* Main action buttons row */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="mr-auto text-[10px] text-white/70 line-clamp-1 max-w-[40%]">
                              {currentResult.prompt}
                            </span>
                            {/* P1-1: explicit buttons — the actions array pattern trips the react-hooks/refs rule once handleGenerate reads the in-flight ref */}
                            <button
                              key={"Download"}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDownload(currentResult.fileUrl!, currentResult.prompt); }}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold transition hover:bg-white/20"
                              style={{
                                backgroundColor: "rgba(255,255,255,.09)",
                                border: "1px solid rgba(255,255,255,.12)",
                                color: "rgba(255,255,255,.8)",
                              }}
                              aria-label={"Download"}
                              title={"Download"}
                            >
                              <Download size={10} className="pointer-events-none" />
                              <span className="hidden sm:inline">{"Download"}</span>
                            </button>
                            <button
                              key={"Edit"}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setPrompt(currentResult.prompt); }}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold transition hover:bg-white/20"
                              style={{
                                backgroundColor: "rgba(255,255,255,.09)",
                                border: "1px solid rgba(255,255,255,.12)",
                                color: "rgba(255,255,255,.8)",
                              }}
                              aria-label={"Edit"}
                              title={"Edit"}
                            >
                              <Wand2 size={10} className="pointer-events-none" />
                              <span className="hidden sm:inline">{"Edit"}</span>
                            </button>
                            <button
                              key={"Variations"}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleGenerate(); }}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold transition hover:bg-white/20"
                              style={{
                                backgroundColor: "rgba(255,255,255,.09)",
                                border: "1px solid rgba(255,255,255,.12)",
                                color: "rgba(255,255,255,.8)",
                              }}
                              aria-label={"Variations"}
                              title={"Variations"}
                            >
                              <Copy size={10} className="pointer-events-none" />
                              <span className="hidden sm:inline">{"Variations"}</span>
                            </button>
                            <button
                              key={"Upscale"}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleQuickAction(", 4k upscale, ultra high resolution, enhanced details"); }}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold transition hover:bg-white/20"
                              style={{
                                backgroundColor: "rgba(255,255,255,.09)",
                                border: "1px solid rgba(255,255,255,.12)",
                                color: "rgba(255,255,255,.8)",
                              }}
                              aria-label={"Upscale"}
                              title={"Upscale"}
                            >
                              <Maximize2 size={10} className="pointer-events-none" />
                              <span className="hidden sm:inline">{"Upscale"}</span>
                            </button>
                            <button
                              key={"Remove BG"}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleQuickAction(", remove background, transparent background, isolated subject"); }}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold transition hover:bg-white/20"
                              style={{
                                backgroundColor: "rgba(255,255,255,.09)",
                                border: "1px solid rgba(255,255,255,.12)",
                                color: "rgba(255,255,255,.8)",
                              }}
                              aria-label={"Remove BG"}
                              title={"Remove BG"}
                            >
                              <Eraser size={10} className="pointer-events-none" />
                              <span className="hidden sm:inline">{"Remove BG"}</span>
                            </button>
                            <button
                              key={"Use as Ref"}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleUseAsReference(currentResult.fileUrl!); }}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold transition hover:bg-white/20"
                              style={{
                                backgroundColor: "rgba(255,255,255,.09)",
                                border: "1px solid rgba(255,255,255,.12)",
                                color: "rgba(255,255,255,.8)",
                              }}
                              aria-label={"Use as Ref"}
                              title={"Use as Ref"}
                            >
                              <Layers size={10} className="pointer-events-none" />
                              <span className="hidden sm:inline">{"Use as Ref"}</span>
                            </button>
                            <button
                              key={useInProjectState[currentResult.id] === "saving" ? "Saving\u2026" : "Use in Project"}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); if (currentResult.fileUrl) void handleUseInProject(currentResult.fileUrl, currentResult.id, currentResult.prompt); }}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold transition hover:bg-white/20"
                              style={{
                                backgroundColor: "rgba(255,255,255,.09)",
                                border: "1px solid rgba(255,255,255,.12)",
                                color: "rgba(255,255,255,.8)",
                              }}
                              aria-label={useInProjectState[currentResult.id] === "saving" ? "Saving\u2026" : "Use in Project"}
                              title={useInProjectState[currentResult.id] === "saving" ? "Saving\u2026" : "Use in Project"}
                            >
                              <Palette size={10} className="pointer-events-none" />
                              <span className="hidden sm:inline">{useInProjectState[currentResult.id] === "saving" ? "Saving\u2026" : "Use in Project"}</span>
                            </button>
                            <button
                              key={"Delete"}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); deleteGeneration(currentResult.id); }}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold transition hover:bg-white/20"
                              style={{
                                backgroundColor: "rgba(248,81,73,.12)",
                                border: "1px solid rgba(248,81,73,.2)",
                                color: "rgba(248,81,73,.9)",
                              }}
                              aria-label={"Delete"}
                              title={"Delete"}
                            >
                              <Trash2 size={10} className="pointer-events-none" />
                              <span className="hidden sm:inline">{"Delete"}</span>
                            </button>
                          </div>
                          {useInProjectError[currentResult.id] && (
                            <p className="text-[10px] font-semibold text-red-300" role="alert" data-testid="use-in-project-error-desktop">
                              Couldn&apos;t save to project: {useInProjectError[currentResult.id]}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
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
                            disabled={isWorking}
                            className="px-4 py-2 text-xs font-bold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
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
                  <div className="w-full h-full overflow-y-auto p-6 select-none">
                    <div className="text-[12px] font-bold mb-4" style={{ color: T.textMuted }}>
                      Generating {batchSize > 1 ? `${batchSize} images` : "image"}…
                    </div>
                    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(240px, 1fr))` }}>
                      {Array.from({ length: batchSize }).map((_, i) => (
                        <div
                          key={i}
                          className="relative rounded-lg border overflow-hidden"
                          style={{
                            borderColor: T.borderColor + "40",
                            backgroundColor: T.boxBg,
                            paddingBottom: "56.25%",
                            animation: `pulse 1.8s ease-in-out ${i * 0.2}s infinite`,
                          }}
                        >
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                            <div
                              className="h-7 w-7 rounded-full border-2 animate-spin"
                              style={{
                                borderColor: T.accentColor,
                                borderTopColor: "transparent",
                              }}
                            />
                            <span className="text-[10px] font-bold" style={{ color: T.textMuted }}>
                              Generating…
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 text-center">
                      <p className="text-[10px] opacity-50" style={{ color: T.textMuted }}>
                        {currentProvider.label} · {aspectRatio}
                      </p>
                    </div>
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
                        onClick={() => void handleGenerate()}
                        disabled={isWorking}
                        className="px-4 py-2 text-xs font-bold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
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
                  <div className="w-full h-full flex items-center justify-center p-6">
                    <div className="flex flex-col items-center justify-center max-w-md text-center select-none">
                      <div
                        className="grid h-20 w-20 place-items-center rounded-full mb-5"
                        style={{
                          background: "radial-gradient(circle, var(--glass-purple-soft), transparent 70%)",
                          border: "1px solid var(--glass-border-purple)",
                        }}
                      >
                        <Sparkles size={32} style={{ color: "var(--glass-purple)" }} />
                      </div>
                      <h2 className="text-xl font-black" style={{ color: "var(--glass-text-1)" }}>
                        Create your first image
                      </h2>
                      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--glass-text-2)" }}>
                        Describe what you want to see, pick a style, and let LiTT forge it into reality.
                      </p>
                      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                        {[
                          { label: "🌆 Cyberpunk city", prompt: "A breathtaking cyberpunk cityscape at dusk, neon reflections in rain-soaked streets, cinematic lighting" },
                          { label: "🌸 Garden scene", prompt: "A serene Japanese garden with cherry blossoms, soft morning light, photorealistic" },
                          { label: "✨ Abstract 3D", prompt: "Abstract 3D render, flowing iridescent shapes, octane render, vibrant colors, 8k" },
                        ].map((chip) => (
                          <button
                            key={chip.label}
                            onClick={() => { setPrompt(chip.prompt); setActiveTab("prompt"); }}
                            className="glass-button-secondary px-3 py-2 text-[10px] font-bold rounded-lg"
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
                        {LITT_QUICK_ACTIONS.map((action) => (
                          <button
                            key={action.label}
                            onClick={() => handleQuickAction(action.promptSuffix)}
                            disabled={isWorking || !prompt.trim()}
                            className="glass-button-secondary px-2.5 py-1.5 text-[9px] font-bold rounded-full disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Sparkles size={8} className="inline mr-1" />
                            {action.label}
                          </button>
                        ))}
                      </div>
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

            {/* History sidebar (right) — collapses to 44px rail when empty */}
            <div
              className={`shrink-0 flex flex-col transition-all duration-300 ease-out md:relative md:translate-x-0 fixed inset-y-0 right-0 z-10000 ${mobileRightOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"}`}
              style={{
                width: history.length === 0 && !historyOpen ? 44 : rightWidth,
                borderLeft: `1px solid var(--glass-border)`,
                backgroundColor: "var(--glass-surface-1)",
                backdropFilter: "var(--glass-blur)",
                WebkitBackdropFilter: "var(--glass-blur)",
              }}
            >
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="shrink-0 flex items-center justify-between px-3 h-9 text-[10px] font-bold uppercase tracking-widest"
                style={{
                  borderBottom: `1px solid var(--glass-border)`,
                  color: "var(--glass-text-2)",
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

              {historyOpen ? (
                <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-1.5 content-start">
                  {history.length === 0 ? (
                    <div
                      className="col-span-2 py-8 text-center text-[10px]"
                      style={{ color: "var(--glass-text-3)" }}
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
              ) : (
                <div className="flex-1 flex flex-col items-center justify-start pt-3 gap-2">
                  <History size={14} style={{ color: "var(--glass-text-3)" }} />
                  {history.length > 0 && (
                    <span className="text-[9px] font-bold" style={{ color: "var(--glass-text-3)" }}>
                      {history.length}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Generation Log (bottom) ── */}
          {showLogs && (
            <div
              className="shrink-0 border-t glass-toolbar"
              style={{
                borderColor: "var(--glass-border)",
                borderRadius: 0,
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
