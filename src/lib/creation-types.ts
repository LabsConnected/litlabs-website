/**
 * Canonical "what are you making" vocabulary — ONE taxonomy used by every
 * creation surface (dashboard Quick Start, studio build-type picker, media
 * modes).
 *
 * The id, label, and icon for a creation type must be identical everywhere
 * it appears. Pickers render a *subset* of this list for their context
 * (e.g. Quick Start shows the six media+build tiles; the canvas
 * build-type picker shows the build types that have a working editor),
 * but they must never invent a new name for an existing concept.
 *
 * Unavailable types (e.g. games while the game editor is Phase 2) are
 * represented here with `available: false` so pickers can *filter* them —
 * never render them as selectable dead ends.
 */

export type CreationTypeId =
  | "website"
  | "app"
  | "game"
  | "component"
  | "html"
  | "image"
  | "video"
  | "music";

export interface CreationTypeMeta {
  /** Stable id — shared across pickers, modes, and routes. */
  id: CreationTypeId;
  /** Display label — identical everywhere this type is shown. */
  label: string;
  /** Lucide icon name — identical everywhere this type is shown. */
  icon: string;
  description: string;
  /** Whether this type builds something (canvas/code) or generates media. */
  kind: "build" | "media";
  /** Studio deep link that starts this creation type. */
  href: string;
  /**
   * Whether the type is selectable in pickers. Types that are not yet
   * supported stay filtered out instead of rendering as dead ends.
   */
  available?: boolean;
}

export const CREATION_TYPES: CreationTypeMeta[] = [
  {
    id: "website",
    label: "Website",
    icon: "Globe",
    description: "Landing pages, business sites, stores",
    kind: "build",
    href: "/studio?tool=chat&mode=website",
  },
  {
    id: "app",
    label: "App",
    icon: "Smartphone",
    description: "Interactive web apps, dashboards, tools",
    kind: "build",
    href: "/studio?tool=build",
  },
  {
    id: "game",
    label: "Game",
    icon: "Gamepad2",
    description: "2D and 3D games",
    kind: "build",
    href: "/studio?tool=game",
    // The game editor is Phase 2 — filtered from pickers until it exists.
    available: false,
  },
  {
    id: "component",
    label: "Component",
    icon: "Component",
    description: "Reusable UI components",
    kind: "build",
    href: "/studio?tool=build",
  },
  {
    id: "html",
    label: "HTML / CSS / JS",
    icon: "Code2",
    description: "Raw HTML, CSS, and JavaScript with live preview",
    kind: "build",
    href: "/studio?tool=chat&mode=code",
  },
  {
    id: "image",
    label: "Image",
    icon: "Image",
    description: "AI-generated images",
    kind: "media",
    href: "/studio?tool=chat&mode=image",
  },
  {
    id: "video",
    label: "Video",
    icon: "Film",
    description: "AI-generated video clips",
    kind: "media",
    href: "/studio?tool=chat&mode=video",
  },
  {
    id: "music",
    label: "Music",
    icon: "Music",
    description: "AI-generated music",
    kind: "media",
    href: "/studio?tool=chat&mode=music",
  },
];

export function getCreationType(id: CreationTypeId): CreationTypeMeta {
  return CREATION_TYPES.find((t) => t.id === id) ?? CREATION_TYPES[0];
}

/** Types a picker may offer — unavailable types are filtered, never shown as dead ends. */
export function selectableCreationTypes(): CreationTypeMeta[] {
  return CREATION_TYPES.filter((t) => t.available !== false);
}
