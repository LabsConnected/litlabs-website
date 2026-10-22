import { describe, it, expect, vi } from "vitest";
import { verifyNumberOwnership, type TwilioNumberLookupClient } from "./twilio-number-lookup";

function makeFakeClient(numbers: Array<{ phoneNumber: string; sid?: string; voice?: boolean; sms?: boolean; mms?: boolean }>): TwilioNumberLookupClient {
  return {
    async listIncomingPhoneNumbers() {
      return numbers.map((n) => ({
        sid: n.sid ?? "PNfake",
        phoneNumber: n.phoneNumber,
        capabilities: { voice: n.voice ?? true, sms: n.sms ?? false, mms: n.mms ?? false },
      }));
    },
  };
}

describe("verifyNumberOwnership", () => {
  it("reports owned=true with capabilities when the number is found", async () => {
    const client = makeFakeClient([{ phoneNumber: "+18772838063", voice: true, sms: false, mms: false }]);
    const result = await verifyNumberOwnership(client, "+18772838063");
    expect(result).toEqual({ owned: true, capabilities: { voice: true, sms: false, mms: false } });
  });

  it("reports owned=false, not_found when the account has no matching number", async () => {
    const client = makeFakeClient([]);
    const result = await verifyNumberOwnership(client, "+18772838063");
    expect(result).toEqual({ owned: false, reason: "not_found" });
  });

  it("does not match a different number than the one requested", async () => {
    const client = makeFakeClient([{ phoneNumber: "+19998887777" }]);
    const result = await verifyNumberOwnership(client, "+18772838063");
    expect(result).toEqual({ owned: false, reason: "not_found" });
  });

  it("fails closed (owned=false) when the lookup itself throws", async () => {
    const client: TwilioNumberLookupClient = {
      listIncomingPhoneNumbers: vi.fn().mockRejectedValue(new Error("network error")),
    };
    const result = await verifyNumberOwnership(client, "+18772838063");
    expect(result).toEqual({ owned: false, reason: "lookup_failed" });
  });

  it("finds the toll-free number among several numbers on the account (realistic multi-number response)", async () => {
    // Shaped like Twilio's real IncomingPhoneNumberInstance list response:
    // an account typically has more than one number, and the target may not
    // be first in the list.
    const client = makeFakeClient([
      { phoneNumber: "+15555550100", voice: true, sms: true, mms: true },
      { phoneNumber: "+18772838063", sid: "PNrealtollfree", voice: true, sms: false, mms: false },
      { phoneNumber: "+15555550199", voice: false, sms: true, mms: false },
    ]);
    const result = await verifyNumberOwnership(client, "+18772838063");
    expect(result).toEqual({ owned: true, capabilities: { voice: true, sms: false, mms: false } });
  });

  it("never calls anything beyond the injected client (no real network/SDK import)", async () => {
    const spy = vi.fn().mockResolvedValue([{ sid: "PN1", phoneNumber: "+18772838063", capabilities: { voice: true, sms: false, mms: false } }]);
    const client: TwilioNumberLookupClient = { listIncomingPhoneNumbers: spy };
    await verifyNumberOwnership(client, "+18772838063");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("+18772838063");
  });
});
