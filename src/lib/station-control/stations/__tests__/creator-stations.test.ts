/**
 * Station Control Bridge — creator station adapter tests (chunk C).
 *
 * Providers/routes are mocked; the assertions verify the ADAPTER contracts:
 * - canvas actions route to the correct repository operations (the
 *   server-side equivalents of the /api/canvases/* HTTP methods)
 * - image.generate merges creator-state params and runs the asset pipeline
 * - video.generate surfaces not_configured honestly when keys are absent
 * - music.generate / audio.tts honest-failure paths
 * - omitted actions (image.upscale, music.remix, assets.delete, …) are NOT registered
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── Heavy/provider modules: mocked ─────────────────────────────── */
const mocks = vi.hoisted(() => ({
  toolExecute: vi.fn(),
  addBlocks: vi.fn(),
  updateBlock: vi.fn(),
  deleteBlock: vi.fn(),
  reorderBlock: vi.fn(),
  listBlocks: vi.fn(),
  getCanvas: vi.fn(),
  listCanvases: vi.fn(),
  generateImage: vi.fn(),
  insertAssetFromUrl: vi.fn(),
  isAlibabaConfigured: vi.fn(),
  submitAlibabaVideoTask: vi.fn(),
  pollAlibabaVideoTask: vi.fn(),
  downloadVideo: vi.fn(),
  getActiveProvider: vi.fn(),
  googleGenAI: vi.fn(),
  uploadBinaryAsset: vi.fn(),
  resolveInternalUserId: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/tool-registry", () => ({
  toolRegistry: {
    execute: mocks.toolExecute,
    register: vi.fn(),
  },
}));

vi.mock("@/lib/canvas/repository", () => ({
  addBlocks: mocks.addBlocks,
  updateBlock: mocks.updateBlock,
  deleteBlock: mocks.deleteBlock,
  reorderBlock: mocks.reorderBlock,
  listBlocks: mocks.listBlocks,
  getCanvas: mocks.getCanvas,
  listCanvases: mocks.listCanvases,
}));

vi.mock("@/lib/generation/image-service", () => ({
  generateImage: mocks.generateImage,
}));

vi.mock("@/lib/litt-intelligence/tool-handlers-v2", () => ({
  insertAssetFromUrl: mocks.insertAssetFromUrl,
}));

vi.mock("@/lib/alibaba-video", () => ({
  isAlibabaConfigured: mocks.isAlibabaConfigured,
  submitAlibabaVideoTask: mocks.submitAlibabaVideoTask,
  pollAlibabaVideoTask: mocks.pollAlibabaVideoTask,
  downloadVideo: mocks.downloadVideo,
}));

vi.mock("@/lib/music/providers/factory", () => ({
  getActiveProvider: mocks.getActiveProvider,
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: mocks.googleGenAI,
  Modality: { AUDIO: "AUDIO" },
}));

vi.mock("@/lib/r2", () => ({
  uploadBinaryAsset: mocks.uploadBinaryAsset,
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: null,
}));

vi.mock("@/lib/generation/identity", () => ({
  resolveInternalUserId: mocks.resolveInternalUserId,
}));

/* ── Station modules under test (side-effect: register actions) ─── */
import { getStationAction } from "../../registry";
import { DEFAULT_PERMISSIONS } from "../../permissions";
import type { StationExecutionContext, StationResult } from "../../types";
import {
  creatorKey,
  getCreatorParams,
  setCreatorParams,
  clearCreatorParams,
} from "../creator-state";
import "../canvas";
import "../image";
import "../video";
import "../music";
import "../audio";
import "../assets";

const CANVAS = {
  id: "canvas_1",
  userId: "user_123",
  status: "active",
  projectId: "proj_1",
  conversationId: "conv_1",
};

function makeCtx(overrides: Partial<StationExecutionContext> = {}): StationExecutionContext {
  return {
    projectId: "proj_1",
    conversationId: "conv_1",
    userId: "user_123",
    permissions: { ...DEFAULT_PERMISSIONS },
    emitEvent: vi.fn(),
    navigateToStation: vi.fn(),
    reportLiveState: vi.fn(),
    transport: null,
    ...overrides,
  };
}

function makeTransport() {
  return {
    writeBinaryFile: vi.fn(async () => ({ saved: true })),
    listFiles: vi.fn(async () => ({ entries: [] })),
  };
}

