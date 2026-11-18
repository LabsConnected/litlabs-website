import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import {
  SectionHeader,
  SettingsCard,
  SettingsInput,
  ToggleRow,
} from "./SettingsPrimitives";

/**
 * Settings primitives theme compliance — the shared Settings building
 * blocks (card, section header, toggle row, input) must follow the
 * APPLIED theme (useTheme tokens), in both directions. Regression
 * contract for the 2026-11-14 patchwork defect: SettingsCard and its
 * siblings hard-coded the light design (bg-white cards, zinc text,
 * black-alpha hairlines), so under Dark mode the Settings content
 * cards stayed white while the rest of the app went dark.
 *
 * Themes are pinned via customColors so the expected token values are
 * exact and independent of the skin tables (same pattern as
 * studio/components/shell/shell-chrome-theme.test.tsx).
 */

const LIGHT_THEME = {
  mode: "light",
  skin: "signature",
  accent: "signature-green",
  backgroundMode: "minimal",
  layoutStyle: "classic",
  customColors: {
    bgColor: "#ffffff",
    textColor: "#10240f",
    boxBg: "#eef5e9",
    borderColor: "#c9dcbf",
    accentColor: "#1d7a35",
    linkColor: "#1d7a35",
    headerColor: "#10240f",
  },
};

const DARK_THEME = {
  mode: "dark",
  skin: "volcanic",
  accent: "lime",
  backgroundMode: "nebula",
  layoutStyle: "classic",
  customColors: {
    bgColor: "#0a0a14",
    textColor: "#f2f2fa",
    boxBg: "#141424",
    borderColor: "#2c2c44",
    accentColor: "#a8ff2f",
    linkColor: "#a8ff2f",
    headerColor: "#f2f2fa",
  },
};

// tokens.surface ← boxBg; tokens.border ← borderColor; tokens.text ← textColor.
const LIGHT_SURFACE = "rgb(238, 245, 233)";
const DARK_SURFACE = "rgb(20, 20, 36)";
const LIGHT_BORDER = "rgb(201, 220, 191)";
const DARK_BORDER = "rgb(44, 44, 68)";
const LIGHT_TEXT = "rgb(16, 36, 15)";
const DARK_TEXT = "rgb(242, 242, 250)";

function seedTheme(theme: unknown) {
  localStorage.setItem("litlabs-theme", JSON.stringify(theme));
}

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

async function expectStyle(el: HTMLElement, prop: "backgroundColor" | "borderColor" | "color", rgb: string) {
  // ThemeProvider applies the stored theme after a rAF-gated mount.
  await waitFor(() => expect(el.style[prop]).toBe(rgb));
}

describe("SettingsCard follows the applied theme", () => {
  it("paints surface, border and title from tokens in Light", async () => {
    seedTheme(LIGHT_THEME);
    const { container } = renderWithTheme(
      <SettingsCard title="Theme mode" description="Light, dark, or system">
        <p>body</p>
      </SettingsCard>,
    );
    const card = container.querySelector(".rounded-2xl") as HTMLElement;
    await expectStyle(card, "backgroundColor", LIGHT_SURFACE);
    await expectStyle(card, "borderColor", LIGHT_BORDER);
    await expectStyle(screen.getByText("Theme mode"), "color", LIGHT_TEXT);
  });

  it("paints surface, border and title from tokens in Dark", async () => {
    seedTheme(DARK_THEME);
    const { container } = renderWithTheme(
      <SettingsCard title="Theme mode" description="Light, dark, or system">
        <p>body</p>
      </SettingsCard>,
    );
    const card = container.querySelector(".rounded-2xl") as HTMLElement;
    await expectStyle(card, "backgroundColor", DARK_SURFACE);
    await expectStyle(card, "borderColor", DARK_BORDER);
    await expectStyle(screen.getByText("Theme mode"), "color", DARK_TEXT);
  });
});

describe("SectionHeader follows the applied theme", () => {
  it("title follows tokens.text in both modes", async () => {
    seedTheme(LIGHT_THEME);
    const light = renderWithTheme(<SectionHeader title="Appearance" />);
    await expectStyle(screen.getByText("Appearance"), "color", LIGHT_TEXT);
    light.unmount();

    seedTheme(DARK_THEME);
    renderWithTheme(<SectionHeader title="Appearance" />);
    await expectStyle(screen.getByText("Appearance"), "color", DARK_TEXT);
  });
});

describe("ToggleRow follows the applied theme", () => {
  it("paints border and title from tokens in both modes", async () => {
    seedTheme(LIGHT_THEME);
    const light = renderWithTheme(
      <ToggleRow title="Autosave" checked onChange={() => {}} />,
    );
    const lightRow = screen.getByText("Autosave").closest("label") as HTMLElement;
    await expectStyle(lightRow, "borderColor", LIGHT_BORDER);
    await expectStyle(screen.getByText("Autosave"), "color", LIGHT_TEXT);
    light.unmount();

    seedTheme(DARK_THEME);
    renderWithTheme(<ToggleRow title="Autosave" checked onChange={() => {}} />);
    const darkRow = screen.getByText("Autosave").closest("label") as HTMLElement;
    await expectStyle(darkRow, "borderColor", DARK_BORDER);
    await expectStyle(screen.getByText("Autosave"), "color", DARK_TEXT);
  });
});

describe("SettingsInput follows the applied theme", () => {
  it("paints surface and text from tokens in both modes", async () => {
    seedTheme(LIGHT_THEME);
    const light = renderWithTheme(
      <SettingsInput label="Name" value="x" onChange={() => {}} />,
    );
    const lightInput = light.container.querySelector("input") as HTMLElement;
    await expectStyle(lightInput, "backgroundColor", LIGHT_SURFACE);
    await expectStyle(lightInput, "color", LIGHT_TEXT);
    light.unmount();

    seedTheme(DARK_THEME);
    const dark = renderWithTheme(
      <SettingsInput label="Name" value="x" onChange={() => {}} />,
    );
    const darkInput = dark.container.querySelector("input") as HTMLElement;
    await expectStyle(darkInput, "backgroundColor", DARK_SURFACE);
    await expectStyle(darkInput, "color", DARK_TEXT);
  });
});
