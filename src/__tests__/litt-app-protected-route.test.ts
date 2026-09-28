import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { hiddenLittAppResponse, isProtectedRoute } from "@/proxy";

function req(path: string, method = "GET"): NextRequest {
  return new NextRequest(new URL(path, "https://www.litlabs.net"), { method });
}

describe("proxy protection for /app", () => {
  it("protects /app and nested app paths", () => {
    expect(isProtectedRoute(req("/app"))).toBe(true);
    expect(isProtectedRoute(req("/app/"))).toBe(true);
    expect(isProtectedRoute(req("/app/thread"))).toBe(true);
  });

  it("404s /app while the feature flag is off and leaves other routes alone", () => {
    const previous = process.env.NEXT_PUBLIC_LITT_APP_ENABLED;
    delete process.env.NEXT_PUBLIC_LITT_APP_ENABLED;
    expect(hiddenLittAppResponse(req("/app"))?.status).toBe(404);
    expect(hiddenLittAppResponse(req("/app/thread"))?.status).toBe(404);
    expect(hiddenLittAppResponse(req("/studio"))).toBeNull();
    expect(hiddenLittAppResponse(req("/application"))).toBeNull();

    process.env.NEXT_PUBLIC_LITT_APP_ENABLED = "true";
    expect(hiddenLittAppResponse(req("/app"))).toBeNull();

    if (previous === undefined) delete process.env.NEXT_PUBLIC_LITT_APP_ENABLED;
    else process.env.NEXT_PUBLIC_LITT_APP_ENABLED = previous;
  });

  it("still protects Studio and leaves public routes alone", () => {
    expect(isProtectedRoute(req("/studio"))).toBe(true);
    expect(isProtectedRoute(req("/studio/anything"))).toBe(true);
    expect(isProtectedRoute(req("/dashboard"))).toBe(true);
    expect(isProtectedRoute(req("/"))).toBe(false);
    expect(isProtectedRoute(req("/pricing"))).toBe(false);
    expect(isProtectedRoute(req("/demo"))).toBe(false);
    expect(isProtectedRoute(req("/api/users/by-username/ada"))).toBe(false);
    expect(isProtectedRoute(req("/api/demo/chat", "POST"))).toBe(false);
  });
});
