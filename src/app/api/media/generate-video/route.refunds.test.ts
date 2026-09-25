// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * P1-3 regression tests: airtight staged video BITS refunds.
 *
 * The /api/media/generate-video flow debits up front and refunds on
 * failure across three stages:
 *   1. validation (pre-debit — nothing to refund),
 *   2. debit → provider submission (refund on submission failure),
 *   3. provider accepted → outcome polling (refund on terminal failure).
 *
 * These tests pin the money invariants:
 *  - a failed provider submission always refunds (net 0 LiTTBits kept),
 *  - a refund that fails transiently is retried and still credits once,
 *  - a refund that keeps failing is recorded as `pending`, never lost,
 *  - billing-exempt requests never debit AND never refund (no phantom credit),
 *  - outcome-stage refunds work even when the in-memory job is gone
 *    (cross-instance / restart) via the durable generation_jobs row,
 *  - outcome-stage refunds are exactly-once across repeated polls,
 *  - the Alibaba FAILED path marks the durable row failed (not stuck).
 *
 * The wallet ledger is faked in-memory (balance + idempotency-key replay
 * detection mirroring the real debit_credits/grant_credits RPC semantics);
 * the providers are stubbed. Tests assert on the fake ledger's net balance,
 * which is exactly what "charged" means to the user.
 */

// ── Mocks ──

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: any) => handler,
}));

let billingExempt = false;
vi.mock("@/lib/owner", () => ({
  isBillingExempt: () => billingExempt,
  getActiveSimulation: vi.fn(async () => null),
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(),
  adjustWalletBalance: vi.fn(),
}));

vi.mock("@/lib/generation/identity", () => ({
  resolveInternalUserId: vi.fn(async () => "internal-uuid-1"),
}));

vi.mock("@/lib/billing/canonical-pricing", () => ({
  buildChargeRating: (x: any) => x,
}));

vi.mock("@/lib/generation/cost-engine", () => ({
  calculateRetailBits: () => ({ retailLiTTBits: 50, providerCostCents: 1 }),
}));

const VIDEO_CAPS = {
  aspectRatios: ["16:9"],
  resolutions: ["720p", "1080p"],
  durations: [5, 8],
  supportsReferenceImage: false,
};
vi.mock("@/lib/studio-models", () => ({
  getVideoModel: (id: string) =>
    id === "happyhorse"
      ? {
          id: "happyhorse",
          apiModel: "happyhorse-i2v",
          label: "HappyHorse",
          available: true,
          capabilities: VIDEO_CAPS,
        }
      : id === "veo"
        ? {
            id: "veo",
            apiModel: "veo-3.0",
            label: "Veo",
            available: true,
            capabilities: VIDEO_CAPS,
          }
        : null,
  getVideoModelPricing: () => 100,
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(),
  GenerateVideosOperation: vi.fn(),
}));

vi.mock("@/lib/alibaba-video", () => ({
  isAlibabaConfigured: () => true,
  submitAlibabaVideoTask: vi.fn(),
  pollAlibabaVideoTask: vi.fn(),
  downloadVideo: vi.fn(),
}));

vi.mock("@/lib/r2", () => ({
  uploadAudio: vi.fn(),
}));

// In-memory fake of @/lib/video-jobs (the real module is server-only).
// NOTE: vi.mock factories are hoisted, so the map lives inside the
// factory and is exposed via __memJobs on the mocked module.
type MemJob = {
  jobId: string;
  userId: string;
  provider: string;
  providerOperationId: string;
  model: string;
  cost: number;
  status: "pending" | "done" | "failed";
  charged: boolean;
  refunded: boolean;
};
vi.mock("@/lib/video-jobs", () => {
  const memJobs = new Map<string, MemJob>();
  return {
    createVideoJob: (job: MemJob) => {
      memJobs.set(job.jobId, { ...job });
    },
    getVideoJob: (id: string) => memJobs.get(id),
    findJobByOperationId: (opId: string) => {
      for (const j of memJobs.values()) if (j.providerOperationId === opId) return j;
      return undefined;
    },
    markVideoJobDone: (id: string) => {
      const j = memJobs.get(id);
      if (j) j.status = "done";
    },
    markVideoJobFailed: (id: string) => {
      const j = memJobs.get(id);
      if (j) j.status = "failed";
    },
    markVideoJobRefunded: (id: string) => {
      const j = memJobs.get(id);
      if (!j || j.refunded) return false;
      j.refunded = true;
      return true;
    },
    __memJobs: memJobs,
  };
});

