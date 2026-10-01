import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BuildConsole } from "./BuildConsole";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));

describe("Dashboard first prompt", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("keeps one composer and secondary setup links without requiring a creation type", () => {
    render(<BuildConsole />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Start blank" }).getAttribute("href")).toBe("/studio?tool=chat");
    expect(screen.getByRole("link", { name: "Connect GitHub" }).getAttribute("href")).toBe("/settings/connections");
    expect(screen.getByText("More ways to create").closest("details")?.open).toBe(false);
    expect(screen.getByRole("button", { name: "Create" }).hasAttribute("disabled")).toBe(true);
  });

  it("preserves the user's request and plan in the canonical Studio handoff", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ result: { primaryIntent: "website" }, plan: { id: "plan-1" } })));
    render(<BuildConsole initialPrompt="Roofing & repairs" />);
    fireEvent.submit(screen.getByTestId("dashboard-composer-form"));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const url = new URL(push.mock.calls[0][0], "https://example.test");
    expect(url.pathname).toBe("/studio");
    expect(url.searchParams.get("prompt")).toBe("Roofing & repairs");
    expect(url.searchParams.get("planId")).toBe("plan-1");
  });

  it("keeps a clarification on the dashboard without starting work", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ type: "clarification", request: { question: "Which business?" } })));
    render(<BuildConsole initialPrompt="Build my site" />);
    fireEvent.submit(screen.getByTestId("dashboard-composer-form"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Which business?"));
    expect(push).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Build my site");
  });

  it("preserves the prompt when routing fails and rejects concurrent submissions", async () => {
    let rejectRequest!: (reason: Error) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    render(<BuildConsole initialPrompt="Roofing & repairs" />);
    const form = screen.getByTestId("dashboard-composer-form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetch).toHaveBeenCalledTimes(1);
    rejectRequest(new Error("unavailable"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/studio?tool=chat&prompt=Roofing%20%26%20repairs"));
  });
});