/**
 * Typed execution of a registered station action. getStationAction erases the
 * concrete args schema (zod v4 infers unknown), so the executor's Promise
 * is cast back to the StationResult envelope every station action returns.
 */
async function runAction(
  id: string,
  args: Record<string, unknown>,
  ctx: StationExecutionContext,
): Promise<StationResult> {
  const action = getStationAction(id);
  if (!action) throw new Error(`station action not registered: ${id}`);
  return (await action.execute(args, ctx)) as StationResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearCreatorParams("conv_1:proj_1");
  mocks.listCanvases.mockResolvedValue([CANVAS]);
  mocks.getCanvas.mockResolvedValue(CANVAS);
  mocks.listBlocks.mockResolvedValue([
    { id: "b_1", type: "paragraph", content: { text: "hello" }, position: 0 },
  ]);
  mocks.addBlocks.mockImplementation(async (_cid: string, _uid: string, blocks: Array<{ type: string; content: unknown; position?: number }>) =>
    blocks.map((b, i) => ({ id: `b_new_${i}`, type: b.type, content: b.content, position: b.position ?? i })),
  );
  mocks.updateBlock.mockImplementation(async (_cid: string, bid: string) => ({ id: bid, type: "paragraph" }));
  mocks.deleteBlock.mockResolvedValue(undefined);
  mocks.reorderBlock.mockResolvedValue(undefined);
});

describe("creator-state", () => {
  it("keys params by conversation:project with default fallbacks", () => {
    expect(creatorKey(makeCtx())).toBe("conv_1:proj_1");
    expect(creatorKey(makeCtx({ conversationId: null, projectId: null }))).toBe("default:default");
  });

  it("set/get round-trips staged params", () => {
    setCreatorParams("k", { prompt: "a sunset", musicBpm: 120, lastResults: [] });
    const p = getCreatorParams("k");
    expect(p.prompt).toBe("a sunset");
    expect(p.musicBpm).toBe(120);
  });
});

describe("canvas station", () => {
  it("addNode maps to addBlocks (POST /blocks analog) with ownership check", async () => {
    const action = getStationAction("canvas.addNode");
    expect(action).toBeDefined();
    expect(action!.mutating).toBe(true);
    const res = await runAction(
      "canvas.addNode",
      { type: "paragraph", props: { text: "hi" } },
      makeCtx(),
    );
    expect(res.success).toBe(true);
    expect(mocks.addBlocks).toHaveBeenCalledTimes(1);
    const [, userId, blocks, actor] = mocks.addBlocks.mock.calls[0];
    expect(userId).toBe("user_123");
    expect(actor).toBe("litt");
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].content).toEqual({ text: "hi" });
    expect((res as unknown as { nodeId: string }).nodeId).toBe("b_new_0");
  });

  it("rejects content that violates the block schema (honest validation)", async () => {
    const res = await runAction(
      "canvas.addNode",
      { type: "image", props: { nope: 1 } },
      makeCtx(),
    );
    expect(res.success).toBe(false);
    expect((res as unknown as { errorCode?: string }).errorCode).toBe("invalid_args");
    expect(mocks.addBlocks).not.toHaveBeenCalled();
  });

  it("removeNode maps to deleteBlock (DELETE /blocks/[id] analog)", async () => {
    const res = await runAction("canvas.removeNode", { nodeId: "b_1" }, makeCtx());
    expect(res.success).toBe(true);
    expect(mocks.deleteBlock).toHaveBeenCalledWith("canvas_1", "b_1", "litt", undefined);
  });

  it("moveNode maps to reorderBlock (PATCH position analog)", async () => {
    const res = await runAction("canvas.moveNode", { nodeId: "b_1", position: 3 }, makeCtx());
    expect(res.success).toBe(true);
    expect(mocks.reorderBlock).toHaveBeenCalledWith("canvas_1", "b_1", 3, "litt", undefined);
  });

  it("editNode maps to updateBlock (PATCH content analog)", async () => {
    const res = await runAction("canvas.editNode", 
      { nodeId: "b_1", props: { text: "edited" } },
      makeCtx(),
    );
    expect(res.success).toBe(true);
    expect(mocks.updateBlock).toHaveBeenCalledWith("canvas_1", "b_1", { text: "edited" }, "litt", undefined);
  });

  it("selectNode is a read (mutating:false) returning the node", async () => {
    const action = getStationAction("canvas.selectNode")!;
    expect(action.mutating).toBe(false);
    const res = await runAction("canvas.selectNode", { nodeId: "b_1" }, makeCtx());
    expect(res.success).toBe(true);
    expect((res as unknown as { node: { id: string } }).node.id).toBe("b_1");
    expect(mocks.addBlocks).not.toHaveBeenCalled();
  });

  it("exportNode supports json honestly and refuses png (no renderer)", async () => {
    const json = await runAction("canvas.exportNode", { nodeId: "b_1", format: "json" }, makeCtx());
    expect(json.success).toBe(true);
    expect((json as unknown as { format: string }).format).toBe("json");

    const png = await runAction("canvas.exportNode", { nodeId: "b_1", format: "png" }, makeCtx());
    expect(png.success).toBe(false);
    expect((png as unknown as { errorCode?: string }).errorCode).toBe("not_implemented");
  });

  it("denies access to another user's canvas (route ownership parity)", async () => {
    mocks.getCanvas.mockResolvedValue({ ...CANVAS, userId: "someone_else" });
    const res = await runAction("canvas.addNode", 
      { type: "note", props: { text: "x" } },
      makeCtx(),
    );
    expect(res.success).toBe(false);
    expect((res as unknown as { errorCode?: string }).errorCode).toBe("permission_denied");
    expect(mocks.addBlocks).not.toHaveBeenCalled();
  });
});