// In-memory fake of @/lib/generation/jobs (the real module is server-only).
// The map lives inside the hoisted factory; exposed via __genRows.
type GenRow = {
  id: string;
  userId: string;
  modality: string;
  provider: string;
  model: string;
  status: string;
  prompt: string;
  requestId: string;
  providerJobId: string | null;
  littBitsCharged: number;
  refundStatus: "none" | "pending" | "refunded" | "failed";
  assetId: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
};
vi.mock("@/lib/generation/jobs", () => {
  const genRows = new Map<string, GenRow>();
  return {
    createGenerationJob: async (input: any) => {
      for (const r of genRows.values()) {
        if (r.userId === input.userId && r.requestId === input.requestId) return { ...r };
      }
      const row: GenRow = {
        id: input.id,
        userId: input.userId,
        modality: input.modality,
        provider: input.provider,
        model: input.model,
        status: "queued",
        prompt: input.prompt,
        requestId: input.requestId,
        providerJobId: null,
        littBitsCharged: input.littBitsCharged,
        refundStatus: "none",
        assetId: null,
        error: null,
        metadata: input.metadata ?? {},
      };
      genRows.set(row.id, row);
      return { ...row };
    },
    getGenerationJobByRequestId: async (userId: string, requestId: string) => {
      for (const r of genRows.values()) {
        if (r.userId === userId && r.requestId === requestId) return { ...r };
      }
      return null;
    },
    getGenerationJobByProviderJobId: async (userId: string, providerJobId: string) => {
      for (const r of genRows.values()) {
        if (r.userId === userId && r.providerJobId === providerJobId) return { ...r };
      }
      return null;
    },
    updateGenerationJobStatus: async (jobId: string, status: string, updates: any = {}) => {
      const r = genRows.get(jobId);
      if (!r) return;
      r.status = status;
      if (updates.providerJobId !== undefined) r.providerJobId = updates.providerJobId;
      if (updates.refundStatus !== undefined) r.refundStatus = updates.refundStatus;
      if (updates.error !== undefined) r.error = updates.error;
      if (updates.assetId !== undefined) r.assetId = updates.assetId;
    },
    updateGenerationJobMetadata: async (jobId: string, updates: any) => {
      const r = genRows.get(jobId);
      if (r) r.metadata = { ...r.metadata, ...updates };
    },
    failGenerationJob: async (jobId: string, error: string, refundStatus: any = "none") => {
      const r = genRows.get(jobId);
      if (!r) return;
      r.status = "failed";
      r.error = error;
      r.refundStatus = refundStatus;
    },
    completeGenerationJob: async (jobId: string, assetId: string | null) => {
      const r = genRows.get(jobId);
      if (!r) return;
      r.status = "completed";
      r.assetId = assetId;
      r.refundStatus = "none";
    },
    setGenerationRefundStatus: async (jobId: string, refundStatus: GenRow["refundStatus"]) => {
      const r = genRows.get(jobId);
      if (r) r.refundStatus = refundStatus;
    },
    __genRows: genRows,
  };
});

import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import { submitAlibabaVideoTask, pollAlibabaVideoTask } from "@/lib/alibaba-video";
import { POST as generateVideo } from "./route";
import { POST as videoStatus } from "../video-status/route";
import { POST as alibabaStatus } from "../alibaba-status/route";
import * as videoJobsMock from "@/lib/video-jobs";
import * as genJobsMock from "@/lib/generation/jobs";

// Handles to the in-memory fakes exposed by the hoisted vi.mock factories.
const memJobs = (videoJobsMock as any).__memJobs as Map<string, MemJob>;
const genRows = (genJobsMock as any).__genRows as Map<string, GenRow>;

// ── Fake ledger ────────────────────────────────────────────────
// Mirrors the real RPC idempotency semantics: the first call with a key
// applies; a repeat with the same key is a no-op reporting replayed:true
// (debits: balance unchanged; grants: granted=false).

const STARTING_BALANCE = 10_000;
let ledgerBalance: number;
let ledgerCalls: { key: string; amount: number; type: string }[];
let seenLedgerKeys: Set<string>;
let queuedRefundFailures: number;

