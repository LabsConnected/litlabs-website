// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const chain = {
    delete: vi.fn(),
    eq: vi.fn(),
  };
  chain.delete.mockReturnValue(chain);
  chain.eq.mockResolvedValue({ error: null });
  return {
    auth: vi.fn(),
    supabaseFrom: vi.fn(),
    deleteChain: chain,
    fetch: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({}),
  supabaseAdmin: {
    from: mocks.supabaseFrom,
  },
}));

import { POST as disconnectPOST } from "@/app/api/connections/[id]/disconnect/route";
import { POST as syncPOST } from "@/app/api/connections/[id]/sync/route";

function req() {
  return new NextRequest("https://www.litlabs.net/api/connections/x/disconnect", {
    method: "POST",
  });
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/connections/[id]/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user_1" });
    mocks.deleteChain.delete.mockReturnValue(mocks.deleteChain);
    mocks.deleteChain.eq.mockResolvedValue({ error: null });
    mocks.supabaseFrom.mockReturnValue(mocks.deleteChain);
  });

  it("returns 401 when signed out", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const res = await disconnectPOST(req(), params("github"));
    expect(res.status).toBe(401);
  });

  it("deletes the user's github installations for github", async () => {
    const res = await disconnectPOST(req(), params("github"));
    expect(res.status).toBe(200);
    expect(mocks.supabaseFrom).toHaveBeenCalledWith("github_installations");
    expect(mocks.deleteChain.eq).toHaveBeenCalledWith("user_id", "user_1");
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 500 when the delete fails", async () => {
    mocks.deleteChain.eq.mockResolvedValue({ error: { message: "boom" } });
    const res = await disconnectPOST(req(), params("github"));
    expect(res.status).toBe(500);
  });

  it("returns 501 for providers with no disconnect backend", async () => {
    const res = await disconnectPOST(req(), params("openrouter"));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toMatch(/not available/i);
  });
});

describe("POST /api/connections/[id]/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user_1" });
  });

  it("returns 401 when signed out", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const res = await syncPOST(req(), params("github"));
    expect(res.status).toBe(401);
  });

  it("proxies github sync to /api/github/sync", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const res = await syncPOST(req(), params("github"));
    expect(res.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/github/sync"),
      expect.objectContaining({ method: "POST" }),
    );
    vi.unstubAllGlobals();
  });

  it("returns 501 for providers with no sync backend", async () => {
    const res = await syncPOST(req(), params("fal"));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toMatch(/not available/i);
  });
});
