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
