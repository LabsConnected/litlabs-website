import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI, Modality } from "@google/genai";
import {
  MEDIA_PROVIDERS,
  MediaFormat,
  MediaProviderId,
  getProvider,
} from "@/lib/media";
import { uploadBinaryAsset } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase";
import { calculateRetailBits } from "@/lib/generation/cost-engine";
import {
  createGenerationJob,
  completeGenerationJob,
  failGenerationJob,
  getGenerationJobByRequestId,
} from "@/lib/generation/jobs";
import { resolveInternalUserId } from "@/lib/generation/identity";

// ── Route configuration ──────────────────────────────────────────
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Environment variables ────────────────────────────────────────
const HF_API_KEY = process.env.HUGGING_FACE_API_KEY;
const HF_VIDEO_URL =
  "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7";
const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";
const FAL_API_KEY = process.env.FAL_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RECRAFT_API_KEY = process.env.RECRAFT_API_KEY;
const ALIBABA_API_KEY = process.env.ALIBABA_DASHSCOPE_API_KEY;
const ALIBABA_WORKSPACE_ID = process.env.ALIBABA_MODELSTUDIO_WORKSPACE_ID;
const ALIBABA_REGION = process.env.ALIBABA_MODELSTUDIO_REGION || "ap-southeast-1";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_AI_API_TOKEN = process.env.CLOUDFLARE_AI_API_TOKEN;
const CLOUDFLARE_IMAGE_MODEL =
  process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";

// ── Types ────────────────────────────────────────────────────────

type GeminiImageModel =
  | "gemini-3.1-flash-lite-image"
  | "gemini-3.1-flash-image"
  | "gemini-3-pro-image"
  | "gemini-2.5-flash-image";

type ImageGenerationMode = "auto-free" | "auto-quality" | "manual";

type MediaRequest = {
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  providerId?: MediaProviderId;
  format?: MediaFormat;
  width?: number;
  height?: number;
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
  referenceUrl?: string;
  generationMode?: ImageGenerationMode;
  /** Client-generated request ID for idempotent retries. */
  requestId?: string;
};

type MediaResult = {
  downloadUrl: string;
  thumbUrl?: string;
  id: string;
  status: number | string;
  title: string;
  format: MediaFormat;
};

type GenerationResponse = {
  success: true;
  requestId: string;
  providerId: MediaProviderId;
  model?: string;
  downloadUrl: string;
  thumbUrl?: string;
  title: string;
  id: string;
  cost: number;
  free: boolean;
  balance: number | null;
  /** Canonical generation_jobs ID for Asset Lake auto-selection. */
  generationJobId?: string | null;
  /** Canonical Asset Lake ID (generation_job:<id>) for auto-selection. */
  assetId?: string | null;
  /** True if generation succeeded but Asset Lake persistence failed. */
  assetPersistenceFailed?: boolean;
};

