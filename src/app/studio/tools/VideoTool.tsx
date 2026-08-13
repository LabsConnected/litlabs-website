"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useWallet } from "@/context/WalletContext";
import { VIDEO_MODELS } from "@/lib/studio-models";
import {
  Film,
  Wand2,
  Download,
  RefreshCw,
  AlertTriangle,
  Loader2,
  History,
  Sparkles,
  ImagePlus,
  X,
  Lightbulb,
  Eye,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import { apiFetch, readApiResponse, type ApiJson } from "@/lib/api-response";
import { notifyAssetsChanged } from "../hooks/useAssetsRefresh";

/* ─── Types ──────────────────────────────────────────────────────────── */

type CreationMode = "quick" | "animate" | "director";

type GenStatus = "idle" | "uploading" | "analyzing" | "queued" | "generating" | "finalizing" | "complete" | "failed";

interface VideoGen {
  id: string;
  prompt: string;
  model: string;
  duration: number;
  aspectRatio: string;
  resolution: string;
  status: GenStatus;
  videoUrl?: string;
  error?: string;
  createdAt: number;
  cost: number;
}

interface VideoIdea {
  title: string;
  prompt: string;
  motion: string;
  vibe: string;
}

/* ─── Constants ──────────────────────────────────────────────────────── */

const STORAGE_KEY = "litlabs-studio-video-history";
const MAX_HISTORY = 8;

const CAMERA_OPTIONS = ["Static", "Push In", "Pull Out", "Pan Left", "Pan Right", "Tilt Up", "Orbit", "Tracking", "Handheld", "Drone"];
const MOTION_OPTIONS = ["Still", "Subtle", "Smooth", "Energetic", "Fast", "Slow Motion"];
const LOOK_OPTIONS = ["Cinematic", "Photoreal", "Commercial", "Moody", "Dreamlike", "Retro", "Anime"];
const COMPOSITION_OPTIONS = ["Wide", "Medium", "Close-up", "Macro", "Low Angle", "High Angle", "POV"];

const AVAILABLE_MODELS = VIDEO_MODELS.filter((m) => m.available);
const UNAVAILABLE_MODELS = VIDEO_MODELS.filter((m) => !m.available);

/* ─── Helpers ────────────────────────────────────────────────────────── */

function composeEnhancedPrompt(
  base: string,
  camera: string[],
  motion: string,
  look: string,
  composition: string[],
): string {
  const parts: string[] = [base.trim()];

  const cameraStr = camera.filter((c) => c !== "Static").join(", ");
  if (cameraStr) parts.push(`${cameraStr.toLowerCase()} camera movement`);

  const compStr = composition.join(", ");
  if (compStr) parts.push(compStr.toLowerCase());

  if (motion && motion !== "Still") parts.push(motion.toLowerCase());
  if (look) parts.push(`${look.toLowerCase()} style`);

  return parts.join(", ");
}

function buildShotSuffix(camera: string[], motion: string, look: string, composition: string[]): string {
  const parts: string[] = [];
  const cameraStr = camera.filter((c) => c !== "Static").join(", ");
  if (cameraStr) parts.push(cameraStr.toLowerCase());
  if (composition.length) parts.push(composition.join(", ").toLowerCase());
  if (motion && motion !== "Still") parts.push(motion.toLowerCase());
  if (look) parts.push(look.toLowerCase());
  return parts.length ? `, ${parts.join(", ")}` : "";
}

/* ─── Entrance animation wrapper ─────────────────────────────────────── */

function Entrance({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ─── Chip selector ──────────────────────────────────────────────────── */

function ChipRow({
  label,
  options,
  selected,
  onToggle,
  accentColor,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (val: string) => void;
  accentColor: string;
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-white/40">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const isSelected = selected.includes(opt);
          return (
            <button
              key={opt}
              onClick={() => onToggle(opt)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all hover:scale-[1.04] active:scale-95 ${
                isSelected ? "scale-[1.02]" : ""
              }`}
              style={{
                borderColor: isSelected ? `${accentColor}80` : "rgba(255,255,255,0.08)",
                background: isSelected ? `${accentColor}18` : "rgba(255,255,255,0.03)",
                color: isSelected ? accentColor : "rgba(255,255,255,0.55)",
                minHeight: 32,
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────── */

export default function VideoTool() {
  const [mode, setMode] = useState<CreationMode>("quick");
  const [prompt, setPrompt] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null);
  const [showEnhanced, setShowEnhanced] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);

  const [modelId, setModelId] = useState("veo");
  const [duration, setDuration] = useState(4);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");

  const [camera, setCamera] = useState<string[]>([]);
  const [motionStyle, setMotionStyle] = useState("Smooth");
  const [look, setLook] = useState("Cinematic");
  const [composition, setComposition] = useState<string[]>([]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<GenStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<VideoGen | null>(null);

  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const [uploadedImageBase64, setUploadedImageBase64] = useState<string | null>(null);
  const [uploadedMimeType, setUploadedMimeType] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [ideas, setIdeas] = useState<VideoIdea[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [ideaError, setIdeaError] = useState<string | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);

  const [history, setHistory] = useState<VideoGen[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const { balance: coinBalance, refresh: refreshWallet } = useWallet();
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const videoModel = useMemo(() => VIDEO_MODELS.find((m) => m.id === modelId)!, [modelId]);
  const caps = videoModel.capabilities;
  const cost = videoModel.cost;
  const canAfford = coinBalance === null || coinBalance >= cost;

  // Auto-switch model when mode changes
  useEffect(() => {
    if (mode === "animate" && modelId !== "happyhorse") {
      setModelId("happyhorse");
    } else if (mode === "quick" && modelId !== "veo") {
      setModelId("veo");
    }
  }, [mode, modelId]);

  // Clamp duration to supported values when model changes
  useEffect(() => {
    if (caps.durations.length > 0 && !caps.durations.includes(duration)) {
      setDuration(caps.durations[0]);
    }
  }, [caps, duration]);

  // Clamp aspect ratio and resolution
  useEffect(() => {
    if (!caps.aspectRatios.includes(aspectRatio)) setAspectRatio(caps.aspectRatios[0]);
    if (!caps.resolutions.includes(resolution)) setResolution(caps.resolutions[0]);
  }, [caps, aspectRatio, resolution]);

  useEffect(() => { refreshWallet(); }, [refreshWallet]);

  useEffect(() => {
    if (history.length > 0)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  }, [history]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (uploadedImagePreview) URL.revokeObjectURL(uploadedImagePreview);
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore draft from sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("litlabs:video:draft");
      if (!raw) return;
      const draft = JSON.parse(raw) as { prompt?: string; duration?: number; aspectRatio?: string; resolution?: string };
      if (draft.prompt) setPrompt(draft.prompt);
      if (draft.duration) setDuration(draft.duration);
      if (draft.aspectRatio) setAspectRatio(draft.aspectRatio);
      if (draft.resolution) setResolution(draft.resolution);
      sessionStorage.removeItem("litlabs:video:draft");
    } catch { /* ignore */ }
  }, []);

  /* ─── Image upload ────────────────────────────────────────────────── */

  const fetchIdeas = useCallback(async (url: string) => {
    setIsAnalyzing(true);
    setIdeaError(null);
    setIdeas([]);
    try {
      const data = await apiFetch<ApiJson>("/api/media/suggest-video-ideas", {
        method: "POST",
        body: JSON.stringify({ imageUrl: url }),
      });
      setIdeas(Array.isArray(data.ideas) ? data.ideas : []);
    } catch (err) {
      setIdeaError(err instanceof Error ? err.message : "Could not analyze photo");
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleImageUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const preview = URL.createObjectURL(file);
      setUploadedImagePreview(preview);

      // Read as base64 for Veo reference image support
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        setUploadedImageBase64(base64);
        setUploadedMimeType(file.type);
      };
      reader.readAsDataURL(file);

      const form = new FormData();
      form.append("file", file);
      const data = await apiFetch<ApiJson>("/api/upload", { method: "POST", body: form });
      const uploadUrl = data.url as string | undefined;
      if (!uploadUrl || data.fallback) {
        throw new Error("Upload succeeded but no public URL returned. Supabase Storage may not be configured.");
      }
      setUploadedImageUrl(uploadUrl);
      fetchIdeas(uploadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image upload failed");
      setUploadedImagePreview(null);
      setUploadedImageUrl(null);
      setUploadedImageBase64(null);
    } finally {
      setIsUploading(false);
    }
  }, [fetchIdeas]);

  const handleRemoveImage = () => {
    if (uploadedImagePreview) URL.revokeObjectURL(uploadedImagePreview);
    setUploadedImageUrl(null);
    setUploadedImagePreview(null);
    setUploadedImageBase64(null);
    setUploadedMimeType(null);
    setIdeas([]);
    setIdeaError(null);
  };

  const applyIdea = (idea: VideoIdea) => {
    setPrompt(idea.prompt);
    setOriginalPrompt(idea.prompt);
    setEnhancedPrompt(null);
    setShowEnhanced(false);
    if (idea.motion) setMotionStyle(idea.motion);
    setError(null);
  };

  /* ─── Prompt enhancement ──────────────────────────────────────────── */

  const handleEnhance = useCallback(async () => {
    if (!prompt.trim()) return;
    setIsEnhancing(true);
    setOriginalPrompt(prompt.trim());
    try {
      const data = await apiFetch<ApiJson>("/api/media/suggest-video-ideas", {
        method: "POST",
        body: JSON.stringify({ prompt: prompt.trim(), mode: "enhance" }),
      });
      const ideas = Array.isArray(data.ideas) ? (data.ideas as VideoIdea[]) : [];
      const enhanced = (data.enhancedPrompt as string) || ideas[0]?.prompt || null;
      if (enhanced) {
        setEnhancedPrompt(enhanced);
        setShowEnhanced(true);
      }
    } catch {
      // Fallback: compose locally
      const local = composeEnhancedPrompt(prompt, camera, motionStyle, look, composition);
      setEnhancedPrompt(local);
      setShowEnhanced(true);
    } finally {
      setIsEnhancing(false);
    }
  }, [prompt, camera, motionStyle, look, composition]);

  /* ─── Chip toggles ────────────────────────────────────────────────── */

  const toggleCamera = (val: string) => {
    setCamera((prev) => prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]);
  };
  const toggleComposition = (val: string) => {
    setComposition((prev) => prev.includes(val) ? prev.filter((v) => v !== val) : [val]);
  };

  /* ─── Generate ────────────────────────────────────────────────────── */

  const finalPrompt = useMemo(() => {
    const base = showEnhanced && enhancedPrompt ? enhancedPrompt : prompt.trim();
    if (mode === "director" || mode === "quick") {
      return `${base}${buildShotSuffix(camera, motionStyle, look, composition)}`;
    }
    return base;
  }, [prompt, enhancedPrompt, showEnhanced, mode, camera, motionStyle, look, composition]);

  const handleGenerate = useCallback(async () => {
    if (videoModel.id === "happyhorse" && !uploadedImageUrl) {
      setError("Upload a first-frame image for HappyHorse image-to-video.");
      return;
    }
    if (!finalPrompt.trim() || finalPrompt.trim().length < 3) {
      setError("Prompt must be at least 3 characters.");
      return;
    }
    if (!canAfford) {
      setError(`Need ${cost} LiTTBits.`);
      return;
    }
    setError(null);
    setIsGenerating(true);
    setGenStatus("queued");
    const id = `vid_${Date.now()}`;
    const gen: VideoGen = {
      id, prompt: finalPrompt.trim(), model: videoModel.id, duration,
      aspectRatio, resolution, status: "generating", createdAt: Date.now(), cost,
    };
    setCurrent(gen);
    setHistory((prev) => [gen, ...prev].slice(0, MAX_HISTORY));

    // AbortController for polling cancellation
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const isAlibaba = videoModel.id === "happyhorse";

      const data = await apiFetch<ApiJson>("/api/media/generate-video", {
        method: "POST",
        body: JSON.stringify(
          isAlibaba
            ? { prompt: finalPrompt.trim(), model: videoModel.id, imageUrl: uploadedImageUrl, resolution, duration }
            : {
                prompt: finalPrompt.trim(),
                model: videoModel.id,
                aspectRatio,
                resolution,
                duration,
                ...(uploadedImageBase64 && caps.supportsReferenceImage
                  ? { imageBytes: uploadedImageBase64, mimeType: uploadedMimeType || "image/png" }
                  : {}),
              },
        ),
      });

      setGenStatus("generating");

      const taskId = data.taskId as string | undefined;
      const operationName = data.operationName as string | undefined;

      if (isAlibaba && !taskId) throw new Error("Alibaba task started but no task ID returned.");
      if (!isAlibaba && !operationName) throw new Error("Video generation started but no operation ID returned.");

      const pollStart = Date.now();
      const POLL_TIMEOUT = isAlibaba ? 300_000 : 120_000;
      const POLL_INTERVAL = isAlibaba ? 15_000 : 5_000;
      const pollEndpoint = isAlibaba ? "/api/media/alibaba-status" : "/api/media/video-status";
      const pollBodyKey = isAlibaba ? "taskId" : "operationName";
      const pollBodyValue = isAlibaba ? taskId : operationName;
      const videoUrlKey = isAlibaba ? "videoUrl" : "videoUri";

      while (Date.now() - pollStart < POLL_TIMEOUT && !ac.signal.aborted) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));

        const statusRes = await fetch(pollEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [pollBodyKey]: pollBodyValue }),
          signal: ac.signal,
        });
        const statusData = await readApiResponse<ApiJson>(statusRes);

        if (statusData.done && statusData[videoUrlKey]) {
          setGenStatus("finalizing");
          let videoUrl: string;
          if (isAlibaba) {
            videoUrl = statusData[videoUrlKey] as string;
          } else {
            const videoRes = await fetch(statusData[videoUrlKey] as string, { signal: ac.signal });
            if (!videoRes.ok) throw new Error("Failed to download generated video.");
            const blob = await videoRes.blob();
            videoUrl = URL.createObjectURL(blob);
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = videoUrl;
          }

          setGenStatus("complete");
          setCurrent((prev) => prev?.id === id ? { ...prev, status: "complete", videoUrl } : prev);
          setHistory((prev) => prev.map((g) => g.id === id ? { ...g, status: "complete", videoUrl } : g));
          refreshWallet().catch(() => {});

          // Notify the Asset Lake that a new persistent video asset exists.
          // The server has created a generation_jobs row with the durable URL.
          notifyAssetsChanged();

          break;
        }
        if (statusData.done && !statusData[videoUrlKey]) {
          throw new Error((statusData.error as string) || "Generation completed but no video URL returned.");
        }
      }

      if (Date.now() - pollStart >= POLL_TIMEOUT && !ac.signal.aborted) {
        // Try to get a refund via status endpoint
        await fetch(pollEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [pollBodyKey]: pollBodyValue }),
          signal: ac.signal,
        }).catch(() => {});
        throw new Error(`Generation timed out after ${POLL_TIMEOUT / 1000}s. Credits refunded if applicable.`);
      }
    } catch (err) {
      if (ac.signal.aborted) return; // unmount/navigation
      const msg = err instanceof Error ? err.message : "Video generation failed";
      setError(msg);
      setGenStatus("failed");
      refreshWallet().catch(() => {});
      setCurrent((prev) => prev?.id === id ? { ...prev, status: "failed", error: msg } : prev);
      setHistory((prev) => prev.map((g) => g.id === id ? { ...g, status: "failed", error: msg } : g));
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [videoModel, finalPrompt, uploadedImageUrl, uploadedImageBase64, uploadedMimeType, caps, duration, aspectRatio, resolution, cost, canAfford, refreshWallet]);

  /* ─── Actions ─────────────────────────────────────────────────────── */

  const handleDownload = useCallback((url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `litbit-video-${Date.now()}.mp4`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleRemix = () => {
    if (!current) return;
    setPrompt(current.prompt);
    setModelId(current.model);
    setDuration(current.duration);
    setAspectRatio(current.aspectRatio);
    setResolution(current.resolution);
    setGenStatus("idle");
    setCurrent(null);
  };

  const handleClear = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  /* ─── Derived ─────────────────────────────────────────────────────── */

  const showReferenceImage = caps.supportsReferenceImage || videoModel.id === "happyhorse";
  const referenceLabel = videoModel.id === "happyhorse" ? "First Frame (required)" : "Reference Image (optional)";
  const showDuration = caps.durations.length > 0;

  /* ─── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="w-full space-y-4 p-4" style={{ background: "#050508", minHeight: "100%" }}>
      {/* Header */}
      <Entrance delay={0}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)" }}>
              <Film size={18} style={{ color: "#A970FF" }} />
            </div>
            <div>
              <div className="text-sm font-black tracking-tight text-white">LiTT Video Lab</div>
              <div className="text-[10px] text-white/40">Turn an idea or image into motion</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border px-2.5 py-1 text-[10px] font-black" style={{ borderColor: "rgba(114,242,56,0.3)", background: "rgba(114,242,56,0.08)", color: "#72F238" }}>
              {coinBalance ?? "—"} BITS
            </span>
            <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black" style={{ borderColor: "rgba(255,255,255,0.08)", color: genStatus === "generating" ? "#F97316" : "#72F238" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: genStatus === "generating" ? "#F97316" : "#72F238" }} />
              {genStatus === "generating" ? "RENDERING" : genStatus === "complete" ? "READY" : "READY"}
            </span>
          </div>
        </div>
      </Entrance>

      {/* Mode tabs */}
      <Entrance delay={0.05}>
        <div className="flex gap-2">
          {([
            { id: "quick", label: "Quick Create", desc: "Text → Video" },
            { id: "animate", label: "Animate Image", desc: "Image → Video" },
            { id: "director", label: "Director", desc: "Full control" },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              className="flex flex-col items-start rounded-xl border px-4 py-2.5 transition-all hover:scale-[1.02] active:scale-95"
              style={{
                borderColor: mode === tab.id ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.08)",
                background: mode === tab.id ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.02)",
              }}
            >
              <span className="text-xs font-black" style={{ color: mode === tab.id ? "#A970FF" : "rgba(255,255,255,0.6)" }}>{tab.label}</span>
              <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.35)" }}>{tab.desc}</span>
            </button>
          ))}
        </div>
      </Entrance>

      {/* Video Stage */}
      <Entrance delay={0.1}>
        <div className="relative overflow-hidden rounded-2xl border" style={{ borderColor: "rgba(255,255,255,0.08)", background: "#080710" }}>
          {/* Ambient bloom */}
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(139,92,246,0.08) 0%, transparent 70%)" }} />
          {/* Film grain */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.02] mix-blend-overlay" style={{
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }} />

          <div className="relative aspect-video flex items-center justify-center" style={{ minHeight: 280 }}>
            {current?.videoUrl ? (
              <video src={current.videoUrl} controls autoPlay loop className="h-full w-full object-contain" style={{ maxHeight: 420 }} />
            ) : genStatus === "generating" || genStatus === "queued" || genStatus === "finalizing" ? (
              <div className="flex flex-col items-center gap-4">
                {/* Render shimmer */}
                <motion.div
                  className="h-1 w-48 overflow-hidden rounded-full"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.8), transparent)" }}
                    animate={{ x: ["-100%", "100%"] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  />
                </motion.div>
                <div className="text-sm font-black uppercase tracking-[.2em] text-white/60">Generating your shot</div>
                <div className="text-[10px] text-white/30">{videoModel.label} · {genStatus === "queued" ? "Queued" : genStatus === "finalizing" ? "Finalizing" : "Rendering"}</div>
              </div>
            ) : uploadedImagePreview && mode === "animate" ? (
              <div className="relative h-full w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={uploadedImagePreview} alt="First frame" className="h-full w-full object-contain" />
                <div className="absolute bottom-3 left-3 rounded-lg border px-2.5 py-1 text-[10px] font-bold backdrop-blur-sm" style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.6)", color: "rgba(255,255,255,0.7)" }}>
                  First frame ready
                </div>
              </div>
            ) : (
              <div className="text-center">
                <Film size={40} className="mx-auto opacity-20" style={{ color: "#A970FF" }} />
                <p className="mt-3 text-sm text-white/40">Your video will appear here</p>
                <p className="mt-1 text-[10px] text-white/20">{videoModel.label} · {aspectRatio} · {resolution}</p>
              </div>
            )}
          </div>

          {/* Result actions */}
          {current?.videoUrl && (
            <div className="flex items-center gap-2 border-t px-4 py-2.5" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}>
              <button onClick={() => { const v = document.querySelector("video"); v?.play(); }} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition hover:scale-105" style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>
                <RefreshCw size={11} /> Replay
              </button>
              <button onClick={() => handleDownload(current.videoUrl!)} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition hover:scale-105" style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>
                <Download size={11} /> Download
              </button>
              <button onClick={handleRemix} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition hover:scale-105" style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>
                <RotateCcw size={11} /> Remix
              </button>
              <div className="ml-auto flex items-center gap-3 text-[9px] text-white/30">
                <span>{videoModel.label}</span>
                <span>{aspectRatio}</span>
                <span>{resolution}</span>
                <span>{cost} BITS</span>
              </div>
            </div>
          )}
        </div>
      </Entrance>

      {/* Prompt Composer */}
      <Entrance delay={0.15}>
        <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(10,9,18,0.6)", backdropFilter: "blur(12px)" }}>
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: "#A970FF" }} />
            <span className="text-[10px] font-black uppercase tracking-[.16em] text-white/50">Describe your shot</span>
          </div>

          {showEnhanced && enhancedPrompt ? (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <button onClick={() => setShowEnhanced(false)} className="rounded-full border px-3 py-1 text-[10px] font-bold" style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>Original</button>
                <button onClick={() => setShowEnhanced(true)} className="rounded-full border px-3 py-1 text-[10px] font-bold" style={{ borderColor: "rgba(139,92,246,0.4)", background: "rgba(139,92,246,0.12)", color: "#A970FF" }}>Enhanced</button>
              </div>
              <div className="rounded-xl border p-3 text-sm leading-relaxed" style={{ borderColor: "rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.05)", color: "rgba(255,255,255,0.85)" }}>
                {showEnhanced ? enhancedPrompt : originalPrompt}
              </div>
              {showEnhanced && (
                <button onClick={() => { setPrompt(enhancedPrompt); setShowEnhanced(false); }} className="text-[10px] font-bold text-white/40 transition hover:text-white/70">
                  Use enhanced prompt →
                </button>
              )}
            </div>
          ) : (
            <textarea
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setError(null); }}
              placeholder="A futuristic LiTT robot walking through a rain-soaked city at night..."
              rows={3}
              disabled={isGenerating}
              className="mt-3 w-full resize-none rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none disabled:opacity-50"
              style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.9)", background: "rgba(255,255,255,0.02)" }}
            />
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleEnhance}
              disabled={!prompt.trim() || isEnhancing || isGenerating}
              className="flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11px] font-bold transition hover:scale-[1.02] active:scale-95 disabled:opacity-40"
              style={{ borderColor: "rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.08)", color: "#A970FF", minHeight: 40 }}
            >
              {isEnhancing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
              Enhance with LiTT
            </button>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || !canAfford || isGenerating}
              className="ml-auto flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-black transition hover:scale-[1.02] active:scale-95 disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #8B5CF6, #A970FF)", color: "#fff", boxShadow: "0 0 24px rgba(139,92,246,0.3)", minHeight: 40 }}
            >
              {isGenerating ? <><Loader2 size={14} className="animate-spin" /> Generating...</> : <><Sparkles size={14} /> Generate · {cost} BITS</>}
            </button>
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px]" style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
              <AlertTriangle size={12} />
              <span>{error}</span>
              {(error.includes("timed out") || error.includes("failed")) && (
                <button onClick={handleGenerate} className="ml-auto rounded-lg px-2 py-0.5 text-[9px] font-bold transition hover:opacity-80" style={{ background: "rgba(239,68,68,0.2)" }}>Retry</button>
              )}
            </div>
          )}
        </div>
      </Entrance>

      {/* Shot Controls — Director mode only */}
      {mode === "director" && (
        <Entrance delay={0.2}>
          <div className="grid gap-4 rounded-2xl border p-4 sm:grid-cols-2" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(10,9,18,0.5)", backdropFilter: "blur(12px)" }}>
            <ChipRow label="Camera" options={CAMERA_OPTIONS} selected={camera} onToggle={toggleCamera} accentColor="#A970FF" />
            <ChipRow label="Motion" options={MOTION_OPTIONS} selected={[motionStyle]} onToggle={(v) => setMotionStyle(v)} accentColor="#22D3EE" />
            <ChipRow label="Look" options={LOOK_OPTIONS} selected={[look]} onToggle={(v) => setLook(v)} accentColor="#72F238" />
            <ChipRow label="Composition" options={COMPOSITION_OPTIONS} selected={composition} onToggle={toggleComposition} accentColor="#F97316" />
          </div>
        </Entrance>
      )}

      {/* Source + Advanced */}
      <Entrance delay={0.25}>
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Source / First Frame */}
          {showReferenceImage && (
            <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(10,9,18,0.5)", backdropFilter: "blur(12px)" }}>
              <div className="flex items-center gap-2">
                <Eye size={13} style={{ color: "#22D3EE" }} />
                <span className="text-[10px] font-black uppercase tracking-[.16em] text-white/50">{referenceLabel}</span>
              </div>

              {uploadedImagePreview ? (
                <div className="relative mt-3 overflow-hidden rounded-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={uploadedImagePreview} alt="Reference" className="w-full max-h-48 object-contain rounded-lg" />
                  <button onClick={handleRemoveImage} disabled={isGenerating || isUploading || isAnalyzing} className="absolute right-2 top-2 rounded-lg bg-black/60 p-1.5 text-white transition hover:bg-black/80 disabled:opacity-50">
                    <X size={14} />
                  </button>
                  {uploadedImageUrl && !isAnalyzing && (
                    <div className="absolute bottom-2 left-2 rounded px-2 py-0.5 text-[9px] font-bold" style={{ background: "rgba(114,242,56,0.8)", color: "#000" }}>Ready</div>
                  )}
                  {isAnalyzing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
                      <Loader2 size={20} className="animate-spin" style={{ color: "#A970FF" }} />
                      <span className="text-[10px] font-bold" style={{ color: "#A970FF" }}>LiTT is studying your image...</span>
                    </div>
                  )}
                </div>
              ) : (
                <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition-all hover:scale-[1.01]" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
                  {isUploading ? <Loader2 size={20} className="animate-spin" style={{ color: "#A970FF" }} /> : <ImagePlus size={20} className="text-white/30" />}
                  <span className="text-[10px] text-white/40">{isUploading ? "Uploading..." : "Drop first frame or click to upload"}</span>
                  <span className="text-[9px] text-white/20">JPEG, PNG, or WebP</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={isUploading || isGenerating} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
                </label>
              )}

              {/* LiTT suggestions */}
              {uploadedImageUrl && ideas.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Lightbulb size={11} style={{ color: "#A970FF" }} />
                    <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#A970FF" }}>Suggested Shots</span>
                  </div>
                  {ideas.slice(0, 3).map((idea, i) => (
                    <button key={i} onClick={() => applyIdea(idea)} disabled={isGenerating} className="w-full rounded-lg border p-2.5 text-left transition-all hover:scale-[1.02] disabled:opacity-50" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded px-1.5 py-0.5 text-[8px] font-black uppercase" style={{ background: "rgba(139,92,246,0.2)", color: "#A970FF" }}>{idea.vibe}</span>
                        <span className="text-[9px] text-white/40">{idea.motion}</span>
                      </div>
                      <div className="mt-1 text-[11px] font-bold text-white/80">{idea.title}</div>
                      <div className="mt-0.5 line-clamp-2 text-[10px] text-white/40">{idea.prompt}</div>
                    </button>
                  ))}
                </div>
              )}
              {ideaError && (
                <div className="mt-2 rounded-lg border px-2 py-1.5 text-[10px]" style={{ borderColor: "rgba(239,68,68,0.3)", color: "#ef4444", background: "rgba(239,68,68,0.05)" }}>{ideaError}</div>
              )}
            </div>
          )}

          {/* Advanced */}
          <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(10,9,18,0.5)", backdropFilter: "blur(12px)" }}>
            <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex w-full items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-[.16em] text-white/50">Advanced</span>
              <ChevronDown size={14} className="text-white/40 transition-transform" style={{ transform: showAdvanced ? "rotate(180deg)" : "none" }} />
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4">
                {/* Model selection */}
                <div>
                  <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-white/40">Model</div>
                  <div className="space-y-1.5">
                    {AVAILABLE_MODELS.map((m) => (
                      <button key={m.id} onClick={() => setModelId(m.id)} disabled={isGenerating} className="w-full rounded-lg border p-2.5 text-left text-[11px] transition-all hover:scale-[1.01] disabled:opacity-50" style={{
                        borderColor: modelId === m.id ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.06)",
                        background: modelId === m.id ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.02)",
                        color: modelId === m.id ? "#A970FF" : "rgba(255,255,255,0.7)",
                      }}>
                        <div className="flex items-center justify-between font-bold">
                          <span>{m.label}</span>
                          <span className="text-[9px] opacity-60">{m.cost} BITS</span>
                        </div>
                        <div className="mt-0.5 text-[9px] opacity-50">{m.desc}</div>
                      </button>
                    ))}
                    {UNAVAILABLE_MODELS.length > 0 && (
                      <div className="pt-2">
                        <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-white/20">Coming later</div>
                        <div className="flex flex-wrap gap-1.5">
                          {UNAVAILABLE_MODELS.map((m) => (
                            <span key={m.id} className="rounded-full border px-2.5 py-1 text-[9px] font-bold opacity-40" style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>
                              {m.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Aspect ratio */}
                <div>
                  <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-white/40">Aspect Ratio</div>
                  <div className="flex gap-1.5">
                    {caps.aspectRatios.map((ar) => (
                      <button key={ar} onClick={() => setAspectRatio(ar)} disabled={isGenerating} className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition hover:scale-105 disabled:opacity-50" style={{
                        borderColor: aspectRatio === ar ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.08)",
                        background: aspectRatio === ar ? "rgba(139,92,246,0.12)" : "transparent",
                        color: aspectRatio === ar ? "#A970FF" : "rgba(255,255,255,0.5)",
                      }}>{ar}</button>
                    ))}
                  </div>
                </div>

                {/* Resolution */}
                <div>
                  <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-white/40">Resolution</div>
                  <div className="flex gap-1.5">
                    {caps.resolutions.map((res) => (
                      <button key={res} onClick={() => setResolution(res)} disabled={isGenerating} className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition hover:scale-105 disabled:opacity-50" style={{
                        borderColor: resolution === res ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.08)",
                        background: resolution === res ? "rgba(139,92,246,0.12)" : "transparent",
                        color: resolution === res ? "#A970FF" : "rgba(255,255,255,0.5)",
                      }}>{res}</button>
                    ))}
                  </div>
                </div>

                {/* Duration — only when supported */}
                {showDuration && (
                  <div>
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-white/40">Duration</div>
                    <div className="flex gap-1.5">
                      {caps.durations.map((d) => (
                        <button key={d} onClick={() => setDuration(d)} disabled={isGenerating} className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition hover:scale-105 disabled:opacity-50" style={{
                          borderColor: duration === d ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.08)",
                          background: duration === d ? "rgba(139,92,246,0.12)" : "transparent",
                          color: duration === d ? "#A970FF" : "rgba(255,255,255,0.5)",
                        }}>{d}s</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Estimate */}
                <div className="flex items-center justify-between rounded-lg border px-3 py-2.5" style={{ borderColor: "rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.05)" }}>
                  <span className="text-[10px] text-white/50">Estimated cost</span>
                  <span className="text-sm font-black" style={{ color: "#A970FF" }}>{cost} BITS</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Entrance>

      {/* History filmstrip */}
      <Entrance delay={0.3}>
        <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(10,9,18,0.5)", backdropFilter: "blur(12px)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <History size={11} className="text-white/40" />
              <span className="text-[10px] font-black uppercase tracking-[.16em] text-white/40">Recent</span>
            </div>
            {history.length > 0 && (
              <button onClick={handleClear} className="text-[9px] text-white/30 transition hover:text-white/60">Clear</button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="py-6 text-center text-[11px] text-white/25">No videos yet</div>
          ) : (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
              {history.map((g) => (
                <button key={g.id} onClick={() => setCurrent(g)} className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg border transition-all hover:scale-[1.04]" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}>
                  {g.videoUrl ? (
                    <video src={g.videoUrl} className="h-full w-full object-cover" muted />
                  ) : g.status === "failed" ? (
                    <div className="flex h-full w-full items-center justify-center"><AlertTriangle size={16} className="text-red-400/60" /></div>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center"><Loader2 size={14} className="animate-spin text-white/30" /></div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 truncate px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "rgba(0,0,0,0.7)", color: "rgba(255,255,255,0.6)" }}>
                    {g.model} · {new Date(g.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Entrance>
    </div>
  );
}
