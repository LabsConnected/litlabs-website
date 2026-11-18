// @vitest-environment jsdom
/**
 * Website start path (Larry's directive, 2026-11-10).
 *
 * The landing's Website chip links to /studio?creator=website. That
 * entry must start a FRESH website build on the working path —
 * create a blank managed project (sourceType "blank", template
 * "blank-static", the same POST the first-run flow uses) and pin it
 * in the URL — instead of resolving into whatever project happens
 * to be selected (for many users the repo-backed project, whose
 * live workspace is HOST_EXECUTION_DISABLED on the hosted service
 * and dead-ended the Website flow at the sandbox wall).
 *
 * An explicit ?project= always wins: no creation fires. A failed
 * create shows an honest error with retry — it never falls through
 * into a previously selected project.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";

const nav = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

const mockClerkAuth = vi.fn();

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => mockClerkAuth(),
  useAppUser: () => ({ user: null }),
}));
vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    tokens: {
      background: "#ffffff",
      text: "#0e1510",
      textMuted: "#5c6b5e",
      primary: "#177A36",
      surface: "#ffffff",
      border: "#CFDEC4",
    },
    theme: { mode: "light" },
    resolvedColors: {
      accentColor: "#177A36",
      boxBg: "#ffffff",
      bgColor: "#ffffff",
      borderColor: "#CFDEC4",
      textColor: "#0E1510",
      textMuted: "#5c6b5e",
    },
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.searchParams,
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  usePathname: () => "/studio",
}));
vi.mock("@/app/(app)/studio/components/CommandStudio", () => ({
  __esModule: true,
  default: () =>
    React.createElement("div", { "data-testid": "command-studio-mounted" }, "Studio ready"),
}));
vi.mock("@/app/(app)/studio/components/FirstRunWelcome", () => ({
  __esModule: true,
  default: () =>
    React.createElement("div", { "data-testid": "first-run-welcome" }, "Welcome"),
}));
vi.mock("@/app/(app)/studio/components/StudioPrimeLanding", () => ({
  __esModule: true,
  default: () =>
    React.createElement("div", { "data-testid": "studio-prime-landing" }, "Landing"),
}));

type FetchCall = { url: string; method: string; body?: string };

/** Fetch stub: GET lists one existing (repo-backed) project; POST creates. */
function stubFetch(postImpl: () => Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "POST" && url.includes("/api/studio-projects")) return postImpl();
    return new Response(
      JSON.stringify({ projects: [{ id: "repo-proj", name: "LabsConnected/litlabs-website" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("Studio website start", () => {
  beforeEach(() => {
    nav.searchParams = new URLSearchParams();
    nav.replace.mockClear();
    mockClerkAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
      getToken: async () => null,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("creates a fresh blank website project and pins it — never the selected repo project", async () => {
    nav.searchParams = new URLSearchParams("creator=website");
    const calls = stubFetch(
      async () =>
        new Response(JSON.stringify({ project: { id: "new-web-1" } }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const mod = await import("@/app/(app)/studio/page");
    render(React.createElement(mod.default));

    await vi.waitFor(() => expect(nav.replace).toHaveBeenCalled());
    const post = calls.find((c) => c.method === "POST");
    expect(post).toBeTruthy();
    const body = JSON.parse(post!.body ?? "{}") as Record<string, unknown>;
    expect(body.sourceType).toBe("blank");
    expect(body.templateId).toBe("blank-static");

    const target = String(nav.replace.mock.calls[0][0]);
    expect(target).toContain("project=new-web-1");
    expect(target).toContain("tool=chat");
    // No auto-sent prompt: the describe step belongs to the user.
    expect(target).not.toContain("prompt=");
    // The workspace was never mounted against the repo project.
    expect(screen.queryByTestId("command-studio-mounted")).toBeNull();
  });

  it("an explicit ?project= wins — no creation fires", async () => {
    nav.searchParams = new URLSearchParams("creator=website&project=chosen-1");
    const calls = stubFetch(async () => {
      throw new Error("POST must not be called");
    });
    const mod = await import("@/app/(app)/studio/page");
    render(React.createElement(mod.default));

    await vi.waitFor(() =>
      expect(screen.getByTestId("command-studio-mounted")).toBeTruthy(),
    );
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("a failed create shows an honest error and never falls through to a selected project", async () => {
    nav.searchParams = new URLSearchParams("creator=website");
    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: "quota exhausted" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const mod = await import("@/app/(app)/studio/page");
    render(React.createElement(mod.default));

    await vi.waitFor(() =>
      expect(screen.getByTestId("website-start-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("website-start-error").textContent).toContain("quota exhausted");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("command-studio-mounted")).toBeNull();
  });
});
