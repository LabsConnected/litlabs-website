import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StudioProjectFiles from "./StudioProjectFiles";
import { clearHostExecSettled } from "@/lib/studio/host-exec-session";

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

    // The honest unavailable explanation appears (banner + error surface).
    await screen.findAllByText(/secure sandbox/i);
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
});
