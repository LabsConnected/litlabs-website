import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import StudioProjectPicker from "./StudioProjectPicker";

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken }),
}));

const projectsPayload = {
  projects: [
    { id: "p1", name: "Alpha", sourceType: "litt-managed" },
    { id: "p2", name: "Beta", sourceType: "litt-managed" },
  ],
  legacyOnly: [{ id: "legacy-1", name: "Oldie", sourceType: "litt-managed" }],
};

function mockListFetch() {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(projectsPayload), { status: 200 }),
  );
  return fetchMock;
}

async function openPicker(props?: {
  onSelect?: (id: string) => void;
  onDeleteProject?: (id: string) => void;
}) {
  const onSelect = props?.onSelect ?? vi.fn();
  const onDeleteProject = props?.onDeleteProject ?? vi.fn();
  render(
    <StudioProjectPicker
      projectId="p1"
      projectName="Alpha"
      onSelect={onSelect}
      onCreateProject={vi.fn()}
      onDeleteProject={onDeleteProject}
    />,
  );
  fireEvent.click(screen.getByTitle("Switch active project"));
  // The dropdown lists every project once the list fetch resolves.
  await waitFor(() => expect(screen.getByText("Oldie")).toBeTruthy());
  return { onSelect, onDeleteProject };
}

describe("StudioProjectPicker project deletion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("offers delete only for canonical projects, not legacy ones", async () => {
    mockListFetch();
    await openPicker();

    expect(screen.getByLabelText("Delete project Alpha")).toBeTruthy();
    expect(screen.getByLabelText("Delete project Beta")).toBeTruthy();
    expect(screen.queryByLabelText("Delete project Oldie")).toBeNull();
  });

  it("asks for confirmation and does not call DELETE until confirmed", async () => {
    const fetchMock = mockListFetch();
    await openPicker();

    fireEvent.click(screen.getByLabelText("Delete project Alpha"));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/permanently deletes/i)).toBeTruthy();
    // No DELETE issued yet — the confirm step is a real gate.
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE"),
    ).toBe(false);

    // Cancelling leaves everything untouched.
    fireEvent.click(within(dialog).getByText("Cancel"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText("Delete project Alpha")).toBeTruthy();
  });

  it("removes the project and notifies the parent only after the server confirms", async () => {
    const fetchMock = mockListFetch();
    const { onDeleteProject } = await openPicker();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    fireEvent.click(screen.getByLabelText("Delete project Alpha"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Delete project"));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === "/api/studio-projects/p1" &&
            (init as RequestInit | undefined)?.method === "DELETE",
        ),
      ).toBe(true);
    });
    await waitFor(() => expect(screen.queryByLabelText("Delete project Alpha")).toBeNull());
    expect(onDeleteProject).toHaveBeenCalledWith("p1");
    // The untouched project is still listed.
    expect(screen.getByLabelText("Delete project Beta")).toBeTruthy();
  });

  it("keeps the project and surfaces the error when the server rejects the delete", async () => {
    const fetchMock = mockListFetch();
    const { onDeleteProject } = await openPicker();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Project not found" }), { status: 404 }),
    );

    fireEvent.click(screen.getByLabelText("Delete project Alpha"));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Delete project"));

    // The failure is reported in the confirm panel — the project is NOT
    // removed, and the parent is NOT told a deletion happened.
    await waitFor(() => expect(within(dialog).getByText("Project not found")).toBeTruthy());
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(onDeleteProject).not.toHaveBeenCalled();
    // Cancelling after the failure returns to the intact project row.
    fireEvent.click(within(dialog).getByText("Cancel"));
    expect(screen.getByLabelText("Delete project Alpha")).toBeTruthy();
  });
});

describe("StudioProjectPicker dropdown placement (mobile regression)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders the open menu as a fixed portal on document.body, not inside the scrollable header", async () => {
    mockListFetch();
    // Simulate the studio header: overflow-x: auto on mobile clips any
    // absolutely-positioned dropdown inside it (the reported bug).
    const { container } = render(
      <div style={{ overflowX: "auto", overflowY: "hidden", height: 52 }}>
        <StudioProjectPicker
          projectId="p1"
          projectName="Golden Acceptance — Ember Roast"
          onSelect={vi.fn()}
          onCreateProject={vi.fn()}
          onDeleteProject={vi.fn()}
        />
      </div>,
    );
    fireEvent.click(screen.getByTitle("Switch active project"));
    await waitFor(() => expect(screen.getByText("Beta")).toBeTruthy());

    const menu = screen.getByTestId("project-picker-menu");
    // Fixed positioning escapes the overflow-x: auto clipping ancestor…
    expect(menu.className).toMatch(/fixed/);
    // …and the portal mounts it on document.body, outside the header.
    expect(menu.parentElement).toBe(document.body);
    expect(container.querySelector('[data-testid="project-picker-menu"]')).toBeNull();
  });

  it("closes the menu on Escape", async () => {
    mockListFetch();
    render(
      <StudioProjectPicker
        projectId="p1"
        projectName="Golden Acceptance — Ember Roast"
        onSelect={vi.fn()}
        onCreateProject={vi.fn()}
        onDeleteProject={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle("Switch active project"));
    await waitFor(() => expect(screen.getByTestId("project-picker-menu")).toBeTruthy());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("project-picker-menu")).toBeNull());
  });
});