describe("image station", () => {
  it("generate merges staged creator-state params and runs the asset pipeline", async () => {
    mocks.generateImage.mockResolvedValue({
      success: true,
      downloadUrl: "https://cdn.example/gen.png",
      providerId: "pollinations",
      requestId: "req_1",
    });
    mocks.insertAssetFromUrl.mockResolvedValue({
      success: true,
      path: "public/assets/images/123-generated.png",
      sitePath: "/assets/images/123-generated.png",
    });

    const key = "conv_1:proj_1";
    setCreatorParams(key, {
      prompt: "a red barn",
      negativePrompt: "blurry",
      style: "watercolor",
      aspectRatio: "16:9",
    });

    const res = await runAction("image.generate", 
      {},
      makeCtx({ transport: makeTransport() }),
    );
    expect(res.success).toBe(true);

    // Params merged from creator-state
    const [, input] = mocks.generateImage.mock.calls[0];
    expect(input.prompt).toContain("a red barn");
    expect(input.prompt).toContain("watercolor");
    expect(input.negativePrompt).toBe("blurry");
    expect(input.aspectRatio).toBe("16:9");

    // Asset pipeline ran: saved into project with stable sitePath
    expect(mocks.insertAssetFromUrl).toHaveBeenCalledTimes(1);
    expect(mocks.insertAssetFromUrl.mock.calls[0][0]).toBe("https://cdn.example/gen.png");
    const out = res as unknown as { savedToProject: boolean; sitePath: string };
    expect(out.savedToProject).toBe(true);
    expect(out.sitePath).toBe("/assets/images/123-generated.png");

    // Result staged for saveAsset/sendToCanvas
    const params = getCreatorParams(key);
    expect(params.lastResults).toHaveLength(1);
    expect(params.lastResults[0].sitePath).toBe("/assets/images/123-generated.png");
  });

  it("generate returns the URL honestly with savedToProject:false when no transport", async () => {
    mocks.generateImage.mockResolvedValue({
      success: true,
      downloadUrl: "https://cdn.example/chat.png",
      providerId: "pollinations",
      requestId: "req_2",
    });
    setCreatorParams("conv_1:proj_1", { prompt: "chat-only render" });
    const res = await runAction("image.generate", {}, makeCtx({ transport: null }));
    expect(res.success).toBe(true);
    const out = res as unknown as { savedToProject: boolean; url: string };
    expect(out.savedToProject).toBe(false);
    expect(out.url).toBe("https://cdn.example/chat.png");
    expect(mocks.insertAssetFromUrl).not.toHaveBeenCalled();
  });

  it("generate fails honestly when the provider reports failure", async () => {
    mocks.generateImage.mockResolvedValue({ success: false, error: "No providers configured", code: "NO_PROVIDER" });
    setCreatorParams("conv_1:proj_1", { prompt: "will fail" });
    const res = await runAction("image.generate", {}, makeCtx());
    expect(res.success).toBe(false);
    expect((res as unknown as { errorCode?: string }).errorCode).toBe("execution_failed");
  });

  it("saveAsset delegates to project.insert_asset", async () => {
    mocks.toolExecute.mockResolvedValue({
      ok: true,
      result: { path: "public/assets/images/x.png", sitePath: "/assets/images/x.png" },
    });
    const key = "conv_1:proj_1";
    setCreatorParams(key, {
      lastResults: [{ id: "img_1", url: "https://cdn.example/a.png", kind: "image" }],
    });
    const res = await runAction("image.saveAsset", 
      { resultId: "img_1", name: "hero" },
      makeCtx({ transport: makeTransport() }),
    );
    expect(res.success).toBe(true);
    expect(mocks.toolExecute).toHaveBeenCalledWith(
      "project.insert_asset",
      expect.objectContaining({ url: "https://cdn.example/a.png", name: "hero" }),
      expect.objectContaining({ hasApproval: true }),
    );
  });

  it("sendToCanvas fails honestly when the asset was never saved", async () => {
    setCreatorParams("conv_1:proj_1", {
      lastResults: [{ id: "img_chat", url: "https://cdn.example/chat.png", kind: "image" }],
    });
    const res = await runAction("image.sendToCanvas", { resultId: "img_chat" }, makeCtx());
    expect(res.success).toBe(false);
    expect((res as unknown as { error?: string }).error).toMatch(/saveAsset/);
    expect(mocks.addBlocks).not.toHaveBeenCalled();
  });

  it("sendToCanvas composes canvas.addNode for a saved asset", async () => {
    setCreatorParams("conv_1:proj_1", {
      lastResults: [{
        id: "img_saved", url: "https://cdn.example/a.png", kind: "image",
        sitePath: "/assets/images/x.png",
      }],
    });
    const res = await runAction("image.sendToCanvas", 
      { resultId: "img_saved", alt: "hero" },
      makeCtx(),
    );
    expect(res.success).toBe(true);
    expect(mocks.addBlocks).toHaveBeenCalledTimes(1);
    const blocks = mocks.addBlocks.mock.calls[0][2];
    expect(blocks[0].type).toBe("image");
    expect(blocks[0].content).toEqual({ url: "/assets/images/x.png", alt: "hero" });
  });
});

