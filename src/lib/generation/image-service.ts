/**
 * Shared image generation service — the single server-side implementation
 * behind BOTH image generation entry points:
 *
 *   POST /api/media/generate  → auth validation → generateImage(...)
 *   Studio agent image.generate → trusted transport ctx → generateImage(...)
 *
 * This replaces the pre-2026-09-18 architecture where the Studio agent
 * loop self-fetched /api/media/generate over HTTP with an internal
 * service-key header (the #385 patch). That layering hid the real defect:
 * an unauthenticated server-to-server call to an authenticated endpoint.
 * The agent handler now calls this service directly with explicit trusted
 * server-side context (userId, projectId, conversationId, requestId) —
 * no cookies forwarded, no internal HTTP fetch, no header auth.
 *
 * Ownership rule: ctx.userId is trusted ONLY because it is resolved
 * server-side (Clerk session at the HTTP boundary; the approved
 * operation's workspace transport on the agent path). The input type has
 * no userId field — a client can never supply one.
 */

import "server-only";


import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { isBillingExempt, getActiveSimulation } from "@/lib/owner";
import { GoogleGenAI, Modality } from "@google/genai";
import {
  MediaFormat,
  MediaProviderId,
  getProvider,
} from "@/lib/media";
import { uploadBinaryAsset } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase";
import { calculateRetailBits } from "@/lib/generation/cost-engine";
import {
  createGenerationJob,
  getGenerationJobByRequestId,
  updateGenerationJobStatus,
  updateGenerationJobMetadata,
} from "@/lib/generation/jobs";
import { resolveInternalUserId } from "@/lib/generation/identity";
import type { GenerationJob, GenerationStatus } from "./types";
import type { CreateGenerationJobInput } from "./jobs";

// ── Environment variables ──

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


// ── Types ──


type GeminiImageModel =
  | "gemini-3.1-flash-lite-image"
  | "gemini-3.1-flash-image"
  | "gemini-3-pro-image"
  | "gemini-2.5-flash-image";

type ImageGenerationMode = "auto-free" | "auto-quality" | "manual";

export type ImageGenerationInput = {
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
};

type MediaResult = {
  downloadUrl: string;
  thumbUrl?: string;
  id: string;
  status: number | string;
  title: string;
  format: MediaFormat;
};






// ── Helpers ──


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


// ── Provider implementations ──


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


// ── Auto Best router ──


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


// ── Provider dispatch ──


