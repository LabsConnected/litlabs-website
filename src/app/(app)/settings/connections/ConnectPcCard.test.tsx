import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectPcCard from "./ConnectPcCard";

vi.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ resolvedColors: {
  boxBg: "#111", borderColor: "#222", accentColor: "#abc", bgColor: "#000", headerColor: "#fff",
} }) }));

const code = "ABCDEFGHJKMN";
let confirmed = false;
let revoked = false;

beforeEach(() => {
  confirmed = false; revoked = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/local-devices" && !init?.method) return Response.json({ devices: confirmed ? [{
      id: "00000000-0000-0000-0000-000000000001", name: "Office PC",
      fingerprint: "a".repeat(64), revokedAt: revoked ? "2026-11-20" : null,
    }] : [] });
    if (path === "/api/local-devices/pairing" && init?.method === "POST")
      return Response.json({ code, expiresAt: new Date(Date.now() + 600_000).toISOString() });
    if (path.startsWith("/api/local-devices/pairing/claim?") && !init?.method)
      return Response.json({ claim: { name: "Office PC", fingerprint: "a".repeat(64) } });
    if (path === "/api/local-devices/pairing/claim" && init?.method === "POST") {
      confirmed = true; return Response.json({ device: { id: "device" } });
    }
    if (path.startsWith("/api/local-devices/") && init?.method === "DELETE") {
      revoked = true; return Response.json({ revoked: true });
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
});

describe("Connect PC", () => {
  it("shows the signed claim for explicit confirmation and supports revocation", async () => {
    render(<ConnectPcCard />);
    fireEvent.click(screen.getByRole("button", { name: "Connect PC" }));
    expect(await screen.findByText(code)).toBeTruthy();
    expect(await screen.findByText(/Fingerprint: a{64}/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm this PC" }));
    expect(await screen.findByRole("button", { name: "Revoke" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.getByText(/Office PC \(revoked\)/)).toBeTruthy());
  });
});
