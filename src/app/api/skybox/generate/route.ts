import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserWallet, updateWalletBalance } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { getStylePreset, STYLE_PRESETS } from "@/lib/skybox";

const SKYBOX_API_KEY = process.env.SKYBOX_API_KEY;
const SKYBOX_API_URL = "https://backend.blockadelabs.com/api/v1/skybox";

async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!SKYBOX_API_KEY) {
    return NextResponse.json(
      { error: "SKYBOX_API_KEY not configured" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { prompt, negativePrompt = "", seed = 0, styleId } = body as {
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    styleId?: string;
  };

  if (!prompt || prompt.trim().length < 3) {
    return NextResponse.json(
      { error: "Prompt too short" },
      { status: 400 }
    );
  }

  const style = styleId ? getStylePreset(styleId) : undefined;
  if (!style) {
    return NextResponse.json(
      { error: "Invalid style selected", availableStyles: STYLE_PRESETS.map(s => s.id) },
      { status: 400 }
    );
  }

  const wallet = await getUserWallet(userId);
  if (!wallet) {
    return NextResponse.json(
      { error: "Wallet not initialized" },
      { status: 500 }
    );
  }

  if (wallet.balance < style.cost) {
    return NextResponse.json(
      { error: `Insufficient LiTBit Coins. Need ${style.cost}, have ${wallet.balance}.` },
      { status: 402 }
    );
  }

  const payload: Record<string, unknown> = {
    prompt: prompt.trim(),
    negative_text: negativePrompt.trim(),
    seed,
    style_id: style.id,
    webhook_url: "",
  };

  const res = await fetch(SKYBOX_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": SKYBOX_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok || data.error) {
    return NextResponse.json(
      { error: data.message || data.error || "Skybox API error" },
      { status: 502 }
    );
  }

  const updatedWallet = await updateWalletBalance(userId, wallet.balance - style.cost);

  return NextResponse.json({
    success: true,
    id: data.id,
    status: data.status,
    title: data.title,
    fileUrl: data.file_url,
    thumbUrl: data.thumb_url,
    balance: updatedWallet.balance,
    cost: style.cost,
    styleId: style.id,
  });
}

export const POST = withRateLimit(handler, 30, 60);
