/**
 * Signed-out LOCAL requests blocked by the capability gate must name the
 * real cause — the local model lane — not tell the operator to sign in.
 *
 * Bug (2026-10-18): with Ollama unreachable, a signed-out LOCAL request got
 * "This request requires LiTT cloud/model access. Sign in (`litt login`)…".
 * The gate only blocks signed-out LOCAL requests when no local model is
 * available, so signing in was never the fix; starting Ollama was.
 */

import { describe, it, expect } from "vitest";
import { localModelGateMessage } from "../lib/capability-gate.js";

describe("localModelGateMessage", () => {
  it("names the unreachable endpoint and does not demand sign-in", () => {
    const msg = localModelGateMessage({
      available: false,
      models: [],
      endpoint: "http://127.0.0.1:11435",
      reason: "Ollama unreachable at http://127.0.0.1:11435",
    });
    expect(msg).toContain("Local model unavailable");
    expect(msg).toContain("Ollama unreachable at http://127.0.0.1:11435");
    expect(msg).toContain("ollama serve");
    expect(msg).not.toMatch(/requires LiTT cloud/i);
    expect(msg).not.toMatch(/^Sign in/m);
  });

  it("points at LITT_OLLAMA_URL so a non-default endpoint can be configured", () => {
    const msg = localModelGateMessage({ available: false, models: [], endpoint: "http://localhost:11434", reason: "connection refused" });
    expect(msg).toContain("LITT_OLLAMA_URL");
  });

  it("covers a reachable daemon with no models installed", () => {
    const msg = localModelGateMessage({ available: false, models: [], endpoint: "http://127.0.0.1:11435", reason: "Ollama has no models installed" });
    expect(msg).toContain("Ollama has no models installed");
    expect(msg).toContain("ollama pull");
  });

  it("keeps the list of capabilities that work without auth", () => {
    const msg = localModelGateMessage({ available: false, models: [], endpoint: "http://127.0.0.1:11435", reason: "x" });
    expect(msg).toContain("/local");
    expect(msg).toContain("local tools");
  });

  it("falls back to a generic reason when the probe gave none", () => {
    const msg = localModelGateMessage(null);
    expect(msg).toContain("Local model unavailable");
    expect(msg).not.toMatch(/requires LiTT cloud/i);
  });
});
