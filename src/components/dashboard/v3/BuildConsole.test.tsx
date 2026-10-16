/**
 * BuildConsole — "Create something new" contract.
 *
 * Regression coverage for the golden-journey defect: a descriptive prompt
 * submitted on the dashboard used to navigate to /studio?prompt=… with no
 * project, where Studio silently resolved the most-recently-touched
 * project and ran inside it. The console must now create the project
 * first and pin its id in the URL.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

import { BuildConsole } from "./BuildConsole";

function mockFetch(handlers: {
  intent?: () => Response;
  create?: () => Response | Promise<Response>;
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/api/litt/intent")) return handlers.intent!();
    if (url.includes("/api/studio-projects")) return handlers.create!();
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function pushedUrl(): URL {
  expect(pushMock).toHaveBeenCalledTimes(1);
  return new URL(`http://localhost${pushMock.mock.calls[0][0] as string}`);
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  pushMock.mockClear();
});

describe("BuildConsole project creation", () => {
  it("creates a new project and navigates to it with prompt, intent and planId", async () => {
    const fetchMock = mockFetch({
      intent: () =>
        new Response(
          JSON.stringify({
            type: "intent",
            result: { primaryIntent: "website", action: "create" },
            plan: { id: "plan-1" },
          }),
          { status: 200 },
        ),
      create: () =>
        new Response(JSON.stringify({ project: { id: "proj-new", name: "A site" } }), { status: 201 }),
    });
    const user = userEvent.setup();
    render(<BuildConsole />);

    await user.type(
      screen.getByLabelText("Describe what you want to make"),
      "A website for my landscaping business",
    );
    await user.click(screen.getByRole("button", { name: /create/i }));

    const url = pushedUrl();
    expect(url.pathname).toBe("/studio");
    expect(url.searchParams.get("project")).toBe("proj-new");
    expect(url.searchParams.get("prompt")).toBe("A website for my landscaping business");
    expect(url.searchParams.get("intent")).toBe("website");
    expect(url.searchParams.get("planId")).toBe("plan-1");

    const createCalls = fetchMock.mock.calls.filter(([i]) =>
      String(i instanceof Request ? i.url : String(i)).includes("/api/studio-projects"),
    );
    expect(createCalls).toHaveLength(1);
    const body = JSON.parse((createCalls[0][1] as RequestInit).body as string);
    expect(body.sourceType).toBe("blank");
    expect(typeof body.idempotencyKey).toBe("string");
    expect(body.idempotencyKey.length).toBeGreaterThan(0);
    expect(body.name.length).toBeGreaterThan(0);
    expect(body.name.length).toBeLessThanOrEqual(120);
    // The button must stay locked while the navigation is pending — a
    // second click during the transition cannot fire another submission.
    const busyButton = screen.getByRole("button", { name: /starting/i }) as HTMLButtonElement;
    expect(busyButton.disabled).toBe(true);
  });

  it("does NOT create a project for non-creation actions — routes into Studio against the current project", async () => {
    const fetchMock = mockFetch({
      intent: () =>
        new Response(
          JSON.stringify({
            type: "intent",
            result: { primaryIntent: "debug", action: "fix" },
            plan: { id: "plan-2" },
          }),
          { status: 200 },
        ),
      create: () => {
        throw new Error("create must not be called for non-creation actions");
      },
    });
    const user = userEvent.setup();
    render(<BuildConsole />);

    await user.type(
      screen.getByLabelText("Describe what you want to make"),
      "Fix the broken checkout page",
    );
    await user.click(screen.getByRole("button", { name: /create/i }));

    const url = pushedUrl();
    expect(url.pathname).toBe("/studio");
    expect(url.searchParams.get("project")).toBeNull();
    expect(url.searchParams.get("prompt")).toBe("Fix the broken checkout page");
    expect(url.searchParams.get("intent")).toBe("debug");
    expect(url.searchParams.get("planId")).toBe("plan-2");
    expect(
      fetchMock.mock.calls.some(([i]) =>
        String(i instanceof Request ? i.url : String(i)).includes("/api/studio-projects"),
      ),
    ).toBe(false);
  });

  it("creates a project for mixed intents when the action is generate", async () => {
    mockFetch({
      intent: () =>
        new Response(
          JSON.stringify({
            type: "intent",
            result: { primaryIntent: "mixed", action: "generate" },
          }),
          { status: 200 },
        ),
      create: () =>
        new Response(JSON.stringify({ project: { id: "proj-mixed" } }), { status: 201 }),
    });
    const user = userEvent.setup();
    render(<BuildConsole />);

    await user.type(screen.getByLabelText("Describe what you want to make"), "Build a site and deploy it");
    await user.click(screen.getByRole("button", { name: /create/i }));

    const url = pushedUrl();
    expect(url.searchParams.get("project")).toBe("proj-mixed");
  });

  it.each([
    ["research", "create"],
    ["project_action", "create"],
    ["deploy", "create"],
  ])(
    "does NOT create a project for non-build intent %s even when the action is %s",
    async (primaryIntent, action) => {
      const fetchMock = mockFetch({
        intent: () =>
          new Response(
            JSON.stringify({ type: "intent", result: { primaryIntent, action } }),
            { status: 200 },
          ),
        create: () => {
          throw new Error(`create must not be called for ${primaryIntent}`);
        },
      });
      const user = userEvent.setup();
      render(<BuildConsole />);

      await user.type(screen.getByLabelText("Describe what you want to make"), "Tell me something");
      await user.click(screen.getByRole("button", { name: /create/i }));

      const url = pushedUrl();
      expect(url.searchParams.get("project")).toBeNull();
      expect(
        fetchMock.mock.calls.some(([i]) =>
          String(i instanceof Request ? i.url : String(i)).includes("/api/studio-projects"),
        ),
      ).toBe(false);
    },
  );

  it("does NOT create a project when the router omits intent and action (unknown fallback)", async () => {
    const fetchMock = mockFetch({
      intent: () =>
        new Response(JSON.stringify({ type: "intent", result: {} }), { status: 200 }),
      create: () => {
        throw new Error("create must not be called for an unknown intent");
      },
    });
    const user = userEvent.setup();
    render(<BuildConsole />);

    await user.type(screen.getByLabelText("Describe what you want to make"), "???");
    await user.click(screen.getByRole("button", { name: /create/i }));

    const url = pushedUrl();
    expect(url.searchParams.get("project")).toBeNull();
    expect(
      fetchMock.mock.calls.some(([i]) =>
        String(i instanceof Request ? i.url : String(i)).includes("/api/studio-projects"),
      ),
    ).toBe(false);
  });

  it("surfaces a retryable error when the intent router is unreachable — never guesses build vs chat", async () => {
    const fetchMock = mockFetch({
      intent: () => {
        throw new Error("network down");
      },
      create: () =>
        new Response(JSON.stringify({ project: { id: "proj-new" } }), { status: 201 }),
    });
    const user = userEvent.setup();
    render(<BuildConsole />);

    await user.type(screen.getByLabelText("Describe what you want to make"), "A landing page");
    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(screen.getByText(/could not route/i)).toBeTruthy());
    // No project minted, no redirect into an existing project, and the
    // button is unlocked for the retry.
    expect(pushMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([i]) =>
        String(i instanceof Request ? i.url : String(i)).includes("/api/studio-projects"),
      ),
    ).toBe(false);
    expect((screen.getByRole("button", { name: /create/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the clarification and does NOT create a project", async () => {
    const fetchMock = mockFetch({
      intent: () =>
        new Response(
          JSON.stringify({ type: "clarification", request: { question: "What kind of site?" } }),
          { status: 200 },
        ),
      create: () => {
        throw new Error("create must not be called");
      },
    });
    const user = userEvent.setup();
    render(<BuildConsole />);

    await user.type(screen.getByLabelText("Describe what you want to make"), "Website");
    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(screen.getByText("What kind of site?")).toBeTruthy());
    expect(pushMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([i]) =>
        String(i instanceof Request ? i.url : String(i)).includes("/api/studio-projects"),
      ),
    ).toBe(false);
    // Button must not stay stuck busy after a clarification.
    expect((screen.getByRole("button", { name: /create/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the create error and does not navigate when project creation fails", async () => {
    mockFetch({
      intent: () =>
        new Response(
          JSON.stringify({ type: "intent", result: { primaryIntent: "website", action: "create" } }),
          { status: 200 },
        ),
      create: () =>
        new Response(JSON.stringify({ error: "quota exceeded" }), { status: 402 }),
    });
    const user = userEvent.setup();
    render(<BuildConsole />);

    await user.type(screen.getByLabelText("Describe what you want to make"), "A portfolio site");
    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(screen.getByText("quota exceeded")).toBeTruthy());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("issues a single create POST on rapid double submit", async () => {
    let resolveCreate: ((r: Response) => void) | undefined;
    const fetchMock = mockFetch({
      intent: () =>
        new Response(
          JSON.stringify({ type: "intent", result: { primaryIntent: "code", action: "generate" } }),
          { status: 200 },
        ),
      create: () =>
        new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        }),
    });
    const user = userEvent.setup();
    render(<BuildConsole />);

    await user.type(screen.getByLabelText("Describe what you want to make"), "A dashboard app");
    const button = screen.getByRole("button", { name: /create/i });
    await user.click(button);
    await user.click(button);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([i]) =>
          String(i instanceof Request ? i.url : String(i)).includes("/api/studio-projects"),
        ),
      ).toHaveLength(1);
    });
    resolveCreate?.(
      new Response(JSON.stringify({ project: { id: "proj-new" } }), { status: 201 }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushedUrl().searchParams.get("project")).toBe("proj-new");
  });
});
