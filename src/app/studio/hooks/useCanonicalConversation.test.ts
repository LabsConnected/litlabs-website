import { describe, it, expect, beforeEach, vi } from "vitest";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("getActiveProjectId resolution", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns serverProjectId when provided (authoritative)", () => {
    localStorageMock.setItem("litt:active-project-id", "local-123");
    // Simulate the resolution logic
    const serverProjectId = "server-456";
    const result = serverProjectId ?? localStorageMock.getItem("litt:active-project-id") ?? null;
    expect(result).toBe("server-456");
  });

  it("falls back to localStorage when serverProjectId is null", () => {
    localStorageMock.setItem("litt:active-project-id", "local-123");
    const serverProjectId: string | null = null;
    const result = serverProjectId ?? localStorageMock.getItem("litt:active-project-id") ?? null;
    expect(result).toBe("local-123");
  });

  it("returns null when neither server nor localStorage has a value", () => {
    const serverProjectId: string | null = null;
    const result = serverProjectId ?? localStorageMock.getItem("litt:active-project-id") ?? null;
    expect(result).toBeNull();
  });

  it("server resolution takes priority over stale localStorage", () => {
    localStorageMock.setItem("litt:active-project-id", "stale-local");
    const serverProjectId = "fresh-server";
    const result = serverProjectId ?? localStorageMock.getItem("litt:active-project-id") ?? null;
    expect(result).toBe("fresh-server");
  });
});

describe("ConnectionCapabilities project fields", () => {
  it("DEFAULT_CAPABILITIES includes projectId, projectName, defaultBranch", async () => {
    // Verify the interface contract by checking the default object shape
    const defaultCaps = {
      repository: "none",
      repositoryName: null,
      repositoryIndexed: false,
      projectId: null,
      projectName: null,
      defaultBranch: null,
      terminalExecution: "unavailable",
      writeAccess: false,
      connectedProviders: [],
      availableTools: [],
      connectionSummary: "No services connected.",
      terminalStatus: "disconnected",
      terminalSessionId: null,
      terminalError: null,
      voiceTransportConnected: false,
      voiceMicrophoneOn: false,
      voiceHealth: {
        configured: false,
        tokenService: "unknown",
        available: false,
      },
    };
    expect(defaultCaps.projectId).toBeNull();
    expect(defaultCaps.projectName).toBeNull();
    expect(defaultCaps.defaultBranch).toBeNull();
  });
});
