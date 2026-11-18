import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { clearHostExecSettled } from "@/lib/studio/host-exec-session";

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

  describe("HOST_EXECUTION_DISABLED prepare verdict", () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: "Execution is unavailable on this deployment. No verified sandbox isolation exists.",
          code: "HOST_EXECUTION_DISABLED",
          context: "workspace.prepare",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );

    beforeEach(() => {
      clearHostExecSettled();
      fetchMock.mockClear();
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      clearHostExecSettled();
    });

    it("settles into the honest unavailable state with no Retry affordance", async () => {
      render(<StudioTerminalDrawer projectId="proj-repo" />);
      await waitFor(() => {
        expect(screen.getByText(/Repo workspace unavailable/i)).toBeDefined();
      });
      expect(screen.getByText(/secure sandbox/i)).toBeDefined();
      expect(screen.queryByText(/^Retry$/i)).toBeNull();
      expect(screen.queryByLabelText(/Restart workspace/i)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not re-POST prepare on remount after the verdict", async () => {
      const first = render(<StudioTerminalDrawer projectId="proj-repo" />);
      await waitFor(() => {
        expect(screen.getByText(/Repo workspace unavailable/i)).toBeDefined();
      });
      first.unmount();
      render(<StudioTerminalDrawer projectId="proj-repo" />);
      await waitFor(() => {
        expect(screen.getByText(/Repo workspace unavailable/i)).toBeDefined();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
