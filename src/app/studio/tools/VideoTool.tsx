"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
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
  Clock,
  Sparkles,
  ImagePlus,
  X,
  Lightbulb,
  Eye,
  ArrowRight,
} from "lucide-react";
import { apiFetch, readApiResponse, type ApiJson } from "@/lib/api-response";

const PROMPT_PRESETS = [
  "A cyberpunk street market at night, neon signs flickering, people walking in rain, cinematic slow motion",
  "Space station orbiting a gas giant, ships docking, Earth visible in distance, epic sci-fi",
  "Ancient temple crumbling, dust and debris, dramatic sunlight beams, Indiana Jones style",
  "Underwater coral reef, tropical fish swimming, sunlight filtering through water, serene",
];

const STORAGE_KEY = "litlabs-studio-video-history";
const MAX_HISTORY = 8;

interface VideoGen {
  id: string;
  prompt: string;
  model: string;
  duration: number;
  status: "idle" | "generating" | "succeeded" | "failed";
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

export default function VideoTool() {
  const { resolvedColors: T } = useTheme();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("veo");
  const [duration, setDuration] = useState(4);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [motionStyle, setMotionStyle] = useState("Cinematic");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<VideoGen | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [ideas, setIdeas] = useState<VideoIdea[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const isHappyHorse = model === "happyhorse";
  const [history, setHistory] = useState<VideoGen[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  // Use WalletContext
  const { balance: coinBalance, refresh: refreshWallet } = useWallet();

  const cost = VIDEO_MODELS.find((m) => m.id === model)?.cost || 5;
  const canAfford = coinBalance === null || coinBalance >= cost;

  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("litlabs:video:draft");
      if (!raw) return;
      const draft = JSON.parse(raw) as { prompt?: string; duration?: number; aspectRatio?: string; resolution?: string; style?: string };
      if (draft.prompt) setPrompt(draft.prompt);
      if (draft.duration) setDuration(draft.duration);
      if (draft.aspectRatio) setAspectRatio(draft.aspectRatio);
      if (draft.resolution) setResolution(draft.resolution);
      if (draft.style) setMotionStyle(draft.style);
      sessionStorage.removeItem("litlabs:video:draft");
    } catch { /* ignore invalid drafts */ }
  }, []);

