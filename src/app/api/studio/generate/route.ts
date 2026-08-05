import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GoogleGenAI, Modality } from "@google/genai";
import { withRateLimit } from "@/lib/rate-limiter";

async function handler(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { prompt, provider, aspectRatio, batchSize = 1 } = body;

    // Validate prompt
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 },
      );
    }

    if (prompt.length < 3) {
      return NextResponse.json(
        { error: "Prompt must be at least 3 characters" },
        { status: 400 },
      );
    }

    // Calculate dimensions based on aspect ratio
    const getDimensions = (ratio: string) => {
      const [w, h] = ratio.split(":").map(Number);
      if (!w || !h) return { width: 1024, height: 1024 };
      // Scale to reasonable image size while maintaining aspect
      const scale = Math.min(1024 / w, 1024 / h);
      return {
        width: Math.round(w * scale),
        height: Math.round(h * scale),
      };
    };

    const { width, height } = getDimensions(aspectRatio || "1:1");

    // Pollinations.ai fallback (always works, no API key needed)
    if (provider === "pollinations" || !provider) {
      // Use a stable seed based on prompt hash to prevent infinite reloading
      const promptHash = prompt
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const baseSeed = promptHash % 1000000;

      const images = Array.from({ length: Math.min(batchSize, 4) }, (_, i) => ({
        url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&n=${batchSize}${batchSize > 1 ? `&index=${i}` : ""}&seed=${baseSeed + i}&noCache=true`,
        prompt,
        provider: "pollinations",
        timestamp: Date.now(),
      }));

      return NextResponse.json({
        images,
        provider: "pollinations",
        free: true,
      });
    }

    // For other providers, try to use their APIs if keys are available
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (provider === "gemini" && GEMINI_API_KEY) {
      try {
        // Migrated from deprecated Imagen 3 to Nano Banana (gemini-2.5-flash-image).
        // Imagen 3 shuts down August 17, 2026.
        const imageModel = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

        const response = await ai.models.generateContent({
          model: imageModel,
          contents: prompt.trim(),
          config: {
            responseModalities: [Modality.IMAGE],
          },
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const imagePart = parts.find((p) => p.inlineData?.data);
        if (imagePart?.inlineData?.data) {
          const mimeType = imagePart.inlineData.mimeType || "image/png";
          return NextResponse.json({
            images: [
              {
                url: `data:${mimeType};base64,${imagePart.inlineData.data}`,
                prompt,
                provider: "gemini",
                timestamp: Date.now(),
              },
            ],
            provider: "gemini",
            cost: 1,
          });
        }
      } catch {
        // Silenced
      }
    }

    // Default fallback to pollinations with stable seed
    const promptHash2 = prompt
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const stableSeed = promptHash2 % 1000000;

    return NextResponse.json({
      images: [
        {
          url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${stableSeed}`,
          prompt,
          provider: "pollinations",
          timestamp: Date.now(),
        },
      ],
      provider: "pollinations",
      free: true,
      note:
        provider !== "pollinations"
          ? "API key not configured, using free fallback"
          : undefined,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate image" },
      { status: 500 },
    );
  }
}

// Also handle GET for health check
async function getHandler() {
  return NextResponse.json({
    status: "ok",
    providers: [
      "pollinations",
      "gemini",
      "together",
      "fal",
      "openai",
      "recraft",
    ],
    default: "pollinations",
  });
}

export const POST = withRateLimit(handler, 10, 60);
export const GET = withRateLimit(getHandler, 30, 60);
