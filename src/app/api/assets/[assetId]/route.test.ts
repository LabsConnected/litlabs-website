// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for DELETE /api/assets/[assetId] — the real delete path the
 * Studio Media panel's click-to-manage flow calls (Amendment 6).
 * The Supabase mock is an in-memory row store: a successful DELETE
 * must remove the underlying source row, and a repeat DELETE (the
 * equivalent of a refetch) must find nothing.
 */

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}));

function matches(row: Record<string, unknown>, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([k, v]) => row[k] === v);
}

function makeBuilder(table: string) {
  const state: { op: string | null; filters: Record<string, unknown> } = {
    op: null,
    filters: {},
  };
  const rows = () => (db.tables[table] ??= []);
  const builder: Record<string, unknown> = {
    select() {
      if (!state.op) state.op = "select";
      return builder;
    },
    delete() {
      state.op = "delete";
      return builder;
    },
    eq(key: string, value: unknown) {
      state.filters[key] = value;
      return builder;
    },
    maybeSingle: async () => {
      const row = rows().find((r) => matches(r, state.filters));
      return { data: row ?? null, error: null };
    },
    then(resolve: (v: unknown) => void) {
      if (state.op === "delete") {
        const matched = rows().filter((r) => matches(r, state.filters));
        db.tables[table] = rows().filter((r) => !matches(r, state.filters));
        resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
        return;
      }
      resolve({ data: rows().filter((r) => matches(r, state.filters)), error: null });
    },
  };
  return builder;
}

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));
vi.mock("@/lib/projects/project-repository", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/r2", () => ({ deleteAudio: vi.fn(async () => ({ deleted: true })) }));

import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { DELETE } from "./route";

function req(assetId: string, query = ""): [NextRequest, { params: Promise<{ assetId: string }> }] {
  return [
    new NextRequest(`https://www.litlabs.net/api/assets/${encodeURIComponent(assetId)}${query}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ assetId }) },
  ];
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ userId: "clerk-1" } as never);
  vi.mocked(getProject).mockImplementation(async (projectId: string) =>
    projectId === "project-1" ? ({ id: "project-1" } as never) : null,
  );
  db.tables = {
    users: [{ id: "u-1", clerk_id: "clerk-1" }],
    generation_jobs: [{ id: "job-1", user_id: "u-1" }],
    user_media: [
      { id: "media-1", user_id: "u-1" },
      { id: "media-2", user_id: "someone-else" },
    ],
    project_assets: [{ id: "pa-1", project_id: "project-1" }],
    music_tracks: [{ id: "track-1", user_id: "u-1", audio_storage_key: "u-1/track-1.mp3" }],
  };
});

describe("DELETE /api/assets/[assetId]", () => {
  it("requires authentication", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const [r, ctx] = req("generation_job:job-1");
    const res = await DELETE(r, ctx);
    expect(res.status).toBe(401);
    expect(db.tables.generation_jobs).toHaveLength(1);
  });

  it("rejects a malformed asset id", async () => {
    const [r, ctx] = req("no-prefix-here");
    const res = await DELETE(r, ctx);
    expect(res.status).toBe(400);
  });

  it("deletes a generation_job row for real — a repeat delete finds nothing", async () => {
    const [r, ctx] = req("generation_job:job-1");
    const res = await DELETE(r, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, deletedId: "generation_job:job-1" });
    expect(db.tables.generation_jobs).toHaveLength(0);

    const [r2, ctx2] = req("generation_job:job-1");
    const res2 = await DELETE(r2, ctx2);
    expect(res2.status).toBe(404);
  });

  it("only deletes the caller's own user_media", async () => {
    const [r, ctx] = req("user_media:media-2");
    const res = await DELETE(r, ctx);
    expect(res.status).toBe(404);
    expect(db.tables.user_media).toHaveLength(2);

    const [r2, ctx2] = req("user_media:media-1");
    expect((await DELETE(r2, ctx2)).status).toBe(200);
    expect(db.tables.user_media).toHaveLength(1);
  });

  it("project assets require a verified projectId and delete the scoped row", async () => {
    const [r, ctx] = req("project_asset:pa-1");
    expect((await DELETE(r, ctx)).status).toBe(400);

    const [r2, ctx2] = req("project_asset:pa-1", "?projectId=other-project");
    expect((await DELETE(r2, ctx2)).status).toBe(404);
    expect(db.tables.project_assets).toHaveLength(1);

    const [r3, ctx3] = req("project_asset:pa-1", "?projectId=project-1");
    expect((await DELETE(r3, ctx3)).status).toBe(200);
    expect(db.tables.project_assets).toHaveLength(0);
  });

  it("music tracks delete the row and report R2 storage cleanup", async () => {
    const [r, ctx] = req("music_track:track-1");
    const res = await DELETE(r, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, storageCleanup: "deleted" });
    expect(db.tables.music_tracks).toHaveLength(0);
  });
});
