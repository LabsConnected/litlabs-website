// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ isSignedIn: false }),
}));

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/image", () => ({ default: "img" }));

import { LandingHeroV3 } from "./LandingHeroV3";

describe("LandingHeroV3", () => {
  it("exposes a readable AI Project Operator heading and states GitHub plan availability", () => {
    render(<LandingHeroV3 />);

    expect(
      screen.getByRole("heading", {
        name: "Your AI Project Operator. From idea to ship.",
      }),
    ).toBeTruthy();
    expect(screen.getByText("GitHub on Creator and Pro Builder")).toBeTruthy();
  });
});