describe("video station", () => {
  it("generate/imageToVideo surface not_configured honestly when provider keys are absent", async () => {
    mocks.submitAlibabaVideoTask.mockRejectedValue(new Error("ALIBABA_DASHSCOPE_API_KEY is not configured"));
    mocks.isAlibabaConfigured.mockReturnValue(false);

    setCreatorParams("conv_1:proj_1", { prompt: "waves", referenceAssetId: "https://cdn.example/first.png" });
    const res = await runAction("video.generate", {}, makeCtx());
    expect(res.success).toBe(false);
    expect((res as unknown as { errorCode?: string }).errorCode).toBe("not_configured");
    expect(mocks.submitAlibabaVideoTask).not.toHaveBeenCalled();
  });

  it("maps a provider 'not configured' throw to not_configured (the route's 422)", async () => {
    mocks.isAlibabaConfigured.mockReturnValue(true);
    mocks.submitAlibabaVideoTask.mockRejectedValue(new Error("ALIBABA_DASHSCOPE_API_KEY is not configured"));
    const res = await runAction("video.imageToVideo", 
      { assetId: "https://cdn.example/first.png" },
      makeCtx(),
    );
    expect(res.success).toBe(false);
    expect((res as unknown as { errorCode?: string }).errorCode).toBe("not_configured");
  });

  it("generate without a first-frame image fails honestly (no text-to-video wire)", async () => {
    setCreatorParams("conv_1:proj_1", { prompt: "text only" });
    const res = await runAction("video.generate", {}, makeCtx());
    expect(res.success).toBe(false);
    expect((res as unknown as { errorCode?: string }).errorCode).toBe("not_implemented");
    expect(mocks.submitAlibabaVideoTask).not.toHaveBeenCalled();
  });

  it("poll budget expiry returns processing, not failure", async () => {
    vi.useFakeTimers();
    mocks.isAlibabaConfigured.mockReturnValue(true);
    mocks.submitAlibabaVideoTask.mockResolvedValue({ taskId: "t_1", taskStatus: "PENDING" });
    mocks.pollAlibabaVideoTask.mockResolvedValue({ taskStatus: "RUNNING" });
    setCreatorParams("conv_1:proj_1", { prompt: "slow", referenceAssetId: "https://cdn.example/f.png" });

    const promise = runAction("video.generate", {}, makeCtx());
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 30_000);
    const res = await promise;
    vi.useRealTimers();

    expect(res.success).toBe(true);
    expect((res as unknown as { status: string }).status).toBe("processing");
    expect((res as unknown as { taskId: string }).taskId).toBe("t_1");
  });
});

