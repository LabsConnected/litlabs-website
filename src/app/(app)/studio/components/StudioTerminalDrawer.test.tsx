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

  it("shows terminal session not started initially", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(screen.getByText(/Not started/i)).toBeDefined();
  });
});