function resetLedger() {
  ledgerBalance = STARTING_BALANCE;
  ledgerCalls = [];
  seenLedgerKeys = new Set();
  queuedRefundFailures = 0;
  vi.mocked(getCreditBalances).mockImplementation(async () => ({
    monthly: 0,
    purchased: 0,
    betaPromotional: 0,
    total: ledgerBalance,
    lastDailyClaim: null,
  }));
  vi.mocked(adjustWalletBalance).mockImplementation(async (params: any) => {
    if (params.type === "refund" && queuedRefundFailures > 0) {
      queuedRefundFailures--;
      throw new Error("wallet service unavailable");
    }
    if (seenLedgerKeys.has(params.idempotencyKey)) {
      return { balance: ledgerBalance, previousBalance: ledgerBalance, replayed: true };
    }
    seenLedgerKeys.add(params.idempotencyKey);
    const previous = ledgerBalance;
    ledgerBalance += params.amount;
    ledgerCalls.push({ key: params.idempotencyKey, amount: params.amount, type: params.type });
    return { balance: ledgerBalance, previousBalance: previous, replayed: false };
  });
}

const netCharged = () => STARTING_BALANCE - ledgerBalance;
const refundCalls = () => ledgerCalls.filter((c) => c.type === "refund");

// ── Helpers ──

function makeGenerateRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/media/generate-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "a corgi skateboarding through a neon city",
      model: "veo",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 5,
      requestId: "req-test-1",
      ...body,
    }),
  });
}

function makeStatusRequest(route: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockVeoSubmitSuccess(operationName = "op-123") {
  vi.mocked(GoogleGenAI).mockImplementation(
    (() => ({
      models: {
        generateVideos: async () => ({ name: operationName }),
      },
      operations: {
        getVideosOperation: async () => ({ done: false }),
      },
    })) as any,
  );
}

function mockVeoSubmitFailure(message = "provider exploded") {
  vi.mocked(GoogleGenAI).mockImplementation(
    (() => ({
      models: {
        generateVideos: async () => {
          throw new Error(message);
        },
      },
      operations: {
        getVideosOperation: async () => ({ done: false }),
      },
    })) as any,
  );
}

function mockVeoPollFailed(operationName = "op-123") {
  vi.mocked(GoogleGenAI).mockImplementation(
    (() => ({
      models: { generateVideos: async () => ({ name: operationName }) },
      operations: {
        getVideosOperation: async () => ({ done: true, response: {} }),
      },
    })) as any,
  );
  vi.mocked(GenerateVideosOperation).mockImplementation(function (this: any) {
    this.name = "";
  } as any);
}

function mockAlibabaSubmitSuccess(taskId = "task-1") {
  vi.mocked(submitAlibabaVideoTask).mockResolvedValue({
    taskId,
    taskStatus: "PENDING",
  } as any);
}

function mockAlibabaPollFailed() {
  vi.mocked(pollAlibabaVideoTask).mockResolvedValue({
    taskStatus: "FAILED",
    videoUrl: null,
    error: "task failed at provider",
  } as any);
}

function genRowByRequestId(requestId: string): GenRow | undefined {
  for (const r of genRows.values()) if (r.requestId === requestId) return r;
  return undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  billingExempt = false;
  memJobs.clear();
  genRows.clear();
  resetLedger();
  vi.mocked(auth).mockResolvedValue({ userId: "clerk_test_user" } as any);
});

// ── Stage 2: debit → provider submission ─────────────────────────

