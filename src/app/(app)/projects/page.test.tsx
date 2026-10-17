/**
 * /projects — "New project" creation affordance.
 *
 * Regression coverage for the golden-journey defect: the page offered only
 * "Start in Studio" and "Connect a repository" — no way to create a blank
 * project. The New project button now opens the shared name dialog, POSTs
 * the create, and navigates straight into the new project in Studio.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/PageShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    resolvedColors: {
      accentColor: "#72f238",
      bgColor: "#000",
      boxBg: "#111",
      borderColor: "#333",
      textColor: "#fff",
      textMuted: "#888",
      headerColor: "#fff",
    },
  }),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    getToken: vi.fn().mockResolvedValue("test-token"),
  }),
}));

import ProjectsPage from "./page";

const PROJECT_LIST = { projects: [], legacyOnly: [] };

function mockFetch({ create }: { create?: () => Promise<Response> | Response } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/api/studio-projects") && init?.method === "POST") {
      return (await create?.()) ?? new Response(JSON.stringify({ project: { id: "proj-new", name: "X" } }), { status: 201 });
    }
    if (url.includes("/api/studio-projects")) {
      return new Response(JSON.stringify(PROJECT_LIST), { status: 200 });
    }
    if (url.includes("/api/github/installations")) {
      return new Response(JSON.stringify({ installations: [] }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  pushMock.mockClear();
});

describe("/projects — New project", () => {
  it("creates a blank project and navigates into it in Studio", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.click(screen.getByRole("button", { name: /new project/i }));
    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Landing revamp");
    await user.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/studio?project=proj-new");
    });
    const createCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input instanceof Request ? input.url : String(input)).includes("/api/studio-projects") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(createCalls).toHaveLength(1);
    const body = JSON.parse((createCalls[0][1] as RequestInit).body as string);
    expect(body.name).toBe("Landing revamp");
    expect(typeof body.idempotencyKey).toBe("string");
    expect(body.idempotencyKey.length).toBeGreaterThan(0);
  });

  it("shows the create error in the dialog and does not navigate", async () => {
    mockFetch({
      create: () => new Response(JSON.stringify({ error: "quota exceeded" }), { status: 402 }),
    });
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.click(screen.getByRole("button", { name: /new project/i }));
    await user.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("quota exceeded")).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("issues a single create POST on rapid double submit", async () => {
    const fetchMock = mockFetch({
      create: () => new Promise<Response>(() => {}),
    });
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.click(screen.getByRole("button", { name: /new project/i }));
    const submit = screen.getByRole("button", { name: /create project/i });
    await user.click(submit);
    await user.click(submit);

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input instanceof Request ? input.url : String(input)).includes("/api/studio-projects") &&
          (init as RequestInit | undefined)?.method === "POST",
      );
      expect(posts).toHaveLength(1);
    });
  });

  it("reuses the idempotency key for an identical retry but mints a fresh key on an edit", async () => {
    const fetchMock = mockFetch({
      create: () => new Response(JSON.stringify({ error: "network lost" }), { status: 500 }),
    });
    const user = userEvent.setup();
    render(<ProjectsPage />);

    const createPosts = () =>
      fetchMock.mock.calls
        .filter(
          ([input, init]) =>
            String(input instanceof Request ? input.url : String(input)).includes("/api/studio-projects") &&
            (init as RequestInit | undefined)?.method === "POST",
        )
        .map(([, init]) => JSON.parse((init as RequestInit).body as string));

    await user.click(screen.getByRole("button", { name: /new project/i }));
    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Landing revamp");
    await user.click(screen.getByRole("button", { name: /create project/i }));
    await waitFor(() => expect(createPosts()).toHaveLength(1));
    const firstKey = createPosts()[0].idempotencyKey;
    expect(typeof firstKey).toBe("string");

    // Identical retry after a lost response — same name, same key.
    await user.click(screen.getByRole("button", { name: /create project/i }));
    await waitFor(() => expect(createPosts()).toHaveLength(2));
    expect(createPosts()[1].idempotencyKey).toBe(firstKey);

    // An edited name is a NEW submission — fresh key.
    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Cafe site");
    await user.click(screen.getByRole("button", { name: /create project/i }));
    await waitFor(() => expect(createPosts()).toHaveLength(3));
    expect(createPosts()[2].idempotencyKey).not.toBe(firstKey);

    // Cancel closes the submission — reopening mints a fresh key even
    // for the same text.
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await user.click(screen.getByRole("button", { name: /new project/i }));
    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Cafe site");
    await user.click(screen.getByRole("button", { name: /create project/i }));
    await waitFor(() => expect(createPosts()).toHaveLength(4));
    expect(createPosts()[3].idempotencyKey).not.toBe(createPosts()[2].idempotencyKey);
  });
});