  useEffect(() => {
    if (history.length > 0)
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(history.slice(0, MAX_HISTORY)),
      );
  }, [history]);

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
      const form = new FormData();
      form.append("file", file);
      const data = await apiFetch<ApiJson>("/api/upload", { method: "POST", body: form });
      const uploadUrl = data.url as string | undefined;
      if (!uploadUrl || data.fallback) {
        throw new Error("Upload succeeded but no public URL returned. Supabase Storage may not be configured.");
      }
      setUploadedImageUrl(uploadUrl);
      // Auto-trigger LiTT's idea analysis the moment the photo is live
      fetchIdeas(uploadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image upload failed");
      setUploadedImagePreview(null);
      setUploadedImageUrl(null);
    } finally {
      setIsUploading(false);
    }
  }, [fetchIdeas]);

  const handleRemoveImage = () => {
    setUploadedImageUrl(null);
    setUploadedImagePreview(null);
    setIdeas([]);
    setIdeaError(null);
  };

  const applyIdea = (idea: VideoIdea) => {
    setPrompt(idea.prompt);
    if (idea.motion) setMotionStyle(idea.motion);
    setError(null);
  };

  const handleGenerate = useCallback(async () => {
    if (isHappyHorse && !uploadedImageUrl) {
      setError("Upload a first-frame image for HappyHorse image-to-video.");
      return;
    }
    if (!prompt.trim() || prompt.trim().length < 3) {
      setError("Prompt must be at least 3 characters.");
      return;
    }
    if (!canAfford) {
      setError(`Need ${cost} LiTTBits.`);
      return;
    }
    setError(null);
    setIsGenerating(true);
    const id = `vid_${Date.now()}`;
    const gen: VideoGen = {
      id,
      prompt: prompt.trim(),
      model,
      duration,
      status: "generating",
      createdAt: Date.now(),
      cost,
    };
    setCurrent(gen);
    setHistory((prev) => [gen, ...prev].slice(0, MAX_HISTORY));

    try {
      // ── Branch: Alibaba HappyHorse vs Google Veo ───────────────────
      const isAlibaba = isHappyHorse;
      const apiModel = isAlibaba ? "happyhorse-1.1-i2v" : "veo-3.1-fast-generate-preview";

      const data = await apiFetch<ApiJson>("/api/media/generate-video", {
        method: "POST",
        body: JSON.stringify(
          isAlibaba
            ? {
                prompt: prompt.trim(),
                model: apiModel,
                imageUrl: uploadedImageUrl,
                resolution,
                duration,
                cost,
              }
            : {
                prompt: `${prompt.trim()}, ${motionStyle} motion`,
                model: apiModel,
                aspectRatio,
                resolution,
                cost,
              },
        ),
      });

      // ── Polling: different endpoints for Alibaba vs Veo ────────────
      const taskId = data.taskId as string | undefined;
      const operationName = data.operationName as string | undefined;

      if (isAlibaba && !taskId) {
        throw new Error("Alibaba task started but no task ID returned.");
      }
      if (!isAlibaba && !operationName) {
        throw new Error("Video generation started but no operation ID returned.");
      }

      const pollStart = Date.now();
      const POLL_TIMEOUT = isAlibaba ? 300_000 : 120_000; // 5 min for Alibaba, 2 min for Veo
      const POLL_INTERVAL = isAlibaba ? 15_000 : 5_000;
      const pollEndpoint = isAlibaba ? "/api/media/alibaba-status" : "/api/media/video-status";
      const pollBodyKey = isAlibaba ? "taskId" : "operationName";
      const pollBodyValue = isAlibaba ? taskId : operationName;
      const videoUrlKey = isAlibaba ? "videoUrl" : "videoUri";

      while (Date.now() - pollStart < POLL_TIMEOUT) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));

        const statusRes = await fetch(pollEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [pollBodyKey]: pollBodyValue,
            cost,
            model: apiModel,
          }),
        });
        const statusData = await readApiResponse<ApiJson>(statusRes);
        if (statusData.done && statusData[videoUrlKey]) {
          let videoUrl: string;
          if (isAlibaba) {
            // Alibaba: URL is already a public R2 URL (saved server-side)
            videoUrl = statusData[videoUrlKey] as string;
          } else {
            // Veo: download the blob and create an object URL
            const videoRes = await fetch(statusData[videoUrlKey] as string);
            if (!videoRes.ok) throw new Error("Failed to download generated video.");
            const blob = await videoRes.blob();
            videoUrl = URL.createObjectURL(blob);
          }

          setCurrent((prev) =>
            prev?.id === id ? { ...prev, status: "succeeded", videoUrl } : prev,
          );
          setHistory((prev) =>
            prev.map((g) =>
              g.id === id ? { ...g, status: "succeeded", videoUrl } : g,
            ),
          );

          // NOTE: The backend already charges LiTTBits in /api/media/generate-video.
          // Do NOT charge again here — that was the double-billing bug.
          refreshWallet().catch(() => {});
          break;
        }
        if (statusData.done && !statusData[videoUrlKey]) {
          throw new Error((statusData.error as string) || "Video generation completed but no video URL returned.");
        }
      }

      if (Date.now() - pollStart >= POLL_TIMEOUT) {
        // Request refund for timed-out video
        await fetch(pollEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [pollBodyKey]: pollBodyValue,
            cost,
            model: apiModel,
          }),
        }).catch(() => {});
        throw new Error(`Video generation timed out after ${POLL_TIMEOUT / 1000} seconds.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Video generation failed");
      // Refresh wallet in case a refund was processed
      refreshWallet().catch(() => {});
      setCurrent((prev) =>
        prev?.id === id
          ? {
              ...prev,
              status: "failed",
              error: err instanceof Error ? err.message : "failed",
            }
          : prev,
      );
      setHistory((prev) =>
        prev.map((g) =>
          g.id === id
            ? {
                ...g,
                status: "failed",
                error: err instanceof Error ? err.message : "failed",
              }
            : g,
        ),
      );
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, model, duration, aspectRatio, resolution, motionStyle, cost, canAfford, refreshWallet, isHappyHorse, uploadedImageUrl]);

  const handleDownload = useCallback((url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `litbit-video-${Date.now()}.mp4`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleClear = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="p-4 space-y-4 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film size={14} style={{ color: T.accentColor }} />
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: T.textMuted }}
          >
            Video Generator
          </span>
        </div>
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold border"
          style={{
            borderColor: T.borderColor,
            color: T.accentColor,
            backgroundColor: T.boxBg,
          }}
        >
          <Sparkles size={10} /> {coinBalance ?? "—"} LiTTBits
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* LEFT: Controls */}
        <div className="lg:col-span-2 space-y-3">
          <div
            className="border rounded-lg p-3"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <label
              className="block text-[10px] uppercase tracking-widest mb-1.5"
              style={{ color: T.textMuted }}
            >
              Scene Description
            </label>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setError(null);
              }}
              aria-label="Video scene description"
              title="Video scene description"
              placeholder="A dramatic sunset over a cyberpunk city..."
              rows={4}
              disabled={isGenerating}
              className="w-full px-3 py-2 text-sm rounded outline-none resize-none disabled:opacity-50"
              style={{
                backgroundColor: T.bgColor,
                border: `1px solid ${T.borderColor}`,
                color: T.textColor,
              }}
            />
            <div
              className="text-right text-[10px] mt-1"
              style={{ color: T.textMuted }}
            >
              {prompt.length} chars
            </div>
          </div>

          {/* Image upload — first frame for HappyHorse, reference photo for Veo */}
          <div
            className="border rounded-lg p-3"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <label
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest mb-2"
              style={{ color: T.textMuted }}
            >
              <Eye size={11} style={{ color: T.accentColor }} />
              {isHappyHorse ? "First Frame Image (required)" : "Reference Photo (optional)"}
            </label>
            {uploadedImagePreview ? (
              <div className="relative rounded-lg overflow-hidden">
                {/* blob: URLs are not optimisable by next/image — keep <img> */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uploadedImagePreview}
                  alt={isHappyHorse ? "First frame" : "Reference photo"}
                  className="w-full max-h-48 object-contain rounded"
                />
                <button
                  onClick={handleRemoveImage}
                  disabled={isGenerating || isUploading || isAnalyzing}
                  className="absolute top-2 right-2 p-1 rounded bg-black/60 text-white hover:bg-black/80 disabled:opacity-50"
                >
                  <X size={14} />
                </button>
                {uploadedImageUrl && !isAnalyzing && (
                  <div
                    className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/80 text-white"
                  >
                    Ready
                  </div>
                )}
                {isAnalyzing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm gap-2">
                    <div className="relative w-12 h-12">
                      <div
                        className="absolute inset-0 rounded-full border-2 animate-ping"
                        style={{ borderColor: T.accentColor, opacity: 0.5 }}
                      />
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ color: T.accentColor }}
                      >
                        <Eye size={18} />
                      </div>
                    </div>
                    <span className="text-[10px] font-bold" style={{ color: T.accentColor }}>
                      LiTT is studying your photo...
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <label
                className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-all hover:scale-[1.01]"
                style={{
                  borderColor: T.borderColor,
                  backgroundColor: T.bgColor,
                }}
              >
                {isUploading ? (
                  <Loader2 size={20} className="animate-spin" style={{ color: T.accentColor }} />
                ) : (
                  <ImagePlus size={20} style={{ color: T.textMuted }} />
                )}
                <span className="text-[10px]" style={{ color: T.textMuted }}>
                  {isUploading ? "Uploading..." : "Click to upload JPEG, PNG, or WebP"}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={isUploading || isGenerating}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file);
                  }}
                />
              </label>
            )}
            <div
              className="text-[9px] mt-1.5"
              style={{ color: T.textMuted }}
            >
              {isHappyHorse
                ? "HappyHorse generates a video starting from this image. LiTT will also suggest ideas."
                : "Upload a photo and LiTT will instantly suggest video ideas based on what's in it."}
            </div>
          </div>

          {/* LiTT's AI idea suggestions — appears after photo analysis */}
          {uploadedImageUrl && (isAnalyzing || ideas.length > 0 || ideaError) && (
            <div
              className="border rounded-lg p-3 space-y-2"
              style={{
                borderColor: T.accentColor + "40",
                backgroundColor: T.accentColor + "08",
              }}
            >
              <div className="flex items-center gap-1.5">
                <Lightbulb size={12} style={{ color: T.accentColor }} />
                <span
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: T.accentColor }}
                >
                  LiTT&rsquo;s Ideas
                </span>
                {ideas.length > 0 && (
                  <span className="text-[9px] opacity-50 ml-auto">{ideas.length} suggestions</span>
                )}
              </div>

              {ideaError && (
                <div
                  className="text-[10px] px-2 py-1.5 rounded border"
                  style={{
                    borderColor: "#f8514940",
                    color: "#f85149",
                    backgroundColor: "#f8514910",
                  }}
                >
                  {ideaError}
                </div>
              )}

              {isAnalyzing && ideas.length === 0 && !ideaError && (
                <div className="space-y-1.5">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-10 rounded animate-pulse"
                      style={{ backgroundColor: T.accentColor + "10" }}
                    />
                  ))}
                </div>
              )}

              {ideas.length > 0 && (
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {ideas.map((idea, i) => (
                    <button
                      key={i}
                      onClick={() => applyIdea(idea)}
                      disabled={isGenerating}
                      className="w-full text-left p-2.5 rounded-lg border transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 group"
                      style={{
                        borderColor: T.borderColor,
                        backgroundColor: T.bgColor,
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span
                              className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider"
                              style={{
                                backgroundColor: T.accentColor + "20",
                                color: T.accentColor,
                              }}
                            >
                              {idea.vibe}
                            </span>
                            <span
                              className="text-[9px] font-bold"
                              style={{ color: T.textMuted }}
                            >
                              {idea.motion}
                            </span>
                          </div>
                          <div
                            className="text-[11px] font-bold mb-0.5"
                            style={{ color: T.textColor }}
                          >
                            {idea.title}
                          </div>
                          <div
                            className="text-[10px] leading-relaxed line-clamp-2"
                            style={{ color: T.textMuted }}
                          >
                            {idea.prompt}
                          </div>
                        </div>
                        <ArrowRight
                          size={12}
                          className="shrink-0 mt-1 opacity-30 group-hover:opacity-100 transition-opacity"
                          style={{ color: T.accentColor }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {ideas.length > 0 && (
                <div
                  className="text-[9px] pt-1 border-t"
                  style={{ color: T.textMuted, borderColor: T.borderColor }}
                >
                  Click any idea to load it into the scene description
                </div>
              )}
            </div>
          )}

          <div
            className="border rounded-lg p-3"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <label
              className="block text-[10px] uppercase tracking-widest mb-2"
              style={{ color: T.textMuted }}
            >
              Model
            </label>
            <div className="space-y-1.5">
              {VIDEO_MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => m.available && setModel(m.id)}
                  disabled={isGenerating || !m.available}
                  title={m.available ? undefined : `${m.label} is not yet available — server-side integration pending`}
                  className="w-full p-2.5 text-left text-[11px] rounded border transition-all hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  style={{
                    backgroundColor:
                      model === m.id ? T.accentColor + "20" : T.bgColor,
                    borderColor: model === m.id ? T.accentColor : T.borderColor,
                    color: model === m.id ? T.accentColor : T.textColor,
                  }}
                >
                  <div className="font-bold flex items-center justify-between">
                    <span>{m.label}</span>
                    <span className="flex items-center gap-1 text-[9px] opacity-60">
                      {m.available ? m.provider : <span style={{ color: "#fb7185" }}>Coming soon</span>}
                    </span>
                  </div>
                  <div className="text-[9px] opacity-60 mt-0.5">
                    {m.desc} · {m.cost} 🪙
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div
            className="border rounded-lg p-3"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <label
              className="block text-[10px] uppercase tracking-widest mb-1.5"
              style={{ color: T.textMuted }}
            >
              Duration
            </label>
            <input
              type="range"
              min={isHappyHorse ? 3 : 2}
              max={isHappyHorse ? 15 : 8}
              step={1}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              disabled={isGenerating}
              aria-label="Video duration in seconds"
              title="Video duration in seconds"
              aria-valuemin={2}
              aria-valuemax={8}
              aria-valuenow={duration}
              className="w-full"
            />
            <div
              className="flex items-center justify-between text-[10px] mt-1"
              style={{ color: T.textMuted }}
            >
              <span>
                <Clock size={10} className="inline mr-1" />
                {duration}s
              </span>
              <span>2s — 8s</span>
            </div>
          </div>

          <div
            className="border rounded-lg p-3"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <label
              className="block text-[10px] uppercase tracking-widest mb-1.5"
              style={{ color: T.textMuted }}
            >
              Quick Starters
            </label>
            <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
              {PROMPT_PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setPrompt(p);
                    setError(null);
                  }}
                  disabled={isGenerating}
                  className="w-full text-left text-[10px] px-2 py-1 rounded border hover:opacity-80 disabled:opacity-50 line-clamp-2"
                  style={{
                    backgroundColor: T.bgColor,
                    borderColor: T.borderColor,
                    color: T.textColor,
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || !canAfford || isGenerating}
            className="w-full py-3 rounded-lg font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40 transition-all hover:scale-[1.01]"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor} 0%, ${T.headerColor} 100%)`,
              color: T.bgColor,
              boxShadow: `0 0 20px ${T.accentColor}30`,
            }}
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Wand2 size={16} /> Generate ({cost} 🪙)
              </>
            )}
          </button>

          {error && (
            <div
              className="text-[11px] flex items-center gap-1.5 px-3 py-2 rounded border"
              style={{
                borderColor: "#f85149",
                color: "#f85149",
                backgroundColor: "#f8514910",
              }}
            >
              <AlertTriangle size={12} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* RIGHT: Preview + History */}
        <div className="lg:col-span-3 space-y-3">
          <div
            className="border-2 rounded-lg overflow-hidden"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="px-3 py-1.5 border-b flex items-center justify-between"
              style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}
            >
              <span
                className="text-[10px] uppercase tracking-widest"
                style={{ color: T.textMuted }}
              >
                Preview
              </span>
              {current?.status === "succeeded" && (
                <span className="text-[10px]" style={{ color: "#56d364" }}>
                  ● Ready
                </span>
              )}
              {isGenerating && (
                <span
                  className="text-[10px] flex items-center gap-1"
                  style={{ color: T.accentColor }}
                >
                  <Loader2 size={10} className="animate-spin" /> Working...
                </span>
              )}
            </div>
            <div
              className="aspect-video relative flex items-center justify-center"
              style={{ backgroundColor: T.bgColor }}
            >
              {current?.videoUrl ? (
                <video
                  src={current.videoUrl}
                  controls
                  className="w-full h-full object-cover"
                  style={{ maxHeight: "360px" }}
                />
              ) : isGenerating ? (
                <div className="text-center">
                  <div className="relative w-20 h-20 mx-auto mb-3">
                    <div
                      className="absolute inset-0 rounded-full border-2 animate-ping"
                      style={{ borderColor: T.accentColor, opacity: 0.4 }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center text-2xl">
                      🎬
                    </div>
                  </div>
                  <p className="text-sm opacity-70">Generating video...</p>
                  <p className="text-[10px] opacity-50 mt-1">
                    This can take 30-120 seconds
                  </p>
                </div>
              ) : (
                <div className="text-center px-6">
                  <div className="text-4xl mb-2 opacity-30">🎬</div>
                  <p className="text-sm opacity-60">
                    Your video will appear here
                  </p>
                </div>
              )}
            </div>
            {current?.videoUrl && (
              <div
                className="px-3 py-2 border-t flex items-center gap-2"
                style={{
                  borderColor: T.borderColor,
                  backgroundColor: T.bgColor,
                }}
              >
                <button
                  onClick={() => handleDownload(current.videoUrl!)}
                  className="px-2.5 py-1 text-[10px] font-bold rounded border flex items-center gap-1"
                  style={{ borderColor: T.borderColor, color: T.textColor }}
                >
                  <Download size={10} /> Download
                </button>
                <button
                  onClick={handleGenerate}
                  className="px-2.5 py-1 text-[10px] font-bold rounded border flex items-center gap-1"
                  style={{ borderColor: T.borderColor, color: T.textColor }}
                >
                  <RefreshCw size={10} /> Regen
                </button>
              </div>
            )}
          </div>

          <div
            className="border rounded-lg"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="px-3 py-2 border-b flex items-center justify-between"
              style={{ borderColor: T.borderColor }}
            >
              <div
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest"
                style={{ color: T.textMuted }}
              >
                <History size={10} /> Recent ({history.length})
              </div>
              {history.length > 0 && (
                <button
                  onClick={handleClear}
                  className="text-[9px] opacity-60 hover:opacity-100"
                >
                  Clear
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="p-6 text-center text-xs opacity-50">
                No videos yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 p-2">
                {history.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setCurrent(g)}
                    className="relative aspect-video border rounded overflow-hidden hover:scale-[1.02] transition-transform"
                    style={{
                      borderColor: T.borderColor,
                      backgroundColor: T.bgColor,
                    }}
                  >
                    {g.videoUrl ? (
                      <video
                        src={g.videoUrl}
                        className="w-full h-full object-cover"
                        muted
                      />
                    ) : g.status === "failed" ? (
                      <div className="w-full h-full flex items-center justify-center text-lg">
                        ⚠️
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2
                          size={14}
                          className="animate-spin opacity-50"
                        />
                      </div>
                    )}
                    <div
                      className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 text-[8px] truncate"
                      style={{
                        backgroundColor: "rgba(0,0,0,0.7)",
                        color: "white",
                      }}
                    >
                      {g.model}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
