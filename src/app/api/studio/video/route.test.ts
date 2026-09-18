// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * P1-3 regression tests: Video BITS money bug.
 *
 * The old route debited the wallet BEFORE checking the provider key and
 * before the provider call, so a missing FAL key (503) or a thrown network
 * error (500) kept the user's LiTTBits. The fixed route:
 *   1. checks the provider key BEFORE any debit (missing key → 503, 0 charged)
 *   2. debits ONLY after successful provider output — every failure path
 *      (missing key, non-OK response, thrown fetch) charges 0 LiTTBits
 *   3. dedupes on a client-supplied idempotency key (Idempotency-Key header
 *      or `idempotencyKey` body field) so a retry cannot double-charge
 *
 * The wallet ledger is faked in-memory (balance + idempotency-key replay
 * detection mirroring the real RPC semantics); the provider is a stubbed
 * global fetch. Tests assert on the fake ledger's debit count and balance,
 * which is exactly what "charged" means to the user.
 */

// ── Mocks ──

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: any) => handler,
}));

vi.mock("@/lib/owner", () => ({
  isBillingExempt: () => false,
  getActiveSimulation: vi.fn(async () => null),
}));

vi.mock("@/lib/wallet-ledger", () => ({
  getCreditBalances: vi.fn(),
  adjustWalletBalance: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { getVideoTier } from "@/config/video-tiers";
import { POST } from "./route";

// ── Fake ledger ──
// Mirrors the real debit_credits RPC idempotency semantics: the first call
// with a key applies the debit; a repeat call with the same key is a
// no-op that reports replayed: true.

const STARTING_BALANCE = 10_000;
let ledgerBalance: number;
let ledgerDebits: { key: string; amount: number }[];
let seenLedgerKeys: Set<string>;

function resetLedger() {
  ledgerBalance = STARTING_BALANCE;
  ledgerDebits = [];
  seenLedgerKeys = new Set();
  vi.mocked(getCreditBalances).mockImplementation(async () => ({
    monthly: 0,
    purchased: 0,
    betaPromotional: 0,
    total: ledgerBalance,
    lastDailyClaim: null,
  }));
  vi.mocked(adjustWalletBalance).mockImplementation(async (params: any) => {
    if (seenLedgerKeys.has(params.idempotencyKey)) {
      return { balance: ledgerBalance, previousBalance: ledgerBalance, replayed: true };
    }
    seenLedgerKeys.add(params.idempotencyKey);
    const previous = ledgerBalance;
    ledgerBalance += params.amount;
    ledgerDebits.push({ key: params.idempotencyKey, amount: params.amount });
    return { balance: ledgerBalance, previousBalance: previous, replayed: false };
  });
}

const chargedTotal = () =>
  ledgerDebits.reduce((sum, d) => sum + Math.abs(d.amount), 0);

// ── Fake provider ──

const fetchMock = vi.fn();

function mockProviderSuccess() {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      video: { url: "https://fal.run/video/test-clip.mp4" },
      request_id: "fal-req-1",
    }),
    text: async () => "",
  });
}

function mockProviderFailure() {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => ({}),
    text: async () => "provider exploded",
  });
}

// ── Helpers ──

function makeRequest(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/studio/video", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      prompt: "a corgi skateboarding through a neon city",
      tierId: "draft",
      ...body,
    }),
  });
}

const DRAFT_PRICE = getVideoTier("draft")!.priceLiTTBits;

// ── Tests ──

