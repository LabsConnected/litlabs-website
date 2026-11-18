// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Round 14 — generation job writes must surface failure.
 *
 * updateGenerationJobStatus / updateGenerationJobMetadata used to
 * discard the Supabase result entirely: a failed "completed" flip
 * was indistinguishable from success, so image-service reported a
 * clean completion while the row stayed "processing" — invisible
 * to the project-scope Media repository. The writers now return
 * whether the write landed (and log the error), and the
 * complete/fail wrappers propagate it.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  failUpdates: false,
  failSelects: false,
  adminAvailable: true,
}));

function makeAdmin() {
  return {
    from: () => {
      const filters: Array<[string, unknown]> = [];
      let mode: "select" | "update" | null = null;
      let patch: Row | null = null;

      const matched = (): Row[] =>
        [...state.rows.values()].filter((r) =>
          filters.every(([col, val]) => r[col] === val),
        );

      const chain: Record<string, unknown> = {
        select: () => {
          mode = mode ?? "select";
          return chain;
        },
        update: (p: Row) => {
          mode = "update";
          patch = p;
          return chain;
        },
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return chain;
        },
        maybeSingle: async () => {
          if (state.failSelects) {
            return { data: null, error: { message: "select blew up" } };
          }
          return { data: matched()[0] ?? null, error: null };
        },
        then: (
          onFulfilled: (v: unknown) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => {
          if (mode === "update") {
            if (state.failUpdates) {
              return Promise.resolve({
                data: null,
                error: { message: "update blew up" },
              }).then(onFulfilled, onRejected);
            }
            for (const row of matched()) Object.assign(row, patch);
            return Promise.resolve({ data: null, error: null }).then(
              onFulfilled,
              onRejected,
            );
          }
          return Promise.resolve({ data: matched(), error: null }).then(
            onFulfilled,
            onRejected,
          );
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => (state.adminAvailable ? makeAdmin() : null),
}));

import {
  updateGenerationJobStatus,
  updateGenerationJobMetadata,
  completeGenerationJob,
  failGenerationJob,
  getGenerationJob,
} from "@/lib/generation/jobs";

function seedJob(overrides: Row = {}): Row {
  const row: Row = {
    id: "job_1",
    user_id: "internal_1",
    modality: "image",
    provider: "gemini",
    model: "m",
    status: "processing",
    prompt: "a lion",
    request_id: "op_1",
    provider_job_id: null,
    actual_provider_cost_cents: null,
    littbits_charged: 50,
    refund_status: "none",
    asset_id: null,
    error: null,
    metadata: {},
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
  state.rows.set("job_1", row);
  return row;
}

describe("generation jobs write surfacing (round 14)", () => {
  beforeEach(() => {
    state.rows.clear();
    state.failUpdates = false;
    state.failSelects = false;
    state.adminAvailable = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("updateGenerationJobStatus returns true and applies the patch on success", async () => {
    const row = seedJob();
    const ok = await updateGenerationJobStatus("job_1", "completed", {
      assetId: "generation_job:job_1",
    });
    expect(ok).toBe(true);
    expect(row.status).toBe("completed");
    expect(row.asset_id).toBe("generation_job:job_1");
    expect(row.completed_at).toBeTruthy();
  });

  it("updateGenerationJobStatus returns false when the write errors — the row stays untouched", async () => {
    const row = seedJob();
    state.failUpdates = true;
    const ok = await updateGenerationJobStatus("job_1", "completed", {});
    expect(ok).toBe(false);
    expect(row.status).toBe("processing");
    expect(console.error).toHaveBeenCalled();
  });

  it("completeGenerationJob and failGenerationJob propagate the failure", async () => {
    seedJob();
    state.failUpdates = true;
    await expect(completeGenerationJob("job_1", "generation_job:job_1")).resolves.toBe(false);
    await expect(failGenerationJob("job_1", "boom")).resolves.toBe(false);
    state.failUpdates = false;
    await expect(completeGenerationJob("job_1", "generation_job:job_1")).resolves.toBe(true);
  });

  it("updateGenerationJobMetadata merges and returns true on success", async () => {
    const row = seedJob({ metadata: { operation: "image-service" } });
    const ok = await updateGenerationJobMetadata("job_1", {
      durableUrl: "https://r2/lion.png",
    });
    expect(ok).toBe(true);
    expect(row.metadata).toEqual({
      operation: "image-service",
      durableUrl: "https://r2/lion.png",
    });
  });

  it("updateGenerationJobMetadata returns false when the write errors", async () => {
    seedJob();
    state.failUpdates = true;
    await expect(
      updateGenerationJobMetadata("job_1", { durableUrl: "https://r2/lion.png" }),
    ).resolves.toBe(false);
  });

  it("updateGenerationJobMetadata returns false when the metadata read errors", async () => {
    seedJob();
    state.failSelects = true;
    await expect(
      updateGenerationJobMetadata("job_1", { durableUrl: "https://r2/lion.png" }),
    ).resolves.toBe(false);
  });

  it("writers return false when no admin client is available", async () => {
    seedJob();
    state.adminAvailable = false;
    await expect(updateGenerationJobStatus("job_1", "completed")).resolves.toBe(false);
    await expect(updateGenerationJobMetadata("job_1", {})).resolves.toBe(false);
  });

  it("getGenerationJob reads back the completed row (the read-back §8 relies on)", async () => {
    seedJob();
    await completeGenerationJob("job_1", "generation_job:job_1");
    await updateGenerationJobMetadata("job_1", { durableUrl: "https://r2/lion.png" });
    const job = await getGenerationJob("job_1");
    expect(job?.status).toBe("completed");
    expect(job?.metadata.durableUrl).toBe("https://r2/lion.png");
  });
});
