import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MobileBottomSheet from "./MobileBottomSheet";

describe("MobileBottomSheet", () => {
  function renderSheet(overrides: Partial<Parameters<typeof MobileBottomSheet>[0]> = {}) {
    const onClose = vi.fn();
    const props = {
      open: true,
      onClose,
      title: "Tools",
      children: <div data-testid="sheet-child">Sheet content</div>,
      ...overrides,
    };
    const result = render(<MobileBottomSheet {...props} />);
    return { onClose, ...result };
  }

  it("renders title + children when open, and nothing when closed", () => {
    const first = renderSheet();
    expect(screen.getByTestId("mobile-bottom-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("sheet-child")).toHaveTextContent("Sheet content");
    expect(screen.getByText("Tools")).toBeInTheDocument();
    first.unmount();

    render(<MobileBottomSheet open={false} onClose={vi.fn()} title="Tools">hidden</MobileBottomSheet>);
    expect(screen.queryByTestId("mobile-bottom-sheet")).not.toBeInTheDocument();
  });

  it("clicking the backdrop calls onClose", () => {
    const { onClose } = renderSheet();
    // The backdrop is the aria-hidden button; the visible X close button is
    // the other one. (Name matching is unreliable on aria-hidden elements,
    // so we match the backdrop by its aria-hidden marker instead.)
    const backdrop = screen
      .getAllByRole("button", { hidden: true })
      .find((el) => el.getAttribute("aria-hidden") === "true");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pressing Escape calls onClose", () => {
    const { onClose } = renderSheet();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has role dialog and aria-modal", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Tools");
  });

  it("moves focus into the sheet on open and returns it on close", () => {
    const { rerender } = render(
      <>
        <button type="button">Trigger</button>
        <MobileBottomSheet open={false} onClose={vi.fn()} title="Tools">
          content
        </MobileBottomSheet>
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(
      <>
        <button type="button">Trigger</button>
        <MobileBottomSheet open onClose={vi.fn()} title="Tools">
          content
        </MobileBottomSheet>
      </>,
    );
    expect(document.activeElement).toBe(screen.getByTestId("mobile-bottom-sheet"));

    rerender(
      <>
        <button type="button">Trigger</button>
        <MobileBottomSheet open={false} onClose={vi.fn()} title="Tools">
          content
        </MobileBottomSheet>
      </>,
    );
    expect(document.activeElement).toBe(trigger);
  });
});
