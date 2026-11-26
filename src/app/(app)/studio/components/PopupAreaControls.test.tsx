import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PopupAreaChrome, PopupAreaRestoreTab } from "./PopupAreaControls";
import { usePopupAreaStore } from "../stores/usePopupAreaStore";

// The pop-up area's on-area controls (Larry, 2026-11-25): the
// "Auto pop-ups" switch and the Hide control live on the area
// itself; while hidden, a slim edge tab is the way back.

describe("PopupAreaControls", () => {
  beforeEach(() => {
    localStorage.clear();
    usePopupAreaStore.setState({ areaVisible: true, autoPopups: true });
  });

  it("the chrome carries the Auto pop-ups switch, reflecting and writing the store", () => {
    render(<PopupAreaChrome />);
    const toggle = screen.getByTestId("popup-area-auto-switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(usePopupAreaStore.getState().autoPopups).toBe(false);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("the chrome's Hide control hides the area in the store", () => {
    render(<PopupAreaChrome />);
    fireEvent.click(screen.getByTestId("popup-area-hide"));
    expect(usePopupAreaStore.getState().areaVisible).toBe(false);
  });

  it("the restore tab brings the area back", () => {
    usePopupAreaStore.setState({ areaVisible: false });
    render(<PopupAreaRestoreTab />);
    fireEvent.click(screen.getByTestId("popup-area-restore-tab"));
    expect(usePopupAreaStore.getState().areaVisible).toBe(true);
  });
});
