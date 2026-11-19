import type { ReactNode } from "react";

/**
 * StudioEntrySkeleton — the in-Studio binding-state board (Studio
 * entry fix, Larry 2026-11-18).
 *
 * Rendered inside CommandStudio's body while the layout is known but
 * a project is not bound yet (auth / capabilities still resolving).
 * It occupies the SAME geometry the real board will: a full-window
 * board area with floating panel placeholders at the default panels'
 * positions, and the Chat panel — anchored top-center at its seeded
 * rect (404px wide, 16px from the top) — holding the real chat
 * content in its normal board panel slot when the caller passes it.
 *
 * This replaces the retired "studio-board-shell-noproject" branch,
 * which rendered ONLY the chat in a centered max-w-xl column — the
 * "shows chat in the middle, then it disappears" flash Larry ruled
 * out. Here nothing is a lone centered column and nothing disappears:
 * when the project binds, StudioBoard swaps in panel for panel and
 * the chat stays in its panel.
 *
 * Skeleton blocks only in the placeholder panels — no fake text,
 * project names, or tool output.
 */
/**
 * StudioEntryClassicSkeleton — the Regular layout's binding state:
 * the chat placeholder sits in the classic body's real left column
 * (the LiTTPanel's in-flow position) with the workspace main beside
 * it — never an interim centered chat.
 */
export function StudioEntryClassicSkeleton() {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      data-testid="studio-classic-shell-binding"
    >
      <aside
        className="hidden min-h-0 w-[404px] max-w-[40vw] shrink-0 flex-col border-r lg:flex"
        style={{
          borderColor: "var(--studio-border)",
          backgroundColor: "var(--studio-surface)",
        }}
        data-testid="studio-entry-classic-chat"
        aria-hidden="true"
      >
        <div
          className="flex shrink-0 gap-1 border-b px-3 py-2"
          style={{ borderColor: "var(--studio-border)" }}
        >
          <div className="h-7 w-[72px] animate-pulse rounded-full bg-black/10" />
          <div className="h-7 w-[72px] animate-pulse rounded-full bg-black/10" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
          <div className="h-11 w-[72%] animate-pulse self-start rounded-2xl bg-black/10" />
          <div className="h-8 w-[58%] animate-pulse self-end rounded-2xl bg-black/10" />
          <div className="h-14 w-[80%] animate-pulse self-start rounded-2xl bg-black/10" />
        </div>
        <div
          className="flex shrink-0 items-center gap-2 border-t p-3"
          style={{ borderColor: "var(--studio-border)" }}
        >
          <div className="h-12 flex-1 animate-pulse rounded-xl bg-black/10" />
          <div className="h-10 w-10 animate-pulse rounded-full bg-black/10" />
        </div>
      </aside>
      <main
        className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden"
        data-testid="studio-entry-classic-workspace"
        aria-hidden="true"
      >
        <div
          className="flex h-9 shrink-0 items-center gap-0.5 border-b px-2"
          style={{
            borderColor: "var(--studio-border)",
            backgroundColor: "var(--studio-surface)",
          }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-6 w-[76px] animate-pulse rounded-md bg-black/10" />
          ))}
        </div>
        <div className="min-h-0 flex-1 p-4">
          <div className="h-full w-full animate-pulse rounded-xl bg-black/5" />
        </div>
      </main>
    </div>
  );
}

export default function StudioEntrySkeleton({
  chatContent,
}: {
  /** The real board chat content, rendered inside the chat panel
   *  slot. Omit for a pure placeholder chat panel. */
  chatContent?: ReactNode;
}) {
  const panelStyle = {
    borderColor: "var(--studio-border)",
    backgroundColor: "var(--studio-surface)",
  } as const;

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      data-testid="studio-board-shell-binding"
    >
      {/* Preview panel placeholder — center-left default rect. */}
      <div
        className="absolute hidden flex-col overflow-hidden rounded-xl border md:flex"
        style={{
          ...panelStyle,
          left: 24,
          top: 72,
          width: "min(700px, 52vw)",
          height: "min(532px, calc(100% - 120px))",
        }}
        data-testid="studio-entry-panel-preview"
        aria-hidden="true"
      >
        <div
          className="flex h-9 shrink-0 items-center gap-2 border-b px-3"
          style={{ borderColor: "var(--studio-border)" }}
        >
          <div className="h-3.5 w-[72px] animate-pulse rounded-lg bg-black/10" />
          <div className="flex-1" />
          <div className="h-5 w-5 animate-pulse rounded-md bg-black/10" />
        </div>
        <div className="min-h-0 flex-1 p-3">
          <div className="h-full w-full animate-pulse rounded-lg bg-black/5" />
        </div>
      </div>

      {/* Files panel placeholder — right-top default rect. */}
      <div
        className="absolute hidden flex-col overflow-hidden rounded-xl border xl:flex"
        style={{ ...panelStyle, right: 24, top: 72, width: 360, height: 240 }}
        data-testid="studio-entry-panel-files"
        aria-hidden="true"
      >
        <div
          className="flex h-9 shrink-0 items-center gap-2 border-b px-3"
          style={{ borderColor: "var(--studio-border)" }}
        >
          <div className="h-3.5 w-14 animate-pulse rounded-lg bg-black/10" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          {[82, 73, 64, 55].map((w) => (
            <div
              key={w}
              className="h-4 animate-pulse rounded-lg bg-black/10"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>

      {/* Media panel placeholder — right-bottom default rect. */}
      <div
        className="absolute hidden flex-col overflow-hidden rounded-xl border xl:flex"
        style={{ ...panelStyle, right: 24, bottom: 24, width: 360, height: 220 }}
        data-testid="studio-entry-panel-media"
        aria-hidden="true"
      >
        <div
          className="flex h-9 shrink-0 items-center gap-2 border-b px-3"
          style={{ borderColor: "var(--studio-border)" }}
        >
          <div className="h-3.5 w-14 animate-pulse rounded-lg bg-black/10" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-2 p-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-full w-full animate-pulse rounded-lg bg-black/5" />
          ))}
        </div>
      </div>

      {/* Chat panel — anchored top-center in its real board panel
          slot. With chatContent this IS the real chat, already home;
          without it, a panel-shaped placeholder of the same size. */}
      <div
        className="absolute flex flex-col overflow-hidden rounded-xl border shadow-lg"
        style={{
          ...panelStyle,
          left: "50%",
          transform: "translateX(-50%)",
          top: 16,
          width: "min(404px, calc(100vw - 32px))",
          height: "calc(100% - 32px)",
        }}
        data-testid="studio-entry-chat-panel"
      >
        {chatContent ?? (
          <div className="flex min-h-0 flex-1 flex-col" aria-hidden="true">
            <div
              className="flex shrink-0 gap-1 border-b px-3 py-2"
              style={{ borderColor: "var(--studio-border)" }}
            >
              <div className="h-7 w-[72px] animate-pulse rounded-full bg-black/10" />
              <div className="h-7 w-[72px] animate-pulse rounded-full bg-black/10" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
              <div className="h-11 w-[72%] animate-pulse self-start rounded-2xl bg-black/10" />
              <div className="h-8 w-[58%] animate-pulse self-end rounded-2xl bg-black/10" />
              <div className="h-14 w-[80%] animate-pulse self-start rounded-2xl bg-black/10" />
            </div>
            <div
              className="flex shrink-0 items-center gap-2 border-t p-3"
              style={{ borderColor: "var(--studio-border)" }}
            >
              <div className="h-12 flex-1 animate-pulse rounded-xl bg-black/10" />
              <div className="h-10 w-10 animate-pulse rounded-full bg-black/10" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
