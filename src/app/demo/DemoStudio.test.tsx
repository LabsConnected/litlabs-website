import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

/* ── Mocks ─────────────────────────────────────────────────────────── */

const authState = { isSignedIn: false };
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => authState,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/demo",
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import DemoStudio from "./DemoStudio";
import { DEMO_TRANSCRIPT_KEY } from "@/lib/demo/constants";

const LIMIT_TEXT = "Sign up to keep building with LiTT.";

function okReply(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        limitReached: false,
        reply: "Demo answer.",
        remaining: 4,
        provider: "openrouter-free",
        ...overrides,
      }),
  };
}

describe("DemoStudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isSignedIn = false;
    window.localStorage.clear();
    fetchMock.mockResolvedValue(okReply());
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("always shows the honest demo badge (truthfulness)", () => {
    render(<DemoStudio maxMessages={5} disabled={false} killSwitch={false} />);
    const badges = screen.getAllByTestId("demo-badge");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]).toHaveTextContent("Demo — limited preview");
    // The welcome message is honest about demo limits.
    expect(screen.getByTestId("demo-messages")).toHaveTextContent(/limited demo/i);
  });

  it("routes every gated capability to the signup wall — never fake-executes", async () => {
    const user = userEvent.setup();
    render(<DemoStudio maxMessages={5} disabled={false} killSwitch={false} />);

    for (const cap of ["builder", "preview", "agents", "files", "terminal", "deploy"]) {
      await user.click(screen.getByTestId(`demo-cap-${cap}`));
      const wall = screen.getByTestId("signup-wall");
      expect(wall).toHaveTextContent(LIMIT_TEXT);
      // Wall CTA preserves the demo destination through signup.
      expect(screen.getByTestId("signup-wall-cta")).toHaveAttribute(
        "href",
        "/sign-in?redirect_url=/demo",
      );
      await user.click(screen.getByLabelText("Close"));
      expect(screen.queryByTestId("signup-wall")).not.toBeInTheDocument();
    }
    // No capability tap ever touched the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends {message, history} and renders the reply", async () => {
    const user = userEvent.setup();
    render(<DemoStudio maxMessages={5} disabled={false} killSwitch={false} />);

    await user.type(screen.getByLabelText("Message LiTT"), "What can you do?");
    await user.click(screen.getByTestId("demo-send"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/demo/chat");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body).sort()).toEqual(["history", "message"]);
    expect(body.message).toBe("What can you do?");

    await waitFor(() =>
      expect(screen.getByTestId("demo-messages")).toHaveTextContent("Demo answer."),
    );
    expect(screen.getByTestId("demo-remaining")).toHaveTextContent("4 of 5 demo messages left");
  });

  it("persists the transcript to localStorage and restores it on remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <DemoStudio maxMessages={5} disabled={false} killSwitch={false} />,
    );

    await user.type(screen.getByLabelText("Message LiTT"), "remember this");
    await user.click(screen.getByTestId("demo-send"));
    await waitFor(() =>
      expect(screen.getByTestId("demo-messages")).toHaveTextContent("Demo answer."),
    );

    const stored = JSON.parse(window.localStorage.getItem(DEMO_TRANSCRIPT_KEY)!);
    expect(stored.messages).toHaveLength(2);
    expect(stored.messages[0]).toMatchObject({ role: "user", content: "remember this" });
    expect(stored.messages[1]).toMatchObject({ role: "assistant", content: "Demo answer." });

    // Remount: the transcript carries through (signup round-trip safe).
    unmount();
    render(<DemoStudio maxMessages={5} disabled={false} killSwitch={false} />);
    const messages = screen.getByTestId("demo-messages");
    expect(messages).toHaveTextContent("remember this");
    expect(messages).toHaveTextContent("Demo answer.");
  });

  it("opens the signup wall with the exact limit copy when the ceiling is hit", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      okReply({ limitReached: true, remaining: 0, reply: "Final demo answer." }),
    );
    render(<DemoStudio maxMessages={5} disabled={false} killSwitch={false} />);

    await user.type(screen.getByLabelText("Message LiTT"), "last one");
    await user.click(screen.getByTestId("demo-send"));

    await waitFor(() => expect(screen.getByTestId("signup-wall")).toBeInTheDocument());
    const wall = screen.getByTestId("signup-wall");
    expect(within(wall).getByRole("heading")).toHaveTextContent(LIMIT_TEXT);
    // Composer is replaced by the limit CTA — no more messages can be sent.
    expect(screen.getByTestId("demo-limit-cta")).toHaveTextContent(LIMIT_TEXT);
    expect(screen.queryByTestId("demo-composer")).not.toBeInTheDocument();
  });

  it("renders the disabled state when the kill switch is on — no chat UI", () => {
    render(<DemoStudio maxMessages={5} disabled={true} killSwitch={true} />);
    expect(screen.getByTestId("demo-disabled")).toHaveTextContent(
      "temporarily unavailable",
    );
    expect(screen.getByTestId("demo-badge")).toHaveTextContent("Demo — limited preview");
    expect(screen.queryByTestId("demo-composer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("demo-send")).not.toBeInTheDocument();
  });

  it("offers signed-in visitors a Continue in Studio path", () => {
    authState.isSignedIn = true;
    window.localStorage.setItem(
      DEMO_TRANSCRIPT_KEY,
      JSON.stringify({
        messages: [{ role: "user", content: "earlier question" }],
        updatedAt: Date.now(),
      }),
    );
    render(<DemoStudio maxMessages={5} disabled={false} killSwitch={false} />);
    const banner = screen.getByTestId("demo-continue-banner");
    expect(banner).toHaveTextContent(/signed in/i);
    expect(screen.getByTestId("demo-continue-studio")).toHaveAttribute("href", "/studio");
    // Transcript summary travels with the banner.
    expect(banner).toHaveTextContent("1 messages");
  });
});
