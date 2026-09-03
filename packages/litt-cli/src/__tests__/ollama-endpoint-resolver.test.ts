/**
 * Regression tests for the shared canonical Ollama endpoint resolver.
 *
 * Tests the resolveLocalLaneEndpoint() function which delegates to the
 * ONE shared resolver in @litt/models with precedence:
 *   LITT_OLLAMA_URL > OLLAMA_HOST_PC > OLLAMA_HOST > OLLAMA_BASE_URL > localhost default.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveLocalLaneEndpoint, probeLocalLane, resetLocalLaneCache } from "../lib/local-lane.js";

beforeEach(() => {
  delete process.env.LITT_OLLAMA_URL;
  delete process.env.OLLAMA_HOST_PC;
  delete process.env.OLLAMA_HOST;
  delete process.env.OLLAMA_BASE_URL;
  resetLocalLaneCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetLocalLaneCache();
});

describe("resolveLocalLaneEndpoint — canonical resolver precedence", () => {
  it("1. no env -> localhost default", () => {
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://localhost:11434");
  });

  it("2. LITT_OLLAMA_URL remote/LAN host wins", () => {
    process.env.LITT_OLLAMA_URL = "http://192.168.0.77:11434";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://192.168.0.77:11434");
  });

  it("3. LITT_OLLAMA_URL bare host:port normalization", () => {
    process.env.LITT_OLLAMA_URL = "192.168.0.77:11434";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://192.168.0.77:11434");
  });

  it("4. OLLAMA_HOST bare host:port", () => {
    process.env.OLLAMA_HOST = "192.168.0.77:11434";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://192.168.0.77:11434");
  });

  it("5. OLLAMA_BASE_URL compatibility alias", () => {
    process.env.OLLAMA_BASE_URL = "http://192.168.0.77:11434";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://192.168.0.77:11434");
  });

  it("6. LITT_OLLAMA_URL wins over OLLAMA_BASE_URL", () => {
    process.env.LITT_OLLAMA_URL = "http://192.168.0.77:11434";
    process.env.OLLAMA_BASE_URL = "http://10.0.0.1:11434";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://192.168.0.77:11434");
  });

  it("7. LITT_OLLAMA_URL wins over OLLAMA_HOST", () => {
    process.env.LITT_OLLAMA_URL = "http://192.168.0.77:11434";
    process.env.OLLAMA_HOST = "10.0.0.1:11434";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://192.168.0.77:11434");
  });

  it("8. trailing slash is stripped", () => {
    process.env.LITT_OLLAMA_URL = "http://192.168.0.77:11434/";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://192.168.0.77:11434");
  });

  it("9. https:// URL is preserved as-is", () => {
    process.env.LITT_OLLAMA_URL = "https://192.168.0.77:11434";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("https://192.168.0.77:11434");
  });
});

describe("probeLocalLane — integration with resolver", () => {
  it("10. signed-out probe succeeds when remote Ollama endpoint is healthy", async () => {
    process.env.LITT_OLLAMA_URL = "http://192.168.0.77:11434";

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ model: "qwen3:4b" }, { model: "llama3.2:3b" }] }),
    } as unknown as Response);

    const status = await probeLocalLane({ fetchImpl: mockFetch, force: true });
    expect(status.available).toBe(true);
    expect(status.models).toHaveLength(2);
    expect(status.endpoint).toBe("http://192.168.0.77:11434");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://192.168.0.77:11434/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("11. unreachable endpoint does not become routable", async () => {
    process.env.LITT_OLLAMA_URL = "http://10.255.255.1:11434";

    const mockFetch = vi.fn().mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    const status = await probeLocalLane({ fetchImpl: mockFetch, force: true });
    expect(status.available).toBe(false);
    expect(status.reason).toContain("not reachable at http://10.255.255.1:11434");
  });

  it("12. localhost default when no env set", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ model: "qwen3:4b" }] }),
    } as unknown as Response);

    const status = await probeLocalLane({ fetchImpl: mockFetch, force: true });
    expect(status.endpoint).toBe("http://localhost:11434");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("resolveLocalLaneEndpoint — provider registry consistency", () => {
  it("13. resolver overrides PROVIDERS modelsUrl when LITT_OLLAMA_URL set", () => {
    process.env.LITT_OLLAMA_URL = "http://192.168.0.77:11434";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://192.168.0.77:11434");
    expect(endpoint).not.toBe("http://localhost:11434");
  });
});

describe("resolveLocalLaneEndpoint — edge cases", () => {
  it("14. empty string env var falls through to next precedence", () => {
    process.env.LITT_OLLAMA_URL = "";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://localhost:11434");
  });

  it("15. OLLAMA_HOST takes precedence over default when LITT_OLLAMA_URL empty", () => {
    process.env.LITT_OLLAMA_URL = "";
    process.env.OLLAMA_HOST = "172.16.0.1:11434";
    const endpoint = resolveLocalLaneEndpoint();
    expect(endpoint).toBe("http://172.16.0.1:11434");
  });
});
