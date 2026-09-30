// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), charge: vi.fn(), emit: vi.fn() }));
vi.mock("@/lib/metered-llm-call", () => ({ assertSpendAuthorized: mocks.authorize }));
vi.mock("@/lib/llm-billing", () => ({ chargeLlmUsage: mocks.charge }));
vi.mock("@/lib/metering", () => ({ emitLlmMetering: mocks.emit }));
import { meteredProviderCall } from "./metered-provider-call";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true, billingExempt: false });
  mocks.charge.mockResolvedValue({ debited: true });
});
function call(execute = vi.fn().mockResolvedValue({ text: "result" })) {
  return meteredProviderCall({ clerkId: "user-test", feature: "media-analyze", provider: "gemini",
    model: "gemini-2.5-flash", callId: "logical-action", execute,
    usage: () => ({ promptTokens: 12, completionTokens: 8 }),
  });
}
describe("SDK provider billing adapter", () => {
  it("blocks insufficient balance before provider execution", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 402, error: "Insufficient LiTTBits" });
    const execute = vi.fn();
    expect(await call(execute)).toMatchObject({ ok: false, status: 402 });
    expect(execute).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.charge).not.toHaveBeenCalled();
  });
  it("authorizes before spend and links one charge to the provider event", async () => {
    const execute = vi.fn().mockResolvedValue({ text: "result" });
    expect(await call(execute)).toMatchObject({ ok: true });
    expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]);
    expect(mocks.emit).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ status: "success", inputTokens: 12,
      outputTokens: 8, originalRequestId: "logical-action", idempotencyKey: "metering:llm:logical-action:0" }));
    expect(mocks.charge).toHaveBeenCalledTimes(1);
    expect(mocks.charge).toHaveBeenCalledWith(expect.objectContaining({ meteringBillableKey: "metering:llm:logical-action:0" }));
  });
  it("records a failed attempt without charging", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("provider timeout"));
    await expect(call(execute)).rejects.toThrow("provider timeout");
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", billable: false }));
    expect(mocks.charge).not.toHaveBeenCalled();
  });
  it("keeps provider success truthful when the debit fails", async () => {
    mocks.charge.mockResolvedValue({ error: "Insufficient LiTTBits" });
    expect(await call()).toMatchObject({ ok: false, status: 402 });
    expect(mocks.emit).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
  });
  it("fails closed on a billing service error without exposing diagnostics", async () => {
    mocks.charge.mockResolvedValue({ error: "internal database diagnostic" });
    expect(await call()).toEqual({ ok: false, status: 503, error: "Billing service unavailable" });
  });
});
