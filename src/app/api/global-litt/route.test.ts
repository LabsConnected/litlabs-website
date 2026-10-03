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
    const mockEq3 = vi.fn().mockReturnValue({ single: mockSingle });
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

  it("creates Global LiTT project if not found", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_456", clerkId: "clerk_456" });

    const mockNewProject = {
      id: "proj-uuid-456",
      name: "Global LiTT",
      slug: "global-litt",
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    };

    // First call: not found (null data)
    // Second call (upsert): creates new project
    let callCount = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "studio_projects") {
        callCount++;
        if (callCount === 1) {
          // Find existing: not found
          const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
          const mockEq3 = vi.fn().mockReturnValue({ single: mockSingle });
          const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
          const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
          return { select: mockSelect } as any;
        } else {
          // Upsert: creates
          const mockSingle = vi.fn().mockResolvedValue({ data: mockNewProject, error: null });
          const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
          const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });
          return { upsert: mockUpsert } as any;
        }
      }
      return {} as any;
    });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project.id).toBe("proj-uuid-456");
  });
});
