import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LiTTAmbientHUD from "./LiTTAmbientHUD";

// useExecutionStore is a real zustand store — no network/browser APIs,
// safe to use unmocked in tests.

describe("LiTTAmbientHUD (real component)", () => {
  it("calls onExpand when the LiTT mark is clicked", () => {
    const onExpand = vi.fn();
    render(<LiTTAmbientHUD onExpand={onExpand} />);
    fireEvent.click(screen.getByTestId("litt-hud-expand"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("does not render a mic indicator when no voice session is connected", () => {
    render(<LiTTAmbientHUD onExpand={vi.fn()} voiceConnected={false} microphoneStatus="active" />);
    expect(screen.queryByTestId("litt-hud-mic-indicator")).toBeNull();
  });

  it("renders mic-OFF when connected but microphoneStatus is inactive", () => {
    render(<LiTTAmbientHUD onExpand={vi.fn()} voiceConnected microphoneStatus="inactive" />);
    const indicator = screen.getByTestId("litt-hud-mic-indicator");
    expect(indicator).toHaveAttribute("data-mic-on", "false");
    expect(indicator).toHaveAttribute("aria-label", "Microphone off");
  });

  it("renders mic-OFF when connected but microphoneStatus is muted — a live session does not imply an active mic", () => {
    render(<LiTTAmbientHUD onExpand={vi.fn()} voiceConnected microphoneStatus="muted" />);
    const indicator = screen.getByTestId("litt-hud-mic-indicator");
    expect(indicator).toHaveAttribute("data-mic-on", "false");
  });

  it("renders mic-OFF for denied/error device statuses", () => {
    render(<LiTTAmbientHUD onExpand={vi.fn()} voiceConnected microphoneStatus="denied" />);
    expect(screen.getByTestId("litt-hud-mic-indicator")).toHaveAttribute("data-mic-on", "false");
  });

  it("renders mic-ON only when microphoneStatus is exactly 'active'", () => {
    render(<LiTTAmbientHUD onExpand={vi.fn()} voiceConnected microphoneStatus="active" />);
    const indicator = screen.getByTestId("litt-hud-mic-indicator");
    expect(indicator).toHaveAttribute("data-mic-on", "true");
    expect(indicator).toHaveAttribute("aria-label", "Microphone on");
  });

  it("renders mic-OFF when connected but microphoneStatus is undefined (unknown state is never shown as on)", () => {
    render(<LiTTAmbientHUD onExpand={vi.fn()} voiceConnected />);
    expect(screen.getByTestId("litt-hud-mic-indicator")).toHaveAttribute("data-mic-on", "false");
  });
});
