import { describe, it, expect } from "vitest";

/**
 * The canonical "what are you making" vocabulary.
 * One taxonomy used by the dashboard Quick Start, the studio build-type
 * picker, and the media modes — same id, label, and icon everywhere.
 */

import {
  CREATION_TYPES,
  getCreationType,
  selectableCreationTypes,
} from "./creation-types";

describe("creation-types vocabulary", () => {
  it("has unique ids and labels", () => {
    const ids = CREATION_TYPES.map((t) => t.id);
    const labels = CREATION_TYPES.map((t) => t.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("uses the agreed vocabulary labels", () => {
    const byId = Object.fromEntries(CREATION_TYPES.map((t) => [t.id, t.label]));
    expect(byId).toMatchObject({
      website: "Website",
      app: "App",
      game: "Game",
      component: "Component",
      html: "HTML / CSS / JS",
      image: "Image",
      video: "Video",
      music: "Music",
    });
  });

  it("every type has a studio deep link", () => {
    for (const t of CREATION_TYPES) {
      expect(t.href, `${t.id} href`).toMatch(/^\/studio\?/);
    }
  });

  it("unavailable types are filtered from pickers, not rendered as dead ends", () => {
    // The game editor is Phase 2 — it must stay out of pickers.
    const game = CREATION_TYPES.find((t) => t.id === "game")!;
    expect(game.available).toBe(false);
    const selectable = selectableCreationTypes();
    expect(selectable.some((t) => t.id === "game")).toBe(false);
    // But the concept still exists in the vocabulary.
    expect(getCreationType("game").label).toBe("Game");
  });

  it("getCreationType falls back to the first type for unknown ids", () => {
    expect(getCreationType("nope" as never).id).toBe(CREATION_TYPES[0].id);
  });
});