describe("generate-video — submission-stage refunds", () => {
  it("refunds the debit when the Veo provider call throws (net 0 kept)", async () => {
    mockVeoSubmitFailure();
    const res = await generateVideo(makeGenerateRequest({}));
    expect(res.status).toBe(500);

    expect(netCharged()).toBe(0);
    const debits = ledgerCalls.filter((c) => c.type === "spend");
    const refunds = refundCalls();
    expect(debits).toHaveLength(1);
    expect(debits[0].key).toBe("video:charge:req-test-1");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].key).toBe("video:refund:req-test-1");
    expect(refunds[0].amount).toBe(100);

    const row = genRowByRequestId("req-test-1");
    expect(row?.status).toBe("failed");
    expect(row?.refundStatus).toBe("refunded");
  });

  it("retries a transient wallet failure and still credits exactly once", async () => {
    mockVeoSubmitFailure();
    queuedRefundFailures = 2; // first two refund attempts blow up
    const res = await generateVideo(makeGenerateRequest({}));
    expect(res.status).toBe(500);

    expect(netCharged()).toBe(0);
    // One logical refund applied despite retries (same idempotency key).
    expect(refundCalls()).toHaveLength(1);
    expect(refundCalls()[0].key).toBe("video:refund:req-test-1");
    expect(genRowByRequestId("req-test-1")?.refundStatus).toBe("refunded");
  });

  it("records refund `pending` (never silently lost) when the wallet stays down", async () => {
    mockVeoSubmitFailure();
    queuedRefundFailures = 99; // every refund attempt blows up
    const res = await generateVideo(makeGenerateRequest({}));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toMatch(/pending automatic refund/);

    const row = genRowByRequestId("req-test-1");
    expect(row?.status).toBe("failed");
    expect(row?.refundStatus).toBe("pending");
    // Nothing was credited yet — but the pending state is durable.
    expect(refundCalls()).toHaveLength(0);
  });

  it("a retry with the same requestId completes a pending submission refund", async () => {
    mockVeoSubmitFailure();
    queuedRefundFailures = 99;
    await generateVideo(makeGenerateRequest({}));
    expect(genRowByRequestId("req-test-1")?.refundStatus).toBe("pending");

    // Wallet recovers; the client retries with the same requestId.
    queuedRefundFailures = 0;
    const res = await generateVideo(makeGenerateRequest({}));
    // The debit replays (no double charge) → honest 409 for a failed attempt.
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already failed/);

    expect(genRowByRequestId("req-test-1")?.refundStatus).toBe("refunded");
    expect(netCharged()).toBe(0);
    expect(refundCalls()).toHaveLength(1);
  });

  it("charges nothing when the provider key is missing (pre-debit validation)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    mockVeoSubmitFailure();
    const res = await generateVideo(makeGenerateRequest({}));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toMatch(/not configured/);
    expect(ledgerCalls).toHaveLength(0);
    expect(genRows.size).toBe(0);
  });

  it("rejects an empty prompt before any debit", async () => {
    mockVeoSubmitFailure();
    // Empty prompt → 400 before any debit or provider call.
    const res = await generateVideo(makeGenerateRequest({ prompt: "  " }));
    expect(res.status).toBe(400);
    expect(ledgerCalls).toHaveLength(0);
    expect(genRows.size).toBe(0);
  });

  it("exempt requests never debit and never refund, even when submission fails", async () => {
    billingExempt = true;
    mockVeoSubmitFailure();
    const res = await generateVideo(makeGenerateRequest({}));
    expect(res.status).toBe(500);

    expect(ledgerCalls).toHaveLength(0);
    const row = genRowByRequestId("req-test-1");
    expect(row?.littBitsCharged).toBe(0);
    expect(row?.refundStatus).toBe("none");
  });

  it("records charged=false and 0 BITS for exempt requests on success", async () => {
    billingExempt = true;
    mockVeoSubmitSuccess("op-exempt");
    const res = await generateVideo(makeGenerateRequest({}));
    expect(res.status).toBe(200);

    expect(ledgerCalls).toHaveLength(0);
    const memJob = memJobs.get("veo_op-exempt");
    expect(memJob?.charged).toBe(false);
    expect(genRowByRequestId("req-test-1")?.littBitsCharged).toBe(0);
  });

  it("happy path: exactly one debit, no refund, row generating", async () => {
    mockVeoSubmitSuccess("op-123");
    const res = await generateVideo(makeGenerateRequest({}));
    expect(res.status).toBe(200);

    expect(netCharged()).toBe(100);
    expect(refundCalls()).toHaveLength(0);
    const row = genRowByRequestId("req-test-1");
    expect(row?.status).toBe("generating");
    expect(row?.providerJobId).toBe("op-123");
    expect(row?.refundStatus).toBe("none");
    expect(memJobs.get("veo_op-123")?.charged).toBe(true);
  });
});

// ── Stage 3: outcome polling ─────────────────────────────────────

