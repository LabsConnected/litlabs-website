import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isProtectedRoute } from "@/proxy";

function req(path: string, method = "GET"): NextRequest {
  return new NextRequest(new URL(path, "https://www.litlabs.net"), { method });
}

describe("proxy protection for /app", () => {
  it("protects /app and nested app paths", () => {
    expect(isProtectedRoute(req("/app"))).toBe(true);
    expect(isProtectedRoute(req("/app/"))).toBe(true);
    expect(isProtectedRoute(req("/app/thread"))).toBe(true);
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
