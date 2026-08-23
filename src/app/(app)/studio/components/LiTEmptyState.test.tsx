import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import LiTEmptyState from "@/app/(app)/studio/components/LiTEmptyState";

// Mock LiTTPresence to avoid next/image loading in unit tests.
// LiTTPresence is the current production visual centerpiece rendered by
// LiTEmptyState. We verify it renders with the expected props (state,
// variant, size) rather than testing its internal image loading here.
vi.mock("@/app/(app)/studio/components/LiTTPresence", () => ({
  default: ({ state, variant, size }: {
    state: string;
    variant: string;
    size: string;
  }) => (
    <div
      data-testid="litt-presence"
      aria-label="LiTT Studio operator presence"
      data-state={state}
      data-variant={variant}
      data-size={size}
    />
  ),
  __esModule: true,
}));

// Mock StudioActivityTimeline to avoid async fetch in the empty-state tests
vi.mock("@/app/(app)/studio/components/StudioActivityTimeline", () => ({
  default: () => null,
  __esModule: true,
}));

describe("LiTEmptyState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows project suggestions when hasProject is true with github source", () => {
    render(
      <LiTEmptyState
        hasProject={true}
        projectId="proj-1"
        projectName="owner/repo"
        sourceType="github"
        githubInstalled={true}
        onPickAction={vi.fn()}
        onStartBlankAction={vi.fn()}
        onConnectRepoAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Suggestions")).toBeDefined();
    expect(screen.getByText("owner/repo")).toBeDefined();
  });

  it("shows blank project badge when sourceType is blank", () => {
    render(
      <LiTEmptyState
        hasProject={true}
        projectId="blank-1"
        projectName="My Blank"
        sourceType="blank"
        githubInstalled={false}
        onPickAction={vi.fn()}
        onStartBlankAction={vi.fn()}
        onConnectRepoAction={vi.fn()}
      />,
    );

    expect(screen.getByText(/Blank project ready/)).toBeDefined();
    expect(screen.getAllByText(/My Blank/).length).toBeGreaterThan(0);
  });

  it("shows GitHub connect prompt when githubInstalled but no project", () => {
    render(
      <LiTEmptyState
        hasProject={false}
        projectId={null}
        projectName={null}
        sourceType={null}
        githubInstalled={true}
        onPickAction={vi.fn()}
        onStartBlankAction={vi.fn()}
        onConnectRepoAction={vi.fn()}
      />,
    );

    expect(screen.getByText(/GitHub connected — select a repository/i)).toBeDefined();
    expect(screen.getByText("Connect repo")).toBeDefined();
    expect(screen.getByText("Start blank")).toBeDefined();
  });

  it("shows no-project state when no GitHub and no project", () => {
    render(
      <LiTEmptyState
        hasProject={false}
        projectId={null}
        projectName={null}
        sourceType={null}
        githubInstalled={false}
        onPickAction={vi.fn()}
        onStartBlankAction={vi.fn()}
        onConnectRepoAction={vi.fn()}
      />,
    );

    expect(screen.getByText(/workspace optional|Chat ready/)).toBeDefined();
    expect(screen.getByText("Start blank")).toBeDefined();
    expect(screen.getByText("Connect repo")).toBeDefined();
    expect(screen.getByText("Upload project")).toBeDefined();
  });

  it("renders LiTTPresence with idle state and empty-state variant", () => {
    const onPickAction = vi.fn();
    render(
      <LiTEmptyState
        hasProject={false}
        projectId={null}
        projectName={null}
        sourceType={null}
        githubInstalled={false}
        onPickAction={onPickAction}
      />,
    );

    // LiTTPresence is the production visual centerpiece — verify it renders
    // with the correct props passed from LiTEmptyState.
    const presence = screen.getByTestId("litt-presence");
    expect(presence).toBeDefined();
    expect(presence.getAttribute("aria-label")).toBe("LiTT Studio operator presence");
    expect(presence.getAttribute("data-state")).toBe("idle");
    expect(presence.getAttribute("data-variant")).toBe("empty-state");
    expect(presence.getAttribute("data-size")).toBe("xl");
  });
});
