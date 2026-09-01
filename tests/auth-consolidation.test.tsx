import fs from "node:fs";
import path from "node:path";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const clerkClientState = vi.hoisted(() => ({
  auth: {
    isLoaded: true,
    isSignedIn: false,
    userId: null as string | null,
    sessionClaims: undefined as { name?: string | null; username?: string | null } | undefined,
    getToken: vi.fn(async () => null),
    signOut: vi.fn(async () => undefined),
  },
  user: null as {
    id: string;
    firstName: string | null;
    fullName: string | null;
    username: string | null;
    imageUrl: string;
    primaryEmailAddress: { emailAddress: string } | null;
    publicMetadata: Record<string, unknown>;
  } | null,
  userLoaded: true,
}));

const clerkServerAuth = vi.hoisted(() => vi.fn(async () => ({ userId: null, sessionId: null })));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => clerkClientState.auth,
  useUser: () => ({ user: clerkClientState.user, isLoaded: clerkClientState.userLoaded }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: clerkServerAuth,
  verifyToken: vi.fn(async () => {
    throw new Error("invalid Clerk token");
  }),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: <T extends (...args: never[]) => unknown>(handler: T) => handler,
}));

import {
  ClerkAuthContextProvider,
  useClerkAuthContext,
} from "@/context/ClerkAuthContext";

const ROOT = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(target);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [target] : [];
  });
}

function AuthProbe() {
  const auth = useClerkAuthContext();
  return (
    <div>
      <span data-testid="loaded">{String(auth.isLoaded)}</span>
      <span data-testid="signed-in">{String(auth.isSignedIn)}</span>
      <span data-testid="user-id">{auth.userId ?? "none"}</span>
    </div>
  );
}

describe("Clerk-only client authentication", () => {
  beforeEach(() => {
    clerkClientState.auth.isLoaded = true;
    clerkClientState.auth.isSignedIn = false;
    clerkClientState.auth.userId = null;
    clerkClientState.auth.sessionClaims = undefined;
    clerkClientState.user = null;
    clerkClientState.userLoaded = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            user: { id: "legacy-user", email: "legacy@example.com", name: "Legacy" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("derives signed-in state and identity from Clerk", () => {
    clerkClientState.auth.isSignedIn = true;
    clerkClientState.auth.userId = "user_clerk_123";
    clerkClientState.user = {
      id: "user_clerk_123",
      firstName: "Clerk",
      fullName: "Clerk User",
      username: "clerk-user",
      imageUrl: "https://example.com/avatar.png",
      primaryEmailAddress: { emailAddress: "clerk@example.com" },
      publicMetadata: {},
    };

    render(
      <ClerkAuthContextProvider clerkAvailable>
        <AuthProbe />
      </ClerkAuthContextProvider>,
    );

    expect(screen.getByTestId("loaded").textContent).toBe("true");
    expect(screen.getByTestId("signed-in").textContent).toBe("true");
    expect(screen.getByTestId("user-id").textContent).toBe("user_clerk_123");
  });

  it("stays signed out when Clerk is signed out even if a legacy session responds with a user", async () => {
    render(
      <ClerkAuthContextProvider clerkAvailable>
        <AuthProbe />
      </ClerkAuthContextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
      expect(screen.getByTestId("signed-in").textContent).toBe("false");
      expect(screen.getByTestId("user-id").textContent).toBe("none");
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fails safely as signed out when Clerk is unavailable", () => {
    render(
      <ClerkAuthContextProvider clerkAvailable={false}>
        <AuthProbe />
      </ClerkAuthContextProvider>,
    );

    expect(screen.getByTestId("loaded").textContent).toBe("true");
    expect(screen.getByTestId("signed-in").textContent).toBe("false");
    expect(screen.getByTestId("user-id").textContent).toBe("none");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("legacy authentication removal contracts", () => {
  it("keeps Navbar authentication state Clerk-only", () => {
    const navbar = read("src/components/Navbar.tsx");
    expect(navbar).not.toContain("useSessionAuth");
    expect(navbar).not.toContain("sessionSignedIn");
    expect(navbar).not.toContain("sessionLoaded");
    expect(navbar).toMatch(
      /const \{ isLoaded: authLoaded, isSignedIn \} = useClerkAuth\(\);/,
    );
  });

  it("has no active source calls to removed legacy auth endpoints", () => {
    const forbidden = ["/api/auth/session", "/api/auth/login", "/api/auth/logout"];
    const offenders = listSourceFiles(path.join(ROOT, "src")).flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      return forbidden
        .filter((endpoint) => source.includes(endpoint))
        .map((endpoint) => `${path.relative(ROOT, file)}:${endpoint}`);
    });
    expect(offenders).toEqual([]);
  });

  it("removes the legacy client auth modules and API routes", () => {
    const removed = [
      "src/context/AuthContext.tsx",
      "src/hooks/useSessionAuth.ts",
      "src/app/api/auth/login/route.ts",
      "src/app/api/auth/logout/route.ts",
      "src/app/api/auth/session/route.ts",
      "src/lib/db.ts",
      "src/lib/jwt.ts",
    ];
    expect(removed.filter((file) => fs.existsSync(path.join(ROOT, file)))).toEqual([]);
  });

  it("contains no application auth-token handling", () => {
    const offenders = listSourceFiles(path.join(ROOT, "src")).filter((file) =>
      /["']auth-token["']/.test(fs.readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("Clerk-only server authorization", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_clerk_configured_12345");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_clerk_configured_12345");
    delete process.env.ALLOW_ANONYMOUS_DEV;
    clerkServerAuth.mockResolvedValue({ userId: null, sessionId: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not authenticate an old auth-token cookie", async () => {
    const { auth } = await import("@/lib/auth");
    const request = new NextRequest("https://litlabs.net/api/notifications", {
      headers: { cookie: "auth-token=legacy-signed-token" },
    });

    await expect(auth(request)).resolves.toEqual({ userId: null, clerkId: null });
  });

  it("keeps a protected server route unauthorized without valid Clerk auth", async () => {
    const { GET } = await import("@/app/api/notifications/route");
    const request = new NextRequest("https://litlabs.net/api/notifications");

    const response = await GET(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
