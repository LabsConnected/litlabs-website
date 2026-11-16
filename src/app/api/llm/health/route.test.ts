import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import {
  recordModelFailure,
  isModelCoolingDown,
  _resetProviderHealthForTests,
} from "@/lib/litt-intelligence/provider-registry";
import type { NextRequest } from "next/server";

const authed = auth as unknown as ReturnType<typeof vi.fn>;
const req = {} as NextRequest;

describe("POST /api/llm/health — staging-only provider reset", () => {
  const env = process.env;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    _resetProviderHealthForTests();
  });
  afterEach(() => {
    process.env = env;
    _resetProviderHealthForTests();
  });

  it("404s when LITT_TEST_PROVIDER_RESET is not enabled", async () => {
    delete process.env.LITT_TEST_PROVIDER_RESET;
    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(authed).not.toHaveBeenCalled();
  });

  it("403s when the deployment environment is production — even with the flag set", async () => {
    process.env.LITT_TEST_PROVIDER_RESET = "1";
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    const res = await POST(req);
    expect(res.status).toBe(403);
    // …and nothing was reset.
    recordModelFailure("cloudflare", "@cf/meta/llama");
    expect(isModelCoolingDown("cloudflare", "@cf/meta/llama")).toBe(true);
  });

  it("401s without an authenticated session", async () => {
    process.env.LITT_TEST_PROVIDER_RESET = "1";
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
    authed.mockResolvedValue({ userId: null });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("resets in-process circuit state for an authenticated user on a non-prod deployment", async () => {
    process.env.LITT_TEST_PROVIDER_RESET = "1";
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
    authed.mockResolvedValue({ userId: "user_test" });
    recordModelFailure("cloudflare", "@cf/meta/llama", undefined, true);
    expect(isModelCoolingDown("cloudflare", "@cf/meta/llama")).toBe(true);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(isModelCoolingDown("cloudflare", "@cf/meta/llama")).toBe(false);
  });
});