describe("video-status — outcome-stage refunds", () => {
  async function seedSucceededSubmission() {
    mockVeoSubmitSuccess("op-123");
    const res = await generateVideo(makeGenerateRequest({}));
    expect(res.status).toBe(200);
    expect(netCharged()).toBe(100);
  }

  it("refunds when the provider operation fails with no video output", async () => {
    await seedSucceededSubmission();
    mockVeoPollFailed("op-123");
    const res = await videoStatus(
      makeStatusRequest("/api/media/video-status", { operationName: "op-123" }),
    );
    const body = await res.json();
    expect(body.refunded).toBe(true);

    expect(netCharged()).toBe(0);
    expect(refundCalls()).toHaveLength(1);
    expect(refundCalls()[0].key).toBe("video_refund_op-123");
    const row = genRowByRequestId("req-test-1");
    expect(row?.status).toBe("failed");
    expect(row?.refundStatus).toBe("refunded");
  });

  it("refunds via the durable row when the in-memory job is gone (cross-instance)", async () => {
    await seedSucceededSubmission();
    memJobs.clear(); // simulate another instance / restart

    mockVeoPollFailed("op-123");
    const res = await videoStatus(
      makeStatusRequest("/api/media/video-status", { operationName: "op-123" }),
    );
    const body = await res.json();
    expect(body.refunded).toBe(true);
    expect(netCharged()).toBe(0);
    expect(genRowByRequestId("req-test-1")?.refundStatus).toBe("refunded");
  });

  it("does not double-refund across repeated polls", async () => {
    await seedSucceededSubmission();
    mockVeoPollFailed("op-123");
    const req = () =>
      videoStatus(makeStatusRequest("/api/media/video-status", { operationName: "op-123" }));

    const first = await (await req()).json();
    expect(first.refunded).toBe(true);
    const second = await (await req()).json();
    expect(second.refunded).toBe(false);

    expect(refundCalls()).toHaveLength(1);
    expect(netCharged()).toBe(0);
  });

  it("never refunds an exempt request, even if the exemption lapsed before polling", async () => {
    billingExempt = true;
    mockVeoSubmitSuccess("op-exempt-2");
    const genRes = await generateVideo(makeGenerateRequest({ requestId: "req-exempt" }));
    expect(genRes.status).toBe(200);

    // Exemption lapses before the outcome poll.
    billingExempt = false;
    memJobs.clear(); // force the durable-row path (charge-time truth)
    mockVeoPollFailed("op-exempt-2");
    const res = await videoStatus(
      makeStatusRequest("/api/media/video-status", { operationName: "op-exempt-2" }),
    );
    const body = await res.json();
    expect(body.refunded).toBe(false);
    expect(refundCalls()).toHaveLength(0);
    expect(netCharged()).toBe(0); // no phantom credit minted
  });

  it("still refunds a charged request when the user became exempt before polling", async () => {
    await seedSucceededSubmission();
    // Owner simulation starts mid-flight: poll-time exemption must NOT
    // cancel a refund the user is actually owed.
    billingExempt = true;
    mockVeoPollFailed("op-123");
    const res = await videoStatus(
      makeStatusRequest("/api/media/video-status", { operationName: "op-123" }),
    );
    const body = await res.json();
    expect(body.refunded).toBe(true);
    expect(netCharged()).toBe(0);
  });

  it("leaves refund `pending` and retries on the next poll when the wallet is down", async () => {
    await seedSucceededSubmission();
    mockVeoPollFailed("op-123");

    queuedRefundFailures = 99;
    const first = await (
      await videoStatus(makeStatusRequest("/api/media/video-status", { operationName: "op-123" }))
    ).json();
    expect(first.refunded).toBe(false);
    expect(first.refundPending).toBe(true);
    expect(genRowByRequestId("req-test-1")?.refundStatus).toBe("pending");

    queuedRefundFailures = 0;
    const second = await (
      await videoStatus(makeStatusRequest("/api/media/video-status", { operationName: "op-123" }))
    ).json();
    expect(second.refunded).toBe(true);
    expect(refundCalls()).toHaveLength(1);
    expect(netCharged()).toBe(0);
  });
});

describe("alibaba-status — outcome-stage refunds", () => {
  it("refunds a FAILED task and marks the durable row failed", async () => {
    mockAlibabaSubmitSuccess("task-9");
    const genRes = await generateVideo(
      makeGenerateRequest({ model: "happyhorse", imageUrl: "https://example.com/img.png", requestId: "req-ali-1" }),
    );
    expect(genRes.status).toBe(200);
    expect(netCharged()).toBe(100);

    mockAlibabaPollFailed();
    const res = await alibabaStatus(
      makeStatusRequest("/api/media/alibaba-status", { taskId: "task-9" }),
    );
    const body = await res.json();
    expect(body.refunded).toBe(true);
    expect(netCharged()).toBe(0);

    const row = genRowByRequestId("req-ali-1");
    // Regression: the row used to stay stuck in "generating" forever.
    expect(row?.status).toBe("failed");
    expect(row?.refundStatus).toBe("refunded");
    expect(row?.error).toMatch(/task failed at provider/);
  });

  it("refunds via the durable row when the in-memory job is gone", async () => {
    mockAlibabaSubmitSuccess("task-10");
    const genRes = await generateVideo(
      makeGenerateRequest({ model: "happyhorse", imageUrl: "https://example.com/img.png", requestId: "req-ali-2" }),
    );
    expect(genRes.status).toBe(200);
    memJobs.clear();

    mockAlibabaPollFailed();
    const res = await alibabaStatus(
      makeStatusRequest("/api/media/alibaba-status", { taskId: "task-10" }),
    );
    const body = await res.json();
    expect(body.refunded).toBe(true);
    expect(netCharged()).toBe(0);
  });
});
