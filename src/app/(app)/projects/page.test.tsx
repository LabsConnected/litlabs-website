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

function listedProject(id: string, name: string, updatedAt = new Date().toISOString()) {
  return {
    id,
    name,
    sourceType: "blank",
    githubFullName: null,
    githubBranch: null,
    workspaceStatus: "ready",
    runtimeStatus: "stopped",
    updatedAt,
  };
}

function mockFetch({
  create,
  projectList = PROJECT_LIST,
}: {
  create?: () => Promise<Response> | Response;
  projectList?: unknown;
} = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/api/studio-projects") && init?.method === "POST") {
      return (await create?.()) ?? new Response(JSON.stringify({ project: { id: "proj-new", name: "X" } }), { status: 201 });
    }
    if (url.includes("/api/studio-projects")) {
      return new Response(JSON.stringify(projectList), { status: 200 });
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

describe("/projects — rendered project list", () => {
  it("merges canonical and legacy rows once, keeps canonical data, and links projects to Studio", async () => {
    mockFetch({
      projectList: {
        projects: [listedProject("shared-id", "Canonical project")],
        legacyOnly: [
          listedProject("shared-id", "Duplicate legacy project"),
          listedProject("legacy-id", "Legacy project"),
        ],
      },
    });
    render(<ProjectsPage />);

    await waitFor(() => expect(screen.getByText("Legacy project")).toBeTruthy());
    expect(screen.getByText("Canonical project")).toBeTruthy();
    expect(screen.queryByText("Duplicate legacy project")).toBeNull();
    expect(document.querySelector('a[href="/studio?project=shared-id"]')).not.toBeNull();
    expect(document.querySelector('a[href="/studio?project=legacy-id"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Delete Canonical project" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete Legacy project" })).toBeNull();
  });

  it("searches project names and applies the existing Recent category filter", async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    mockFetch({
      projectList: {
        projects: [
          listedProject("alpha", "Alpha workspace"),
          listedProject("beta", "Beta workspace"),
          listedProject("old", "Older workspace", oldDate),
        ],
        legacyOnly: [],
      },
    });
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await waitFor(() => expect(screen.getByText("Alpha workspace")).toBeTruthy());
    const search = screen.getByPlaceholderText("Search projects...");
    await user.type(search, "Beta");
    expect(screen.getByText("Beta workspace")).toBeTruthy();
    expect(screen.queryByText("Alpha workspace")).toBeNull();

    await user.clear(search);
    await user.click(screen.getByRole("button", { name: /Recent/ }));
    expect(screen.getByText("Alpha workspace")).toBeTruthy();
    expect(screen.queryByText("Older workspace")).toBeNull();
  });

  it("bulk Select All excludes legacy-only projects, since DELETE 404s for them", async () => {
    mockFetch({
      projectList: {
        projects: [listedProject("canon-1", "Canonical one")],
        legacyOnly: [listedProject("legacy-1", "Legacy Project")],
      },
    });
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await waitFor(() => expect(screen.getByText("Canonical one")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "All" }));

    expect(screen.getByRole("button", { name: /Delete \(1\)/ })).toBeTruthy();
  });

  it("bulk Duplicates excludes legacy-only projects even when the name matches the heuristic", async () => {
    mockFetch({
      projectList: {
        projects: [],
        legacyOnly: [listedProject("legacy-dup", "Ember Roast V1 Acceptance 08-17-25")],
      },
    });
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await waitFor(() => expect(screen.getByText("Ember Roast V1 Acceptance 08-17-25")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Duplicates" }));

    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete \(/ })).toBeNull();
  });

  it("ignores a tap on a legacy-only card while in select mode", async () => {
    mockFetch({
      projectList: {
        projects: [],
        legacyOnly: [listedProject("legacy-1", "Legacy Project")],
      },
    });
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await waitFor(() => expect(screen.getByText("Legacy Project")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Select" }));
    const card = screen.getByText("Legacy Project").closest("a")!;
    await user.click(card);

    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete \(/ })).toBeNull();
  });
});
