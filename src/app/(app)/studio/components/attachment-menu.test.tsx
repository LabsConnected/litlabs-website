import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import AttachmentMenu from "./AttachmentMenu";

// Mock portal — AttachmentMenu renders inline (no portal), so no mock needed

describe("AttachmentMenu", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onFiles: vi.fn(),
    onCamera: vi.fn(),
    onRecordVideo: vi.fn(),
    onRecordAudio: vi.fn(),
    onScreenCapture: vi.fn(),
    onLink: vi.fn(),
    onProjectFile: vi.fn(),
    attachmentCount: 0,
    anchorRect: {
      top: 600,
      bottom: 640,
      left: 100,
      right: 140,
      width: 40,
      height: 40,
      x: 100,
      y: 600,
      toJSON: () => "{}",
    } as DOMRect,
    triggerRef: { current: null },
  };

  it("renders menu items when open", () => {
    render(<AttachmentMenu {...defaultProps} />);
    expect(screen.getByTestId("attachment-menu")).toBeTruthy();
    expect(screen.getByText("Upload files")).toBeTruthy();
    expect(screen.getByText("Take photo")).toBeTruthy();
    expect(screen.getByText("Paste link")).toBeTruthy();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<AttachmentMenu {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on non-Escape key", () => {
    const onClose = vi.fn();
    render(<AttachmentMenu {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on outside click (not on trigger)", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const triggerRef = { current: document.createElement("button") };
    render(<AttachmentMenu {...defaultProps} onClose={onClose} triggerRef={triggerRef} />);

    // Advance past the setTimeout(0) that delays listener registration
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Click on an element outside the menu and not the trigger
    const outside = document.createElement("div");
    document.body.appendChild(outside);

    act(() => {
      fireEvent.mouseDown(outside);
    });

    expect(onClose).toHaveBeenCalled();
    document.body.removeChild(outside);
    vi.useRealTimers();
  });

  it("does not close when clicking the trigger button (prevents race)", () => {
    const onClose = vi.fn();
    const triggerBtn = document.createElement("button");
    const triggerRef = { current: triggerBtn };
    render(<AttachmentMenu {...defaultProps} onClose={onClose} triggerRef={triggerRef} />);

    act(() => {
      fireEvent.mouseDown(triggerBtn);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after selecting an action (camera)", () => {
    const onClose = vi.fn();
    const onCamera = vi.fn();
    render(<AttachmentMenu {...defaultProps} onClose={onClose} onCamera={onCamera} />);

    fireEvent.click(screen.getByText("Take photo"));
    expect(onCamera).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes after selecting record video", () => {
    const onClose = vi.fn();
    const onRecordVideo = vi.fn();
    render(<AttachmentMenu {...defaultProps} onClose={onClose} onRecordVideo={onRecordVideo} />);

    fireEvent.click(screen.getByText("Record video"));
    expect(onRecordVideo).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows link input when 'Paste link' is clicked and does not close immediately", () => {
    const onClose = vi.fn();
    render(<AttachmentMenu {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByText("Paste link"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("https://youtube.com/watch?v=...")).toBeTruthy();
  });

  it("disables actions when attachment limit is reached", () => {
    render(<AttachmentMenu {...defaultProps} attachmentCount={10} />);
    expect(screen.getByText(/Attachment limit reached/)).toBeTruthy();
  });
});
