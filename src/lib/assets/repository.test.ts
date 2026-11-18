import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Asset Lake repository — project scope must include generation_jobs
 * (round 10, diagnosis Q3a).
 *
 * image.generate persists exactly one record: a generation_jobs row
 * whose metadata.projectId binds it to the project. It never writes a
 * project_assets row. listStudioAssets used to consult generation_jobs
 * only under scope user/all, so the board Media panel — which reads
 * with scope "project" — could never display an agent-generated image
 * even in a perfect run. These tests pin the merge: a completed job
 * bound to the project appears under scope=project; jobs bound to
 * other projects and unbound jobs do not; user/all behavior is
 * unchanged.
 */

type Row = Record<string, unknown>;

const PROJECT_ID = "proj-1";
const INTERNAL_USER_ID = "user-internal-1";

function jobRow(overrides: Row): Row {
  return {
    id: "job-x",
    user_id: INTERNAL_USER_ID,
    modality: "image",
    provider: "pollinations",
    model: "flux",
    status: "completed",
    prompt: "a lion",
    request_id: "req-x",
    provider_job_id: null,
    actual_provider_cost_cents: null,
    littbits_charged: 0,
    refund_status: "none",
    asset_id: null,
    error: null,
    metadata: { durableUrl: "https://cdn.test/x.png", contentType: "image/png" },
    created_at: "2026-11-16T20:00:00.000Z",
    completed_at: "2026-11-16T20:00:05.000Z",
    ...overrides,
  };
}

const tables: Record<string, Row[]> = {
  users: [{ id: INTERNAL_USER_ID, clerk_id: "clerk-1" }],
  generation_jobs: [
    jobRow({
      id: "job-lion",
      metadata: {
        projectId: PROJECT_ID,
        durableUrl: "https://cdn.test/lion.png",
        contentType: "image/png",
      },
    }),
    jobRow({
      id: "job-other-project",
      metadata: {
        projectId: "proj-2",
        durableUrl: "https://cdn.test/other.png",
        contentType: "image/png",
      },
    }),
    jobRow({
      id: "job-unbound",
      metadata: { durableUrl: "https://cdn.test/unbound.png", contentType: "image/png" },
    }),
  ],
  user_media: [],
  music_tracks: [],
};

/** Minimal chainable Supabase stub: select/eq/order/limit + awaitable. */
function makeQuery(table: string) {
  const filters: Array<[string, unknown]> = [];
  const applyFilters = () =>
    (tables[table] ?? []).filter((row) =>
      filters.every(([col, val]) => row[col] === val),
    );
  const query = {
    select: () => query,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return query;
    },
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: applyFilters()[0] ?? null, error: null }),
    then: (
      onFulfilled: (value: { data: Row[]; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: applyFilters(), error: null }).then(onFulfilled, onRejected),
  };
  return query;
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (table: string) => makeQuery(table) },
}));
vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(async () => ({ id: PROJECT_ID })),
}));
vi.mock("@/lib/visual-builds/repository", () => ({
  listProjectAssets: vi.fn(async () => []),
}));

import { listStudioAssets } from "@/lib/assets/repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listStudioAssets — generation_jobs under scope=project (round 10 Q3a)", () => {
  it("a completed image job bound to the project appears under scope=project", async () => {
    const { assets, error } = await listStudioAssets({
      clerkId: "clerk-1",
      projectId: PROJECT_ID,
      scope: "project",
    });
    expect(error).toBeNull();
    const lion = assets.find((a) => a.id === "generation_job:job-lion");
    expect(lion).toBeDefined();
    expect(lion?.projectId).toBe(PROJECT_ID);
    expect(lion?.kind).toBe("image");
    expect(lion?.url).toBe("https://cdn.test/lion.png");
  });

  it("jobs bound to another project and unbound jobs stay out of the project surface", async () => {
    const { assets } = await listStudioAssets({
      clerkId: "clerk-1",
      projectId: PROJECT_ID,
      scope: "project",
    });
    expect(assets.map((a) => a.id)).not.toContain("generation_job:job-other-project");
    expect(assets.map((a) => a.id)).not.toContain("generation_job:job-unbound");
  });

  it("scope=user still returns the user's jobs, bound and unbound (no regression)", async () => {
    const { assets } = await listStudioAssets({ clerkId: "clerk-1", scope: "user" });
    expect(assets.map((a) => a.id)).toEqual(
      expect.arrayContaining([
        "generation_job:job-lion",
        "generation_job:job-other-project",
        "generation_job:job-unbound",
      ]),
    );
  });

  it("scope=all with a projectId returns the bound job exactly once", async () => {
    const { assets } = await listStudioAssets({
      clerkId: "clerk-1",
      projectId: PROJECT_ID,
      scope: "all",
    });
    expect(assets.filter((a) => a.id === "generation_job:job-lion")).toHaveLength(1);
    // The all+projectId path keeps its existing strictness: jobs bound
    // elsewhere and unbound jobs are filtered by the project scope.
    expect(assets.map((a) => a.id)).not.toContain("generation_job:job-other-project");
  });
});