describe("POST /api/studio/video — P1-3 video BITS money bug", () => {
  const origFalKey = process.env.FAL_KEY;
  const origFalApiKey = process.env.FAL_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    resetLedger();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.FAL_KEY = "test-fal-key";
    delete process.env.FAL_API_KEY;
    vi.mocked(auth).mockResolvedValue({ userId: "user_p13" } as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (origFalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = origFalKey;
    if (origFalApiKey === undefined) delete process.env.FAL_API_KEY;
    else process.env.FAL_API_KEY = origFalApiKey;
  });

  it("success path: exactly one debit of the tier price", async () => {
    mockProviderSuccess();

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.cost).toBe(DRAFT_PRICE);
    expect(body.videoUrl).toBe("https://fal.run/video/test-clip.mp4");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(adjustWalletBalance).toHaveBeenCalledTimes(1);
    expect(vi.mocked(adjustWalletBalance).mock.calls[0][0]).toMatchObject({
      clerkId: "user_p13",
      amount: -DRAFT_PRICE,
      type: "spend",
    });
    expect(chargedTotal()).toBe(DRAFT_PRICE);
    expect(ledgerBalance).toBe(STARTING_BALANCE - DRAFT_PRICE);
  });

  it("missing API key → 503 with 0 BITS charged (key check runs before debit)", async () => {
    delete process.env.FAL_KEY;
    delete process.env.FAL_API_KEY;

    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.setup_required).toBe(true);

    // No provider call, no wallet touch at all.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adjustWalletBalance).not.toHaveBeenCalled();
    expect(getCreditBalances).not.toHaveBeenCalled();
    expect(chargedTotal()).toBe(0);
    expect(ledgerBalance).toBe(STARTING_BALANCE);
  });

  it("provider non-OK response → 502 with 0 BITS charged", async () => {
    mockProviderFailure();

    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("Video provider error");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(adjustWalletBalance).not.toHaveBeenCalled();
    expect(chargedTotal()).toBe(0);
    expect(ledgerBalance).toBe(STARTING_BALANCE);
  });

  it("provider fetch throws (network) → 500 with 0 BITS charged", async () => {
    fetchMock.mockRejectedValue(new Error("DNS lookup failed"));

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("DNS lookup failed");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(adjustWalletBalance).not.toHaveBeenCalled();
    expect(chargedTotal()).toBe(0);
    expect(ledgerBalance).toBe(STARTING_BALANCE);
  });

  it("retry with the same Idempotency-Key header → single charge total", async () => {
    mockProviderSuccess();
    const key = "p13-header-key";

    const first = await POST(makeRequest({}, { "Idempotency-Key": key }));
    expect(first.status).toBe(200);
    expect((await first.json()).replayed).toBeUndefined();

    const second = await POST(makeRequest({}, { "Idempotency-Key": key }));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.replayed).toBe(true);
    expect(secondBody.videoUrl).toBe("https://fal.run/video/test-clip.mp4");

    // Retry returned the stored result: no second provider call, no second debit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(adjustWalletBalance).toHaveBeenCalledTimes(1);
    expect(chargedTotal()).toBe(DRAFT_PRICE);
    expect(ledgerBalance).toBe(STARTING_BALANCE - DRAFT_PRICE);
  });

  it("retry with the same idempotencyKey body field → single charge total", async () => {
    mockProviderSuccess();
    const key = "p13-body-key";

    const first = await POST(makeRequest({ idempotencyKey: key }));
    expect(first.status).toBe(200);

    const second = await POST(makeRequest({ idempotencyKey: key }));
    expect(second.status).toBe(200);
    expect((await second.json()).replayed).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(adjustWalletBalance).toHaveBeenCalledTimes(1);
    expect(chargedTotal()).toBe(DRAFT_PRICE);
  });

  it("different idempotency keys → separate charges", async () => {
    mockProviderSuccess();

    const first = await POST(makeRequest({}, { "Idempotency-Key": "p13-key-a" }));
    expect(first.status).toBe(200);
    const second = await POST(makeRequest({}, { "Idempotency-Key": "p13-key-b" }));
    expect(second.status).toBe(200);
    expect((await second.json()).replayed).toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(adjustWalletBalance).toHaveBeenCalledTimes(2);
    expect(chargedTotal()).toBe(2 * DRAFT_PRICE);
    expect(ledgerBalance).toBe(STARTING_BALANCE - 2 * DRAFT_PRICE);
  });

  it("no idempotency key → each request charges separately (unique ledger keys)", async () => {
    mockProviderSuccess();

    const first = await POST(makeRequest());
    expect(first.status).toBe(200);
    const second = await POST(makeRequest());
    expect(second.status).toBe(200);

    expect(adjustWalletBalance).toHaveBeenCalledTimes(2);
    const keys = vi
      .mocked(adjustWalletBalance)
      .mock.calls.map((c) => (c[0] as any).idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(chargedTotal()).toBe(2 * DRAFT_PRICE);
  });
});
