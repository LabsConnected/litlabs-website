import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserWallet, updateWalletBalance } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { MEDIA_PROVIDERS, MediaFormat, MediaProviderId, getProvider, defaultProviderFor } from "@/lib/media";

const HF_API_KEY = process.env.HUGGING_FACE_API_KEY;
const HF_VIDEO_URL = "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7";
const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";
const FAL_API_KEY = process.env.FAL_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RECRAFT_API_KEY = process.env.RECRAFT_API_KEY;

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */
function arrayBufferToBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

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
  /** Optional reference image URL (for image2video / style transfer flows). */
  referenceUrl?: string;
};

type MediaResult = {
  downloadUrl: string;
  thumbUrl?: string;
  id: string;
  status: number | string;
  title: string;
  format: MediaFormat;
};

/* ------------------------------------------------------------------ */
/*  Provider implementations                                            */
/* ------------------------------------------------------------------ */
function resolveGeminiAspect(width: number, height: number, explicitRatio?: string): string {
  const VALID = ["1:1", "3:4", "4:3", "9:16", "16:9"];
  if (explicitRatio && VALID.includes(explicitRatio)) return explicitRatio;
  // Infer from dimensions
  const r = width / height;
  if (r > 1.7) return "16:9";
  if (r > 1.2) return "4:3";
  if (r < 0.6) return "9:16";
  if (r < 0.85) return "3:4";
  return "1:1";
}

async function handleGeminiImage(
  prompt: string,
  _width: number,
  _height: number,
  aspectRatio?: string,
  _imageSize: "1K" | "2K" | "4K" = "1K",
): Promise<MediaResult> {
  if (!GEMINI_API_KEY) throw new Error("Gemini key missing — set GEMINI_API_KEY");

  const finalAspect = resolveGeminiAspect(_width, _height, aspectRatio);

  // Use stable Imagen 3 predict API - correct model name
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "litlabs-studio" },
      body: JSON.stringify({
        instances: [{ prompt: prompt.trim() }],
        parameters: { sampleCount: 1, aspectRatio: finalAspect },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    // Try fallback to older model if 404
    if (res.status === 404) {
      throw new Error(`Gemini Imagen 3 model not found. Please check your API key or try Pollinations/Together.ai instead.`);
    }
    throw new Error(`Gemini Imagen 3 error: ${err.slice(0, 300) || res.statusText}`);
  }

  const data = await res.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error("Gemini Imagen 3 returned no image data");

  return {
    downloadUrl: `data:image/png;base64,${b64}`,
    id: `gemini_${Date.now()}`,
    status: "complete",
    title: prompt.slice(0, 60),
    format: "image",
  };
}

async function handleFalImage(
  prompt: string,
  width: number,
  height: number,
): Promise<MediaResult> {
  if (!FAL_API_KEY) throw new Error("FAL.ai key missing — set FAL_KEY");

  // Submit to FAL queue
  const submitRes = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${FAL_API_KEY}`,
    },
    body: JSON.stringify({
      prompt: prompt.trim(),
      image_size: { width: Math.min(width, 1440), height: Math.min(height, 1440) },
      num_images: 1,
      enable_safety_checker: true,
    }),
  });

  if (!submitRes.ok) {
    const err = await submitRes.text().catch(() => "");
    throw new Error(`FAL.ai submit error: ${err.slice(0, 200) || submitRes.statusText}`);
  }

  const submitData = await submitRes.json();

  // If synchronous response with images
  if (submitData.images?.[0]?.url) {
    return {
      downloadUrl: submitData.images[0].url,
      id: `fal_${Date.now()}`,
      status: "complete",
      title: prompt.slice(0, 60),
      format: "image",
    };
  }

  // If queued, poll the status URL
  const requestId = submitData.request_id;
  const statusUrl = `https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}/status`;
  const resultUrl = `https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}`;

  const start = Date.now();
  while (Date.now() - start < 60_000) {
    await new Promise(r => setTimeout(r, 2000));
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

async function handleHuggingFaceVideo(prompt: string, referenceUrl?: string): Promise<MediaResult> {
  if (!HF_API_KEY) throw new Error("Hugging Face key missing — set HUGGING_FACE_API_KEY");

  // If a reference image is provided, use image-to-video pipeline (img2vid)
  const modelUrl = referenceUrl
    ? "https://api-inference.huggingface.co/models/stabilityai/stable-video-diffusion-img2vid"
    : HF_VIDEO_URL;

  const body: Record<string, unknown> = referenceUrl
    ? { inputs: referenceUrl, options: { wait_for_model: true, use_cache: false } }
    : { inputs: prompt.trim(), options: { wait_for_model: true, use_cache: false } };

  const res = await fetch(modelUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${HF_API_KEY}` },
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
    enhance: "false",  // enhance adds latency — skip it
    model: "flux",
  });
  if (negativePrompt.trim()) params.set("negative", negativePrompt.trim());
  const url = `${POLLINATIONS_BASE}/${encodeURIComponent(prompt.trim())}?${params}`;

  // Try to fetch + convert to base64 so client doesn't need to hit Pollinations
  // Use 25s timeout; on timeout fall back to direct URL (browser loads it lazily)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
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
    // Non-OK — fall through to direct URL
  } catch {
    clearTimeout(timer);
    // Timeout or network error — fall back to direct URL
  }

  // Fallback: return the direct URL, browser loads it
  return {
    downloadUrl: url,
    id: `pollinations_${Date.now()}`,
    status: "complete",
    title: prompt.slice(0, 60),
    format: "image",
  };
}

