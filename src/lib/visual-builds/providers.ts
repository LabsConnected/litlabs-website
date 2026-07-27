import { AssetInspection, VisualSourceType } from "./types";

export interface StockSearchInput {
  projectId: string;
  missionId: string;
  query: string;
  sectionKey: string;
  maxResults: number;
}

export interface StockAssetResult {
  sourceType: "stock";
  provider: string;
  id: string;
  query: string;
  downloadUrl: string;
  originalUrl: string;
  attribution: string | null;
  license: string | null;
  width: number | null;
  height: number | null;
  sectionKey: string;
}

export interface ImageGenerationInput {
  projectId: string;
  missionId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  width: number;
  height: number;
  sectionKey: string;
}

export interface GeneratedAssetResult {
  sourceType: "generated";
  provider: string;
  id: string;
  prompt: string;
  downloadUrl: string;
  originalUrl: string | null;
  attribution: string | null;
  license: string | null;
  width: number | null;
  height: number | null;
  costCents: number;
  sectionKey: string;
}

export interface StockAssetProvider {
  search(input: StockSearchInput): Promise<StockAssetResult[]>;
}

export interface ImageGenerationProvider {
  generate(input: ImageGenerationInput): Promise<GeneratedAssetResult>;
}

export interface ProjectAssetSearchInput {
  projectId: string;
  missionId: string;
  query: string;
  sectionKey?: string;
  maxResults: number;
}

export interface ProjectAssetSearchResult {
  sourceType: VisualSourceType;
  provider: string;
  id: string;
  query: string;
  downloadUrl: string;
  originalUrl: string | null;
  attribution: string | null;
  license: string | null;
  width: number | null;
  height: number | null;
  sectionKey: string | null;
  inspection?: AssetInspection;
}

class NullStockAssetProvider implements StockAssetProvider {
  async search(): Promise<StockAssetResult[]> {
    return [];
  }
}

class PexelsStockAssetProvider implements StockAssetProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(input: StockSearchInput): Promise<StockAssetResult[]> {
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", input.query);
    url.searchParams.set("per_page", String(Math.min(Math.max(input.maxResults, 1), 10)));
    url.searchParams.set("orientation", input.sectionKey === "hero" ? "landscape" : "portrait");

    const response = await fetch(url, {
      headers: {
        Authorization: this.apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      photos?: Array<{
        id: number;
        url: string;
        width: number;
        height: number;
        alt: string;
        photographer: string;
        photographer_url: string;
        src: { original: string; large2x: string; large: string; portrait: string; landscape: string };
      }>;
    };

    return (payload.photos ?? []).map((photo) => ({
      sourceType: "stock" as const,
      provider: "pexels",
      id: String(photo.id),
      query: input.query,
      downloadUrl: photo.src.original || photo.src.large2x || photo.src.large,
      originalUrl: photo.url,
      attribution: `${photo.photographer} on Pexels`,
      license: "Pexels License",
      width: photo.width,
      height: photo.height,
      sectionKey: input.sectionKey,
    }));
  }
}

class PollinationsImageGenerationProvider implements ImageGenerationProvider {
  async generate(input: ImageGenerationInput): Promise<GeneratedAssetResult> {
    const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(input.prompt)}`);
    url.searchParams.set("width", String(Math.min(input.width, 1024)));
    url.searchParams.set("height", String(Math.min(input.height, 1024)));
    url.searchParams.set("nologo", "true");
    url.searchParams.set("enhance", "false");
    url.searchParams.set("model", "flux");
    if (input.negativePrompt?.trim()) {
      url.searchParams.set("negative", input.negativePrompt.trim());
    }

    return {
      sourceType: "generated",
      provider: "pollinations",
      id: `pollinations-${Date.now()}`,
      prompt: input.prompt,
      downloadUrl: url.toString(),
      originalUrl: url.toString(),
      attribution: null,
      license: null,
      width: input.width,
      height: input.height,
      costCents: 0,
      sectionKey: input.sectionKey,
    };
  }
}

class GeminiImageGenerationProvider implements ImageGenerationProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedAssetResult> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: input.prompt.trim() }],
          parameters: {
            sampleCount: 1,
            aspectRatio: input.aspectRatio,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini image generation failed: ${response.status}`);
    }

    const payload = (await response.json()) as { predictions?: Array<{ bytesBase64Encoded?: string }> };
    const image = payload.predictions?.[0]?.bytesBase64Encoded;
    if (!image) {
      throw new Error("Gemini returned no image data");
    }

    return {
      sourceType: "generated",
      provider: "gemini",
      id: `gemini-${Date.now()}`,
      prompt: input.prompt,
      downloadUrl: `data:image/png;base64,${image}`,
      originalUrl: null,
      attribution: null,
      license: null,
      width: input.width,
      height: input.height,
      costCents: 100,
      sectionKey: input.sectionKey,
    };
  }
}

