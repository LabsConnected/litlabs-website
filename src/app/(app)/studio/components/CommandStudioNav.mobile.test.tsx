import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MobileCommandNav } from "./CommandStudioNav";

vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 0 }),
}));

describe("MobileCommandNav shared work surfaces", () => {
  it("exposes Chat, Preview, Files, Activity, and More as one controlled dock", () => {
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
    for (const label of ["Preview", "Files", "Activity", "More"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onSelectSurface).toHaveBeenCalledWith("preview");
  });
});
