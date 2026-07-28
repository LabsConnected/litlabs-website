import "server-only";

import type { PlanId } from "@/config/plans";

/**
 * Server-owned Stripe checkout product catalog.
 *
 * This catalog is the single source of truth for what may be purchased via
 * `/api/stripe/checkout`. The browser may only send a `productId`; every
 * financial field (price, currency, mode, credits, metadata) is resolved here
 * on the server.
 *
 * The catalog is intentionally empty. No confirmed products exist for this
 * route yet — existing subscription/plan purchases use the separate
 * `/api/billing/checkout` route with pre-created Stripe Price IDs. Until real
 * coin-pack or marketplace products are approved, every checkout request is
 * rejected. This securely closes the orphan endpoint without removing the
 * architecture needed for future products.
 */

export type ProductType = "coin_pack" | "plan" | "one_time";
export type CheckoutMode = "payment" | "subscription";

export interface ProductDefinition {
  /** Stable server-owned identifier sent by the browser. */
  id: string;
  /** When false, the route rejects the product as unavailable. */
  active: boolean;
  /** Product category — controls which metadata fields are emitted. */
  type: ProductType;
  /** Stripe Checkout mode — controls the `mode` parameter sent to Stripe. */
  checkoutMode: CheckoutMode;
  /**
   * Pre-created Stripe Price ID (e.g. `price_xxx`).
   * Required for `subscription` products; optional for `payment` products
   * that use an ad-hoc `amountCents` instead.
   */
  stripePriceId?: string;
  /**
   * Ad-hoc unit amount in cents. Mutually exclusive with `stripePriceId`.
   * Required for `payment` products that do not use `stripePriceId`.
   */
  amountCents?: number;
  /** ISO currency code. Defaults to "usd". */
  currency: string;
  /** Display name sent to Stripe as `product_data.name` (ad-hoc only). */
  name: string;
  /** Optional description sent to Stripe as `product_data.description`. */
  description?: string;
  /** LiTTBits granted on purchase. Only valid for `coin_pack` products. */
  credits?: number;
  /** Plan identifier. Only valid for products representing a plan. */
  planId?: PlanId;
  /** Whether Stripe promotion codes are allowed for this product. */
  allowPromotionCodes: boolean;
}

/**
 * Bumped whenever the checkout metadata contract changes so webhook handlers
 * can distinguish legacy sessions from the server-priced flow.
 */
export const CHECKOUT_VERSION = "server-priced-v1";

/**
 * The authoritative product catalog. Frozen so client code cannot mutate it
 * at runtime. Empty until real, approved products exist.
 */
export const PRODUCT_CATALOG: Readonly<Record<string, ProductDefinition>> =
  Object.freeze({});

/**
 * Resolves a product by id. Returns the record even when `active` is false so
 * the route can distinguish "unknown product" (404) from "inactive product"
 * (409) and emit the correct error.
 */
export function getProductById(id: string): ProductDefinition | undefined {
  return PRODUCT_CATALOG[id];
}

/**
 * Validates catalog invariants at module load. A misconfigured catalog is a
 * build-time / startup bug, not a runtime negotiation, so this throws loudly.
 *
 * Invariants:
 *  - Exactly one of `amountCents` or `stripePriceId` (XOR).
 *  - `checkoutMode: "subscription"` requires `stripePriceId` (ad-hoc amounts
 *    cannot safely create Stripe subscriptions without recurring interval
 *    data).
 *  - `credits` only for `coin_pack` products.
 *  - `planId` only for `plan` products.
 *  - `amountCents`, when present, must be a positive integer >= 50 (Stripe
 *    minimum).
 */
export function validateCatalog(catalog: Record<string, ProductDefinition>): void {
  const APPROVED_CURRENCIES = new Set(["usd", "eur", "gbp", "cad", "aud"]);
  for (const [id, p] of Object.entries(catalog)) {
    // Catalog key must match the product's own id.
    if (p.id !== id) {
      throw new Error(
        `Catalog key "${id}" must match product.id "${p.id}"`,
      );
    }

    // name must be a non-empty string.
    if (!p.name || p.name.trim().length === 0) {
      throw new Error(`Product "${id}" must have a non-empty name`);
    }

    // currency must be an approved lowercase ISO code.
    if (!APPROVED_CURRENCIES.has(p.currency)) {
      throw new Error(
        `Product "${id}" currency "${p.currency}" is not an approved currency`,
      );
    }

    const hasAmount = p.amountCents !== undefined && p.amountCents !== null;
    const hasPrice = !!p.stripePriceId;

    if (hasAmount === hasPrice) {
      throw new Error(
        `Product "${id}" must define exactly one of amountCents or stripePriceId`,
      );
    }
    if (p.checkoutMode === "subscription" && !hasPrice) {
      throw new Error(
        `Product "${id}" is a subscription and requires stripePriceId`,
      );
    }
    if (hasPrice && !p.stripePriceId!.startsWith("price_")) {
      throw new Error(
        `Product "${id}" stripePriceId must start with "price_"`,
      );
    }
    if (hasAmount) {
      if (
        !Number.isInteger(p.amountCents) ||
        (p.amountCents as number) < 50
      ) {
        throw new Error(
          `Product "${id}" amountCents must be a positive integer >= 50`,
        );
      }
    }
    // credits: positive integer, only for coin_pack, and required for coin_pack.
    if (p.credits !== undefined) {
      if (!Number.isInteger(p.credits) || p.credits <= 0) {
        throw new Error(
          `Product "${id}" credits must be a positive integer`,
        );
      }
      if (p.type !== "coin_pack") {
        throw new Error(`Product "${id}" credits is only valid for coin_pack`);
      }
    }
    if (p.type === "coin_pack" && p.credits === undefined) {
      throw new Error(`Product "${id}" is a coin_pack and requires credits`);
    }
    // planId: only for plan products, and required for plan products.
    if (p.planId !== undefined && p.type !== "plan") {
      throw new Error(`Product "${id}" planId is only valid for plan products`);
    }
    if (p.type === "plan" && p.planId === undefined) {
      throw new Error(`Product "${id}" is a plan and requires planId`);
    }
  }
}

// Validate at module load — fails fast in dev and at build time.
validateCatalog(PRODUCT_CATALOG as Record<string, ProductDefinition>);
