import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CookieConsent from "./CookieConsent";
import CookiePreferencesButton from "./CookiePreferencesButton";
import { getConsent } from "@/lib/cookie-consent";

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    resolvedColors: {
      accentColor: "#a8ff2f",
      boxBg: "#101217",
      textColor: "#ffffff",
      bgColor: "#101217",
      headerColor: "#ffffff",
      borderColor: "#666666",
      linkColor: "#a8ff2f",
    },
  }),
}));

describe("CookieConsent controls", () => {
  it("lets a first-time visitor reject optional tracking", () => {
    render(<CookieConsent />);
    expect(screen.getByRole("button", { name: "Essential only" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Essential only" }));
    expect(getConsent()?.analytics).toBe(false);
    expect(getConsent()?.marketing).toBe(false);
    expect(screen.queryByLabelText("Cookie privacy choices")).toBeNull();
  });

  it("offers granular choices and lets visitors reopen and change them", () => {
    render(<><CookieConsent /><CookiePreferencesButton /></>);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Analytics/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save my choices" }));

    expect(getConsent()?.analytics).toBe(true);
    expect(getConsent()?.marketing).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Change cookie preferences" }));
    expect(screen.getByRole("checkbox", { name: /Analytics/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Essential only" }));
    expect(getConsent()?.analytics).toBe(false);
  });
});
