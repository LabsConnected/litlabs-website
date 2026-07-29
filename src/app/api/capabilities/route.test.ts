import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase admin
const mockChainFull = (resolveData: unknown) => ({
  select: () => ({
    eq: () => ({
      order: () => ({
        limit: () => Promise.resolve({ data: resolveData }),
      }),
    }),
  }),
});

const mockChainShort = (resolveData: unknown) => ({
  select: () => ({
    eq: () => Promise.resolve({ data: resolveData }),
  }),
});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === "github_installations") {
        return mockChainShort([{ installation_id: 12345 }]);
      }
      if (table === "projects") {
        return mockChainFull([
          {
            id: "proj-123",
            name: "litlabs-website",
            repository_full_name: "litlabs/litlabs-website",
            default_branch: "main",
            connection_status: "connected",
          },
        ]);
      }
      return mockChainShort([]);
    }),
  },
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "user-123" })),
}));

describe("/api/capabilities route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns projectId in the repository capability", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    const data = await response.json();

    const repoCap = data.capabilities.find(
      (c: { id: string }) => c.id === "repository",
    );
    expect(repoCap).toBeDefined();
    expect(repoCap.projectId).toBe("proj-123");
    expect(repoCap.projectName).toBe("litlabs-website");
    expect(repoCap.defaultBranch).toBe("main");
    expect(repoCap.status).toBe("ready");
    expect(repoCap.accountName).toBe("litlabs/litlabs-website");
  });
});
