// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { limitMock, generateContent, generateVideos, submitAlibaba } = vi.hoisted(() => {
  process.env.GEMINI_API_KEY = "test-key";
  return {
    limitMock: vi.fn(),
    generateContent: vi.fn(),
    generateVideos: vi.fn(),
    submitAlibaba: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user_cap" })),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: any) => handler,
}));

vi.mock("@/lib/owner", () => ({
  isBillingExempt: () => false,
  getActiveSimulation: vi.fn(async () => null),
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(async () => ({ total: 100_000 })),
  adjustWalletBalance: vi.fn(),
}));

vi.mock("@/lib/generation/identity", () => ({
  resolveInternalUserId: vi.fn(async () => null),
}));

vi.mock("@/lib/generation/enforce-media-caps", async () => {
  const actual = await vi.importActual<typeof import("@/lib/generation/enforce-media-caps")>(
    "@/lib/generation/enforce-media-caps",
  );
  return { ...actual, assertGenerationWithinPlanCaps: limitMock };
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent, generateVideos },
  })),
  Modality: { AUDIO: "AUDIO" },
  GenerateVideosOperation: vi.fn(),
}));

vi.mock("@/lib/alibaba-video", () => ({
  isAlibabaConfigured: () => true,
  submitAlibabaVideoTask: submitAlibaba,
  pollAlibabaVideoTask: vi.fn(),
  downloadVideo: vi.fn(),
}));

import { POST as generateVideo } from "@/app/api/media/generate-video/route";
import { POST as generateMusic } from "@/app/api/media/generate-music/route";
import { POST as generateAudio } from "@/app/api/media/generate-audio/route";
import { adjustWalletBalance } from "@/lib/wallet-ledger";

function post(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  limitMock.mockReset();
  generateContent.mockReset();
  generateVideos.mockReset();
  submitAlibaba.mockReset();
  vi.mocked(adjustWalletBalance).mockClear();
});

describe("generation routes stop before the provider when the plan cap denies", () => {
  it("video returns 429 plan_limit and does not submit", async () => {
    limitMock.mockResolvedValue({
      status: 429,
      code: "plan_limit",
      reason: "monthly_video_cap",
      error: "Creator Beta allows 5 videos this month.",
    });
    const res = await generateVideo(
      post("https://www.litlabs.net/api/media/generate-video", {
        prompt: "a river at dusk",
        model: "veo",
        requestId: "vid-1",
      }),
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      code: "plan_limit",
      reason: "monthly_video_cap",
    });
    expect(generateVideos).not.toHaveBeenCalled();
    expect(submitAlibaba).not.toHaveBeenCalled();
    expect(adjustWalletBalance).not.toHaveBeenCalled();
  });

  it("music returns 402 plan_limit and does not call the model", async () => {
    limitMock.mockResolvedValue({
      status: 402,
      code: "plan_limit",
      reason: "provider_spend_cap",
      error: "provider spend cap",
    });
    const res = await generateMusic(
      post("https://www.litlabs.net/api/media/generate-music", {
        prompt: "a quiet piano loop",
        requestId: "music-1",
      }),
    );
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      code: "plan_limit",
      reason: "provider_spend_cap",
    });
    expect(generateContent).not.toHaveBeenCalled();
    expect(adjustWalletBalance).not.toHaveBeenCalled();
  });

  it("audio returns 429 plan_limit for the free-model daily cap and does not call the model", async () => {
    limitMock.mockResolvedValue({
      status: 429,
      code: "plan_limit",
      reason: "free_model_daily_cap",
      error: "daily cap",
    });
    const res = await generateAudio(
      post("https://www.litlabs.net/api/media/generate-audio", {
        prompt: "read this line",
        requestId: "audio-1",
      }),
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      code: "plan_limit",
      reason: "free_model_daily_cap",
    });
    expect(generateContent).not.toHaveBeenCalled();
    expect(adjustWalletBalance).not.toHaveBeenCalled();
  });
});
