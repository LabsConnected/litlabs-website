import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock TerminalPanel (dynamic import)
vi.mock("@/components/litt-terminal/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

import StudioTerminalDrawer from "@/app/(app)/studio/components/StudioTerminalDrawer";

describe("StudioTerminalDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows no-project message when projectId is null", () => {
    render(<StudioTerminalDrawer projectId={null} />);
    expect(screen.getByText(/No project selected/i)).toBeDefined();
  });

  it("renders workspace provisioning status when projectId is provided", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(screen.getByText(/Workspace provisioning/i)).toBeDefined();
  });

  it("auto-attaches the terminal by default (no explicit opt-out)", () => {
    localStorage.removeItem("litt:terminalAutoStart");
    render(<StudioTerminalDrawer projectId="proj-1" />);
    // "Not started" must NOT appear — the session begins connecting immediately.
    expect(screen.queryByText(/Not started/i)).toBeNull();
  });

  it("stays parked only when the user explicitly opted out", () => {
    localStorage.setItem("litt:terminalAutoStart", "0");
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(screen.getByText(/Not started/i)).toBeDefined();
    localStorage.removeItem("litt:terminalAutoStart");
  });
});
