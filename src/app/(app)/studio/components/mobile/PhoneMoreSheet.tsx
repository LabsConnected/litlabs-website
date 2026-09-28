"use client";

/**
 * PhoneMoreSheet — secondary stage surfaces for the responsive Studio
 * phone tier's More entry.
 *
 * Rows are built from STAGE_SURFACE_META for the surfaces not in the
 * bottom nav (Plan, Design, Browser, Code, Images, Assets, Deploy,
 * Terminal). Each row opens the surface in the SAME shared shell stage
 * via openStageSurface, then closes the sheet. Nothing navigates away
 * from Studio and nothing is mounted twice.
 */

import { STAGE_SURFACE_META, type StudioStageSurface } from "../shell/stage-surfaces";

const MORE_SURFACES: StudioStageSurface[] = [
  "plan",
  "design",
  "browser",
  "code",
  "images",
  "assets",
  "deploy",
  "terminal",
];

export default function PhoneMoreSheet({
  onSelectSurface,
}: {
  /** Open the surface in the shared shell stage (caller also closes the sheet). */
  onSelectSurface: (surface: StudioStageSurface) => void;
}) {
  return (
    <div className="flex flex-col gap-1 px-3 pb-3" data-testid="phone-more-sheet-content">
      {MORE_SURFACES.map((id) => {
        const meta = STAGE_SURFACE_META[id];
        const Icon = meta.icon;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelectSurface(id)}
            className="flex min-h-[56px] items-center gap-3 rounded-xl border px-3 text-left transition active:scale-[0.99]"
            style={{
              backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
              borderColor: "rgba(255,255,255,0.07)",
            }}
            data-testid={`phone-more-${id}`}
          >
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
              style={{
                backgroundColor: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
                color: "var(--color-accent)",
              }}
              aria-hidden
            >
              <Icon size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block text-[14px] font-black"
                style={{ color: "var(--text-primary)" }}
              >
                {meta.label}
              </span>
              <span
                className="block text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                {meta.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
