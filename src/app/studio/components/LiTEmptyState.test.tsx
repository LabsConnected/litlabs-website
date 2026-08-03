import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import LiTEmptyState from "@/app/studio/components/LiTEmptyState";

// Mock LiTTPresence to avoid image loading
vi.mock("@/app/studio/components/LiTTPresence", () => ({
  default: () => <div data-testid="litt-presence" />,
  __esModule: true,
}));

// Mock StudioActivityTimeline to avoid async fetch in the empty-state tests
vi.mock("@/app/studio/components/StudioActivityTimeline", () => ({
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
        onPick={vi.fn()}
        onStartBlank={vi.fn()}
        onConnectRepo={vi.fn()}
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
        onPick={vi.fn()}
        onStartBlank={vi.fn()}
        onConnectRepo={vi.fn()}
      />,
    );

    expect(screen.getByText(/Blank project ready/)).toBeDefined();
    expect(screen.getByText(/My Blank/)).toBeDefined();
  });

  it("shows GitHub connect prompt when githubInstalled but no project", () => {
    render(
      <LiTEmptyState
        hasProject={false}
        projectId={null}
        projectName={null}
        sourceType={null}
        githubInstalled={true}
        onPick={vi.fn()}
        onStartBlank={vi.fn()}
        onConnectRepo={vi.fn()}
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
        onPick={vi.fn()}
        onStartBlank={vi.fn()}
        onConnectRepo={vi.fn()}
      />,
    );

    expect(screen.getByText(/workspace optional|Chat ready/)).toBeDefined();
    expect(screen.getByText("Start blank")).toBeDefined();
    expect(screen.getByText("Connect repo")).toBeDefined();
    expect(screen.getByText("Upload project")).toBeDefined();
  });

  it("renders LiTTPresence mascot", () => {
    render(
      <LiTEmptyState
        hasProject={false}
        projectId={null}
        projectName={null}
        sourceType={null}
        githubInstalled={false}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByTestId("litt-presence")).toBeDefined();
  });
});
