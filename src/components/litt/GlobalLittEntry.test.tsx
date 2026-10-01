import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GlobalLittEntry from "./GlobalLittEntry";

const state = vi.hoisted(() => ({ pathname: "/dashboard", params: new URLSearchParams(), push: vi.fn(), userId: "u", signedIn: true, conversation: { id: "c", projectId: "roof", ownerId: "u" } }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useSearchParams: () => state.params, useRouter: () => ({ push: state.push }) }));
vi.mock("@/hooks/useClerkAuth", () => ({ useClerkAuth: () => ({ isSignedIn: state.signedIn, userId: state.userId }) }));
vi.mock("@/app/(app)/studio/stores/useConversationStore", () => ({ useConversationStore: (selector: (value: unknown) => unknown) => selector({ selectedConversationId: "c", conversations: [state.conversation] }) }));

beforeEach(() => {
  state.pathname = "/dashboard"; state.params = new URLSearchParams(); state.signedIn = true; state.userId = "u"; state.push.mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

describe("persistent Ask LiTT entry", () => {
  it("opens, closes and routes canonical navigation without invoking a provider", () => {
    render(<GlobalLittEntry />);
    fireEvent.click(screen.getByRole("button", { name: "Ask LiTT" }));
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
    fireEvent.change(screen.getByLabelText("Ask LiTT about this page"), { target: { value: "Open connections" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(state.push).toHaveBeenCalledWith("/settings/connections");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("retains the draft through navigation and submits fresh route context", () => {
    const { rerender } = render(<GlobalLittEntry />);
    fireEvent.click(screen.getByRole("button", { name: "Ask LiTT" }));
    fireEvent.change(screen.getByLabelText("Ask LiTT about this page"), { target: { value: "Help with this page" } });
    state.pathname = "/deployments"; state.params = new URLSearchParams();
    rerender(<GlobalLittEntry />);
    fireEvent.click(screen.getByRole("button", { name: "Ask LiTT" }));
    expect((screen.getByLabelText("Ask LiTT about this page") as HTMLTextAreaElement).value).toBe("Help with this page");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const url = new URL(state.push.mock.calls[0][0], "https://test.example");
    expect(url.searchParams.get("prompt")).toContain('"pathname":"/deployments"');
    expect(url.searchParams.get("conversation")).toBe("c");
  });
  it("does not reuse another signed-in account's conversation", () => {
    state.userId = "other";
    render(<GlobalLittEntry />);
    fireEvent.click(screen.getByRole("button", { name: "Ask LiTT" }));
    fireEvent.change(screen.getByLabelText("Ask LiTT about this page"), { target: { value: "Help" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(new URL(state.push.mock.calls[0][0], "https://test.example").searchParams.get("conversation")).toBeNull();
  });
  it("does not add a competing composer in Studio or signed-out pages", () => {
    state.pathname = "/studio";
    const { rerender } = render(<GlobalLittEntry />);
    expect(screen.queryByRole("button", { name: "Ask LiTT" })).toBeNull();
    state.pathname = "/dashboard"; state.signedIn = false;
    rerender(<GlobalLittEntry />);
    expect(screen.queryByRole("button", { name: "Ask LiTT" })).toBeNull();
  });
});
