import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";

// ─── Mock useClerkAuth ──────────────────────────────────────────
// FileExplorer uses useClerkAuth() for getToken(). We mock it to
// return a fake token so authHeaders() includes Authorization.
// IMPORTANT: Return stable references — if getToken is a new function
// on every render, authHeaders changes, fetchEntries changes, loadRoot
// changes, the useEffect re-fires, and we get an infinite render loop.
const stableGetToken = vi.fn(async () => "fake-bearer-token");
const stableAuth = {
  isLoaded: true,
  isSignedIn: true,
  userId: "user_test123",
  getToken: stableGetToken,
};
vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => stableAuth,
}));

import { FileExplorer } from "@/components/litt-terminal/FileExplorer";

// ─── Helpers ────────────────────────────────────────────────────

type FileExplorerProps = ComponentProps<typeof FileExplorer>;

function renderExplorer(overrides: Partial<FileExplorerProps> = {}) {
  const onOpenFile = vi.fn();
  const utils = render(
    <FileExplorer projectId="proj_abc" onOpenFile={onOpenFile} {...overrides} />,
  );
  return { ...utils, onOpenFile };
}

/** Build a mock fetch that returns directory listings. */
function mockFetch(entries: Record<string, { name: string; type: "folder" | "file" }[]>) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    // GET — directory listing
    if (!init?.method || init.method === "GET") {
      const pathParam = new URL(urlStr, "http://localhost").searchParams.get("path") || ".";
      const list = entries[pathParam] || [];
      return {
        ok: true,
        status: 200,
        json: async () => ({ entries: list }),
        text: async () => JSON.stringify({ entries: list }),
      } as Response;
    }

    // POST — file mutation
    const body = JSON.parse(init.body as string);
    if (body.action === "write") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      } as Response;
    }
    if (body.action === "delete") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      } as Response;
    }
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: "Bad request" }),
      text: async () => "Bad request",
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────

