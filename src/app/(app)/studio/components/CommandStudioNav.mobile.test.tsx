import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MobileCommandNav } from "./CommandStudioNav";

vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 0 }),
}));

describe("MobileCommandNav shared work surfaces", () => {
  it("exposes Chat, Preview, Activity, and More as one controlled dock (Files retired to the LiTT sheet's top row)", () => {
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
    for (const label of ["Preview", "Activity", "More"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Files" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onSelectSurface).toHaveBeenCalledWith("preview");
  });
});
