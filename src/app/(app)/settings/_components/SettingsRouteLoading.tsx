/**
 * SettingsRouteLoading — the loading state for the /settings route
 * tree. Same shape as the shared <LoadingBar> (⚡, uppercase label,
 * accent bar via the shared .loading-bar class).
 *
 * Colors bind to the theme's published root variables (ThemeProvider
 * sets --bg-color / --text-color / --border-color on <html> from the
 * resolved skin), so the screen follows the effective mode: the
 * approved all-light look in Light (Signature bg #FFFFFF, ink
 * #0E1510 — the same values this file used to hard-code), and Larry's
 * charcoal in Dark. The hard-coded #FFFFFF / #0E1510 / #EDF3E4
 * version painted a full-screen white flash in Dark mode — the
 * white-surface patchwork defect (fixed 2026-11-15). This is a
 * server-rendered loading state, so it cannot use the useTheme hook;
 * root variables are the theme mechanism available to it, the same
 * one the Marketplace hero uses.
 */
export function SettingsRouteLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="min-h-dvh flex items-center justify-center px-5 pb-[calc(2rem+env(safe-area-inset-bottom))]"
      style={{ backgroundColor: "var(--bg-color)", color: "var(--text-color)" }}
    >
      <div className="text-center">
        <div className="text-3xl mb-4" aria-hidden="true">
          {"\u26A1"}
        </div>
        <div
          className="text-xs font-bold tracking-[0.15em] uppercase"
          style={{ color: "color-mix(in srgb, var(--text-color) 55%, transparent)" }}
        >
          {label}...
        </div>
        <div
          className="mt-4 w-48 h-1 mx-auto rounded-full"
          style={{
            backgroundColor: "color-mix(in srgb, var(--text-color) 8%, transparent)",
            border: "1px solid var(--border-color)",
          }}
        >
          <div
            className="loading-bar h-full rounded-full bg-accent"
            style={{ width: "30%" }}
            role="progressbar"
            aria-label={`${label} in progress`}
          />
        </div>
      </div>
    </div>
  );
}