async function handleTogetherImage(prompt: string, width: number, height: number): Promise<MediaResult> {
  if (!TOGETHER_API_KEY) throw new Error("Together.ai key missing — set TOGETHER_API_KEY");

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

async function handleOpenAIImage(prompt: string, _width: number, _height: number): Promise<MediaResult> {
  if (!OPENAI_API_KEY) throw new Error("OpenAI key missing — set OPENAI_API_KEY");

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

async function handleRecraftImage(prompt: string, _width: number, _height: number): Promise<MediaResult> {
  if (!RECRAFT_API_KEY) throw new Error("Recraft key missing — set RECRAFT_API_KEY");

  const res = await fetch("https://external.api.recraft.ai/v1/images/generations", {
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
  });

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

/* ------------------------------------------------------------------ */
/*  Main handler                                                        */
/* ------------------------------------------------------------------ */
async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized — sign in to generate media" }, { status: 401 });
  }

  let body: MediaRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body — send JSON" }, { status: 400 });
  }
  const prompt = body.prompt?.trim();
  if (!prompt || prompt.length < 3) {
    return NextResponse.json({ error: "Prompt must be at least 3 characters" }, { status: 400 });
  }

  // Resolve provider + format with smart defaults
  const format: MediaFormat = body.format ?? (body.providerId === "huggingface" ? "video" : "image");
  const providerId: MediaProviderId = body.providerId ?? defaultProviderFor(format);
  const provider = getProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: "Unknown media provider" }, { status: 400 });
  }
  if (!provider.supportedFormats.includes(format)) {
    return NextResponse.json(
      { error: `${provider.label} does not support ${format}` },
      { status: 400 }
    );
  }

  // Compute cost (free for pollinations, paid for others)
  const cost = provider.cost(format);

  // Check wallet and deduct up-front (free providers skip)
  let wallet = null;
  if (!provider.free) {
    wallet = await getUserWallet(userId);
    if (wallet.balance < cost) {
      return NextResponse.json(
        { error: `Insufficient LiTBit Coins. Need ${cost}, have ${wallet.balance}` },
        { status: 402 }
      );
    }
  }

  // Dispatch
  let result: MediaResult;
  try {
    if (providerId === "gemini") {
      result = await handleGeminiImage(
        prompt, body.width ?? 1024, body.height ?? 1024, body.aspectRatio, body.imageSize ?? "1K"
      );
    } else if (providerId === "fal") {
      result = await handleFalImage(prompt, body.width ?? 1024, body.height ?? 1024);
    } else if (providerId === "huggingface") {
      result = await handleHuggingFaceVideo(prompt, body.referenceUrl);
    } else if (providerId === "pollinations") {
      result = await handlePollinationsImage(
        prompt,
        body.negativePrompt ?? "",
        body.seed ?? 0,
        body.width ?? 1024,
        body.height ?? 1024,
      );
    } else if (providerId === "together") {
      result = await handleTogetherImage(prompt, body.width ?? 1024, body.height ?? 1024);
    } else if (providerId === "openai") {
      result = await handleOpenAIImage(prompt, body.width ?? 1024, body.height ?? 1024);
    } else if (providerId === "recraft") {
      result = await handleRecraftImage(prompt, body.width ?? 1024, body.height ?? 1024);
    } else {
      return NextResponse.json(
        { error: `${provider.label} is not yet wired. Add the provider handler in /api/media/generate/route.ts` },
        { status: 501 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Provider error" },
      { status: 502 }
    );
  }

  // Deduct coins (skip for free providers)
  let newBalance: number | null = null;
  if (!provider.free && cost > 0 && wallet) {
    const updated = await updateWalletBalance(userId, -cost);
    newBalance = updated.balance;
  } else {
    const currentWallet = await getUserWallet(userId);
    newBalance = currentWallet?.balance ?? null;
  }

  return NextResponse.json({
    success: true,
    providerId,
    format,
    downloadUrl: result.downloadUrl,
    thumbUrl: result.thumbUrl,
    title: result.title,
    id: result.id,
    cost,
    free: provider.free,
    balance: newBalance,
  });
}

export const POST = withRateLimit(handler, 60, 60); // generous for free + paid

// GET = list providers (handy for /flow UI and agents)
export async function GET() {
  return NextResponse.json({
    providers: MEDIA_PROVIDERS,
    defaults: {
      image: defaultProviderFor("image"),
      video: defaultProviderFor("video"),
    },
  });
}
