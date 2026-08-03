import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock TerminalPanel (dynamic import)
vi.mock("@/components/litt-terminal/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

// Mock LiTTPresence
vi.mock("@/app/studio/components/LiTTPresence", () => ({
  default: () => <div data-testid="litt-presence" />,
}));

import StudioTerminalDrawer from "@/app/studio/components/StudioTerminalDrawer";

describe("StudioTerminalDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows no-project message when projectId is null", () => {
    render(<StudioTerminalDrawer projectId={null} />);
    expect(screen.getByText(/No project selected/i)).toBeDefined();
  });

  it("renders terminal header when projectId is provided", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(screen.getByText("Terminal")).toBeDefined();
  });

  it("renders LiTTPresence avatar in header", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(screen.getByTestId("litt-presence")).toBeDefined();
  });

  it("shows workspace preparing status initially", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(screen.getByText(/Preparing workspace/i)).toBeDefined();
  });
});
