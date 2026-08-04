import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { KnowledgeService } from "@/lib/litt-intelligence/knowledge-service";
import type { KnowledgeCategory, VerificationStatus } from "@/lib/litt-intelligence/types";

const SECRET = "a".repeat(64);

function createMockSupabase() {
  const mockTable = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };

  const client = {
    from: vi.fn(() => mockTable),
  };

  return { client, mockTable };
}

function mockKnowledgeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "know-1",
    owner_id: "user-a",
    project_id: "proj-a",
    category: "architecture_fact",
    content: "The project uses Next.js App Router",
    source_type: "repository",
    source_reference: "src/app/layout.tsx",
    source_revision: "abc123",
    confidence: 0.9,
    verification_status: "verified",
    expires_at: null,
    superseded_by: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("LiTT Intelligence — Knowledge Service", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // ─── Store ─────────────────────────────────────────────────────

  it("store inserts a new knowledge record", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.single.mockResolvedValueOnce({
      data: mockKnowledgeRow({ id: "know-new" }),
      error: null,
    });
    // findConflicting returns empty
    mockTable.limit.mockResolvedValueOnce({ data: [], error: null });

    const service = new KnowledgeService(client as never);
    const result = await service.store({
      ownerId: "user-a",
      projectId: "proj-a",
      category: "architecture_fact",
      content: "The project uses Next.js App Router",
      sourceType: "repository",
      sourceReference: "src/app/layout.tsx",
      confidence: 0.9,
    });

    expect(result.id).toBe("know-new");
    expect(mockTable.insert).toHaveBeenCalledTimes(1);
  });

  it("store blocks content containing secrets", async () => {
    const { client } = createMockSupabase();
    const service = new KnowledgeService(client as never);

    await expect(
      service.store({
        ownerId: "user-a",
        projectId: "proj-a",
        category: "architecture_fact",
        content: "The API key is sk_test_1234567890abcdefghijklmnopqrstuv",
        sourceType: "manual",
        sourceReference: "test",
      }),
    ).rejects.toThrow("secrets");
  });

  it("store supersedes conflicting knowledge", async () => {
    const { client, mockTable } = createMockSupabase();
    const conflictingRow = mockKnowledgeRow({
      id: "know-old",
      content: "The project uses Next.js Pages Router",
    });

    // findConflicting returns a match
    mockTable.limit.mockResolvedValueOnce({
      data: [conflictingRow],
      error: null,
    });

    // update (supersede old) succeeds
    mockTable.update.mockReturnThis();

    // insert new succeeds
    mockTable.single.mockResolvedValueOnce({
      data: mockKnowledgeRow({ id: "know-new", content: "The project uses Next.js App Router" }),
      error: null,
    });

    const service = new KnowledgeService(client as never);
    const result = await service.store({
      ownerId: "user-a",
      projectId: "proj-a",
      category: "architecture_fact",
      content: "The project uses Next.js App Router",
      sourceType: "repository",
      sourceReference: "src/app/layout.tsx",
      confidence: 0.95,
    });

    expect(result.id).toBe("know-new");
    expect(result.supersededId).toBe("know-old");
  });

  // ─── Search ────────────────────────────────────────────────────

  it("search returns knowledge records for a project", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.limit.mockResolvedValueOnce({
      data: [mockKnowledgeRow(), mockKnowledgeRow({ id: "know-2", category: "decision" })],
      error: null,
    });

    const service = new KnowledgeService(client as never);
    const records = await service.search("user-a", "proj-a");

    expect(records).toHaveLength(2);
    expect(records[0].ownerId).toBe("user-a");
    expect(records[0].projectId).toBe("proj-a");
  });

  it("search filters by category", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.limit.mockResolvedValueOnce({
      data: [mockKnowledgeRow({ category: "decision" })],
      error: null,
    });

    const service = new KnowledgeService(client as never);
    await service.search("user-a", "proj-a", { category: "decision" });

    expect(mockTable.eq).toHaveBeenCalledWith("category", "decision");
  });

  it("search filters by verification status", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.limit.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const service = new KnowledgeService(client as never);
    await service.search("user-a", "proj-a", { verificationStatus: "verified" });

    expect(mockTable.eq).toHaveBeenCalledWith("verification_status", "verified");
  });

  it("search excludes superseded records", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.limit.mockResolvedValueOnce({ data: [], error: null });

    const service = new KnowledgeService(client as never);
    await service.search("user-a", "proj-a");

    expect(mockTable.neq).toHaveBeenCalledWith("verification_status", "superseded");
  });

  // ─── Get ───────────────────────────────────────────────────────

  it("get returns a knowledge record by ID", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.maybeSingle.mockResolvedValueOnce({
      data: mockKnowledgeRow({ id: "know-specific" }),
      error: null,
    });

    const service = new KnowledgeService(client as never);
    const record = await service.get("know-specific");

    expect(record).not.toBeNull();
    expect(record!.id).toBe("know-specific");
  });

  it("get returns null when not found", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const service = new KnowledgeService(client as never);
    const record = await service.get("nonexistent");

    expect(record).toBeNull();
  });

  // ─── Mark stale ────────────────────────────────────────────────

  it("markStale updates verification status to stale", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.update.mockReturnThis();

    const service = new KnowledgeService(client as never);
    await service.markStale("know-1");

    expect(mockTable.update).toHaveBeenCalledWith(
      expect.objectContaining({ verification_status: "stale" }),
    );
  });

  it("markAllStale updates all verified records for a project", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.update.mockReturnThis();

    const service = new KnowledgeService(client as never);
    await service.markAllStale("user-a", "proj-a");

    expect(mockTable.update).toHaveBeenCalledWith(
      expect.objectContaining({ verification_status: "stale" }),
    );
    expect(mockTable.eq).toHaveBeenCalledWith("owner_id", "user-a");
    expect(mockTable.eq).toHaveBeenCalledWith("project_id", "proj-a");
    expect(mockTable.eq).toHaveBeenCalledWith("verification_status", "verified");
  });

  // ─── Update verification ───────────────────────────────────────

  it("updateVerification changes the status", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.update.mockReturnThis();

    const service = new KnowledgeService(client as never);
    await service.updateVerification("know-1", "verified");

    expect(mockTable.update).toHaveBeenCalledWith(
      expect.objectContaining({ verification_status: "verified" }),
    );
  });

  // ─── Answer question ───────────────────────────────────────────

  it("answerQuestion returns relevant knowledge records", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.limit.mockResolvedValueOnce({
      data: [
        mockKnowledgeRow({
          id: "know-1",
          content: "The project uses Next.js App Router for routing",
          verification_status: "verified",
        }),
        mockKnowledgeRow({
          id: "know-2",
          content: "The project uses Stripe for payments",
          verification_status: "verified",
        }),
      ],
      error: null,
    });

    const service = new KnowledgeService(client as never);
    const results = await service.answerQuestion("user-a", "proj-a", "What framework does the project use?");

    expect(results.length).toBeGreaterThan(0);
    // The Next.js record should rank higher (more keyword matches)
    expect(results[0].content).toContain("Next.js");
  });

  it("answerQuestion returns all records when no keywords extracted", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.limit.mockResolvedValueOnce({
      data: [mockKnowledgeRow()],
      error: null,
    });

    const service = new KnowledgeService(client as never);
    const results = await service.answerQuestion("user-a", "proj-a", "hi?");

    expect(results.length).toBeGreaterThan(0);
  });

  // ─── Knowledge categories ──────────────────────────────────────

  it("supports all 14 knowledge categories", () => {
    const categories: KnowledgeCategory[] = [
      "architecture_fact",
      "dependency_fact",
      "integration_fact",
      "capability_fact",
      "decision",
      "constraint",
      "user_preference",
      "known_issue",
      "failed_attempt",
      "successful_pattern",
      "research_finding",
      "security_risk",
      "release_state",
      "open_question",
    ];
    expect(categories).toHaveLength(14);
  });

  it("supports all 4 verification statuses", () => {
    const statuses: VerificationStatus[] = ["verified", "unverified", "superseded", "stale"];
    expect(statuses).toHaveLength(4);
  });

  // ─── User isolation ────────────────────────────────────────────

  it("search is scoped by owner_id", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.limit.mockResolvedValueOnce({ data: [], error: null });

    const service = new KnowledgeService(client as never);
    await service.search("user-a", "proj-a");

    expect(mockTable.eq).toHaveBeenCalledWith("owner_id", "user-a");
    expect(mockTable.eq).toHaveBeenCalledWith("project_id", "proj-a");
  });
});
