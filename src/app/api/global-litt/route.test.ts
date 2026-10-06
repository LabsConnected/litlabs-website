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

const INTERNAL_UUID = "11111111-2222-3333-4444-555555555555";
const CLERK_ID = "user_test123";

/** Mock for from("users") — resolves the Clerk ID to the internal UUID. */
function mockUsersTable(userId: string | null = INTERNAL_UUID) {
  const mockSingle = vi.fn().mockResolvedValue({
    data: userId ? { id: userId } : null,
    error: null,
  });
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  return { select: mockSelect, _eq: mockEq, _single: mockSingle };
}

/** Mock for a studio_projects SELECT chain (find existing). */
function mockFindProject(project: Record<string, unknown> | null, error: unknown = null) {
  const mockSingle = vi.fn().mockResolvedValue({ data: project, error });
  const mockEq3 = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
  const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
  const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
  return { select: mockSelect, _eq1: mockEq1, _eq2: mockEq2, _eq3: mockEq3 };
}

/** Mock for a studio_projects INSERT chain. */
function mockInsertProject(project: Record<string, unknown> | null, error: unknown = null) {
  const mockSingle = vi.fn().mockResolvedValue({ data: project, error });
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
  return { insert: mockInsert, _insert: mockInsert };
}

describe("GET /api/global-litt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: CLERK_ID, clerkId: CLERK_ID });
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null, clerkId: null });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 when the user has no users row (not provisioned)", async () => {
    const users = mockUsersTable(null);
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return users as any;
      throw new Error(`unexpected table: ${table}`);
    });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("User not provisioned");
    expect(data.project).toBeNull();
  });

  it("resolves the Clerk ID to the internal UUID before querying projects", async () => {
    const users = mockUsersTable(INTERNAL_UUID);
    const find = mockFindProject({
      id: "proj-uuid-123",
      name: "Global LiTT",
      slug: "global-litt",
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    });
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return users as any;
      if (table === "studio_projects") return find as any;
      throw new Error(`unexpected table: ${table}`);
    });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(200);
    // The users lookup used the Clerk ID…
    expect(users._eq).toHaveBeenCalledWith("clerk_id", CLERK_ID);
    // …and the project lookup used the resolved UUID, NOT the Clerk ID.
    expect(find._eq1).toHaveBeenCalledWith("user_id", INTERNAL_UUID);
    expect(find._eq1).not.toHaveBeenCalledWith("user_id", CLERK_ID);
  });

  it("returns existing Global LiTT project if found", async () => {
    const users = mockUsersTable(INTERNAL_UUID);
    const mockProject = {
      id: "proj-uuid-123",
      name: "Global LiTT",
      slug: "global-litt",
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    };
    const find = mockFindProject(mockProject);
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return users as any;
      if (table === "studio_projects") return find as any;
      throw new Error(`unexpected table: ${table}`);
    });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project.id).toBe("proj-uuid-123");
    expect(data.project.name).toBe("Global LiTT");
  });

  it("creates Global LiTT project with the UUID user_id (INSERT, not upsert)", async () => {
    const users = mockUsersTable(INTERNAL_UUID);
    const mockNewProject = {
      id: "proj-uuid-456",
      name: "Global LiTT",
      slug: "global-litt",
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    };

    let callCount = 0;
    let insertedRow: Record<string, unknown> | null = null;
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return users as any;
      if (table === "studio_projects") {
        callCount++;
        if (callCount === 1) {
          return mockFindProject(null) as any; // not found
        }
        // INSERT (not upsert): capture the row to verify user_id
        const mockSingle = vi.fn().mockResolvedValue({ data: mockNewProject, error: null });
        const mockSelect = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
        const mockInsert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
          insertedRow = row;
          return { select: mockSelect };
        });
        const mockUpsert = vi.fn().mockImplementation(() => {
          throw new Error("upsert should not be used with partial unique index");
        });
        return { insert: mockInsert, upsert: mockUpsert } as any;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project.id).toBe("proj-uuid-456");
    // The INSERT used the internal UUID, not the Clerk ID
    expect(insertedRow).not.toBeNull();
    expect(insertedRow!.user_id).toBe(INTERNAL_UUID);
    expect(insertedRow!.user_id).not.toBe(CLERK_ID);
  });

  it("handles concurrent creation via 23505: fetches existing instead of failing", async () => {
    const users = mockUsersTable(INTERNAL_UUID);
    const mockExistingProject = {
      id: "proj-uuid-789",
      name: "Global LiTT",
      slug: "global-litt",
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    };

    let callCount = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return users as any;
      if (table === "studio_projects") {
        callCount++;
        if (callCount === 1) {
          return mockFindProject(null) as any; // race window: not found
        } else if (callCount === 2) {
          // INSERT fails with 23505 (concurrent request won the race)
          return mockInsertProject(null, {
            code: "23505",
            message: "duplicate key value violates unique constraint",
          }) as any;
        }
        // Fetch existing (the winner's row)
        return mockFindProject(mockExistingProject) as any;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project.id).toBe("proj-uuid-789");
  });

  it("does not swallow unrelated database errors", async () => {
    const users = mockUsersTable(INTERNAL_UUID);
    let callCount = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return users as any;
      if (table === "studio_projects") {
        callCount++;
        if (callCount === 1) {
          return mockFindProject(null) as any;
        }
        // INSERT fails with a NON-23505 error (e.g., connection issue)
        return mockInsertProject(null, {
          code: "08006",
          message: "connection failure",
        }) as any;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const req = new NextRequest("http://localhost/api/global-litt");
    const res = await GET(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("connection failure");
  });
});

describe("Global LiTT lookup failures", () => {
  it("does not INSERT after a failed lookup", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: CLERK_ID, clerkId: CLERK_ID });
    const users = mockUsersTable(INTERNAL_UUID);
    const insert = vi.fn();
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: null, error: { code: "08006", message: "connection failure" } }),
      insert,
    };
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return users as any;
      return chain;
    });
    const response = await GET(new NextRequest("http://localhost/api/global-litt"));
    expect(response.status).toBe(500);
    expect(insert).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "connection failure" });
  });

  it("does not query projects when the users lookup fails", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: CLERK_ID, clerkId: CLERK_ID });
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "08006", message: "connection failure" },
    });
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const projectFrom = vi.fn();
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") return { select: mockSelect } as any;
      projectFrom(table);
      throw new Error(`unexpected table: ${table}`);
    });
    const response = await GET(new NextRequest("http://localhost/api/global-litt"));
    expect(response.status).toBe(500);
    expect(projectFrom).not.toHaveBeenCalled();
  });
});
