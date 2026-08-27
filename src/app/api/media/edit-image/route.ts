import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { withRateLimit } from "@/lib/rate-limiter";
import { isBillingExempt, getActiveSimulation } from "@/lib/owner";
import { GoogleGenAI, Modality } from "@google/genai";
import { uploadBinaryAsset } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createGenerationJob,
  completeGenerationJob,
} from "@/lib/generation/jobs";
import { resolveInternalUserId } from "@/lib/generation/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const COST = 2;

/**
 * POST /api/media/edit-image
 *
 * Edits an existing image asset using Gemini's reference-image editing
 * capability. The source image is downloaded, converted to inline data,
 * and sent to Gemini alongside the edit prompt. The result is persisted
 * as a new asset (variant) — the original is never modified.
 *
 * Body: {
 *   imageUrl: string,    // HTTPS URL of the source image (from Asset Lake)
 *   prompt: string,      // edit instructions (e.g. "make the sky purple")
 *   parentAssetId?: string, // optional: the source asset ID for provenance
 * }
 *
 * Returns: { downloadUrl, durableUrl, cost, balance, generationJobId, assetId }
 */
async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
    return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });

  const balances = await getCreditBalances(userId);
  if (balances.total < COST) {
    return NextResponse.json({ error: `Need ${COST} LiTTBits` }, { status: 402 });
  }

  try {
    const { imageUrl, prompt, parentAssetId } = await req.json();
    if (!imageUrl?.startsWith("https://"))
      return NextResponse.json({ error: "imageUrl must be a public HTTPS URL" }, { status: 400 });
    if (!prompt?.trim())
      return NextResponse.json({ error: "Edit prompt required" }, { status: 400 });

    // 1. Download the source image
    const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!imgResp.ok)
      return NextResponse.json({ error: `Failed to download source image: HTTP ${imgResp.status}` }, { status: 502 });

    const contentType = imgResp.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/"))
      return NextResponse.json({ error: "Source URL is not an image" }, { status: 400 });

    const arrayBuf = await imgResp.arrayBuffer();
    const sourceBase64 = Buffer.from(arrayBuf).toString("base64");

    // 2. Call Gemini with the source image + edit prompt
    const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { inlineData: { mimeType: contentType, data: sourceBase64 } },
      { text: prompt.trim() },
    ];

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        responseModalities: [Modality.IMAGE],
      } as Record<string, unknown>,
    });

    const responseParts = response.candidates?.[0]?.content?.parts ?? [];
    const generated = responseParts.find((part) => {
      const inlineData = (part as { inlineData?: { data?: string } }).inlineData;
      return inlineData?.data;
    });

    const inlineData = (generated as { inlineData?: { data?: string; mimeType?: string } })?.inlineData;
    if (!inlineData?.data) throw new Error("Gemini completed without returning image data");

    const resultMimeType = inlineData.mimeType ?? "image/png";
    const resultBase64 = inlineData.data;
    const resultBuffer = Buffer.from(resultBase64, "base64");

    // 3. Billing
    const sim = await getActiveSimulation().catch(() => null);
    const exempt = isBillingExempt(userId, sim);
    let balance: number | null = null;
    if (exempt) {
      try { balance = (await getCreditBalances(userId)).total; } catch { balance = null; }
    } else {
      const reservation = await adjustWalletBalance({
        clerkId: userId,
        amount: -COST,
        type: "spend",
        reason: `image-edit: ${prompt.slice(0, 60)}`,
        idempotencyKey: `imgedit_${userId}_${Date.now()}`,
      });
      balance = reservation.balance;
    }

    // 4. Persist the edited image to durable storage
    const ext = resultMimeType.split("/")[1]?.split("+")[0] || "png";
    const safePrompt = prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "-");
    const filename = `edit-${safePrompt}.${ext}`;
    let durableUrl: string | null = null;
    let persisted = false;

    if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) {
      try {
        const result = await uploadBinaryAsset(userId, filename, resultBuffer, resultMimeType, "image");
        durableUrl = result.publicUrl;
        persisted = true;
      } catch { /* fall through to Supabase */ }
    }

    if (!persisted && supabaseAdmin) {
      try {
        const filePath = `${userId}/${Date.now()}_${filename}`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from("studio-images")
          .upload(filePath, resultBuffer, { contentType: resultMimeType, upsert: false });
        if (!uploadError) {
          const { data: urlData } = supabaseAdmin.storage
            .from("studio-images")
            .getPublicUrl(filePath);
          if (urlData?.publicUrl) { durableUrl = urlData.publicUrl; persisted = true; }
        }
      } catch { /* fall through */ }
    }

    // 5. Register in generation_jobs for Asset Lake visibility
    let generationJobId: string | null = null;
    let assetId: string | null = null;
    let assetPersistenceFailed = false;
    const internalUserId = await resolveInternalUserId(userId);
    if (internalUserId && persisted && durableUrl) {
      try {
        const jobId = crypto.randomUUID();
        await createGenerationJob({
          id: jobId,
          userId: internalUserId,
          modality: "image",
          provider: "gemini",
          model,
          prompt: prompt.trim(),
          requestId: `imgedit_${userId}_${Date.now()}`,
          littBitsCharged: exempt ? 0 : COST,
          metadata: {
            durableUrl,
            contentType: resultMimeType,
            edited: true,
            parentAssetId: parentAssetId || undefined,
            sourceImageUrl: imageUrl,
          },
        });
        await completeGenerationJob(jobId, `generation_job:${jobId}`);
        generationJobId = jobId;
        assetId = `generation_job:${jobId}`;
      } catch {
        assetPersistenceFailed = true;
      }
    } else if (!persisted) {
      assetPersistenceFailed = true;
    }

    return NextResponse.json({
      success: true,
      downloadUrl: `data:${resultMimeType};base64,${resultBase64}`,
      durableUrl: durableUrl ?? `data:${resultMimeType};base64,${resultBase64}`,
      cost: COST,
      balance,
      generationJobId,
      assetId,
      assetPersistenceFailed,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Image edit failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
