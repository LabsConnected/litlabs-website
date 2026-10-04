import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GlobalLittProvider, useGlobalLitt } from "./GlobalLittProvider";
const auth = vi.hoisted(() => ({ isSignedIn: true, userId: "A" }));
vi.mock("@/hooks/useClerkAuth", () => ({ useClerkAuth: () => auth }));
afterEach(() => { vi.unstubAllGlobals(); auth.userId = "A"; auth.isSignedIn = true; });
function Consumer() { const value = useGlobalLitt(); return <span data-testid="global-state" data-loading={String(value.loading)} data-error={value.error ?? ""}>{value.projectId ?? "empty"}</span>; }
it("clears on account switch, aborts A, and refuses A's late response after B", async () => {
  const pending: Array<{ signal: AbortSignal; resolve: (value: unknown) => void }> = [];
  vi.stubGlobal("fetch", vi.fn((_url, opts) => new Promise(resolve => pending.push({ signal: opts.signal, resolve }))));
  const view = render(<GlobalLittProvider><Consumer /></GlobalLittProvider>);
  await waitFor(() => expect(pending).toHaveLength(1));
  auth.userId = "B";
  view.rerender(<GlobalLittProvider><Consumer /></GlobalLittProvider>);
  expect(screen.getByText("empty")).toBeTruthy();
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => pending[1].resolve({ ok: true, json: async () => ({ project: { id: "B-project" } }) }));
  expect(screen.getByText("B-project")).toBeTruthy();
  await act(async () => pending[0].resolve({ ok: true, json: async () => ({ project: { id: "A-project" } }) }));
  expect(screen.queryByText("A-project")).toBeNull();
  expect(screen.getByText("B-project")).toBeTruthy();
  auth.isSignedIn = false; auth.userId = "";
  view.rerender(<GlobalLittProvider><Consumer /></GlobalLittProvider>);
  expect(screen.getByText("empty")).toBeTruthy();
});
it("immediately hides an already loaded account project on userId change", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ project: { id: "A-project" } }) }).mockImplementation(() => new Promise(() => {})));
  const view = render(<GlobalLittProvider><Consumer /></GlobalLittProvider>);
  await screen.findByText("A-project");
  auth.userId = "B";
  view.rerender(<GlobalLittProvider><Consumer /></GlobalLittProvider>);
  expect(screen.queryByText("A-project")).toBeNull();
  expect(screen.getByText("empty")).toBeTruthy();
});

it("resets errors and loading for a new identity and clears them on logout", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockImplementation(() => new Promise(() => {})));
  const view = render(<GlobalLittProvider><Consumer /></GlobalLittProvider>);
  await waitFor(() => expect(screen.getByTestId("global-state").dataset.error).toContain("503"));
  expect(screen.getByTestId("global-state").dataset.loading).toBe("false");
  auth.userId = "B";
  view.rerender(<GlobalLittProvider><Consumer /></GlobalLittProvider>);
  expect(screen.getByTestId("global-state").dataset.error).toBe("");
  expect(screen.getByTestId("global-state").dataset.loading).toBe("true");
  expect(screen.getByText("empty")).toBeTruthy();
  auth.isSignedIn = false; auth.userId = "";
  view.rerender(<GlobalLittProvider><Consumer /></GlobalLittProvider>);
  expect(screen.getByTestId("global-state").dataset.error).toBe("");
  expect(screen.getByTestId("global-state").dataset.loading).toBe("false");
  expect(screen.getByText("empty")).toBeTruthy();
});
