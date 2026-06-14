import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserWallet, updateWalletBalance } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  MEDIA_PROVIDERS,
  MediaFormat,
  MediaProviderId,
  getProvider,
  defaultProviderFor,
} from "@/lib/media";

/* ------------------------------------------------------------------ */
/*  Storyboard types — shared with the /flow UI                        */
/* ------------------------------------------------------------------ */
export type FlowCell = {
  id: string;            // local UI id
  label: string;         // "Scene 1: establishing shot"
  format: MediaFormat;
  providerId: MediaProviderId;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  referenceUrl?: string; // optional ingredient / reference image
};

export type FlowCellResult = {
  cellId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  downloadUrl?: string;
  thumbUrl?: string;
  providerId: MediaProviderId;
  format: MediaFormat;
  cost: number;
  error?: string;
  durationMs?: number;
  startedAt?: number;
  finishedAt?: number;
};

type FlowPostBody = {
  userId?: string;
  name?: string;
  cells?: FlowCell[];
};

export type FlowRun = {
  id: string;
  userId: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "partial";
  cells: FlowCell[];
  results: FlowCellResult[];
  totalCost: number;
  createdAt: number;
  finishedAt?: number;
};

/* ------------------------------------------------------------------ */
/*  Cost calculator                                                    */
/* ------------------------------------------------------------------ */
function computeCellCost(cell: FlowCell): number {
  const provider = getProvider(cell.providerId);
  if (!provider) return 0;
  return provider.cost(cell.format);
}

function computeTotalCost(cells: FlowCell[]): number {
  return cells.reduce((sum, c) => sum + computeCellCost(c), 0);
}

/* ------------------------------------------------------------------ */
/*  Call a single cell by delegating to /api/media/generate's logic    */
/*  (re-implemented here so we don't fight Next route re-entry)         */
/* ------------------------------------------------------------------ */
const HF_API_KEY = process.env.HUGGING_FACE_API_KEY;
const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";
const FAL_API_KEY = process.env.FAL_KEY;
const FLOW_SERVICE_TOKEN = process.env.FLOW_SERVICE_TOKEN;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

