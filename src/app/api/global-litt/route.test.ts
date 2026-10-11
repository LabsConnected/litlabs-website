import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock auth
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

// Mock supabase
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { GET } from "@/app/api/global-litt/route";

describe("GET /api/global-litt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null, clerkId: null });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns existing Global LiTT project if found", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" });

    const mockProject = {
      id: "proj-uuid-123",
      name: "Global LiTT",
      slug: "global-litt",
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    };

    const mockSingle = vi.fn().mockResolvedValue({ data: mockProject, error: null });
    const mockEq3 = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
    const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
    vi.mocked(supabaseAdmin.from).mockReturnValue({ select: mockSelect } as any);

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project.id).toBe("proj-uuid-123");
    expect(data.project.name).toBe("Global LiTT");
  });

  it("creates Global LiTT project if not found (INSERT, not upsert)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_456", clerkId: "clerk_456" });

    const mockNewProject = {
      id: "proj-uuid-456",
      name: "Global LiTT",
      slug: "global-litt",
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    };

    // First call: not found (null data)
    // Second call (insert): creates new project
    let callCount = 0;
    let usedInsert = false;
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "studio_projects") {
        callCount++;
        if (callCount === 1) {
          // Find existing: not found
          const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
          const mockEq3 = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
          const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
          const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
          return { select: mockSelect } as any;
        } else {
          // INSERT (not upsert): creates
          const mockSingle = vi.fn().mockResolvedValue({ data: mockNewProject, error: null });
          const mockSelect = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
          const mockInsert = vi.fn().mockImplementation(() => {
            usedInsert = true;
            return { select: mockSelect };
          });
          // Ensure upsert is NOT used (would fail on partial index)
          const mockUpsert = vi.fn().mockImplementation(() => {
            throw new Error("upsert should not be used with partial unique index");
          });
          return { insert: mockInsert, upsert: mockUpsert } as any;
        }
      }
      return {} as any;
    });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project.id).toBe("proj-uuid-456");
    expect(usedInsert).toBe(true);
  });

  it("handles concurrent creation via 23505: fetches existing instead of failing", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_789", clerkId: "clerk_789" });

    const mockExistingProject = {
      id: "proj-uuid-789",
      name: "Global LiTT",
      slug: "global-litt",
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    };

    let callCount = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "studio_projects") {
        callCount++;
        if (callCount === 1) {
          // Find existing: not found (race window)
          const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
          const mockEq3 = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
          const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
          const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
          return { select: mockSelect } as any;
        } else if (callCount === 2) {
          // INSERT fails with 23505 (concurrent request won the race)
          const mockSingle = vi.fn().mockResolvedValue({
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          });
          const mockSelect = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
          const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
          return { insert: mockInsert } as any;
        } else {
          // Fetch existing (the winner's row)
          const mockSingle = vi.fn().mockResolvedValue({ data: mockExistingProject, error: null });
          const mockEq3 = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
          const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
          const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
          return { select: mockSelect } as any;
        }
      }
      return {} as any;
    });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    // Returns the existing project (from the concurrent winner), not an error
    expect(data.project.id).toBe("proj-uuid-789");
  });

  it("does not swallow unrelated database errors", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_999", clerkId: "clerk_999" });

    let callCount = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "studio_projects") {
        callCount++;
        if (callCount === 1) {
          const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
          const mockEq3 = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
          const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
          const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
          return { select: mockSelect } as any;
        } else {
          // INSERT fails with a NON-23505 error (e.g., connection issue)
          const mockSingle = vi.fn().mockResolvedValue({
            data: null,
            error: { code: "08006", message: "connection failure" },
          });
          const mockSelect = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
          const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
          return { insert: mockInsert } as any;
        }
      }
      return {} as any;
    });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    // Should return 500, not silently succeed
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("connection failure");
  });
});


describe("Global LiTT lookup failures", () => {
  it("does not INSERT after a failed lookup", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" });
    const insert = vi.fn();
    const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: { code: "08006", message: "connection failure" } }), insert };
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);
    const response = await GET(new NextRequest("http://localhost/api/global-litt"));
    expect(response.status).toBe(500);
    expect(insert).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "connection failure" });
  });
});
