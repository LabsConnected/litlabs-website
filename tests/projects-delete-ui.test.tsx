// @vitest-environment jsdom
/**
 * Projects page — delete UI regression tests.
 *
 * Larry's request (2026-09-16): 51 projects on /projects with no way to
 * delete them. The page now exposes the existing
 * DELETE /api/studio-projects/[projectId] endpoint through:
 *   - a per-card delete button with a confirm dialog
 *   - a Select mode with multi-select, "Duplicates" bulk pre-selection,
 *     and a bulk confirm dialog
 *
 * Verifies:
 *   - each card renders a delete button that opens the confirm dialog
 *   - confirming issues DELETE for that project id and refreshes the list
 *   - "Keep" dismisses without deleting
 *   - Select mode + Duplicates selects only timestamped acceptance-test names
 *   - bulk confirm deletes every selected project
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import * as React from "react";

vi.mock("next/link", () => ({
  default: ({ children, href, onClick, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/PageShell", () => ({
  default: ({ children }: any) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    resolvedColors: {
      bgColor: "#0a0a12",
      boxBg: "#14141f",
      borderColor: "#333344",
      textMuted: "#888899",
      textColor: "#ffffff",
      accentColor: "#72f238",
      headerColor: "#ffffff",
    },
  }),
}));

import ProjectsPage from "@/app/(app)/projects/page";

function project(id: string, name: string) {
  return {
    id,
    name,
    sourceType: "blank",
    githubFullName: null,
    githubBranch: null,
    workspaceStatus: "ready",
    runtimeStatus: "ready",
    updatedAt: new Date().toISOString(),
  };
}

const PROJECTS = [
  project("p1", "Golden Acceptance — Ember Roast"),
  project("p2", "Ember Roast V1 Acceptance 08-17-25"),
  project("p3", "Ember Roast V1 Acceptance 08-39-06"),
  project("p4", "litlabs-website"),
];

let fetchMock: ReturnType<typeof vi.fn>;
let deleteCalls: string[];

beforeEach(() => {
  deleteCalls = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      deleteCalls.push(url);
      return { ok: true, json: async () => ({ success: true }) };
    }
    return {
      ok: true,
      json: async () => ({ projects: PROJECTS, legacyOnly: [] }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderLoaded() {
  render(<ProjectsPage />);
  await waitFor(() => {
    expect(screen.getByText("Golden Acceptance — Ember Roast")).toBeTruthy();
  });
}

describe("projects delete UI", () => {
  it("renders a delete button on every project card", async () => {
    await renderLoaded();
    for (const p of PROJECTS) {
      expect(screen.getByRole("button", { name: new RegExp(`Delete ${p.name.replace(/[—()]/g, ".")}`) })).toBeTruthy();
    }
  });

  it("per-card delete opens a confirm dialog and deletes on confirm", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Delete litlabs-website/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("litlabs-website");
    fireEvent.click(screen.getByRole("button", { name: /Delete project/ }));
    await waitFor(() => {
      expect(deleteCalls).toContain("/api/studio-projects/p4");
    });
    expect(deleteCalls).toHaveLength(1);
    // list refreshes after delete
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([u]) => u === "/api/studio-projects").length).toBeGreaterThan(1);
    });
  });

  it("Keep dismisses the dialog without deleting", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Delete litlabs-website/ }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteCalls).toHaveLength(0);
  });

  it("Select mode + Duplicates selects only timestamped acceptance names, then bulk deletes", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicates" }));
    const deleteBtn = screen.getByRole("button", { name: /Delete \(2\)/ });
    fireEvent.click(deleteBtn);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Ember Roast V1 Acceptance 08-17-25");
    expect(dialog.textContent).toContain("Ember Roast V1 Acceptance 08-39-06");
    expect(dialog.textContent).not.toContain("Golden Acceptance");
    // confirm the bulk delete inside act for the async runDelete
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete 2 projects" }));
    });
    await waitFor(() => {
      expect(deleteCalls).toContain("/api/studio-projects/p2");
      expect(deleteCalls).toContain("/api/studio-projects/p3");
    });
    expect(deleteCalls).not.toContain("/api/studio-projects/p1");
    expect(deleteCalls).not.toContain("/api/studio-projects/p4");
  });

  it("Select mode card tap toggles selection instead of navigating", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const card = screen.getByText("litlabs-website").closest("a")!;
    expect(card.getAttribute("href")).toBe("#");
    fireEvent.click(card);
    expect(screen.getByRole("button", { name: /Delete \(1\)/ })).toBeTruthy();
  });
});
