/**
 * SettingsRouteLoading — the loading state for the /settings route
 * tree. Same shape as the shared <LoadingBar> (⚡, uppercase label,
 * accent bar via the shared .loading-bar class) but in the platform's
 * all-light look: the shared bar hard-codes a near-black background
 * (#0f0f14), which flashed a full-screen black screen before the
 * light Settings page appeared. Settings routes use this instead;
 * other routes keep the shared bar.
 */
export function SettingsRouteLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="min-h-dvh flex items-center justify-center px-5 pb-[calc(2rem+env(safe-area-inset-bottom))]"
      style={{ backgroundColor: "#FFFFFF", color: "#0E1510" }}
    >
      <div className="text-center">
        <div className="text-3xl mb-4" aria-hidden="true">
          {"\u26A1"}
        </div>
        <div
          className="text-xs font-bold tracking-[0.15em] uppercase"
          style={{ color: "#717573" }}
        >
          {label}...
        </div>
        <div
          className="mt-4 w-48 h-1 mx-auto rounded-full"
          style={{ backgroundColor: "#EDF3E4", border: "1px solid #CFDEC4" }}
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