class FalImageGenerationProvider implements ImageGenerationProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedAssetResult> {
    const response = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${this.apiKey}`,
      },
      body: JSON.stringify({
        prompt: input.prompt.trim(),
        image_size: {
          width: Math.min(input.width, 1440),
          height: Math.min(input.height, 1440),
        },
        num_images: 1,
        enable_safety_checker: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`FAL image generation failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      images?: Array<{ url?: string }>;
      request_id?: string;
      status?: string;
    };

    const directUrl = payload.images?.[0]?.url;
    if (directUrl) {
      return {
        sourceType: "generated",
        provider: "fal",
        id: `fal-${Date.now()}`,
        prompt: input.prompt,
        downloadUrl: directUrl,
        originalUrl: directUrl,
        attribution: null,
        license: null,
        width: input.width,
        height: input.height,
        costCents: 300,
        sectionKey: input.sectionKey,
      };
    }

    if (!payload.request_id) {
      throw new Error("FAL did not return an image URL or request id");
    }

    const requestId = payload.request_id;
    const statusUrl = `https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}/status`;
    const resultUrl = `https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}`;
    const start = Date.now();
    while (Date.now() - start < 60_000) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const statusResponse = await fetch(statusUrl, {
        headers: { Authorization: `Key ${this.apiKey}` },
      });
      const status = (await statusResponse.json()) as { status?: string };
      if (status.status === "COMPLETED") {
        const resultResponse = await fetch(resultUrl, {
          headers: { Authorization: `Key ${this.apiKey}` },
        });
        const result = (await resultResponse.json()) as { images?: Array<{ url?: string }> };
        const image = result.images?.[0]?.url;
        if (!image) {
          throw new Error("FAL returned no image URL");
        }
        return {
          sourceType: "generated",
          provider: "fal",
          id: `fal-${requestId}`,
          prompt: input.prompt,
          downloadUrl: image,
          originalUrl: image,
          attribution: null,
          license: null,
          width: input.width,
          height: input.height,
          costCents: 300,
          sectionKey: input.sectionKey,
        };
      }
      if (status.status === "FAILED") {
        throw new Error("FAL image generation failed");
      }
    }

    throw new Error("FAL image generation timed out");
  }
}

export function createStockAssetProvider(): StockAssetProvider {
  const apiKey = process.env.PEXELS_API_KEY ?? process.env.UNSPLASH_ACCESS_KEY ?? "";
  if (apiKey) {
    return new PexelsStockAssetProvider(apiKey);
  }
  return new NullStockAssetProvider();
}

export function createImageGenerationProvider(): ImageGenerationProvider {
  const falKey = process.env.FAL_KEY ?? "";
  if (falKey) {
    return new FalImageGenerationProvider(falKey);
  }

  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
  if (geminiKey) {
    return new GeminiImageGenerationProvider(geminiKey);
  }

  return new PollinationsImageGenerationProvider();
}

export function buildAssetQuery(prompt: string, sectionKey: string): string {
  const base = prompt.trim().split(/\s+/).slice(0, 10).join(" ");
  return `${base} ${sectionKey}`.trim();
}