type GenerationErrorResponse = {
  success: false;
  requestId: string;
  providerId: MediaProviderId | null;
  code: string;
  error: string;
  retryable: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

function resolveGeminiAspect(
  width: number,
  height: number,
  explicitRatio?: string,
): string {
  const VALID = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"];
  if (explicitRatio && VALID.includes(explicitRatio)) return explicitRatio;
  const r = width / height;
  if (r > 1.7) return "16:9";
  if (r > 1.2) return "4:3";
  if (r < 0.6) return "9:16";
  if (r < 0.85) return "3:4";
  return "1:1";
}

/**
 * Upload a generated image to durable storage.
 * Tries R2 first, then Supabase Storage as a fallback.
 * Handles both base64 data URLs and remote URLs.
 * Returns a durable public URL, or the original URL if all storage fails.
 */
async function persistImage(
  userId: string,
  downloadUrl: string,
  providerId: MediaProviderId,
  prompt: string,
): Promise<string> {
  // Parse the image into a buffer first
  let buffer: Buffer;
  let contentType: string;

  if (downloadUrl.startsWith("data:image/")) {
    const match = downloadUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) return downloadUrl;
    contentType = match[1];
    buffer = Buffer.from(match[2], "base64");
  } else {
    try {
      const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return downloadUrl;
      contentType = res.headers.get("content-type") || "image/png";
      if (!contentType.startsWith("image/")) contentType = "image/png";
      const arrayBuf = await res.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
    } catch {
      return downloadUrl;
    }
  }

  const ext = contentType.split("/")[1]?.split("+")[0] || "png";
  const safePrompt = prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "-");
  const filename = `${providerId}-${safePrompt}.${ext}`;

  // Try R2 first
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) {
    try {
      const result = await uploadBinaryAsset(userId, filename, buffer, contentType, "image");
      return result.publicUrl;
    } catch {
      // Fall through to Supabase Storage
    }
  }

  // Fallback: Supabase Storage (bucket: studio-images)
  if (supabaseAdmin) {
    try {
      const filePath = `${userId}/${Date.now()}_${filename}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from("studio-images")
        .upload(filePath, buffer, { contentType, upsert: false });

      if (!uploadError) {
        const { data: urlData } = supabaseAdmin.storage
          .from("studio-images")
          .getPublicUrl(filePath);
        if (urlData?.publicUrl) return urlData.publicUrl;
      }
    } catch {
      // Fall through to original URL
    }
  }

  // Last resort: return the original URL (data URL or remote URL)
  return downloadUrl;
}

// ── Provider implementations ─────────────────────────────────────

async function handleGeminiImage(args: {
  prompt: string;
  aspectRatio: string;
  imageSize: "1K" | "2K" | "4K";
  referenceUrl?: string;
}): Promise<MediaResult> {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini is not configured — set GEMINI_API_KEY");
  }

  const model = (process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image") as GeminiImageModel;
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: args.prompt.trim() },
  ];

  // Reference image editing — include inline data if provided
  if (args.referenceUrl?.startsWith("data:image/")) {
    const match = args.referenceUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) {
      parts.unshift({
        inlineData: {
          mimeType: match[1],
          data: match[2],
        },
      });
    }
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: [Modality.IMAGE],
      responseFormat: [
        {
          image: {
            aspectRatio: args.aspectRatio,
            imageSize: args.imageSize,
          },
        },
      ],
    } as Record<string, unknown>,
  });

  const responseParts = response.candidates?.[0]?.content?.parts ?? [];
  const generated = responseParts.find(
    (part) => {
      const inlineData = (part as { inlineData?: { data?: string } }).inlineData;
      return inlineData?.data;
    },
  );

  const inlineData = (generated as { inlineData?: { data?: string; mimeType?: string } })
    ?.inlineData;

  if (!inlineData?.data) {
    throw new Error("Gemini completed without returning image data");
  }

  const mimeType = inlineData.mimeType ?? "image/png";

  return {
    downloadUrl: `data:${mimeType};base64,${inlineData.data}`,
    id: `gemini_${Date.now()}`,
    status: "complete",
    title: args.prompt.slice(0, 60),
    format: "image",
  };
}

async function handleAlibabaImage(args: {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  referenceUrl?: string;
}): Promise<MediaResult> {
  if (!ALIBABA_API_KEY) {
    throw new Error("Alibaba Model Studio API key is missing — set ALIBABA_DASHSCOPE_API_KEY");
  }
  if (!ALIBABA_WORKSPACE_ID) {
    throw new Error("Alibaba Model Studio workspace ID is missing — set ALIBABA_MODELSTUDIO_WORKSPACE_ID");
  }

  const domain =
    ALIBABA_REGION === "cn-beijing"
      ? `${ALIBABA_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com`
      : `${ALIBABA_WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com`;

  const endpoint =
    `https://${domain}/api/v1/services/aigc/multimodal-generation/generation`;

  const content: Array<Record<string, string>> = [];
  if (args.referenceUrl) {
    content.push({ image: args.referenceUrl });
  }
  content.push({ text: args.prompt.trim() });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ALIBABA_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.ALIBABA_IMAGE_MODEL || "qwen-image-2.0",
      input: {
        messages: [{ role: "user", content }],
      },
      parameters: {
        prompt_extend: true,
        n: 1,
        size: `${args.width}*${args.height}`,
        negative_prompt: args.negativePrompt || undefined,
        seed: args.seed,
        watermark: false,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const raw = await response.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Alibaba returned non-JSON HTTP ${response.status}: ${raw.slice(0, 200)}`,
    );
  }

  if (!response.ok) {
    const msg =
      (typeof data.message === "string" && data.message) ||
      (typeof data.code === "string" && data.code) ||
      `Alibaba failed with HTTP ${response.status}`;
    throw new Error(msg);
  }

  const output = data.output as
    | { choices?: Array<{ message?: { content?: Array<Record<string, unknown>> } }> }
    | undefined;

  const imageUrl = output?.choices?.[0]?.message?.content?.find(
    (item: Record<string, unknown>) => typeof item.image === "string",
  )?.image as string | undefined;

  if (!imageUrl) {
    throw new Error("Alibaba returned no generated image URL");
  }

  return {
    downloadUrl: imageUrl,
    id: (typeof data.request_id === "string" && data.request_id) || `alibaba_${Date.now()}`,
    status: "complete",
    title: args.prompt.slice(0, 60),
    format: "image",
  };
}

async function handleCloudflareImage(args: {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
}): Promise<MediaResult> {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AI_API_TOKEN) {
    throw new Error("Cloudflare Workers AI is not configured — set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_API_TOKEN");
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${CLOUDFLARE_IMAGE_MODEL}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLOUDFLARE_AI_API_TOKEN}`,
    },
    body: JSON.stringify({
      prompt: args.prompt.trim(),
      width: Math.min(args.width, 1024),
      height: Math.min(args.height, 1024),
      seed: args.seed,
      num_steps: 4, // FLUX schnell works well with 4 steps
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const contentType = response.headers.get("content-type") || "image/png";

  if (!response.ok) {
    const errText = await response.text();
    let msg: string;
    try {
      const errData = JSON.parse(errText) as { errors?: Array<{ message?: string }> };
      msg = errData.errors?.[0]?.message || `Cloudflare failed with HTTP ${response.status}`;
    } catch {
      msg = `Cloudflare failed with HTTP ${response.status}: ${errText.slice(0, 200)}`;
    }
    throw new Error(msg);
  }

  // Cloudflare Workers AI can return either:
  //   1. Binary image data (content-type: image/png)
  //   2. JSON with base64 image (content-type: application/json)
  if (contentType.startsWith("image/")) {
    const arrayBuf = await response.arrayBuffer();
    const b64 = Buffer.from(arrayBuf).toString("base64");
    return {
      downloadUrl: `data:${contentType};base64,${b64}`,
      id: `cloudflare_${Date.now()}`,
      status: "complete",
      title: args.prompt.slice(0, 60),
      format: "image",
    };
  }

  // JSON response — parse and extract base64 image
  const jsonText = await response.text();
  const data = JSON.parse(jsonText) as {
    result?: { image?: string };
    success?: boolean;
    errors?: Array<{ message?: string }>;
  };
  if (!data.success && data.errors?.[0]?.message) {
    throw new Error(data.errors[0].message);
  }
  if (data.result?.image) {
    return {
      downloadUrl: `data:image/png;base64,${data.result.image}`,
      id: `cloudflare_${Date.now()}`,
      status: "complete",
      title: args.prompt.slice(0, 60),
      format: "image",
    };
  }
  throw new Error("Cloudflare returned no image data");
}

async function handleFalImage(
  prompt: string,
  width: number,
  height: number,
  negativePrompt?: string,
  seed?: number,
): Promise<MediaResult> {
  if (!FAL_API_KEY) throw new Error("FAL.ai key missing — set FAL_KEY");

  const body: Record<string, unknown> = {
    prompt: prompt.trim(),
    image_size: {
      width: Math.min(width, 1440),
      height: Math.min(height, 1440),
    },
    num_images: 1,
    enable_safety_checker: true,
  };
  if (negativePrompt && negativePrompt.trim()) {
    body.negative_prompt = negativePrompt.trim();
  }
  if (typeof seed === "number" && seed > 0) {
    body.seed = seed;
  }

  const submitRes = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${FAL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!submitRes.ok) {
    const err = await submitRes.text().catch(() => "");
    throw new Error(`FAL.ai submit error: ${err.slice(0, 200) || submitRes.statusText}`);
  }

  const submitData = await submitRes.json();

  if (submitData.images?.[0]?.url) {
    return {
      downloadUrl: submitData.images[0].url,
      id: `fal_${Date.now()}`,
      status: "complete",
      title: prompt.slice(0, 60),
      format: "image",
    };
  }

  const requestId = submitData.request_id;
  const statusUrl = `https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}/status`;
  const resultUrl = `https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}`;

  const start = Date.now();
  while (Date.now() - start < 60_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(statusUrl, {
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });
    const pollData = await pollRes.json();
    if (pollData.status === "COMPLETED") {
      const resultRes = await fetch(resultUrl, {
        headers: { Authorization: `Key ${FAL_API_KEY}` },
      });
      const resultData = await resultRes.json();
      const imgUrl = resultData.images?.[0]?.url;
      if (!imgUrl) throw new Error("FAL.ai returned no image URL");
      return {
        downloadUrl: imgUrl,
        id: `fal_${requestId}`,
        status: "complete",
        title: prompt.slice(0, 60),
        format: "image",
      };
    }
    if (pollData.status === "FAILED") {
      throw new Error("FAL.ai generation failed");
    }
  }
  throw new Error("FAL.ai timed out after 60s");
}

async function handleHuggingFaceVideo(
  prompt: string,
  referenceUrl?: string,
): Promise<MediaResult> {
  if (!HF_API_KEY)
    throw new Error("Hugging Face key missing — set HUGGING_FACE_API_KEY");

  const modelUrl = referenceUrl
    ? "https://api-inference.huggingface.co/models/stabilityai/stable-video-diffusion-img2vid"
    : HF_VIDEO_URL;

  const body: Record<string, unknown> = referenceUrl
    ? { inputs: referenceUrl, options: { wait_for_model: true, use_cache: false } }
    : { inputs: prompt.trim(), options: { wait_for_model: true, use_cache: false } };

  const res = await fetch(modelUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${HF_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Hugging Face error: ${error.slice(0, 200)}`);
  }

  const buffer = await res.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  return {
    downloadUrl: `data:video/mp4;base64,${base64}`,
    id: `hf_${Date.now()}`,
    status: "complete",
    title: `HF Clip ${new Date().toISOString().slice(0, 16)}`,
    format: "video",
  };
}

async function handlePollinationsImage(
  prompt: string,
  negativePrompt: string,
  seed: number,
  width: number,
  height: number,
): Promise<MediaResult> {
  const fixedSeed = seed ?? Math.floor(Math.random() * 1000000);
  const params = new URLSearchParams({
    width: String(Math.min(width, 1024)),
    height: String(Math.min(height, 1024)),
    seed: String(fixedSeed),
    nologo: "true",
    enhance: "false",
    model: "flux",
  });
  if (negativePrompt.trim()) params.set("negative", negativePrompt.trim());
  const url = `${POLLINATIONS_BASE}/${encodeURIComponent(prompt.trim())}?${params}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (res.ok) {
      const ct = res.headers.get("content-type") || "image/jpeg";
      const buf = await res.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      return {
        downloadUrl: `data:${ct};base64,${b64}`,
        id: `pollinations_${Date.now()}`,
        status: "complete",
        title: prompt.slice(0, 60),
        format: "image",
      };
    }
  } catch {
    clearTimeout(timer);
  }

  return {
    downloadUrl: url,
    id: `pollinations_${Date.now()}`,
    status: "complete",
    title: prompt.slice(0, 60),
    format: "image",
  };
}

async function handleTogetherImage(
  prompt: string,
  width: number,
  height: number,
): Promise<MediaResult> {
  if (!TOGETHER_API_KEY)
    throw new Error("Together.ai key missing — set TOGETHER_API_KEY");

  const res = await fetch("https://api.together.xyz/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOGETHER_API_KEY}`,
    },
    body: JSON.stringify({
      model: "black-forest-labs/FLUX.1-schnell-Free",
      prompt: prompt.trim(),
      width: Math.min(width, 1024),
      height: Math.min(height, 1024),
      steps: 4,
      n: 1,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Together.ai error: ${err.slice(0, 200) || res.statusText}`);
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  const url = data.data?.[0]?.url;
  if (b64) {
    return {
      downloadUrl: `data:image/png;base64,${b64}`,
      id: `together_${Date.now()}`,
      status: "complete",
      title: prompt.slice(0, 60),
      format: "image",
    };
  }
  if (url) {
    return {
      downloadUrl: url,
      id: `together_${Date.now()}`,
      status: "complete",
      title: prompt.slice(0, 60),
      format: "image",
    };
  }
  throw new Error("Together.ai returned no image data");
}

async function handleOpenAIImage(prompt: string): Promise<MediaResult> {
  if (!OPENAI_API_KEY)
    throw new Error("OpenAI key missing — set OPENAI_API_KEY");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: prompt.trim(),
      size: "1024x1024",
      quality: "standard",
      n: 1,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI error: ${err.slice(0, 200) || res.statusText}`);
  }

  const data = await res.json();
  const url = data.data?.[0]?.url;
  if (!url) throw new Error("OpenAI returned no image URL");

  return {
    downloadUrl: url,
    id: `openai_${Date.now()}`,
    status: "complete",
    title: prompt.slice(0, 60),
    format: "image",
  };
}

async function handleRecraftImage(prompt: string): Promise<MediaResult> {
  if (!RECRAFT_API_KEY)
    throw new Error("Recraft key missing — set RECRAFT_API_KEY");

  const res = await fetch(
    "https://external.api.recraft.ai/v1/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RECRAFT_API_KEY}`,
      },
      body: JSON.stringify({
        prompt: prompt.trim(),
        style: "digital_illustration",
        n: 1,
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Recraft error: ${err.slice(0, 200) || res.statusText}`);
  }

  const data = await res.json();
  const url = data.data?.[0]?.url;
  if (!url) throw new Error("Recraft returned no image URL");

  return {
    downloadUrl: url,
    id: `recraft_${Date.now()}`,
    status: "complete",
    title: prompt.slice(0, 60),
    format: "image",
  };
}

// ── Auto Best router ─────────────────────────────────────────────

/**
 * Auto-free provider order: Pollinations → Cloudflare → Alibaba
 * Pollinations is always available (no key needed) so it goes first.
 * Cloudflare and Alibaba are tried as faster alternatives when configured.
 */
const AUTO_FREE_ORDER: MediaProviderId[] = ["pollinations", "cloudflare", "alibaba"];

/**
 * Auto-quality provider order: FAL → Recraft → Gemini → Pollinations
 * FAL is the most reliable quality provider (fast, good output).
 * Recraft is preferred for vector/logo prompts.
 * Gemini is tried later since its key has had issues.
 * Pollinations is always appended as a last-resort fallback so users
 * never get a hard 502 when all quality providers are down or unconfigured.
 */
const AUTO_QUALITY_ORDER: MediaProviderId[] = ["fal", "recraft", "gemini", "pollinations"];

function isProviderConfigured(providerId: MediaProviderId): boolean {
  switch (providerId) {
    case "gemini": return !!GEMINI_API_KEY;
    case "alibaba": return !!ALIBABA_API_KEY && !!ALIBABA_WORKSPACE_ID;
    case "cloudflare": return !!CLOUDFLARE_ACCOUNT_ID && !!CLOUDFLARE_AI_API_TOKEN;
    case "fal": return !!FAL_API_KEY;
    case "together": return !!TOGETHER_API_KEY;
    case "openai": return !!OPENAI_API_KEY;
    case "recraft": return !!RECRAFT_API_KEY;
    case "pollinations": return true; // always available
    case "huggingface": return !!HF_API_KEY;
    default: return false;
  }
}

function isVectorRequest(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return (
    lower.includes("vector") ||
    lower.includes("logo") ||
    lower.includes("svg") ||
    lower.includes("icon") ||
    lower.includes("graphic")
  );
}

function getAutoOrder(
  mode: "auto-free" | "auto-quality",
  prompt: string,
): MediaProviderId[] {
  if (mode === "auto-free") {
    return AUTO_FREE_ORDER.filter(isProviderConfigured);
  }
  // auto-quality
  const order = [...AUTO_QUALITY_ORDER];
  // Prefer Recraft first for vector/logo requests
  if (isVectorRequest(prompt) && isProviderConfigured("recraft")) {
    return ["recraft", ...order.filter((p) => p !== "recraft")];
  }
  return order.filter(isProviderConfigured);
}

// ── Provider dispatch ────────────────────────────────────────────

async function dispatchProvider(
  providerId: MediaProviderId,
  body: MediaRequest,
  prompt: string,
): Promise<MediaResult> {
  const width = body.width ?? 1024;
  const height = body.height ?? 1024;

  if (providerId === "gemini") {
    return handleGeminiImage({
      prompt,
      aspectRatio: resolveGeminiAspect(width, height, body.aspectRatio),
      imageSize: body.imageSize ?? "1K",
      referenceUrl: body.referenceUrl,
    });
  }
  if (providerId === "alibaba") {
    return handleAlibabaImage({
      prompt,
      negativePrompt: body.negativePrompt,
      width,
      height,
      seed: body.seed,
      referenceUrl: body.referenceUrl,
    });
  }
  if (providerId === "cloudflare") {
    return handleCloudflareImage({
      prompt,
      width,
      height,
      seed: body.seed,
    });
  }
  if (providerId === "fal") {
    return handleFalImage(prompt, width, height, body.negativePrompt, body.seed);
  }
  if (providerId === "huggingface") {
    return handleHuggingFaceVideo(prompt, body.referenceUrl);
  }
  if (providerId === "pollinations") {
    return handlePollinationsImage(
      prompt,
      body.negativePrompt ?? "",
      body.seed ?? 0,
      width,
      height,
    );
  }
  if (providerId === "together") {
    return handleTogetherImage(prompt, width, height);
  }
  if (providerId === "openai") {
    return handleOpenAIImage(prompt);
  }
  if (providerId === "recraft") {
    return handleRecraftImage(prompt);
  }
  throw new Error(`${providerId} is not yet wired`);
}

// ── Main handler ─────────────────────────────────────────────────

async function handler(req: NextRequest) {
  const startTime = Date.now();
  // Use client-provided requestId for idempotency, or generate one.
  // The client should send the same requestId on retries to avoid double-charging.
  let requestId: string = "";

  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json(
      {
        success: false,
        requestId,
        providerId: null,
        code: "UNAUTHORIZED",
        error: "Sign in to generate media",
        retryable: false,
      } satisfies GenerationErrorResponse,
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  }

  // Resolve Clerk ID → internal public.users.id UUID.
  // generation_jobs.user_id requires the internal UUID, NOT the Clerk ID.
  // Wallet operations still use the Clerk ID.
  const internalUserId = await resolveInternalUserId(userId);

  let body: MediaRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        requestId: "parse-error",
        providerId: null,
        code: "BAD_REQUEST",
        error: "Invalid request body — send JSON",
        retryable: false,
      } satisfies GenerationErrorResponse,
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": "parse-error",
        },
      },
    );
  }

  // Set requestId from client or generate a new one.
  // Client-provided requestId enables idempotent retries.
  requestId = body.requestId || crypto.randomUUID();

  const prompt = body.prompt?.trim();
  if (!prompt || prompt.length < 3) {
    return NextResponse.json(
      {
        success: false,
        requestId,
        providerId: null,
        code: "BAD_REQUEST",
        error: "Prompt must be at least 3 characters",
        retryable: false,
      } satisfies GenerationErrorResponse,
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  }

  const format: MediaFormat =
    body.format ?? (body.providerId === "huggingface" ? "video" : "image");

  // ── Resolve provider (manual or auto) ──────────────────────────
  let providerId: MediaProviderId;
  const generationMode: ImageGenerationMode = body.generationMode ?? "manual";

  if (generationMode === "auto-free" || generationMode === "auto-quality") {
    const order = getAutoOrder(generationMode, prompt);
    if (order.length === 0) {
      return NextResponse.json(
        {
          success: false,
          requestId,
          providerId: null,
          code: "NO_PROVIDER",
          error: `No ${generationMode === "auto-free" ? "free" : "quality"} providers are configured`,
          retryable: false,
        } satisfies GenerationErrorResponse,
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "X-Request-Id": requestId,
          },
        },
      );
    }
    providerId = order[0]; // Start with the first; fall through on failure
  } else {
    // Manual mode
    providerId = body.providerId ?? "pollinations";
  }

  const provider = getProvider(providerId);
  if (!provider) {
    return NextResponse.json(
      {
        success: false,
        requestId,
        providerId,
        code: "UNKNOWN_PROVIDER",
        error: "Unknown media provider",
        retryable: false,
      } satisfies GenerationErrorResponse,
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  }

  if (!provider.supportedFormats.includes(format)) {
    return NextResponse.json(
      {
        success: false,
        requestId,
        providerId,
        code: "FORMAT_NOT_SUPPORTED",
        error: `${provider.label} does not support ${format}`,
        retryable: false,
      } satisfies GenerationErrorResponse,
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  }

  // ── Wallet check (canonical credit_ledger) ────────────────────
  // Use the cost engine for server-authoritative pricing.
  // Legacy provider.cost() is still used for free providers (cost=0).
  const legacyCost = provider.cost(format);
  const costResult = calculateRetailBits({
    modality: "image",
    provider: providerId,
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image",
  });
  const cost = provider.free ? 0 : Math.max(legacyCost, costResult.retailLiTTBits);

  // Idempotency: check for existing job with this requestId
  // Uses internal UUID, not Clerk ID.
  const existingJob = internalUserId
    ? await getGenerationJobByRequestId(internalUserId, requestId)
    : null;
  if (existingJob && existingJob.status === "completed") {
    // Replay — return the existing result without re-charging
    return NextResponse.json(
      {
        success: true,
        requestId,
        providerId: existingJob.provider as MediaProviderId,
        downloadUrl: existingJob.metadata?.durableUrl as string ?? null,
        thumbUrl: null,
        title: existingJob.prompt.slice(0, 60),
        id: existingJob.id,
        cost: existingJob.littBitsCharged,
        free: existingJob.littBitsCharged === 0,
        balance: null,
        replayed: true,
        generationJobId: existingJob.id,
        assetId: `generation_job:${existingJob.id}`,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  }

  if (cost > 0) {
    const balances = await getCreditBalances(userId);
    if (balances.total < cost) {
      return NextResponse.json(
        {
          success: false,
          requestId,
          providerId,
          code: "INSUFFICIENT_FUNDS",
          error: `Insufficient LiTTBits. Need ${cost}, have ${balances.total}`,
          retryable: false,
        } satisfies GenerationErrorResponse,
        {
          status: 402,
          headers: {
            "Cache-Control": "no-store",
            "X-Request-Id": requestId,
          },
        },
      );
    }
  }

  // ── Generate (with auto-router fallthrough) ────────────────────
  let result: MediaResult | null = null;
  let usedProviderId: MediaProviderId = providerId;
  let lastError: Error | null = null;

  if (generationMode === "auto-free" || generationMode === "auto-quality") {
    const order = getAutoOrder(generationMode, prompt);
    for (const candidateId of order) {
      const candidate = getProvider(candidateId);
      if (!candidate) continue;
      try {
        result = await dispatchProvider(candidateId, body, prompt);
        usedProviderId = candidateId;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error("Provider error");
        // Continue to next provider
      }
    }
  } else {
    // Manual mode — single provider, no fallthrough
    try {
      result = await dispatchProvider(providerId, body, prompt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Provider error");
    }
  }

  if (!result || lastError) {
    const rawMsg = lastError?.message || "Generation failed";
    // Detect quota exhaustion and give a actionable message
    const isQuota = rawMsg.includes("429") || rawMsg.toLowerCase().includes("quota");
    const errorMsg = isQuota
      ? `${usedProviderId} quota exceeded. Try "Auto Best (Free)" mode which uses Pollinations — no API key needed.`
      : rawMsg;
    const duration = Date.now() - startTime;
    // Log the failure (no secrets — only provider, requestId, status, duration)
    console.info(`[media/generate] FAIL provider=${usedProviderId} requestId=${requestId} status=502 duration=${duration}ms`);
    return NextResponse.json(
      {
        success: false,
        requestId,
        providerId: usedProviderId,
        code: isQuota ? "QUOTA_EXCEEDED" : "PROVIDER_ERROR",
        error: errorMsg,
        retryable: !isQuota,
      } satisfies GenerationErrorResponse,
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  }

  // ── Persist to R2 (for providers that return temporary or data URLs) ───
  // Gemini returns a data:image/png;base64,... URL which can be several MB.
  // Storing it in R2 converts it to a durable, cacheable public URL that
  // won't break localStorage or hit browser data URL size limits.
  let durableUrl = result.downloadUrl;
  if (usedProviderId === "gemini" || usedProviderId === "alibaba" || usedProviderId === "fal" || usedProviderId === "openai" || usedProviderId === "recraft") {
    durableUrl = await persistImage(userId, result.downloadUrl, usedProviderId, prompt);
  }

  // ── Deduct cost via canonical wallet ledger (idempotent) ───────
  const usedProvider = getProvider(usedProviderId)!;
  const usedCostResult = calculateRetailBits({
    modality: "image",
    provider: usedProviderId,
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image",
  });
  const usedCost = usedProvider.free ? 0 : Math.max(usedProvider.cost(format), usedCostResult.retailLiTTBits);
  let newBalance: number | null = null;

  if (!usedProvider.free && usedCost > 0) {
    // Idempotent debit — same requestId = no double charge
    const charge = await adjustWalletBalance({
      clerkId: userId,
      amount: -usedCost,
      type: "spend",
      reason: `Image generation: ${usedProviderId} — ${prompt.slice(0, 60)}`,
      idempotencyKey: `image:charge:${requestId}`,
    });
    newBalance = charge.balance;
  } else {
    // Free provider — still get balance for display
    try {
      const balances = await getCreditBalances(userId);
      newBalance = balances.total;
    } catch {
      newBalance = null;
    }
  }

  // ── Record generation job (durable, queryable) ─────────────────
  // Uses internal UUID for user_id, NOT the Clerk ID.
  // If persistence fails, generation still succeeded — but we must
  // NOT return a fabricated assetId. The response distinguishes:
  //   generation succeeded + asset persisted → assetId is canonical
  //   generation succeeded + asset persistence failed → assetId is null
  let generationJobId: string | null = null;
  let assetPersistenceFailed = false;
  if (internalUserId) {
    try {
      const jobId = crypto.randomUUID();
      await createGenerationJob({
        id: jobId,
        userId: internalUserId,
        modality: "image",
        provider: usedProviderId,
        model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image",
        prompt,
        requestId,
        littBitsCharged: usedCost,
        metadata: { durableUrl, durationMs: Date.now() - startTime },
      });
      await completeGenerationJob(jobId, `generation_job:${jobId}`, usedCostResult.providerCostCents);
      generationJobId = jobId;
    } catch (persistErr) {
      // Generation succeeded but Asset Lake persistence failed.
      // Log the error and mark it — do NOT fabricate an assetId.
      console.error(
        `[media/generate] Asset persistence failed for requestId=${requestId}:`,
        persistErr instanceof Error ? persistErr.message : persistErr,
      );
      assetPersistenceFailed = true;
    }
  } else {
    // Could not resolve internal user ID — persistence impossible.
    assetPersistenceFailed = true;
  }

  const duration = Date.now() - startTime;
  // Log success (no secrets — only provider, requestId, status, duration)
  console.info(`[media/generate] OK provider=${usedProviderId} requestId=${requestId} status=200 duration=${duration}ms`);

  return NextResponse.json(
    {
      success: true,
      requestId,
      providerId: usedProviderId,
      downloadUrl: durableUrl,
      thumbUrl: result.thumbUrl,
      title: result.title,
      id: result.id,
      cost: usedCost,
      free: usedProvider.free,
      balance: newBalance,
      generationJobId,
      assetId: generationJobId ? `generation_job:${generationJobId}` : null,
      // Truthful: if persistence failed, the generation succeeded
      // but the asset is NOT in Asset Lake. Clients must not auto-select.
      assetPersistenceFailed,
    } satisfies GenerationResponse,
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}

export const POST = withRateLimit(handler, 60, 60);

// ── GET: list providers ──────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    providers: MEDIA_PROVIDERS,
    defaults: {
      image: "pollinations" as MediaProviderId,
      video: "huggingface" as MediaProviderId,
    },
  });
}
