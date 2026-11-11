import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import GameCreatorEmptyState from "./GameCreatorEmptyState";

/**
 * Game — honest empty state (ART-20261111-035).
 *
 * The Game entry used to fall through the Create destination's tool
 * resolution and silently render the IMAGE studio. There is no game
 * creator in Studio (tests/creator-normalization.test.ts pins that no
 * GameCreatorTool exists); the surface must say so plainly and route
 * the user's intent into the ONE chat instead of faking a creator.
 */

const replace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    tokens: {
      background: "#0b0b10",
      text: "#f2f2fa",
      textMuted: "#9a9ab0",
      textInverse: "#0b0b10",
      border: "#2c2c44",
      surface: "#141424",
      primary: "#a8ff2f",
      success: "#22c55e",
      warning: "#f59e0b",
      danger: "#ef4444",
    },
  }),
}));

describe("GameCreatorEmptyState — honest, chat-routing surface", () => {
  it("says plainly that game creation is not built yet (no fake creator)", () => {
    render(<GameCreatorEmptyState />);
    expect(screen.getByText(/isn'?t built yet|not (built|available) yet/i)).toBeTruthy();
  });

  it("carries no prompt or chat input of its own", () => {
    const { container } = render(<GameCreatorEmptyState />);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("its one action routes intent into the one chat (bare /studio)", () => {
    render(<GameCreatorEmptyState />);
    fireEvent.click(screen.getByRole("button", { name: /chat/i }));
    expect(replace).toHaveBeenCalledWith("/studio");
  });

  it("CommandStudio renders this surface for createMode 'game' — never ImageTool", () => {
    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/app/(app)/studio/components/CommandStudio.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("GameCreatorEmptyState");
    expect(src).toMatch(/game:\s*GameCreatorEmptyState/);
  });
});