async function dispatchProvider(
  providerId: MediaProviderId,
  body: ImageGenerationInput,
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


// ── Shared orchestration ─────────────────────────────────────────
// `generateImage` is the single server-side entry point for image
// generation. Both callers share it:
//
//   /api/media/generate (HTTP)  → auth validation → generateImage
//   Studio agent image.generate → trusted transport ctx → generateImage
//
// The agent path NEVER self-fetches the HTTP route: there is no Clerk
// session in the agent loop, no cookies to forward, and no internal
// service-key header dance. Identity arrives as explicit trusted
// server-side context (ctx.userId), resolved from the session (HTTP) or
// the approved operation's workspace transport (agent).
//
// Billing contract (enforced here, in one place):
//   - no provider success → no debit, ever
//   - the debit is idempotent on the requestId: retries, double-clicks,
//     browser retries and agent retries of the same logical operation
//     produce at most ONE provider generation and ONE debit.

/** Successful generation result. */
export type ImageGenerationSuccess = {
  success: true;
  requestId: string;
  providerId: MediaProviderId;
  downloadUrl: string;
  thumbUrl?: string | null;
  title: string;
  id: string;
  cost: number;
  free: boolean;
  balance: number | null;
  /** Canonical generation_jobs ID for Asset Lake auto-selection. */
  generationJobId: string | null;
  /** Canonical Asset Lake ID (generation_job:<id>) for auto-selection. */
  assetId: string | null;
  /** True if generation succeeded but Asset Lake persistence failed. */
  assetPersistenceFailed: boolean;
  /** True when this response replayed an earlier completed operation. */
  replayed?: boolean;
  durationMs: number;
};

export type ImageGenerationFailureCode =
  | "UNAUTHORIZED"
  | "BAD_REQUEST"
  | "NO_PROVIDER"
  | "UNKNOWN_PROVIDER"
  | "FORMAT_NOT_SUPPORTED"
  | "INSUFFICIENT_FUNDS"
  | "DUPLICATE_IN_FLIGHT"
  | "QUOTA_EXCEEDED"
  | "PROVIDER_ERROR"
  | "WALLET_ERROR"
  | "SERVICE_ERROR";

/** Failed generation result — structured, never a thrown domain error. */
export type ImageGenerationFailure = {
  success: false;
  requestId: string;
  providerId: MediaProviderId | null;
  code: ImageGenerationFailureCode;
  error: string;
  retryable: boolean;
  durationMs: number;
};

export type ImageGenerationResult =
  | ImageGenerationSuccess
  | ImageGenerationFailure;

/** Trusted server-side context for one logical generation operation. */
export interface ImageServiceContext {
  /**
   * Trusted Clerk user ID — resolved server-side from the HTTP session or
   * the approved operation's workspace transport. NEVER from client input:
   * the input type has no userId field at all.
   */
  userId: string;
  projectId?: string;
  conversationId?: string;
  /**
   * Stable idempotency key for the logical operation. The agent path sets
   * this from the approved operation's identity (`approval:<pausedRunId>`)
   * so a retried approval replays instead of generating + debiting again.
   * Generated when absent.
   */
  requestId?: string;
}

/** Side-effect seams — injected in tests, real modules in production. */
export interface ImageServiceDeps {
  resolveInternalUserId: (clerkId: string) => Promise<string | null>;
  getJobByRequestId: (
    internalUserId: string,
    requestId: string,
  ) => Promise<GenerationJob | null>;
  createJob: (input: CreateGenerationJobInput) => Promise<GenerationJob | null>;
  setJobStatus: (
    jobId: string,
    status: GenerationStatus,
    updates?: {
      providerJobId?: string | null;
      actualProviderCostCents?: number;
      assetId?: string | null;
      error?: string;
    },
  ) => Promise<void>;
  updateJobMetadata: (
    jobId: string,
    metadataUpdates: Record<string, unknown>,
  ) => Promise<void>;
  getBalances: (clerkId: string) => Promise<{ total: number }>;
  debit: (
    clerkId: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
  ) => Promise<{ balance: number | null }>;
  isBillingExempt: (clerkId: string) => Promise<boolean>;
  persistImage: (
    userId: string,
    downloadUrl: string,
    providerId: MediaProviderId,
    prompt: string,
  ) => Promise<string>;
  dispatch: (
    providerId: MediaProviderId,
    input: ImageGenerationInput,
    prompt: string,
  ) => Promise<MediaResult>;
}

const defaultDeps: ImageServiceDeps = {
  resolveInternalUserId: (clerkId) => resolveInternalUserId(clerkId),
  getJobByRequestId: (internalUserId, requestId) =>
    getGenerationJobByRequestId(internalUserId, requestId),
  createJob: (input) => createGenerationJob(input),
  setJobStatus: (jobId, status, updates) =>
    updateGenerationJobStatus(jobId, status, updates),
  updateJobMetadata: (jobId, metadataUpdates) =>
    updateGenerationJobMetadata(jobId, metadataUpdates),
  getBalances: (clerkId) => getCreditBalances(clerkId),
  debit: async (clerkId, amount, reason, idempotencyKey) => {
    const charge = await adjustWalletBalance({
      clerkId,
      amount: -amount,
      type: "spend",
      reason,
      idempotencyKey,
    });
    return { balance: charge.balance };
  },
  isBillingExempt: async (clerkId) => {
    const simulation = await getActiveSimulation().catch(() => null);
    return isBillingExempt(clerkId, simulation);
  },
  persistImage: (userId, downloadUrl, providerId, prompt) =>
    persistImage(userId, downloadUrl, providerId, prompt),
  dispatch: (providerId, input, prompt) =>
    dispatchProvider(providerId, input, prompt),
};

const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";

/** A claimed job row younger than this is treated as still in flight. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

function isInFlight(status: GenerationStatus): boolean {
  return (
    status === "queued" ||
    status === "generating" ||
    status === "processing" ||
    status === "persisting"
  );
}

function replayCompletedJob(
  existing: GenerationJob,
  requestId: string,
  startTime: number,
): ImageGenerationSuccess {
  const charged =
    typeof existing.metadata?.chargedBits === "number"
      ? (existing.metadata.chargedBits as number)
      : (existing.littBitsCharged ?? 0);
  return {
    success: true,
    requestId,
    providerId: existing.provider as MediaProviderId,
    downloadUrl: (existing.metadata?.durableUrl as string) ?? "",
    thumbUrl: null,
    title: existing.prompt.slice(0, 60),
    id: existing.id,
    cost: charged,
    free: charged === 0,
    balance: null,
    generationJobId: existing.id,
    assetId: `generation_job:${existing.id}`,
    assetPersistenceFailed: false,
    replayed: true,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Run one image generation end to end: validate → resolve provider →
 * claim idempotency → wallet pre-check → provider → persist → debit
 * (once) → record job. Returns a structured result; never throws for
 * domain failures (only for unexpected programmer errors).
 */
export async function generateImage(
  ctx: ImageServiceContext,
  input: ImageGenerationInput,
  deps: ImageServiceDeps = defaultDeps,
): Promise<ImageGenerationResult> {
  const startTime = Date.now();
  const requestId = ctx.requestId || crypto.randomUUID();
  const fail = (
    code: ImageGenerationFailure["code"],
    error: string,
    retryable: boolean,
    providerId: MediaProviderId | null = null,
  ): ImageGenerationFailure => ({
    success: false,
    requestId,
    providerId,
    code,
    error,
    retryable,
    durationMs: Date.now() - startTime,
  });

  // ── 0. Trusted identity (never from client input) ──────────────
  const userId = ctx.userId?.trim();
  if (!userId) {
    console.info(`[image-service] REJECT reason=missing_user requestId=${requestId}`);
    return fail("UNAUTHORIZED", "Sign in to generate media", false);
  }

  const prompt = input.prompt?.trim();
  if (!prompt || prompt.length < 3) {
    return fail("BAD_REQUEST", "Prompt must be at least 3 characters", false);
  }

  const format: MediaFormat =
    input.format ?? (input.providerId === "huggingface" ? "video" : "image");

  // ── 1. Resolve provider (manual or auto) ────────────────────────
  const generationMode = input.generationMode ?? "manual";
  let providerId: MediaProviderId;
  if (generationMode === "auto-free" || generationMode === "auto-quality") {
    const order = getAutoOrder(generationMode, prompt);
    if (order.length === 0) {
      return fail(
        "NO_PROVIDER",
        `No ${generationMode === "auto-free" ? "free" : "quality"} providers are configured`,
        false,
      );
    }
    providerId = order[0];
  } else {
    providerId = input.providerId ?? "pollinations";
  }

  const provider = getProvider(providerId);
  if (!provider) {
    return fail("UNKNOWN_PROVIDER", "Unknown media provider", false, providerId);
  }
  if (!provider.supportedFormats.includes(format)) {
    return fail(
      "FORMAT_NOT_SUPPORTED",
      `${provider.label} does not support ${format}`,
      false,
      providerId,
    );
  }

  // ── 2. Server-authoritative cost ────────────────────────────────
  const legacyCost = provider.cost(format);
  const costResult = calculateRetailBits({
    modality: "image",
    provider: providerId,
    model: GEMINI_IMAGE_MODEL,
  });
  const cost = provider.free ? 0 : Math.max(legacyCost, costResult.retailLiTTBits);

  // ── 3. Idempotency: claim the operation BEFORE the provider call ─
  // A completed claim replays (no generation, no debit). A fresh in-flight
  // claim collapses duplicates. A failed/stale claim is reused for a
  // controlled retry — the debit stays idempotent on the requestId, so a
  // retry can never double-charge.
  const internalUserId = await deps.resolveInternalUserId(userId);
  let job: GenerationJob | null = null;
  if (internalUserId) {
    const existing = await deps.getJobByRequestId(internalUserId, requestId);
    if (existing) {
      if (existing.status === "completed") {
        console.info(
          `[image-service] REPLAY provider=${existing.provider} requestId=${requestId}`,
        );
        return replayCompletedJob(existing, requestId, startTime);
      }
      if (
        isInFlight(existing.status) &&
        Date.parse(existing.createdAt) > Date.now() - DUPLICATE_WINDOW_MS
      ) {
        console.info(
          `[image-service] DUPLICATE_IN_FLIGHT requestId=${requestId} jobId=${existing.id}`,
        );
        return fail(
          "DUPLICATE_IN_FLIGHT",
          "A generation for this operation is already in progress",
          true,
          existing.provider as MediaProviderId,
        );
      }
      // Failed, cancelled, or stale — reuse the row for a controlled retry.
      await deps.setJobStatus(existing.id, "processing");
      job = { ...existing, status: "processing" as GenerationStatus };
    } else {
      const created = await deps.createJob({
        id: crypto.randomUUID(),
        userId: internalUserId,
        modality: "image",
        provider: providerId,
        model: GEMINI_IMAGE_MODEL,
        prompt,
        requestId,
        littBitsCharged: cost,
        metadata: {
          operation: "image-service",
          projectId: ctx.projectId ?? null,
          conversationId: ctx.conversationId ?? null,
        },
      });
      if (created) {
        await deps.setJobStatus(created.id, "processing");
        job = { ...created, status: "processing" as GenerationStatus };
      } else {
        // createJob returns the conflicting row on unique violation (a
        // concurrent claim won the race) — re-read and apply the rules.
        // A null without a row means the DB is unavailable: proceed without
        // a job row (no replay protection, but the debit stays idempotent).
        const raced = await deps.getJobByRequestId(internalUserId, requestId);
        if (raced) {
          if (raced.status === "completed") {
            return replayCompletedJob(raced, requestId, startTime);
          }
          if (isInFlight(raced.status)) {
            return fail(
              "DUPLICATE_IN_FLIGHT",
              "A generation for this operation is already in progress",
              true,
              raced.provider as MediaProviderId,
            );
          }
          await deps.setJobStatus(raced.id, "processing");
          job = { ...raced, status: "processing" as GenerationStatus };
        }
      }
    }
  }

  const failJob = async (error: string): Promise<void> => {
    if (job) {
      await deps
        .setJobStatus(job.id, "failed", { error: error.slice(0, 1000) })
        .catch(() => undefined);
    }
  };

  // ── 4. Wallet pre-check (canonical credit ledger) ──────────────
  if (cost > 0) {
    let balances: { total: number };
    try {
      balances = await deps.getBalances(userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Wallet lookup failed";
      await failJob(msg);
      return fail("WALLET_ERROR", msg, false, providerId);
    }
    if (balances.total < cost) {
      const msg = `Insufficient LiTTBits. Need ${cost}, have ${balances.total}`;
      await failJob(msg);
      return fail("INSUFFICIENT_FUNDS", msg, false, providerId);
    }
  }

  // ── 5. Provider dispatch (with auto-router fallthrough) ────────
  let result: MediaResult | null = null;
  let usedProviderId: MediaProviderId = providerId;
  let lastError: Error | null = null;

  if (generationMode === "auto-free" || generationMode === "auto-quality") {
    const order = getAutoOrder(generationMode, prompt);
    for (const candidateId of order) {
      if (!getProvider(candidateId)) continue;
      try {
        result = await deps.dispatch(candidateId, input, prompt);
        usedProviderId = candidateId;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error("Provider error");
      }
    }
  } else {
    try {
      result = await deps.dispatch(providerId, input, prompt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Provider error");
    }
  }

  if (!result) {
    const rawMsg = lastError?.message || "Generation failed";
    const isQuota = rawMsg.includes("429") || rawMsg.toLowerCase().includes("quota");
    const errorMsg = isQuota
      ? `${usedProviderId} quota exceeded. Try "Auto Best (Free)" mode which uses Pollinations — no API key needed.`
      : rawMsg;
    await failJob(errorMsg);
    const duration = Date.now() - startTime;
    console.info(
      `[image-service] FAIL provider=${usedProviderId} requestId=${requestId} duration=${duration}ms`,
    );
    return fail(
      isQuota ? "QUOTA_EXCEEDED" : "PROVIDER_ERROR",
      errorMsg,
      !isQuota,
      usedProviderId,
    );
  }

  // ── 6. Persist to durable storage ──────────────────────────────
  let durableUrl = result.downloadUrl;
  if (
    usedProviderId === "gemini" ||
    usedProviderId === "alibaba" ||
    usedProviderId === "fal" ||
    usedProviderId === "openai" ||
    usedProviderId === "recraft"
  ) {
    durableUrl = await deps.persistImage(userId, result.downloadUrl, usedProviderId, prompt);
  }

  // ── 7. Debit — ONLY after provider success, idempotent on requestId ──
  const usedProvider = getProvider(usedProviderId)!;
  const usedCostResult = calculateRetailBits({
    modality: "image",
    provider: usedProviderId,
    model: GEMINI_IMAGE_MODEL,
  });
  const usedCost = usedProvider.free
    ? 0
    : Math.max(usedProvider.cost(format), usedCostResult.retailLiTTBits);
  let newBalance: number | null = null;

  if (!usedProvider.free && usedCost > 0) {
    const exempt = await deps.isBillingExempt(userId).catch(() => false);
    if (exempt) {
      try {
        newBalance = (await deps.getBalances(userId)).total;
      } catch {
        newBalance = null;
      }
    } else {
      try {
        const charge = await deps.debit(
          userId,
          usedCost,
          `Image generation: ${usedProviderId} — ${prompt.slice(0, 60)}`,
          `image:charge:${requestId}`,
        );
        newBalance = charge.balance;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Wallet debit failed";
        await failJob(msg);
        return fail("WALLET_ERROR", msg, false, usedProviderId);
      }
    }
  } else {
    try {
      newBalance = (await deps.getBalances(userId)).total;
    } catch {
      newBalance = null;
    }
  }

  // ── 8. Complete the job row ────────────────────────────────────
  // If persistence fails the generation still succeeded — but we must NOT
  // fabricate an assetId. The response distinguishes the two outcomes.
  let generationJobId: string | null = null;
  let assetPersistenceFailed = false;
  if (job) {
    try {
      await deps.updateJobMetadata(job.id, {
        durableUrl,
        durationMs: Date.now() - startTime,
        chargedBits: usedCost,
      });
      await deps.setJobStatus(job.id, "completed", {
        assetId: `generation_job:${job.id}`,
        actualProviderCostCents: usedCostResult.providerCostCents,
      });
      generationJobId = job.id;
    } catch (persistErr) {
      console.error(
        `[image-service] Asset persistence failed for requestId=${requestId}:`,
        persistErr instanceof Error ? persistErr.message : persistErr,
      );
      assetPersistenceFailed = true;
    }
  } else {
    assetPersistenceFailed = true;
  }

  const duration = Date.now() - startTime;
  console.info(
    `[image-service] OK provider=${usedProviderId} requestId=${requestId} duration=${duration}ms`,
  );

  return {
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
    assetPersistenceFailed,
    durationMs: duration,
  };
}
