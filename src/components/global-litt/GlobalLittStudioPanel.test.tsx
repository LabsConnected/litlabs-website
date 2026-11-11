import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlobalLittStudioPanel from "./GlobalLittStudioPanel";

/**
 * ART-20261111-025 — Global overlay workspace inheritance.
 *
 * Acceptance shape (staging, 2026-11-11): with a project open in Studio,
 * asking the Global LiTT overlay "List the files in the project I'm
 * currently viewing" produced ZERO tool steps and a prose decline,
 * because the panel posted to the legacy /api/gemini/chat lane with a
 * hard-coded "no tools" capability block and never sent the viewed
 * project. These tests pin the fix: with a viewed project, the overlay
 * runs through the canonical Studio messages route (the lane #899
 * fixed) carrying that project id; with no viewed project it keeps the
 * plain-chat lane, which honestly has no workspace.
 */

vi.mock("@/components/global-litt/GlobalLittProvider", () => ({
  useGlobalLitt: () => ({
    projectId: "global-proj",
    project: { id: "global-proj", name: "Global LiTT", slug: "global-litt" },
    loading: false,
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({
    isSignedIn: true,
    isLoaded: true,
    userId: "user-1",
    getToken: async () => "test-token",
  }),
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

function installFetchMock(opts?: { refuseMessagesPost?: boolean; failedAssistantReply?: boolean }) {
  const calls: FetchCall[] = [];
  let sent = false;
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url: u, method, body });

    if (u === "/api/studio/conversations" && method === "POST") {
      return jsonResponse({
        conversation: { id: "conv-1", revision: 1 },
        projectId: "proj-viewed",
      }, 201);
    }
    if (u === "/api/studio/conversations/conv-1/messages" && method === "GET") {
      if (!sent) return jsonResponse({ messages: [], revision: 1 });
      if (opts?.failedAssistantReply) {
        return jsonResponse({
          messages: [
            { id: "m1", role: "user", content: "List the files in the project I'm currently viewing.", status: "completed" },
            {
              id: "m2",
              role: "assistant",
              content: "The run did not complete: the quality gate could not be satisfied for this task.",
              status: "failed",
            },
          ],
          revision: 2,
        });
      }
      return jsonResponse({
        messages: [
          { id: "m1", role: "user", content: "List the files in the project I'm currently viewing.", status: "completed" },
          { id: "m2", role: "assistant", content: "Files: index.html, README.md", status: "completed" },
        ],
        revision: 2,
      });
    }
    if (u === "/api/studio/conversations/conv-1/messages" && method === "POST") {
      if (opts?.refuseMessagesPost) {
        return jsonResponse(
          {
            error: "Project mismatch",
            code: "PROJECT_MISMATCH",
            detail: "This chat belongs to a different project.",
          },
          409,
        );
      }
      sent = true;
      return jsonResponse({ ok: true });
    }
    if (u === "/api/gemini/chat" && method === "POST") {
      return jsonResponse({ response: "Plain chat reply." });
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

async function sendMessage(text: string) {
  const composer = screen.getByTestId("global-litt-composer");
  fireEvent.change(composer, { target: { value: text } });
  fireEvent.click(screen.getByTestId("global-litt-send"));
}

beforeEach(() => {
  localStorage.clear();
  // jsdom does not implement scrollIntoView (the panel's scroll effect
  // calls it on every messages change).
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("GlobalLittStudioPanel workspace inheritance", () => {
  it("viewed project: sends through the canonical messages route carrying the viewed project, never the legacy lane", async () => {
    const calls = installFetchMock();
    render(<GlobalLittStudioPanel onClose={() => {}} viewedProjectId="proj-viewed" />);

    await sendMessage("List the files in the project I'm currently viewing.");

    // The assistant reply comes from the canonical run's persisted messages.
    await screen.findByText("Files: index.html, README.md");

    const post = calls.find(
      (c) => c.url === "/api/studio/conversations/conv-1/messages" && c.method === "POST",
    );
    expect(post).toBeTruthy();
    expect(post?.body?.projectId).toBe("proj-viewed");
    expect(typeof post?.body?.clientRequestId).toBe("string");
    expect(post?.body?.expectedRevision).toBe(1);
    expect(calls.some((c) => c.url === "/api/gemini/chat")).toBe(false);
  });

  it("no viewed project: keeps the plain-chat lane (honest no-workspace surface)", async () => {
    const calls = installFetchMock();
    render(<GlobalLittStudioPanel onClose={() => {}} />);

    await sendMessage("Hello there.");

    await screen.findByText("Plain chat reply.");
    const gemini = calls.find((c) => c.url === "/api/gemini/chat" && c.method === "POST");
    expect(gemini).toBeTruthy();
    expect(gemini?.body?.globalLittProjectId).toBe("global-proj");
    expect(calls.some((c) => c.url.startsWith("/api/studio/conversations"))).toBe(false);
  });

  it("canonical coded refusal surfaces honestly — no silent fallback to the tool-less lane", async () => {
    const calls = installFetchMock({ refuseMessagesPost: true });
    render(<GlobalLittStudioPanel onClose={() => {}} viewedProjectId="proj-viewed" />);

    await sendMessage("List the files in the project I'm currently viewing.");

    await waitFor(() => {
      expect(screen.getByText(/Project mismatch/)).toBeTruthy();
    });
    expect(calls.some((c) => c.url === "/api/gemini/chat")).toBe(false);
  });
});

describe("GlobalLittStudioPanel composer keys + failed-run visibility (ART-20261111-041)", () => {
  function messagesPosts(calls: FetchCall[]) {
    return calls.filter(
      (c) => c.url === "/api/studio/conversations/conv-1/messages" && c.method === "POST",
    );
  }

  it("Enter submits through the canonical lane (docked-composer convention)", async () => {
    const calls = installFetchMock();
    render(<GlobalLittStudioPanel onClose={() => {}} viewedProjectId="proj-viewed" />);

    const composer = screen.getByTestId("global-litt-composer");
    fireEvent.change(composer, { target: { value: "List the files in the project I'm currently viewing." } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: false });

    await screen.findByText("Files: index.html, README.md");
    expect(messagesPosts(calls)).toHaveLength(1);
    expect(messagesPosts(calls)[0]?.body?.projectId).toBe("proj-viewed");
  });

  it("Shift+Enter does NOT submit — it is the newline chord", async () => {
    const calls = installFetchMock();
    render(<GlobalLittStudioPanel onClose={() => {}} viewedProjectId="proj-viewed" />);

    const composer = screen.getByTestId("global-litt-composer") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "List the files" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });

    // Let any (incorrect) async send settle, then assert nothing was sent
    // and the draft is untouched.
    await new Promise((r) => setTimeout(r, 50));
    expect(messagesPosts(calls)).toHaveLength(0);
    expect(composer.value).toBe("List the files");
  });

  it("a failed run's assistant message is SHOWN in the overlay, never filtered into silence", async () => {
    installFetchMock({ failedAssistantReply: true });
    render(<GlobalLittStudioPanel onClose={() => {}} viewedProjectId="proj-viewed" />);

    await sendMessage("List the files in the project I'm currently viewing.");

    // The persisted failure report is the user's answer for that turn —
    // the panel must render it (the docked transcript renders failed
    // messages; the overlay previously dropped every non-completed row).
    await screen.findByText(/quality gate could not be satisfied/);
  });
});
