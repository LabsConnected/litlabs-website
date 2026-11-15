import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StudioProjectFiles from "./StudioProjectFiles";
import { clearHostExecSettled } from "@/lib/studio/host-exec-session";
import { STUDIO_EVENT_OPEN_FILE } from "@/lib/canvas/panel-actions";

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken }),
}));

vi.mock("../context/StudioContext", () => ({
  useStudioContext: () => ({
    setActiveFile: vi.fn(),
    activeFile: null,
  }),
}));

describe("StudioProjectFiles", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
    clearHostExecSettled();
  });

  it("loads nested files, opens text, and saves through the project API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ name: "src", type: "folder" }, { name: "README.md", type: "file", size: 10 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ name: "App.tsx", type: "file", size: 20 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: "export default function App() {}" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ name: "App.tsx", type: "file", size: 28 }] }), { status: 200 }));

    const onSaved = vi.fn();
    render(<StudioProjectFiles projectId="project-1" repositoryName="owner/repo" branch="main" workspaceStatus="ready" writeAccess onSaved={onSaved} />);

    await screen.findByText("README.md");
    fireEvent.click(screen.getByTitle("src"));
    await screen.findByText("App.tsx");
    fireEvent.click(screen.getByTitle("src/App.tsx"));

    const editor = await screen.findByRole("textbox", { name: "Edit src/App.tsx" });
    fireEvent.change(editor, { target: { value: "export default function App() { return null; }" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/studio-projects/project-1/files",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"action":"write"') }),
    );
  });

  it("keeps mutations unavailable when the workspace is not writable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    render(<StudioProjectFiles projectId="project-1" repositoryName={null} branch={null} workspaceStatus="preparing" writeAccess={false} />);

    await screen.findByText("No files found.");
    expect((screen.getByTitle("Create file") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/workspace is preparing/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /prepare/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks save and offers reload when LiTT rewrites the open file with unsaved edits", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ name: "App.tsx", type: "file", size: 20 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: "v1 from disk" }), { status: 200 }))
      // Directory refresh triggered by the files-changed event
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ name: "App.tsx", type: "file", size: 21 }] }), { status: 200 }))
      // Reload latest after the conflict
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: "v2 written by LiTT" }), { status: 200 }));

    render(<StudioProjectFiles projectId="project-1" repositoryName="owner/repo" branch="main" workspaceStatus="ready" writeAccess />);

    await screen.findByText("App.tsx");
    fireEvent.click(screen.getByTitle("App.tsx"));
    const editor = await screen.findByRole("textbox", { name: "Edit App.tsx" });
    fireEvent.change(editor, { target: { value: "my unsaved edits" } });

    // LiTT rewrites the same file while the user has unsaved edits.
    window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId: "project-1", path: "App.tsx" } }));

    await screen.findByText(/LiTT changed this file while you had unsaved edits/i);
    const saveBtn = screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Reload latest pulls LiTT's content and clears the conflict.
    fireEvent.click(screen.getByRole("button", { name: /Reload latest/i }));
    const editorAfter = await screen.findByRole("textbox", { name: "Edit App.tsx" });
    await waitFor(() => expect((editorAfter as HTMLTextAreaElement).value).toBe("v2 written by LiTT"));
    expect(screen.queryByText(/LiTT changed this file while you had unsaved edits/i)).toBeNull();
    expect((screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement).disabled).toBe(true); // clean, nothing to save
  });

  it("settles after one HOST_EXECUTION_DISABLED prepare — no prepare loop, no Prepare affordance", async () => {
    let prepareCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/workspace/prepare")) {
        prepareCalls += 1;
        return new Response(
          JSON.stringify({
            error: "Execution is unavailable on this deployment. No verified sandbox isolation exists.",
            code: "HOST_EXECUTION_DISABLED",
            context: "workspace.prepare",
          }),
          { status: 503 },
        );
      }
      // Files stay unavailable (workspace never becomes ready).
      return new Response(JSON.stringify({ error: "Workspace not ready", code: "WORKSPACE_NOT_READY" }), { status: 503 });
    });

    render(<StudioProjectFiles projectId="project-repo" repositoryName="owner/repo" branch="main" workspaceStatus="failed" writeAccess />);

    // The honest unavailable explanation appears exactly ONCE. (This
    // assertion previously used findAllByText and thereby pinned the
    // duplication: the settled verdict set the same message as the load
    // error, so the panel showed it in both the yellow gate banner and
    // the red error banner.)
    await screen.findByText(/secure sandbox/i);
    expect(screen.getAllByText(/secure sandbox/i)).toHaveLength(1);
    expect(prepareCalls).toBe(1);

    // Give any retry loop ample opportunity to fire, then use the manual
    // Refresh — neither may produce another prepare POST.
    await new Promise((resolve) => setTimeout(resolve, 400));
    fireEvent.click(screen.getByRole("button", { name: /refresh project files/i }));
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(prepareCalls).toBe(1);
    expect(screen.queryByRole("button", { name: /^Prepare$/i })).toBeNull();
    expect(screen.queryByText(/could not be re-prepared automatically/i)).toBeNull();
  });

  it("Refresh resets the one-shot auto-prepare budget so a manual retry genuinely re-prepares", async () => {
    let prepareCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/workspace/prepare")) {
        prepareCalls += 1;
        return new Response(JSON.stringify({ workspaceStatus: "ready", workspaceId: "ws-1" }), { status: 200 });
      }
      // The outage window, keyed on prepares rather than fetch counts
      // (the mount effect can re-fire loads as `preparing` toggles):
      // every listing fails recoverably until the SECOND prepare has
      // run — the first (automatic) prepare does not heal the outage,
      // the Refresh-triggered one does.
      if (prepareCalls < 2) {
        return new Response(JSON.stringify({ error: "Workspace not found" }), { status: 503 });
      }
      return new Response(JSON.stringify({ entries: [{ name: "index.html", type: "file", size: 42 }] }), { status: 200 });
    });

    render(<StudioProjectFiles projectId="project-1" repositoryName="owner/repo" branch="main" workspaceStatus="ready" writeAccess />);

    // Mount load fails → ONE automatic prepare → retry still fails →
    // the error stands and the per-mount budget is spent.
    await screen.findByText(/could not be re-prepared automatically/i, undefined, { timeout: 5000 });
    expect(prepareCalls).toBe(1);

    // Without a budget reset, Refresh would re-surface the same error
    // with no new prepare (the live-proof defect: only a fresh Studio
    // load ever retried). With the reset, the failing load runs a
    // SECOND prepare and the panel heals.
    fireEvent.click(screen.getByRole("button", { name: /refresh project files/i }));

    await screen.findByText("index.html", undefined, { timeout: 5000 });
    expect(prepareCalls).toBe(2);
  });

  it("keeps entry names laid out in narrow panels (container-scoped split, row actions out of flow)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ entries: [{ name: "assets", type: "folder" }, { name: "index.html", type: "file", size: 128 }] }), { status: 200 }),
    );
    render(<StudioProjectFiles projectId="project-1" repositoryName={null} branch="main" workspaceStatus="ready" writeAccess />);

    expect(await screen.findByText("index.html")).toBeTruthy();
    expect(screen.getByText("assets")).toBeTruthy();

    // The list/editor split keys off the panel's OWN width through a
    // container query. The old viewport `xl:` split also fired inside
    // the ~286px Files sidebar and starved the tree to ~130px.
    const layout = screen.getByTestId("studio-project-files-layout");
    expect(layout.className).toContain("@min-[560px]:grid-cols-");
    expect(layout.className).not.toContain("xl:grid-cols-");
    expect(screen.getByTestId("studio-project-files").className).toContain("@container");

    // Row actions are an absolute, pointer-events-none overlay: they no
    // longer reserve 72px (file) to 148px (folder) of row layout width
    // while invisible, which is what compressed the name span to zero
    // width and rendered the tree visually blank in the sidebar.
    const clusters = screen.getAllByTestId("file-row-actions");
    expect(clusters).toHaveLength(2);
    for (const cluster of clusters) {
      expect(cluster.className).toContain("absolute");
      expect(cluster.className).toContain("pointer-events-none");
    }
  });

  it("reloads a clean open file silently when LiTT rewrites it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ name: "App.tsx", type: "file", size: 20 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: "v1 from disk" }), { status: 200 }))
      // Directory refresh triggered by the files-changed event
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ name: "App.tsx", type: "file", size: 21 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: "v2 written by LiTT" }), { status: 200 }));

    render(<StudioProjectFiles projectId="project-1" repositoryName="owner/repo" branch="main" workspaceStatus="ready" writeAccess />);

    await screen.findByText("App.tsx");
    fireEvent.click(screen.getByTitle("App.tsx"));
    const editor = await screen.findByRole("textbox", { name: "Edit App.tsx" });

    window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId: "project-1", path: "App.tsx" } }));

    const editorAfter = await screen.findByRole("textbox", { name: "Edit App.tsx" });
    await waitFor(() => expect((editorAfter as HTMLTextAreaElement).value).toBe("v2 written by LiTT"));
    expect(screen.queryByText(/LiTT changed this file while you had unsaved edits/i)).toBeNull();
  });

  it("panel linking (B3): opening a file dispatches studio:open-file once, tagged files-panel, without looping", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ name: "README.md", type: "file", size: 10 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: "# hello" }), { status: 200 }));

    const received: unknown[] = [];
    const listener = (e: Event) => received.push((e as CustomEvent).detail);
    window.addEventListener(STUDIO_EVENT_OPEN_FILE, listener);
    try {
      render(<StudioProjectFiles projectId="project-1" repositoryName="owner/repo" branch="main" workspaceStatus="ready" writeAccess />);

      await screen.findByText("README.md");
      fireEvent.click(screen.getByTitle("README.md"));

      const editor = await screen.findByRole("textbox", { name: "Edit README.md" });
      expect((editor as HTMLTextAreaElement).value).toBe("# hello");
      // Exactly one linking dispatch for the open — the panel's own
      // listener ignores its tagged dispatch, so there is no re-entry
      // and the file content was read exactly once.
      expect(received).toEqual([{ projectId: "project-1", path: "README.md", source: "files-panel" }]);
      const readCalls = fetchMock.mock.calls.filter(([, init]) =>
        typeof init?.body === "string" && init.body.includes('"action":"read"'),
      );
      expect(readCalls).toHaveLength(1);
    } finally {
      window.removeEventListener(STUDIO_EVENT_OPEN_FILE, listener);
    }
  });

  it("panel linking (B3): an external studio:open-file event still selects the file", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ name: "README.md", type: "file", size: 10 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: "# from action" }), { status: 200 }));

    render(<StudioProjectFiles projectId="project-1" repositoryName="owner/repo" branch="main" workspaceStatus="ready" writeAccess />);

    await screen.findByText("README.md");
    fireEvent(window, new CustomEvent(STUDIO_EVENT_OPEN_FILE, { detail: { projectId: "project-1", path: "README.md" } }));

    const editor = await screen.findByRole("textbox", { name: "Edit README.md" });
    expect((editor as HTMLTextAreaElement).value).toBe("# from action");
  });
});
