import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GlobalLittEntry from "./GlobalLittEntry";

const state = vi.hoisted(() => ({
  pathname: "/dashboard",
  params: new URLSearchParams(),
  push: vi.fn(),
  userId: "u",
  signedIn: true,
  getToken: vi.fn(async () => "token"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => state.params,
  useRouter: () => ({ push: state.push }),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({
    isSignedIn: state.signedIn,
    userId: state.userId,
    getToken: state.getToken,
  }),
}));

function conversation(revision = 1) {
  return {
    id: "global-conv",
    projectId: "global-project",
    ownerId: state.userId,
    title: "Global LiTT",
    activeAgentSlug: "litt",
    activeAgentMode: "standard",
    activeAgentInstanceId: null,
    archived: false,
    revision,
    createdAt: "2026-10-03T22:00:00.000Z",
    updatedAt: "2026-10-03T22:00:00.000Z",
  };
}

function message(overrides: Record<string, unknown>) {
  return {
    id: "message",
    conversationId: "global-conv",
    ownerId: state.userId,
    projectId: "global-project",
    role: "assistant",
    agentSlug: "litt",
    agentMode: "standard",
    agentInstanceId: null,
    content: "Welcome back",
    status: "completed",
    parentMessageId: null,
    clientRequestId: null,
    createdAt: "2026-10-03T22:00:00.000Z",
    updatedAt: "2026-10-03T22:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

beforeEach(() => {
  state.pathname = "/dashboard";
  state.params = new URLSearchParams();
  state.signedIn = true;
  state.userId = "u";
  state.push.mockReset();
  state.getToken.mockClear();

  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };

  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/litt/global" && (!init?.method || init.method === "GET")) {
      return jsonResponse({
        projectId: "global-project",
        conversation: conversation(1),
        messages: [message({ id: "a0" })],
      });
    }
    if (url === "/api/litt/global" && init?.method === "POST") {
      return jsonResponse({
        projectId: "global-project",
        conversationId: "global-conv",
        userMessage: message({
          id: "u1",
          role: "user",
          content: "Help with this page",
          clientRequestId: "req",
        }),
        assistantMessage: message({
          id: "a1",
          role: "assistant",
          content: "I can help with Dashboard.",
          parentMessageId: "u1",
        }),
        duplicate: false,
        revision: 2,
      });
    }
    return jsonResponse({ error: "unexpected request" }, 500);
  }));
});

describe("persistent Global LiTT entry", () => {
  it("loads the canonical persisted transcript", async () => {
    render(<GlobalLittEntry />);
    fireEvent.click(screen.getByRole("button", { name: "Ask LiTT" }));

    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/litt/global", expect.objectContaining({ method: "GET" }));
  });

  it("keeps closed-set navigation provider-free and keeps the panel mounted", async () => {
    render(<GlobalLittEntry />);
    await screen.findByText("Welcome back");
    fireEvent.click(screen.getByRole("button", { name: "Ask LiTT" }));
    fireEvent.change(screen.getByLabelText("Ask LiTT about this page"), {
      target: { value: "Open connections" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(state.push).toHaveBeenCalledWith("/settings/connections");
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
    const postCalls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(0);
  });

  it("persists a real Global LiTT turn with fresh route context", async () => {
    render(<GlobalLittEntry />);
    await screen.findByText("Welcome back");
    fireEvent.click(screen.getByRole("button", { name: "Ask LiTT" }));
    fireEvent.change(screen.getByLabelText("Ask LiTT about this page"), {
      target: { value: "Help with this page" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("I can help with Dashboard.")).toBeInTheDocument();
    const postCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.message).toBe("Help with this page");
    expect(body.expectedRevision).toBe(1);
    expect(body.pageContext).toMatchObject({
      surface: "global_companion",
      route: "/dashboard",
      authenticated: true,
    });
  });

  it("retains draft and open panel across route navigation", async () => {
    const { rerender } = render(<GlobalLittEntry />);
    await screen.findByText("Welcome back");
    fireEvent.click(screen.getByRole("button", { name: "Ask LiTT" }));
    fireEvent.change(screen.getByLabelText("Ask LiTT about this page"), {
      target: { value: "Still thinking" },
    });

    state.pathname = "/deployments";
    state.params = new URLSearchParams();
    rerender(<GlobalLittEntry />);

    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
    expect((screen.getByLabelText("Ask LiTT about this page") as HTMLTextAreaElement).value).toBe("Still thinking");
    expect(screen.getByText("/deployments")).toBeInTheDocument();
  });

  it("retries one stale revision with the same client request", async () => {
    let postCount = 0;
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/litt/global" && (!init?.method || init.method === "GET")) {
        const revision = postCount > 0 ? 2 : 1;
        return jsonResponse({ projectId: "global-project", conversation: conversation(revision), messages: [] });
      }
      if (url === "/api/litt/global" && init?.method === "POST") {
        postCount += 1;
        if (postCount === 1) return jsonResponse({ error: "Stale revision" }, 409);
        return jsonResponse({
          projectId: "global-project",
          conversationId: "global-conv",
          userMessage: message({ id: "u2", role: "user", content: "Help with this page" }),
          assistantMessage: message({ id: "a2", content: "Recovered." }),
          revision: 3,
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });

    render(<GlobalLittEntry />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Ask LiTT" }));
    fireEvent.change(screen.getByLabelText("Ask LiTT about this page"), {
      target: { value: "Help with this page" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Recovered.")).toBeInTheDocument();
    const posts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    const first = JSON.parse(String(posts[0][1]?.body));
    const second = JSON.parse(String(posts[1][1]?.body));
    expect(first.clientRequestId).toBe(second.clientRequestId);
    expect(first.expectedRevision).toBe(1);
    expect(second.expectedRevision).toBe(2);
  });

  it("does not add a competing operator in Studio or on signed-out pages", () => {
    state.pathname = "/studio";
    const { rerender } = render(<GlobalLittEntry />);
    expect(screen.queryByRole("button", { name: "Ask LiTT" })).toBeNull();

    state.pathname = "/dashboard";
    state.signedIn = false;
    rerender(<GlobalLittEntry />);
    expect(screen.queryByRole("button", { name: "Ask LiTT" })).toBeNull();
  });
});
