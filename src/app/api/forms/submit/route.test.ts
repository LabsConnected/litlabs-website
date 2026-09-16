/**
 * Platform form backend — POST /api/forms/submit tests.
 *
 * The route resolves the deployment id to a site owner (mocked), stores
 * the lead in `business_leads` with a server-set source (mocked), and
 * silently drops honeypot submissions.
 *
 * Run: npx vitest run src/app/api/forms/submit/route.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks (hoisted) ────────────────────────────────────────────────
// vi.mock factories are hoisted above top-level declarations, so the
// mocks are declared inside the factories and imported below.

vi.mock("@/lib/business-public", () => ({
  // Deployment ids look like "depxxxxx"; match the real pattern shape.
  DEPLOYMENT_ID_PATTERN: /^[A-Za-z0-9_-]{1,64}$/,
  resolveSiteOwner: vi.fn(),
  withCors: vi.fn(),
  corsPreflight: vi.fn(() => new Response(null, { status: 204 })),
}));

vi.mock("@/lib/business-operations", () => ({
  createLead: vi.fn(),
  getBusinessConfig: vi.fn(),
}));

// Pass through the handler unwrapped — rate limiting is tested
// separately against the real rate-limiter.
vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: vi.fn((handler: unknown) => handler),
}));

import { POST, GET } from "./route";
import { resolveSiteOwner } from "@/lib/business-public";
import { createLead, getBusinessConfig } from "@/lib/business-operations";
import type { BusinessLead, BusinessConfig, BusinessResult } from "@/lib/business-operations";

const mockResolveSiteOwner = vi.mocked(resolveSiteOwner);
const mockCreateLead = vi.mocked(createLead);
const mockGetBusinessConfig = vi.mocked(getBusinessConfig);

// ─── Helpers ────────────────────────────────────────────────────────

const VALID_BODY = {
  deploymentId: "dep_valid_123",
  formName: "Contact us",
  page: "/contact",
  fields: { name: "Jane Doe", email: "jane@example.com", message: "Hello!" },
};

function jsonRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/forms/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function urlencodedRequest(params: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/forms/submit", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSiteOwner.mockResolvedValue({
    ok: true,
    ownerId: "owner_123",
    deploymentId: "dep_valid_123",
  });
  mockCreateLead.mockResolvedValue({ ok: true, data: { id: "lead_123" } } as unknown as BusinessResult<BusinessLead>);
  // No Resend key in tests → notifyOwner bails before reading config,
  // but keep the mock defined for safety.
  mockGetBusinessConfig.mockResolvedValue({ ok: true, data: { notification_email: null } } as unknown as BusinessResult<BusinessConfig>);
});

// ─── Valid submissions ──────────────────────────────────────────────

describe("POST /api/forms/submit — valid submissions", () => {
  it("accepts a valid JSON submission and stores the lead", async () => {
    const res = await POST(jsonRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.leadId).toBe("lead_123");

    expect(mockCreateLead).toHaveBeenCalledTimes(1);
    const [ownerId, input] = mockCreateLead.mock.calls[0];
    expect(ownerId).toBe("owner_123");
    // Server-set values — the client cannot spoof the source.
    expect(input.source).toBe("site_form");
    expect(input.name).toBe("Jane Doe");
    expect(input.email).toBe("jane@example.com");
    const metadata = input.metadata ?? {};
    expect(metadata.deploymentId).toBe("dep_valid_123");
    expect(metadata.formName).toBe("Contact us");
    expect(metadata.page).toBe("/contact");
  });

  it("accepts the urlencoded no-JS fallback", async () => {
    const res = await POST(
      urlencodedRequest({
        deploymentId: "dep_valid_123",
        name: "No JS",
        email: "nojs@example.com",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockCreateLead).toHaveBeenCalledTimes(1);
    expect(mockCreateLead.mock.calls[0][1].name).toBe("No JS");
  });

  it("maps common name/email/phone field variants", async () => {
    const res = await POST(
      jsonRequest({
        deploymentId: "dep_valid_123",
        fields: { full_name: "Bob", your_email: "bob@example.com", mobile: "555-1234" },
      }),
    );
    expect(res.status).toBe(200);
    const [, input] = mockCreateLead.mock.calls[0];
    expect(input.name).toBe("Bob");
    expect(input.email).toBe("bob@example.com");
    expect(input.phone).toBe("555-1234");
  });
});

// ─── Validation failures ────────────────────────────────────────────

describe("POST /api/forms/submit — invalid submissions", () => {
  it("rejects a malformed deployment id with 400", async () => {
    const res = await POST(jsonRequest({ deploymentId: "!!!bad", fields: { name: "x" } }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("rejects empty fields with 400", async () => {
    const res = await POST(jsonRequest({ deploymentId: "dep_valid_123", fields: {} }));
    expect(res.status).toBe(400);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("rejects more than 25 fields with 400", async () => {
    const fields: Record<string, string> = {};
    for (let i = 0; i < 26; i++) fields[`field${i}`] = "x";
    const res = await POST(jsonRequest({ deploymentId: "dep_valid_123", fields }));
    expect(res.status).toBe(400);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("rejects suspicious field names with 400", async () => {
    const res = await POST(
      jsonRequest({ deploymentId: "dep_valid_123", fields: { "<script>alert(1)</script>": "x" } }),
    );
    expect(res.status).toBe(400);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const req = new NextRequest("http://localhost/api/forms/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });
});

// ─── Honeypot + deployment resolution ───────────────────────────────

describe("POST /api/forms/submit — honeypot and resolution", () => {
  it("silently drops honeypot submissions without storing anything", async () => {
    const res = await POST(
      jsonRequest({ ...VALID_BODY, website: "http://spam.example" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    // Looks like success to the bot, but nothing was stored.
    expect(json.ok).toBe(true);
    expect(json.leadId).toBeUndefined();
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("returns 404 when the deployment id is unknown", async () => {
    mockResolveSiteOwner.mockResolvedValue({ ok: false, status: 404, error: "Site not found" });
    const res = await POST(jsonRequest(VALID_BODY));
    expect(res.status).toBe(404);
    expect(mockCreateLead).not.toHaveBeenCalled();
  });

  it("returns 503 when lead storage fails", async () => {
    mockCreateLead.mockResolvedValue({ ok: false, status: 500, error: "db down" });
    const res = await POST(jsonRequest(VALID_BODY));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});

describe("GET /api/forms/submit", () => {
  it("is not allowed", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });
});
