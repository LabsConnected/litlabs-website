// @vitest-environment jsdom
/**
 * First-run project create regression.
 *
 * Behaviors under test:
 *  - A repeated submit while a create POST is in flight fires exactly
 *    one POST — the guard is synchronous (ref), so a second submit
 *    inside the same render window cannot slip past the disabled
 *    button's state lag and insert a second project row.
 *  - The POST carries the Clerk Bearer token (session-cookie expiry
 *    fallback that every other Studio client already sends).
 *  - A failed create clears the guard so the user can submit again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import * as React from "react";

const mockClerkAuth = vi.fn();
const mockRouterReplace = vi.fn();
const mockWriteHandoff = vi.fn();

type FirstRunProps = {
  onSubmit: (idea: string) => void;
  isCreating: boolean;
  error: string | null;
  onRetry: () => void;
};
let lastFirstRunProps: FirstRunProps | null = null;

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => mockClerkAuth(),
  useAppUser: () => ({ user: null }),
}));
vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    tokens: {
      background: "#0a0a0f",
      text: "#ffffff",
      textMuted: "#888888",
      primary: "#00e5ff",
      surface: "#111111",
      border: "#222222",
    },
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: mockRouterReplace })),
  usePathname: vi.fn(() => "/studio"),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

// Heavy Studio surfaces are stubbed — this test exercises the page-level
// create controller, not the welcome form or the workspace.
vi.mock("@/app/(app)/studio/components/CommandStudio", () => ({
  __esModule: true,
  default: () =>
    React.createElement(
      "div",
      { "data-testid": "command-studio-mounted" },
      "Studio ready",
    ),
}));
vi.mock("@/app/(app)/studio/components/FirstRunWelcome", () => ({
  __esModule: true,
  default: (props: FirstRunProps) => {
    lastFirstRunProps = props;
    return React.createElement(
      "button",
      {
        "data-testid": "first-run-submit-stub",
        onClick: () => props.onSubmit("a roofing site"),
      },
      props.isCreating ? "creating" : "submit",
    );
  },
}));
vi.mock("@/app/(app)/studio/lib/first-run-handoff", () => ({
  peekFirstRunProjectId: () => null,
  writeFirstRunHandoff: (...args: unknown[]) => mockWriteHandoff(...args),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function listEmptyResponse() {
  return Promise.resolve({
    ok: true,
    json: async () => ({ projects: [] }),
  } as Response);
}

function postCalls() {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );
}

async function renderFirstRun() {
  mockClerkAuth.mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
    userId: "user-1",
    getToken: async () => "tok-1",
  });
  const mod = await import("@/app/(app)/studio/page");
  await act(async () => {
    render(React.createElement(mod.default));
  });
  // The project-list GET resolves empty → FirstRunWelcome stub mounts.
  expect(screen.getByTestId("first-run-submit-stub")).toBeTruthy();
}

describe("Studio first-run create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastFirstRunProps = null;
    fetchMock.mockImplementation(() => listEmptyResponse());
  });
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fires exactly one create POST for a repeated submit while in flight", async () => {
    let resolvePost: ((value: unknown) => void) | null = null;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        // Keep the create in flight so a re-submit races the open request.
        return new Promise((resolve) => {
          resolvePost = resolve;
        });
      }
      return listEmptyResponse();
    });

    await renderFirstRun();

    // Two submits in one act: the second must be dropped synchronously —
    // waiting for the isCreating re-render would be the state-guard race
    // this ref guard exists to close.
    await act(async () => {
      fireEvent.click(screen.getByTestId("first-run-submit-stub"));
      fireEvent.click(screen.getByTestId("first-run-submit-stub"));
      lastFirstRunProps?.onSubmit("a roofing site");
    });

    expect(postCalls()).toHaveLength(1);

    const [, init] = postCalls()[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(init.body as string)).toMatchObject({
      sourceType: "blank",
      templateId: "blank-static",
    });

    await act(async () => {
      resolvePost?.({
        ok: true,
        json: async () => ({ project: { id: "proj-1" } }),
      });
    });

    expect(mockWriteHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", userId: "user-1" }),
    );
    expect(mockRouterReplace).toHaveBeenCalledWith(
      expect.stringContaining("project=proj-1"),
    );
    expect(screen.getByTestId("command-studio-mounted")).toBeTruthy();
  });

  it("clears the in-flight guard after a failed create so resubmit works", async () => {
    await renderFirstRun();

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: "insert failed" }),
        } as Response);
      }
      return listEmptyResponse();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("first-run-submit-stub"));
    });
    expect(postCalls()).toHaveLength(1);
    expect(lastFirstRunProps?.error).toBe("insert failed");

    await act(async () => {
      fireEvent.click(screen.getByTestId("first-run-submit-stub"));
    });
    expect(postCalls()).toHaveLength(2);
  });
});
