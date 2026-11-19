import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MobileCommandNav } from "./CommandStudioNav";

vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 0 }),
}));

describe("MobileCommandNav shared work surfaces", () => {
  it("exposes Chat, Static View, Files, and More as one controlled dock (Studio Finish Spec, Larry 2026-11-14)", () => {
    const onSelectSurface = vi.fn();
    render(
      <MobileCommandNav
        active="studio"
        onSelect={vi.fn()}
        surface="chat"
        onSelectSurface={onSelectSurface}
      />,
    );

    expect(screen.getByRole("button", { name: "Chat" }).getAttribute("aria-current")).toBe("page");
    for (const label of ["Static View", "Files", "More"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Activity" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Static View" }));
    expect(onSelectSurface).toHaveBeenCalledWith("preview");
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(onSelectSurface).toHaveBeenCalledWith("files");
  });
});
