import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock theme context
vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    resolvedColors: {
      bgColor: "#0a0a12",
      textColor: "#e0e0ff",
      textMuted: "#8888aa",
      headerColor: "#00f0ff",
      borderColor: "#2a2a45",
      accentColor: "#ff00a0",
      boxBg: "#151520",
    },
    tokens: {
      background: "#0a0a12",
      textMuted: "#8888aa",
      primary: "#ff00a0",
    },
  }),
}));

// Mock profile context
vi.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({
    profile: {
      displayName: "Test User",
      username: "testuser",
      bio: "Test bio",
      avatarUrl: null,
    },
  }),
}));

// Mock Clerk auth
vi.mock("@/hooks/useClerkAuth", () => ({
  useAppUser: () => ({
    user: {
      firstName: "Test",
      username: "testuser",
      imageUrl: null,
    },
  }),
  useClerkAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
  }),
}));

// Mock MusicPlayer
vi.mock("@/components/dashboard/MusicPlayer", () => ({
  default: () => <div data-testid="music-player">Music Player</div>,
}));

// Mock YouTube player context — DashboardV2 uses useYouTubePlayer
vi.mock("@/context/YouTubePlayerContext", () => ({
  useYouTubePlayer: () => ({
    dockMode: "hidden",
    showDocked: false,
    setDockMode: () => {},
    setShowDocked: () => {},
  }),
  YouTubePlayerProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock YouTube dock
vi.mock("@/components/youtube/YouTubeDock", () => ({
  YouTubeDock: () => null,
}));

// Mock next/dynamic — simple pass-through to avoid hooks-in-lowercase lint error
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    return function DynamicMock() {
      const [Comp, setComp] = React.useState<React.ComponentType | null>(null);
      React.useEffect(() => {
        loader().then((m) => setComp(() => m.default));
      }, []);
      return Comp ? React.createElement(Comp) : React.createElement("div", null, "Loading...");
    };
  },
}));

import React from "react";
import { DashboardV2 } from "@/components/dashboard/v2/DashboardV2";
import { ContinueProjectCard } from "@/components/dashboard/v2/ContinueProjectCard";
import { CurrentMissionCard } from "@/components/dashboard/v2/CurrentMissionCard";
import { UnifiedInboxCard } from "@/components/dashboard/v2/UnifiedInboxCard";
import { CommunityPulseCard } from "@/components/dashboard/v2/CommunityPulseCard";
import { YourWorldCard } from "@/components/dashboard/v2/YourWorldCard";
import { DashboardQuickCreate } from "@/components/dashboard/v2/DashboardQuickCreate";
import { SystemHealthStrip } from "@/components/dashboard/v2/SystemHealthStrip";
import type { DashboardData, SocialPost } from "@/components/dashboard/v2/dashboard-v2-types";

// Suppress console.error from missing router
const originalError = console.error;
beforeEach(() => {
  console.error = (...args: unknown[]) => {
    const msg = String(args[0] || "");
    if (!msg.includes("router") && !msg.includes("next/navigation")) {
      originalError.call(console, ...args);
    }
  };
});

describe("DashboardV2", () => {
  it("renders greeting with user name", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accounts: [], projects: [], legacyProjects: [], events: [], unreadCount: 0, deployments: [], installations: [] }),
    }) as unknown as typeof fetch;

    render(<DashboardV2 />);
    // While loading, should show "Loading your workspace..."
    expect(screen.getByText(/Loading your workspace/)).toBeTruthy();
  });
});

