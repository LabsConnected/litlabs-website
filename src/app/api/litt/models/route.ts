import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  CHAT_MODELS,
  LITT_MODEL_ALIASES,
  LITT_MEDIA_ALIASES,
} from "@/lib/studio-models";

/**
 * GET /api/litt/models
 *
 * Returns the LiTT model catalog — stable LiTT aliases first, then
 * underlying provider models. The model picker uses this to populate
 * the menu. UI code references LiTT aliases, never raw provider IDs.
 *
 * When LiteLLM is installed, this route will proxy to LiteLLM's
 * /v1/models endpoint and merge the results with LiTT aliases.
 */
export async function GET(request: Request) {
  const { userId } = await auth(request as never);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Format LiTT aliases for the picker
  const littAliases = LITT_MODEL_ALIASES.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    cost: m.cost,
    speed: m.speed,
    icon: m.icon,
    recommended: m.recommended ?? false,
    isLittAlias: true,
    description: m.description,
    category: m.category,
  }));

  // Format underlying provider models (excluding aliases to avoid duplicates)
  const providerModels = CHAT_MODELS.filter((m) => !m.isLittAlias).map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    cost: m.cost,
    speed: m.speed,
    icon: m.icon,
    recommended: m.recommended ?? false,
    isLittAlias: false,
    category: m.category,
  }));

  // Media aliases (image, video, audio, music)
  const mediaAliases = LITT_MEDIA_ALIASES.map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    description: m.description,
    aliasFor: m.aliasFor,
  }));

  return NextResponse.json({
    aliases: littAliases,
    models: providerModels,
    media: mediaAliases,
    defaultModel: "litt-balanced",
    autoBest: "auto",
  });
}
