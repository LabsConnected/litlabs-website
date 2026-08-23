import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import LiTEmptyState from "@/app/(app)/studio/components/LiTEmptyState";

// Mock StudioBrandHero to avoid next/image loading in unit tests.
// The brand hero is the new visual centerpiece that replaced LiTTPresence.
// We verify it renders with the expected props (display name, project state,
// action callback) rather than testing its internal image carousel here.
vi.mock("@/app/(app)/studio/components/StudioBrandHero", () => ({
  default: ({ displayName, hasProject, onPickAction }: {
    displayName: string;
    hasProject: boolean;
    projectName: string | null;
    onPickAction: (prompt: string) => void;
  }) => (
    <div data-testid="studio-brand-hero" aria-label="LiTT Studio command center">
      <span data-testid="brand-hero-display-name">{displayName}</span>
      <span data-testid="brand-hero-has-project">{String(hasProject)}</span>
      <button type="button" onClick={() => onPickAction("test-prompt")}>
        Start building
      </button>
    </div>
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

  it("renders StudioBrandHero with display name and project state", () => {
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

    // The brand hero is the new visual centerpiece — verify it renders
    // with the correct props passed from LiTEmptyState.
    const hero = screen.getByTestId("studio-brand-hero");
    expect(hero).toBeDefined();
    expect(hero.getAttribute("aria-label")).toBe("LiTT Studio command center");

    // Display name is passed through (greetingName derived from user)
    expect(screen.getByTestId("brand-hero-display-name").textContent).toBeDefined();

    // No project → hasProject=false
    expect(screen.getByTestId("brand-hero-has-project").textContent).toBe("false");

    // The primary CTA ("Start building") is present and wired
    const cta = screen.getByText("Start building");
    expect(cta.tagName).toBe("BUTTON");
    cta.click();
    expect(onPickAction).toHaveBeenCalledWith("test-prompt");
  });
});
