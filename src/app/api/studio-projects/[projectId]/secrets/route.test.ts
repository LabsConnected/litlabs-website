/**
 * Project secrets API — GET / POST tests.
 *
 * Mocks auth, project ownership, the broker, the internal terminal client,
 * and the rate limiter; the Clerk-env extraction stays real (pure).
 *
 * Run: npx vitest run "src/app/api/studio-projects/[projectId]/secrets/route.test.ts"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/terminal-v1/secret-broker", () => ({ SecretBroker: vi.fn() }));
vi.mock("@/lib/terminal-internal-client", () => ({ ensurePreviewEnvInternal: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ rateLimit: vi.fn() }));

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { SecretBroker } from "@/lib/terminal-v1/secret-broker";
import { ensurePreviewEnvInternal } from "@/lib/terminal-internal-client";
import { rateLimit } from "@/lib/rate-limiter";
import { fingerprintSecretValue, maskFingerprint } from "@/lib/project-secrets";

const mockAuth = vi.mocked(auth);
const mockGetProject = vi.mocked(getProject);
const MockBroker = vi.mocked(SecretBroker);
const mockEnsureEnv = vi.mocked(ensurePreviewEnvInternal);
const mockRateLimit = vi.mocked(rateLimit);

const USER = "user_123";
const PROJECT = "proj_abc";
const params = { params: Promise.resolve({ projectId: PROJECT }) };

function brokerInstance(methods: Record<string, unknown>) {
  return methods;
}

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/studio-projects/${PROJECT}/secrets`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: USER, clerkId: "clerk_1" });
  mockGetProject.mockResolvedValue({
    id: PROJECT,
    workspaceId: "ws_1",
  } as never);
  mockRateLimit.mockResolvedValue({ success: true, remaining: 29, resetTime: 3600 });
  mockEnsureEnv.mockResolvedValue({ restarted: true, status: "ready" });
});

describe("GET", () => {
  it("401s when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(401);
  });

  it("404s when the project is not the caller's (no ownership leak)", async () => {
    mockGetProject.mockResolvedValue(null);
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(404);
    expect(MockBroker).not.toHaveBeenCalled();
  });

  it("returns metadata with masked fingerprints — values never leak", async () => {
    const plaintext = "sk_live_never_leak_me";
    MockBroker.mockImplementation(
      () =>
        brokerInstance({
          listProjectSecrets: vi.fn().mockResolvedValue([
            {
              secretId: "sec-1",
              userId: USER,
              projectId: PROJECT,
              name: "CLERK_SECRET_KEY",
              updatedAt: "2026-09-21T00:00:00Z",
            },
          ]),
          decryptValue: vi.fn().mockResolvedValue(plaintext),
        }) as never,
    );

    const res = await GET(req("GET"), params);
    expect(res.status).toBe(200);
    const text = await res.text();
    // The plaintext must not appear anywhere in the response.
    expect(text).not.toContain(plaintext);
    const payload = JSON.parse(text) as {
      secrets: { secretId: string; name: string; fingerprint: string }[];
    };
    expect(payload.secrets).toHaveLength(1);
    expect(payload.secrets[0].name).toBe("CLERK_SECRET_KEY");
    expect(payload.secrets[0].fingerprint).toBe(
      maskFingerprint(fingerprintSecretValue(plaintext)),
    );
  });
});

describe("POST", () => {
  function mockBrokerForSave() {
    const upsert = vi.fn().mockResolvedValue({
      secretId: "sec-1",
      userId: USER,
      projectId: PROJECT,
      name: "CLERK_SECRET_KEY",
      updatedAt: "2026-09-21T00:00:00Z",
    });
    MockBroker.mockImplementation(
      () =>
        brokerInstance({
          listProjectSecrets: vi.fn().mockResolvedValue([]),
          upsertProjectSecret: upsert,
          resolveForSandbox: vi.fn().mockResolvedValue({
            CLERK_SECRET_KEY: "sk_live_abc",
            NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_xyz",
            OPENAI_API_KEY: "unrelated",
          }),
        }) as never,
    );
    return upsert;
  }

  it("401s when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });
    const res = await POST(req("POST", { name: "A", value: "v" }), params);
    expect(res.status).toBe(401);
  });

  it("400s on an invalid secret name", async () => {
    const res = await POST(req("POST", { name: "bad-name", value: "v" }), params);
    expect(res.status).toBe(400);
  });

  it("400s on an empty value", async () => {
    const res = await POST(req("POST", { name: "CLERK_SECRET_KEY", value: "   " }), params);
    expect(res.status).toBe(400);
  });

  it("429s when rate-limited", async () => {
    mockRateLimit.mockResolvedValue({ success: false, remaining: 0, resetTime: 60 });
    const res = await POST(req("POST", { name: "CLERK_SECRET_KEY", value: "sk_x" }), params);
    expect(res.status).toBe(429);
  });

  it("saves, nudges the preview with the extracted Clerk env, and reports the restart", async () => {
    const upsert = mockBrokerForSave();
    const res = await POST(
      req("POST", { name: "CLERK_SECRET_KEY", value: "sk_live_abc" }),
      params,
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({
      userId: USER,
      projectId: PROJECT,
      name: "CLERK_SECRET_KEY",
      value: "sk_live_abc",
      description: undefined,
    });
    // Only the Clerk subset reaches the terminal server — never the full map.
    expect(mockEnsureEnv).toHaveBeenCalledWith("ws_1", USER, {
      CLERK_SECRET_KEY: "sk_live_abc",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_xyz",
    });
    const payload = (await res.json()) as {
      secret: { name: string; fingerprint: string };
      previewRestarted: boolean;
    };
    expect(payload.previewRestarted).toBe(true);
    expect(payload.secret.name).toBe("CLERK_SECRET_KEY");
    expect(payload.secret.fingerprint).toBe(
      maskFingerprint(fingerprintSecretValue("sk_live_abc")),
    );
    // The saved value is never echoed back.
    expect(JSON.stringify(payload)).not.toContain("sk_live_abc");
  });

  it("skips the preview nudge when the project has no workspace yet", async () => {
    mockBrokerForSave();
    mockGetProject.mockResolvedValue({ id: PROJECT, workspaceId: null } as never);
    const res = await POST(
      req("POST", { name: "CLERK_SECRET_KEY", value: "sk_live_abc" }),
      params,
    );
    expect(res.status).toBe(200);
    expect(mockEnsureEnv).not.toHaveBeenCalled();
    const payload = (await res.json()) as { previewRestarted: boolean };
    expect(payload.previewRestarted).toBe(false);
  });

  it("400s when the project already holds the max number of secrets", async () => {
    const existing = Array.from({ length: 50 }, (_, i) => ({
      secretId: `sec-${i}`,
      name: `KEY_${i}`,
    }));
    MockBroker.mockImplementation(
      () =>
        brokerInstance({
          listProjectSecrets: vi.fn().mockResolvedValue(existing),
          upsertProjectSecret: vi.fn(),
        }) as never,
    );
    const res = await POST(req("POST", { name: "ONE_MORE", value: "v" }), params);
    expect(res.status).toBe(400);
  });
});
