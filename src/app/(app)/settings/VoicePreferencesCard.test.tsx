import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VoicePreferencesCard } from "./VoicePreferencesCard";

// Regression tests for the Settings → Voice card being a façade: its
// state used to live in a bare useState inside the settings page, so
// every toggle died on unmount and the Studio session never saw it.
// The card now writes the real preference keys VoiceSessionContext
// reads (litt:voice:autoSendEnabled / litt:voice:ttsEnabled, "1"/"0").

function toggleFor(title: string): HTMLElement {
  const label = screen.getByText(title).closest("label");
  if (!label) throw new Error(`No settings row found for "${title}"`);
  return within(label as HTMLElement).getByRole("switch");
}

describe("VoicePreferencesCard — persistence wiring", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders only controls backed by a real preference (no dead controls)", () => {
    render(<VoicePreferencesCard />);
    expect(screen.getByText("Auto-send")).toBeInTheDocument();
    expect(screen.getByText("Spoken replies")).toBeInTheDocument();
    // Removed — no consumer exists anywhere for these:
    expect(screen.queryByText("Barge-in")).not.toBeInTheDocument();
    expect(screen.queryByText(/Silence timeout/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Playback speed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Spoken response length/i)).not.toBeInTheDocument();
  });

  it("auto-send starts on by default (nothing stored) and writes the real key on toggle", () => {
    render(<VoicePreferencesCard />);
    const toggle = toggleFor("Auto-send");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(window.localStorage.getItem("litt:voice:autoSendEnabled")).toBe("0");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem("litt:voice:autoSendEnabled")).toBe("1");
  });

  it("remount reads back the persisted auto-send value", () => {
    const first = render(<VoicePreferencesCard />);
    fireEvent.click(toggleFor("Auto-send"));
    expect(window.localStorage.getItem("litt:voice:autoSendEnabled")).toBe("0");
    first.unmount();

    render(<VoicePreferencesCard />);
    expect(toggleFor("Auto-send")).toHaveAttribute("aria-checked", "false");
  });

  it("honours an explicit off previously written by the Studio session", () => {
    // A stored "0" is an explicit user choice — it beats the new default-on.
    window.localStorage.setItem("litt:voice:autoSendEnabled", "0");
    render(<VoicePreferencesCard />);
    expect(toggleFor("Auto-send")).toHaveAttribute("aria-checked", "false");
  });

  it("honours a value previously written by the Studio session", () => {
    // The composer popover writes the same key via VoiceSessionContext.
    window.localStorage.setItem("litt:voice:autoSendEnabled", "1");
    render(<VoicePreferencesCard />);
    expect(toggleFor("Auto-send")).toHaveAttribute("aria-checked", "true");
  });

  it("spoken replies defaults on, persists off, and reads back on remount", () => {
    const first = render(<VoicePreferencesCard />);
    const toggle = toggleFor("Spoken replies");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(window.localStorage.getItem("litt:voice:ttsEnabled")).toBe("0");
    first.unmount();

    render(<VoicePreferencesCard />);
    expect(toggleFor("Spoken replies")).toHaveAttribute("aria-checked", "false");
  });
});