async function dispatchCell(
  cell: FlowCell,
  referenceUrl?: string,
): Promise<{ downloadUrl: string; thumbUrl?: string; providerId: MediaProviderId; format: MediaFormat }> {
  if (cell.providerId === "pollinations") {
    const params = new URLSearchParams({
      width: String(cell.width ?? 1024),
      height: String(cell.height ?? 1024),
      seed: String(cell.seed ?? Math.floor(Math.random() * 1000000)),
      nologo: "true",
      enhance: "true",
    });
    if (cell.negativePrompt?.trim()) params.set("negative", cell.negativePrompt.trim());
    const url = `${POLLINATIONS_BASE}/${encodeURIComponent(cell.prompt.trim())}?${params}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Pollinations: ${(await res.text()).slice(0, 200)}`);
    const ct = res.headers.get("content-type") || "image/jpeg";
    const buf = await res.arrayBuffer();
    return {
      downloadUrl: `data:${ct};base64,${arrayBufferToBase64(buf)}`,
      providerId: "pollinations",
      format: "image",
    };
  }

  if (cell.providerId === "fal") {
    if (!FAL_API_KEY) throw new Error("FAL_KEY not configured");
    const submitRes = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${FAL_API_KEY}` },
      body: JSON.stringify({
        prompt: cell.prompt.trim(),
        image_size: { width: Math.min(cell.width ?? 1024, 1440), height: Math.min(cell.height ?? 1024, 1440) },
        num_images: 1,
        enable_safety_checker: true,
      }),
    });
    if (!submitRes.ok) throw new Error(`FAL.ai: ${(await submitRes.text()).slice(0, 200)}`);
    const submitData = await submitRes.json();
    if (submitData.images?.[0]?.url) {
      return { downloadUrl: submitData.images[0].url, providerId: "fal", format: "image" };
    }
    const requestId = submitData.request_id;
    const start = Date.now();
    while (Date.now() - start < 60_000) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}/status`, {
        headers: { Authorization: `Key ${FAL_API_KEY}` },
      });
      const pollData = await pollRes.json();
      if (pollData.status === "COMPLETED") {
        const resultRes = await fetch(`https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}`, {
          headers: { Authorization: `Key ${FAL_API_KEY}` },
        });
        const resultData = await resultRes.json();
        const imgUrl = resultData.images?.[0]?.url;
        if (!imgUrl) throw new Error("FAL.ai returned no image URL");
        return { downloadUrl: imgUrl, providerId: "fal", format: "image" };
      }
      if (pollData.status === "FAILED") throw new Error("FAL.ai generation failed");
    }
    throw new Error("FAL.ai timed out");
  }

  if (cell.providerId === "huggingface") {
    if (!HF_API_KEY) throw new Error("HUGGING_FACE_API_KEY not configured");
    const modelUrl = referenceUrl
      ? "https://api-inference.huggingface.co/models/stabilityai/stable-video-diffusion-img2vid"
      : "https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7";
    const body: Record<string, unknown> = referenceUrl
      ? { inputs: referenceUrl, options: { wait_for_model: true, use_cache: false } }
      : { inputs: cell.prompt.trim(), options: { wait_for_model: true, use_cache: false } };
    const res = await fetch(modelUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${HF_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HuggingFace: ${(await res.text()).slice(0, 200)}`);
    const buf = await res.arrayBuffer();
    return {
      downloadUrl: `data:video/mp4;base64,${arrayBufferToBase64(buf)}`,
      providerId: "huggingface",
      format: "video",
    };
  }

  throw new Error(`Provider ${cell.providerId} is not yet implemented in /api/flow`);
}

/* ------------------------------------------------------------------ */
/*  Run a storyboard sequentially                                      */
/* ------------------------------------------------------------------ */
async function runFlow(
  userId: string,
  name: string,
  cells: FlowCell[],
): Promise<FlowRun> {
  const startedAt = Date.now();
  const totalCost = computeTotalCost(cells);
  const results: FlowCellResult[] = cells.map(c => ({
    cellId: c.id,
    status: "pending",
    providerId: c.providerId,
    format: c.format,
    cost: computeCellCost(c),
  }));

  // Check + deduct wallet up-front (free cells = 0 cost, no debit)
  if (totalCost > 0) {
    const wallet = await getUserWallet(userId);
    if (wallet.balance < totalCost) {
      throw new Error(`Insufficient LiTBit Coins. Need ${totalCost}, have ${wallet.balance}`);
    }
    await updateWalletBalance(userId, -totalCost);
  }

  // Sequential execution. Image/video chaining: each cell's output becomes
  // the next cell's `referenceUrl` if the next cell's format is video.
  let lastOutputUrl: string | undefined;
  let hadFailure = false;
  let firstFailureError: string | undefined;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const result = results[i];
    result.startedAt = Date.now();
    result.status = "running";

    // Smart chain: per-cell reference override first, else use prior output for videos
    const referenceUrl =
      cell.referenceUrl ?? (cell.format === "video" && lastOutputUrl ? lastOutputUrl : undefined);

    try {
      const t0 = Date.now();
      const out = await dispatchCell(cell, referenceUrl);
      result.downloadUrl = out.downloadUrl;
      result.thumbUrl = out.thumbUrl;
      result.status = "succeeded";
      result.durationMs = Date.now() - t0;
      lastOutputUrl = out.downloadUrl;
    } catch (err) {
      result.status = "failed";
      result.error = err instanceof Error ? err.message : "Unknown error";
      hadFailure = true;
      if (!firstFailureError) firstFailureError = result.error;
      // Continue with remaining cells (partial flow); chain breaks here
      lastOutputUrl = undefined;
    } finally {
      result.finishedAt = Date.now();
    }
  }

  const runStatus: FlowRun["status"] = hadFailure
    ? cells.every((_, i) => results[i].status === "failed")
      ? "failed"
      : "partial"
    : "completed";

  return {
    id: `flow_${startedAt}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    name: name || "Untitled Flow",
    status: runStatus,
    cells,
    results,
    totalCost,
    createdAt: startedAt,
    finishedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/*  Handlers                                                           */
/* ------------------------------------------------------------------ */
async function postHandler(req: NextRequest) {
  const body = await req.json().catch(() => null) as FlowPostBody | null;
  const headers = req.headers;
  const serviceToken = headers.get("x-flow-service-token");
  const isService = FLOW_SERVICE_TOKEN && serviceToken === FLOW_SERVICE_TOKEN;

  let userId: string | null = null;
  if (isService) {
    userId = body?.userId ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Service calls must include a userId" }, { status: 400 });
    }
  } else {
    const authResult = await auth();
    userId = authResult.userId ?? null;
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cells = body?.cells;
  if (!cells || !Array.isArray(cells) || cells.length === 0) {
    return NextResponse.json({ error: "Storyboard must have at least one cell" }, { status: 400 });
  }
  if (cells.length > 12) {
    return NextResponse.json({ error: "Storyboard capped at 12 cells" }, { status: 400 });
  }

  // Validate each cell
  for (const c of cells) {
    if (!c.prompt || c.prompt.trim().length < 3) {
      return NextResponse.json(
        { error: `Cell "${c.label || c.id}" needs a prompt (≥3 chars)` },
        { status: 400 }
      );
    }
    if (!getProvider(c.providerId)) {
      return NextResponse.json({ error: `Unknown provider: ${c.providerId}` }, { status: 400 });
    }
  }

  // Dry-run option: just return the cost, don't actually run
  if (req.nextUrl.searchParams.get("dryRun") === "1") {
    const totalCost = computeTotalCost(cells);
    const breakdown = cells.map(c => ({
      cellId: c.id,
      label: c.label,
      provider: c.providerId,
      format: c.format,
      cost: computeCellCost(c),
    }));
    return NextResponse.json({ dryRun: true, totalCost, breakdown });
  }

  try {
    const run = await runFlow(userId, body.name ?? "Untitled Flow", cells);
    return NextResponse.json({ success: true, run }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Flow run failed" },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(postHandler, 20, 60);