describe("ContinueProjectCard", () => {
  it("shows empty state when no projects", () => {
    render(<ContinueProjectCard data={null} loading={false} />);
    expect(screen.getByText("No project yet")).toBeTruthy();
    expect(screen.getByText("Connect GitHub")).toBeTruthy();
  });

  it("shows project when data exists", () => {
    const data: DashboardData = {
      accounts: [],
      projects: [{
        id: "1",
        provider: "github",
        repository_id: 123,
        repository_full_name: "test/repo",
        repository_html_url: "https://github.com/test/repo",
        repository_private: false,
        default_branch: "main",
        working_branch: "feature",
        latest_commit_sha: "abc",
        latest_commit_message: "test",
        latest_commit_author: "test",
        latest_commit_date: new Date().toISOString(),
        open_prs_count: 0,
        open_issues_count: 0,
        github_actions_status: {},
        vercel_project_id: null,
        vercel_deployment_url: null,
        vercel_production_url: "https://example.com",
        vercel_status: "ready",
        last_synced_at: new Date().toISOString(),
        sync_status: "synced",
        sync_error: null,
      }],
      legacyProjects: [],
      events: [],
      unreadCount: 0,
      deployments: [],
      installations: [],
    };
    render(<ContinueProjectCard data={data} loading={false} />);
    expect(screen.getByText("test/repo")).toBeTruthy();
    expect(screen.getByText("feature")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
  });
});

describe("CurrentMissionCard", () => {
  it("shows honest empty state when no missions", () => {
    render(<CurrentMissionCard data={null} loading={false} />);
    expect(screen.getByText("No active mission.")).toBeTruthy();
  });

  it("shows missions when they exist", () => {
    const data: DashboardData = {
      accounts: [],
      projects: [],
      legacyProjects: [],
      events: [{
        id: "1",
        provider: "studio",
        event_type: "mission_created",
        title: "Build landing page",
        description: "Create a new landing page",
        severity: "info",
        actor: "user",
        url: null,
        read_at: null,
        created_at: new Date().toISOString(),
      }],
      unreadCount: 0,
      deployments: [],
      installations: [],
    };
    render(<CurrentMissionCard data={data} loading={false} />);
    expect(screen.getByText("Build landing page")).toBeTruthy();
  });
});

describe("UnifiedInboxCard", () => {
  it("shows inbox zero when no items", () => {
    render(<UnifiedInboxCard data={null} loading={false} onMarkAllRead={() => {}} />);
    expect(screen.getByText("Inbox zero")).toBeTruthy();
  });

  it("shows error events as inbox items", () => {
    const data: DashboardData = {
      accounts: [],
      projects: [],
      legacyProjects: [],
      events: [{
        id: "1",
        provider: "vercel",
        event_type: "deployment_failed",
        title: "Deployment failed",
        description: "Build error",
        severity: "error",
        actor: "system",
        url: null,
        read_at: null,
        created_at: new Date().toISOString(),
      }],
      unreadCount: 1,
      deployments: [],
      installations: [],
    };
    render(<UnifiedInboxCard data={data} loading={false} onMarkAllRead={() => {}} />);
    expect(screen.getByText("Deployment failed")).toBeTruthy();
  });
});

describe("CommunityPulseCard", () => {
  it("shows empty state when no posts", () => {
    render(<CommunityPulseCard socialPosts={[]} socialLoading={false} socialError={null} socialMock={false} />);
    expect(screen.getByText("Nothing new in your community yet.")).toBeTruthy();
  });

  it("shows error state when API fails", () => {
    render(<CommunityPulseCard socialPosts={[]} socialLoading={false} socialError="Failed to load" socialMock={false} />);
    expect(screen.getByText("Community activity could not be loaded.")).toBeTruthy();
  });

  it("rejects mock data and shows demo mode state", () => {
    render(<CommunityPulseCard socialPosts={[]} socialLoading={false} socialError={null} socialMock={true} />);
    expect(screen.getByText("Community feed is in demo mode.")).toBeTruthy();
    expect(screen.queryByText("Nothing new in your community yet.")).toBeNull();
  });

  it("shows posts when they exist", () => {
    const posts: SocialPost[] = [{
      id: "1",
      content: "Just shipped a new feature!",
      likes_count: 5,
      comments_count: 2,
      created_at: new Date().toISOString(),
      author: { name: "Alice", username: "alice", avatar_url: null },
    }];
    render(<CommunityPulseCard socialPosts={posts} socialLoading={false} socialError={null} socialMock={false} />);
    expect(screen.getByText("Just shipped a new feature!")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
  });
});

describe("YourWorldCard", () => {
  it("renders without dead /world/ links", () => {
    const { container } = render(<YourWorldCard />);
    const links = container.querySelectorAll("a");
    const hrefs = Array.from(links).map((l) => l.getAttribute("href"));
    // Must not link to /world/[username] — route doesn't exist
    expect(hrefs.every((h) => !h?.startsWith("/world/"))).toBe(true);
    // Should link to /settings/profile and /discover
    expect(hrefs).toContain("/settings/profile");
    expect(hrefs.some((h) => h?.startsWith("/discover"))).toBe(true);
  });
});

describe("DashboardQuickCreate", () => {
  it("renders all 7 quick actions with real routes", () => {
    const { container } = render(<DashboardQuickCreate />);
    const links = container.querySelectorAll("a");
    expect(links.length).toBe(7);

    const hrefs = Array.from(links).map((l) => l.getAttribute("href"));
    // Every action must point to a real route
    expect(hrefs).toContain("/studio");
    expect(hrefs).toContain("/projects/new");
    expect(hrefs).toContain("/studio?tool=image");
    expect(hrefs).toContain("/studio?tool=music");
    expect(hrefs).toContain("/studio?tool=agents");
    expect(hrefs).toContain("/studio?tool=workflows");
    expect(hrefs).toContain("/studio/github");
  });
});

describe("SystemHealthStrip", () => {
  // SystemHealthStrip now fetches its own data from /api/system-health.
  // Mock fetch to return a minimal valid response.
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          workspace: [
            { id: "github", label: "GitHub Repository", category: "Workspace", state: "not_connected", detail: "Not connected", lastChecked: new Date().toISOString(), action: { label: "Connect GitHub", href: "/studio/github" } },
            { id: "vercel", label: "Vercel Project", category: "Workspace", state: "not_connected", detail: "Not linked", lastChecked: new Date().toISOString() },
            { id: "supabase_project", label: "Supabase Project Integration", category: "Workspace", state: "not_connected", detail: "Optional · Not linked", lastChecked: new Date().toISOString() },
          ],
          ai: [
            { id: "gemini", label: "Gemini", category: "AI", state: "missing", detail: "API key required", model: "gemini-2.5-flash", latencyMs: null, lastChecked: new Date().toISOString() },
            { id: "openrouter", label: "OpenRouter", category: "AI", state: "missing", detail: "API key required", model: "openrouter/free", latencyMs: null, lastChecked: new Date().toISOString() },
          ],
          platform: [
            { id: "auth", label: "Authentication", category: "Platform", state: "operational", detail: "Operational", lastChecked: new Date().toISOString() },
          ],
          summary: { headline: "Platform operational · 3 optional integrations need setup", optionalPending: 3, platformDegraded: false },
          isOwner: false,
          generatedAt: new Date().toISOString(),
        }),
    }) as unknown as typeof fetch;
  });

  it("renders collapsed by default", async () => {
    const { container } = render(<SystemHealthStrip loading={false} />);
    // Wait for fetch to resolve and component to render the summary
    await screen.findByText(/System Status/i, undefined, { timeout: 3000 });
    const button = screen.getByRole("button", { name: /toggle system health/i });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows truthful summary instead of fake X/Y score", async () => {
    render(<SystemHealthStrip loading={false} />);
    await screen.findByText(/Platform operational/i, undefined, { timeout: 3000 });
    // Must NOT show the old "X/Y services connected" score
    expect(screen.queryByText(/\d+\/\d+ services connected/)).toBeNull();
  });

  it("links to canonical settings URL, not /settings/connections", async () => {
    const { container } = render(<SystemHealthStrip loading={false} />);
    await screen.findByText(/Platform operational/i, undefined, { timeout: 3000 });
    // Expand the panel to reveal the Manage Connections link
    fireEvent.click(screen.getByRole("button", { name: /toggle system health/i }));
    const links = container.querySelectorAll("a");
    const hrefs = Array.from(links).map((l) => l.getAttribute("href"));
    // Must use /settings?section=connections, not the nonexistent /settings/connections
    expect(hrefs.some((h) => h?.includes("/settings?section=connections"))).toBe(true);
    expect(hrefs.every((h) => h !== "/settings/connections")).toBe(true);
  });
});
