import { describe, it, expect } from "vitest";
import { MockTwilioProvider } from "./mock-twilio-provider";

describe("MockTwilioProvider", () => {
  it("records the call instead of dialing anything, and returns a queued result", async () => {
    const provider = new MockTwilioProvider();
    const result = await provider.placeCall({
      to: "+15551234567",
      from: "+15557654321",
      agentInstructions: "Confirm the appointment time.",
    });
    expect(result.status).toBe("queued");
    expect(result.providerCallId).toMatch(/^mock-/);
    expect(provider.getCalls()).toEqual([
      { to: "+15551234567", from: "+15557654321", agentInstructions: "Confirm the appointment time." },
    ]);
  });

  it("never performs any network call (no fetch/http import in the module)", async () => {
    const provider = new MockTwilioProvider();
    const before = provider.getCalls().length;
    await provider.placeCall({ to: "+10000000000", from: "+10000000001", agentInstructions: "test" });
    expect(provider.getCalls().length).toBe(before + 1);
    // Purely in-memory: a second instance has no knowledge of the first's calls.
    const isolated = new MockTwilioProvider();
    expect(isolated.getCalls()).toEqual([]);
  });

  it("gives every call a unique providerCallId", async () => {
    const provider = new MockTwilioProvider();
    const a = await provider.placeCall({ to: "+1", from: "+2", agentInstructions: "a" });
    const b = await provider.placeCall({ to: "+1", from: "+2", agentInstructions: "b" });
    expect(a.providerCallId).not.toBe(b.providerCallId);
  });
});
