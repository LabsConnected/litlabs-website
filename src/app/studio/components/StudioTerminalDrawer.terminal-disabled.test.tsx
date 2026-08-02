import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock TerminalPanel (dynamic import) — we will assert it never renders
vi.mock("@/components/litt-terminal/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

// Mock LiTTPresence
vi.mock("@/app/studio/components/LiTTPresence", () => ({
  default: () => <div data-testid="litt-presence" />,
}));

// Mock terminal-client to track fetch calls
const mockGetTerminalToken = vi.fn();
vi.mock("@/lib/terminal-client", () => ({
  getTerminalToken: (...args: unknown[]) => mockGetTerminalToken(...args),
}));

// Mock socket.io-client to track connections
const mockIo = vi.fn();
vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => mockIo(...args),
}));

import StudioTerminalDrawer from "@/app/studio/components/StudioTerminalDrawer";
import { isTerminalDisabled, isTerminalEnabled } from "@/lib/terminal-config";

describe("terminal-config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns disabled when NEXT_PUBLIC_TERMINAL_ENABLED=false", () => {
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "false");
    expect(isTerminalDisabled()).toBe(true);
    expect(isTerminalEnabled()).toBe(false);
  });

  it("returns disabled when TERMINAL_ENABLED=false", () => {
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", undefined);
    vi.stubEnv("TERMINAL_ENABLED", "false");
    expect(isTerminalDisabled()).toBe(true);
  });

  it("returns enabled by default when no flag is set", () => {
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", undefined);
    vi.stubEnv("TERMINAL_ENABLED", undefined);
    expect(isTerminalEnabled()).toBe(true);
    expect(isTerminalDisabled()).toBe(false);
  });

  it("returns enabled when NEXT_PUBLIC_TERMINAL_ENABLED=true", () => {
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "true");
    expect(isTerminalEnabled()).toBe(true);
  });
});

describe("StudioTerminalDrawer — terminal disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders Coming Soon card when terminal is disabled", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(screen.getByTestId("terminal-coming-soon")).toBeDefined();
    expect(screen.getByText(/Coming Soon/i)).toBeDefined();
  });

  it("does not render TerminalPanel when terminal is disabled", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(screen.queryByTestId("terminal-panel")).toBeNull();
  });

  it("does not render LiTTPresence avatar when terminal is disabled", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(screen.queryByTestId("litt-presence")).toBeNull();
  });

  it("does not call getTerminalToken when terminal is disabled", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(mockGetTerminalToken).not.toHaveBeenCalled();
  });

  it("does not call socket.io when terminal is disabled", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(mockIo).not.toHaveBeenCalled();
  });

  it("does not fetch workspace prepare endpoint when terminal is disabled", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("StudioTerminalDrawer — terminal enabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows no-project message when projectId is null and terminal enabled", () => {
    render(<StudioTerminalDrawer projectId={null} />);
    expect(screen.getByText(/No project selected/i)).toBeDefined();
  });

  it("renders terminal header when projectId is provided and terminal enabled", () => {
    render(<StudioTerminalDrawer projectId="proj-1" />);
    expect(screen.getByText("Terminal")).toBeDefined();
  });
});
