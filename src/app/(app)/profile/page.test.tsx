/**
 * P1-5: Profile save fake success — regression tests.
 *
 * The profile page used to apply optimistic UI updates and close the edit
 * dialog without ever checking the persistence response, so a failed save
 * looked successful while nothing was stored server-side. These tests pin
 * the honest behavior:
 *  - save ok    → UI shows SERVER-returned values, dialog closes
 *  - save 500   → error shown, UI untouched (last confirmed values), dialog stays open
 *  - network throw → same truthful state as 500
 *  - retry      → fail then succeed → ends with persisted server values
 *  - avatar/cover upload or profile-persist failure → error shown, UI untouched
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { UserProfile } from "@/context/ProfileContext";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

// ---- Mock profile store (stands in for ProfileContext) ----
const profileState = {
  profile: null as unknown as UserProfile,
  updateProfile: vi.fn(),
};
vi.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({
    profile: profileState.profile,
    updateProfile: profileState.updateProfile,
    resetProfile: vi.fn(),
    loading: false,
  }),
}));

// ---- Capture child-component props so tests can drive the page ----
const captured: Record<string, any> = {};

vi.mock("./_components/ProfileCover", () => ({
  ProfileCover: (props: any) => {
    captured.cover = props;
    return (
      <div data-testid="profile-cover">
        <span data-testid="cover-src">{props.coverPreview ?? props.coverUrl ?? "none"}</span>
        <button data-testid="cover-select" onClick={() => props.onFileSelect(new File(["x"], "cover.png", { type: "image/png" }))}>
          select cover
        </button>
        <button data-testid="cover-confirm" onClick={props.onConfirm}>
          confirm cover
        </button>
        {props.uploadError && <p data-testid="cover-error">{props.uploadError}</p>}
      </div>
    );
  },
}));

vi.mock("./_components/ProfileIdentity", () => ({
  ProfileIdentity: (props: any) => {
    captured.identity = props;
    return (
      <div data-testid="profile-identity">
        <span data-testid="avatar-src">{props.avatarPreview ?? props.profile.avatarUrl ?? "none"}</span>
        <button data-testid="avatar-select" onClick={() => props.onAvatarSelect(new File(["x"], "avatar.png", { type: "image/png" }))}>
          select avatar
        </button>
        <button data-testid="avatar-confirm" onClick={props.onAvatarConfirm}>
          confirm avatar
        </button>
        <button data-testid="edit-profile" onClick={props.onEditProfile}>
          edit profile
        </button>
        {props.uploadError && <p data-testid="avatar-error">{props.uploadError}</p>}
      </div>
    );
  },
}));

vi.mock("./_components/ProfileTabs", () => ({
  ProfileTabs: () => <div data-testid="profile-tabs" />,
}));
vi.mock("./_components/ProfileOverview", () => ({
  ProfileOverview: () => <div data-testid="profile-overview" />,
}));
vi.mock("./_components/ProfileRightRail", () => ({
  ProfileRightRail: () => <div data-testid="profile-right-rail" />,
}));
vi.mock("./_components/CreatorActionPanel", () => ({
  CreatorActionPanel: () => <div data-testid="creator-action-panel" />,
}));

// The real dialog is rendered: its "only close on confirmed save" behavior
// is part of the P1-5 fix and must be tested, not mocked away.
import ProfilePage from "./page";

const initialProfile: UserProfile = {
  displayName: "Old Name",
  username: "oldname",
  bio: "Old bio",
  mood: "creative",
  avatarUrl: null,
  coverUrl: null,
  location: "Old Town",
  website: "https://old.site",
  interests: [],
  musicLinks: {},
  videoLinks: {},
  socialLinks: {},
  badges: [],
  wallpaper: "afterglow",
  customWallpaperUrl: null,
  wallpaperFit: "cover",
  wallpaperOverlay: 0.46,
  wallpaperBlur: 0,
  wallpaperEffect: "constellation",
  sidebarStyle: "comfortable",
  accentColor: "#fbbf24",
};

const serverUser = {
  id: "user-1",
  clerk_id: "clerk-1",
  email: "user@example.com",
  name: "Server Name",
  username: "servername",
  avatar_url: null,
  cover_url: null,
  bio: "Server bio",
  website: "https://server.site",
  location: "Server Town",
  created_at: new Date().toISOString(),
};

const jsonResponse = (body: unknown, ok: boolean, status: number) =>
  ({
    ok,
    status,
    json: async () => body,
  }) as Response;

const fetchCalls: Array<{ url: string; body: unknown }> = [];
let fetchHandler: (url: string, init: RequestInit) => Promise<Response>;

const renderPage = () => {
  profileState.profile = { ...initialProfile };
  profileState.updateProfile = vi.fn();
  render(<ProfilePage />);
};

const openDialog = () => {
  fireEvent.click(screen.getByTestId("edit-profile"));
  expect(screen.getByRole("dialog")).toBeTruthy();
};

const setDialogName = (value: string) => {
  fireEvent.change(screen.getByPlaceholderText("Your name"), {
    target: { value },
  });
};

const clickDialogSave = () => {
  fireEvent.click(screen.getByRole("button", { name: /save changes|saving/i }));
};

beforeEach(() => {
  fetchCalls.length = 0;
  const impl = (url: any, init: any) => {
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(init.body as string) : null;
    } catch {
      body = init?.body ?? null;
    }
    fetchCalls.push({ url: String(url), body });
    return fetchHandler(String(url), init);
  };
  vi.stubGlobal("fetch", vi.fn(impl));
  // Default: unhandled endpoints fail loudly so a test can't pass on an
  // unexpected fetch.
  fetchHandler = async () => jsonResponse({ error: "unhandled" }, false, 500);
  if (typeof URL.createObjectURL !== "function") {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL =
      () => "blob:mock-preview";
  }
});

describe("P1-5 profile save honesty", () => {
  it("success: UI shows server-returned values and the dialog closes", async () => {
    vi.mocked(fetch).mockImplementation(async (url: any, init: any) => {
      fetchCalls.push({ url: String(url), body: JSON.parse(init.body as string) });
      return jsonResponse({ message: "ok", user: serverUser }, true, 200);
    });

    renderPage();
    openDialog();
    setDialogName("Typed Name — must NOT be shown as saved");
    clickDialogSave();

    await waitFor(() =>
      expect(profileState.updateProfile).toHaveBeenCalledTimes(1),
    );
    // Server is the source of truth: the UI reflects what was persisted,
    // not the optimistic typed copy.
    expect(profileState.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Server Name",
        username: "servername",
        bio: "Server bio",
        location: "Server Town",
        website: "https://server.site",
      }),
    );
    // The intended payload went to the server.
    expect(fetchCalls[0].body).toEqual(
      expect.objectContaining({ name: "Typed Name — must NOT be shown as saved" }),
    );
    // Dialog closed only after the confirmed save.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("backend failure (500): error shown, UI reverted, dialog stays open", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({ error: "DB exploded" }, false, 500),
    );

    renderPage();
    openDialog();
    setDialogName("Ghost Name");
    clickDialogSave();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/save failed/i);
    expect(alert.textContent).toContain("DB exploded");
    // No optimistic write: the profile was never touched.
    expect(profileState.updateProfile).not.toHaveBeenCalled();
    // Dialog stays open so the user can retry.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("network throw: same truthful state as a 500", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));

    renderPage();
    openDialog();
    setDialogName("Ghost Name");
    clickDialogSave();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't reach the server/i);
    expect(profileState.updateProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("retry: fail then succeed ends with persisted server values", async () => {
    let attempts = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) return jsonResponse({ error: "first fail" }, false, 500);
      return jsonResponse({ message: "ok", user: serverUser }, true, 200);
    });

    renderPage();
    openDialog();
    clickDialogSave();

    await screen.findByRole("alert");
    expect(profileState.updateProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Retry from the still-open dialog.
    clickDialogSave();
    await waitFor(() =>
      expect(profileState.updateProfile).toHaveBeenCalledTimes(1),
    );
    expect(profileState.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Server Name" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("avatar: profile-persist failure shows error and never touches the UI", async () => {
    vi.mocked(fetch).mockImplementation(async (url: any) => {
      if (String(url).includes("/api/upload")) {
        return jsonResponse({ url: "https://cdn.example.com/avatar.png" }, true, 200);
      }
      return jsonResponse({ error: "DB exploded" }, false, 500);
    });

    renderPage();
    fireEvent.click(screen.getByTestId("avatar-select"));
    await waitFor(() =>
      expect(screen.getByTestId("avatar-src").textContent).toBe("blob:mock-preview"),
    );
    fireEvent.click(screen.getByTestId("avatar-confirm"));

    const error = await screen.findByTestId("avatar-error");
    expect(error.textContent).toMatch(/not saved/i);
    // The uploaded-but-unpersisted URL must never reach the UI.
    expect(profileState.updateProfile).not.toHaveBeenCalled();
    // Preview retained so the user can retry without re-selecting.
    expect(screen.getByTestId("avatar-src").textContent).toBe("blob:mock-preview");
  });

  it("cover: upload failure shows error and never touches the UI", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({ error: "storage down" }, false, 503),
    );

    renderPage();
    fireEvent.click(screen.getByTestId("cover-select"));
    await waitFor(() =>
      expect(screen.getByTestId("cover-src").textContent).toBe("blob:mock-preview"),
    );
    fireEvent.click(screen.getByTestId("cover-confirm"));

    const error = await screen.findByTestId("cover-error");
    expect(error.textContent).toMatch(/not saved/i);
    expect(profileState.updateProfile).not.toHaveBeenCalled();
    expect(screen.getByTestId("cover-src").textContent).toBe("blob:mock-preview");
  });

  it("avatar: successful upload + persist updates the UI from the server data", async () => {
    vi.mocked(fetch).mockImplementation(async (url: any) => {
      if (String(url).includes("/api/upload")) {
        return jsonResponse({ url: "https://cdn.example.com/avatar.png" }, true, 200);
      }
      return jsonResponse(
        {
          message: "ok",
          user: { ...serverUser, avatar_url: "https://cdn.example.com/avatar.png" },
        },
        true,
        200,
      );
    });

    renderPage();
    fireEvent.click(screen.getByTestId("avatar-select"));
    fireEvent.click(screen.getByTestId("avatar-confirm"));

    await waitFor(() =>
      expect(profileState.updateProfile).toHaveBeenCalledTimes(1),
    );
    expect(profileState.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarUrl: "https://cdn.example.com/avatar.png",
      }),
    );
    expect(screen.queryByTestId("avatar-error")).toBeNull();
  });
});