describe("music station", () => {
  it("generate fails honestly when no real provider is configured (never mock audio)", async () => {
    mocks.getActiveProvider.mockReturnValue({ name: "mock", supportsStreaming: false, supportsAsyncPolling: false });
    setCreatorParams("conv_1:proj_1", { prompt: "lofi beat", musicStyle: "lofi" });
    const res = await runAction("music.generate", {}, makeCtx());
    expect(res.success).toBe(false);
    expect((res as unknown as { errorCode?: string }).errorCode).toBe("not_configured");
  });

  it("generate surfaces provider failure honestly", async () => {
    mocks.getActiveProvider.mockReturnValue({
      name: "lyria",
      supportsStreaming: true,
      supportsAsyncPolling: false,
      generateSong: vi.fn(async () => ({ status: "failed", error: "Lyria generation failed", estimatedCostCents: 0 })),
    });
    setCreatorParams("conv_1:proj_1", { prompt: "epic", musicStyle: "orchestral" });
    const res = await runAction("music.generate", {}, makeCtx());
    expect(res.success).toBe(false);
    expect((res as unknown as { error?: string }).error).toBe("Lyria generation failed");
  });
});

describe("audio station", () => {
  it("tts fails honestly when GEMINI_API_KEY is absent", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await runAction("audio.tts", { text: "hello world" }, makeCtx());
    expect(res.success).toBe(false);
    expect((res as unknown as { errorCode?: string }).errorCode).toBe("not_configured");
    expect(mocks.googleGenAI).not.toHaveBeenCalled();
  });

  it("sfx is registered but fails honestly — the backend is speech-only", async () => {
    const action = getStationAction("audio.sfx");
    expect(action).toBeDefined();
    const res = await runAction("audio.sfx", { description: "thunder crash" }, makeCtx());
    expect(res.success).toBe(false);
    expect((res as unknown as { errorCode?: string }).errorCode).toBe("not_implemented");
    expect((res as unknown as { error?: string }).error).toMatch(/not backed by a provider/i);
  });
});

describe("assets station", () => {
  it("save delegates to project.insert_asset", async () => {
    mocks.toolExecute.mockResolvedValue({
      ok: true,
      result: { path: "public/assets/images/a.png", sitePath: "/assets/images/a.png" },
    });
    const res = await runAction("assets.save", 
      { blob: "https://cdn.example/a.png", name: "a" },
      makeCtx({ transport: makeTransport() }),
    );
    expect(res.success).toBe(true);
    expect(mocks.toolExecute).toHaveBeenCalledWith(
      "project.insert_asset",
      expect.objectContaining({ url: "https://cdn.example/a.png", name: "a" }),
      expect.anything(),
    );
  });

  it("search fails honestly when Supabase is unavailable", async () => {
    const res = await runAction("assets.search", { query: "sunset" }, makeCtx());
    expect(res.success).toBe(false);
    expect((res as unknown as { errorCode?: string }).errorCode).toBe("not_configured");
  });
});

describe("omitted actions are not registered", () => {
  it.each([
    "image.upscale", // no real upscaler — ImageTool button was a prompt suffix
    "music.remix", // no remix endpoint anywhere
    "assets.delete", // no backend delete
    "terminal.cancel", // no cancel path in transport (chunk B)
  ])("%s is not registered", (id) => {
    expect(getStationAction(id)).toBeUndefined();
  });
});
