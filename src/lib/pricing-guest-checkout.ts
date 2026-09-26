/**
 * Where a signed-out visitor goes when they start checkout from /pricing.
 *
 * Kept as a named helper (not an inline string) so the return path is
 * covered by a regression test: sign-in only honors `redirect_url`, so this
 * must stay `?redirect_url=/pricing` — the bare `?redirect=` variant silently
 * drops the return path and the user lands in /studio with checkout
 * abandoned.
 */
export function pricingGuestCheckoutUrl(): string {
  return "/sign-in?redirect_url=/pricing";
}

/**
 * The plan a signed-out visitor picked on /pricing, remembered across the
 * sign-in redirect so checkout can resume where they left off instead of
 * dropping them back on /pricing with their choice forgotten.
 *
 * sessionStorage (not a URL param): it survives the same-tab redirect to
 * /sign-in and back, never leaks into shareable/bookmarkable URLs, and needs
 * no server round-trip. Read-and-clear via takePendingPlanCheckout so a
 * resume fires at most once.
 */
const PENDING_PLAN_STORAGE_KEY = "litt:pendingPlanCheckout";

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Remember the visitor's chosen plan before sending them to sign in. */
export function savePendingPlanCheckout(planId: string): void {
  try {
    storage()?.setItem(PENDING_PLAN_STORAGE_KEY, planId);
  } catch {
    // Storage unavailable (private mode, SSR) — the visitor just lands on
    // /pricing after sign-in, same as before. Never throw from here.
  }
}

/**
 * Read and clear the remembered plan. Returns null when there is nothing
 * to resume. Callers must validate the id against known plans — this
 * helper intentionally does no plan-config lookup.
 */
export function takePendingPlanCheckout(): string | null {
  const store = storage();
  if (!store) return null;
  try {
    const value = store.getItem(PENDING_PLAN_STORAGE_KEY);
    store.removeItem(PENDING_PLAN_STORAGE_KEY);
    return value;
  } catch {
    return null;
  }
}
