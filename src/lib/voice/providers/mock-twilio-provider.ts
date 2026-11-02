import type { CallProvider, PlaceCallParams, PlaceCallResult } from "./call-provider";

/**
 * Phase 1 only. Never performs a network call or talks to Twilio — records
 * every placeCall() invocation in-memory so tests and the mock end-to-end
 * script can assert on what would have been dialed, without dialing it.
 */
export class MockTwilioProvider implements CallProvider {
  private calls: PlaceCallParams[] = [];

  async placeCall(params: PlaceCallParams): Promise<PlaceCallResult> {
    this.calls.push(params);
    return { providerCallId: `mock-${this.calls.length}-${Date.now()}-${Math.random().toString(36).slice(2)}`, status: "queued" };
  }

  getCalls(): PlaceCallParams[] {
    return this.calls;
  }
}
