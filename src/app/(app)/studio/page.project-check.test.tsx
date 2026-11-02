import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

const authState = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  userId: "user_e2e",
  getToken: async () => "test-token",
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => authState,
  useAppUser: () => ({ user: null }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/studio",
}));
vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    tokens: {
      background: "#000",
      surface: "#111",
      primary: "#72f238",
      text: "#fff",
      textMuted: "#888",
      border: "#333",
    },
  }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./components/CommandStudio", () => ({
  default: () => <div data-testid="command-studio-mock" />,
}));
vi.mock("./components/FirstRunWelcome", () => ({
  default: () => <div data-testid="first-run-welcome-mock" />,
}));
vi.mock("./lib/first-run-handoff", () => ({
  peekFirstRunProjectId: () => null,
  writeFirstRunHandoff: vi.fn(),
}));

const { default: StudioPage } = await import("./page");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function projectsResponse(projects: unknown[]) {
  return { ok: true, json: async () => ({ projects }) };
}

describe("StudioPage project check", () => {
  beforeEach(() => {
    authState.isLoaded = true;
    authState.isSignedIn = true;
    fetchMock.mockReset();
    window.history.replaceState(null, "", "/studio");
  });

  it("renders FirstRunWelcome when the user has zero projects", async () => {
    fetchMock.mockResolvedValue(projectsResponse([]));
    render(<StudioPage />);

    expect(await screen.findByTestId("first-run-welcome-mock")).toBeInTheDocument();
    expect(screen.queryByTestId("command-studio-mock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("studio-load-error")).not.toBeInTheDocument();
  });

  it("renders CommandStudio when the user has projects", async () => {
    fetchMock.mockResolvedValue(projectsResponse([{ id: "p1" }]));
    render(<StudioPage />);

    expect(await screen.findByTestId("command-studio-mock")).toBeInTheDocument();
    expect(screen.queryByTestId("first-run-welcome-mock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("studio-load-error")).not.toBeInTheDocument();
  });

  it("shows an honest error state when the check fails — no fail-open into CommandStudio", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<StudioPage />);

    expect(await screen.findByTestId("studio-load-error")).toBeInTheDocument();
    // Regression: previously a failed check assumed hasProjects and mounted
    // CommandStudio — a broken workspace for zero-project users.
    expect(screen.queryByTestId("command-studio-mock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("first-run-welcome-mock")).not.toBeInTheDocument();
  });

  it("shows the error state on network failure too", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    render(<StudioPage />);

    expect(await screen.findByTestId("studio-load-error")).toBeInTheDocument();
    expect(screen.queryByTestId("command-studio-mock")).not.toBeInTheDocument();
  });

  it("retry re-runs the check and recovers", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce(projectsResponse([{ id: "p1" }]));
    render(<StudioPage />);

    expect(await screen.findByTestId("studio-load-error")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByTestId("command-studio-mock")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