describe("FileExplorer — no project", () => {
  it("shows 'Open or create a project first.' when projectId is null", () => {
    render(<FileExplorer projectId={null} />);
    expect(screen.getByText("Open or create a project first.")).toBeTruthy();
  });

  it("shows 'Open or create a project first.' when projectId is undefined", () => {
    render(<FileExplorer />);
    expect(screen.getByText("Open or create a project first.")).toBeTruthy();
  });

  it("disables refresh and create buttons when no project", () => {
    render(<FileExplorer projectId={null} />);
    const refreshBtn = screen.getByLabelText("Refresh file list");
    const createBtn = screen.getByLabelText("Create new file");
    expect(refreshBtn).toBeTruthy();
    expect(createBtn).toBeTruthy();
    expect((refreshBtn as HTMLButtonElement).disabled).toBe(true);
    expect((createBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not issue any fetch requests when no project", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<FileExplorer projectId={null} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("FileExplorer — with project", () => {
  it("fetches root listing on mount", async () => {
    const fetchMock = mockFetch({
      ".": [
        { name: "src", type: "folder" },
        { name: "package.json", type: "file" },
      ],
    });
    renderExplorer();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/studio-projects/proj_abc/files?path=."),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });
  });

  it("sends Authorization Bearer header", async () => {
    const fetchMock = mockFetch({ ".": [] });
    renderExplorer();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      const call = fetchMock.mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer fake-bearer-token");
    });
  });

  it("renders files and folders from the API", async () => {
    mockFetch({
      ".": [
        { name: "src", type: "folder" },
        { name: "README.md", type: "file" },
      ],
    });
    renderExplorer();

    await waitFor(() => {
      expect(screen.getByText("src")).toBeTruthy();
      expect(screen.getByText("README.md")).toBeTruthy();
    });
  });

  it("calls onOpenFile when a file is clicked", async () => {
    mockFetch({
      ".": [{ name: "index.tsx", type: "file" }],
    });
    const { onOpenFile } = renderExplorer();

    await waitFor(() => expect(screen.getByText("index.tsx")).toBeTruthy());
    fireEvent.click(screen.getByText("index.tsx"));
    expect(onOpenFile).toHaveBeenCalledWith("index.tsx");
  });

  it("expands a folder on click and loads its children", async () => {
    mockFetch({
      ".": [{ name: "src", type: "folder" }],
      "src": [{ name: "app.tsx", type: "file" }],
    });
    renderExplorer();

    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    // Click the folder to expand
    fireEvent.click(screen.getByText("src"));

    await waitFor(() => {
      expect(screen.getByText("app.tsx")).toBeTruthy();
    });
  });
});

describe("FileExplorer — error handling", () => {
  it("shows sanitized error on 401", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
      text: async () => JSON.stringify({ error: "Unauthorized" }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderExplorer();

    await waitFor(() => {
      expect(screen.getByText("Your session expired. Please sign in again.")).toBeTruthy();
    });
  });

  it("shows sanitized error on 403", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
      text: async () => JSON.stringify({ error: "Forbidden" }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderExplorer();

    await waitFor(() => {
      expect(screen.getByText("You do not have access to this project.")).toBeTruthy();
    });
  });

  it("shows sanitized error on 404", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
      text: async () => JSON.stringify({ error: "Not found" }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderExplorer();

    await waitFor(() => {
      expect(screen.getByText("Project or file not found.")).toBeTruthy();
    });
  });

  it("shows workspace-not-ready error on 503", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "Workspace not ready" }),
      text: async () => JSON.stringify({ error: "Workspace not ready" }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderExplorer();

    await waitFor(() => {
      expect(screen.getByText("Workspace is not ready yet. Try again in a moment.")).toBeTruthy();
    });
  });

  it("shows generic error on network failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    renderExplorer();

    await waitFor(() => {
      // TypeError's message is displayed directly by the catch handler
      expect(screen.getByText("Failed to fetch")).toBeTruthy();
    });
  });

  it("shows error on malformed JSON response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error("Invalid JSON"); },
      text: async () => "not json",
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderExplorer();

    // The json() parse failure throws and is caught by fetchEntries.
    // The Error's message is displayed directly.
    await waitFor(() => {
      expect(screen.getByText("Invalid JSON")).toBeTruthy();
    }, { timeout: 3000 });
  });
});

describe("FileExplorer — accessible button names", () => {
  it("has aria-label on refresh button", () => {
    render(<FileExplorer projectId="proj_abc" />);
    expect(screen.getByLabelText("Refresh file list")).toBeTruthy();
  });

  it("has aria-label on create button", () => {
    render(<FileExplorer projectId="proj_abc" />);
    expect(screen.getByLabelText("Create new file")).toBeTruthy();
  });

  it("has aria-label on expand/collapse folder buttons", async () => {
    mockFetch({
      ".": [{ name: "src", type: "folder" }],
    });
    renderExplorer();

    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    const folderBtn = screen.getByLabelText("Expand folder src");
    expect(folderBtn).toBeTruthy();
  });

  it("has aria-label on delete buttons", async () => {
    mockFetch({
      ".": [{ name: "old.ts", type: "file" }],
    });
    renderExplorer();

    await waitFor(() => expect(screen.getByText("old.ts")).toBeTruthy());
    expect(screen.getByLabelText("Delete old.ts")).toBeTruthy();
  });
});

describe("FileExplorer — endpoint contract", () => {
  it("uses /api/studio-projects/{projectId}/files for GET", async () => {
    const fetchMock = mockFetch({ ".": [] });
    renderExplorer({ projectId: "proj_xyz" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/studio-projects/proj_xyz/files");
  });

  it("never calls terminal-server endpoints directly", async () => {
    const fetchMock = mockFetch({ ".": [] });
    renderExplorer();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const call of fetchMock.mock.calls) {
      const url = call[0] as string;
      expect(url).not.toContain("localhost:4001");
      expect(url).not.toContain("/ws-files");
      expect(url).not.toContain("terminal-server");
    }
  });

  it("encodes the path parameter", async () => {
    const fetchMock = mockFetch({ ".": [] });
    renderExplorer();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("path=.");
  });
});
