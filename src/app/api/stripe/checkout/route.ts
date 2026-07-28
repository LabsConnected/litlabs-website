// Stripe checkout session creation — server-priced only.
//
// The browser sends only `{ "productId": "server-owned-id" }`. Every financial
// field (price, currency, mode, credits, metadata) is resolved from the
// server-owned product catalog in src/config/stripe-products.ts. Client-
// supplied priceData, priceId, amount, metadata, email, and mode are all
// rejected.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import {
  getProductById,
  CHECKOUT_VERSION,
  type ProductDefinition,
} from "@/config/stripe-products";

export const runtime = "nodejs";

// Strict request schema — `.strict()` rejects any unknown property.
const RequestSchema = z
  .object({
    productId: z.string().trim().min(1).max(100),
  })
  .strict();

/**
 * Resolves the trusted application URL for return redirects. Never reads the
 * request Origin header. localhost is allowed only in development.
 */
function getAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://litlabs.net");

  let url = raw.trim();
  // Normalize: remove trailing slashes.
  url = url.replace(/\/+$/, "");

  // In production, require HTTPS.
  if (
    process.env.NODE_ENV === "production" &&
    !url.startsWith("https://")
  ) {
    throw new Error("Production app URL must use HTTPS");
  }

  return url;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function productNotFound() {
  return NextResponse.json({ error: "Unknown product" }, { status: 404 });
}

function productUnavailable() {
  return NextResponse.json(
    { error: "Product is not available for purchase" },
    { status: 409 },
  );
}

/** Stable public error — never leaks Stripe internals. */
function stripeFailure() {
  return NextResponse.json(
    { error: "Unable to create checkout session" },
    { status: 502 },
  );
}

function serverError() {
  return NextResponse.json(
    { error: "Unable to create checkout session" },
    { status: 500 },
  );
}

/** Builds the form-encoded line_items segment from the catalog product. */
function buildLineItems(
  product: ProductDefinition,
  params: URLSearchParams,
): void {
  if (product.stripePriceId) {
    params.append("line_items[0][price]", product.stripePriceId);
  } else if (product.amountCents !== undefined) {
    params.append("line_items[0][price_data][currency]", product.currency);
    params.append(
      "line_items[0][price_data][unit_amount]",
      String(product.amountCents),
    );
    params.append(
      "line_items[0][price_data][product_data][name]",
      product.name,
    );
    if (product.description) {
      params.append(
        "line_items[0][price_data][product_data][description]",
        product.description,
      );
    }
  }
  params.append("line_items[0][quantity]", "1");
}

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return unauthorized();
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    // Strict validation — rejects priceData, priceId, amount, metadata, etc.
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid request. Expected { productId: string }.");
    }

    const product = getProductById(parsed.data.productId);
    if (!product) {
      return productNotFound();
    }
    if (!product.active) {
      return productUnavailable();
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      // Sanitized — does not name the env var to the browser.
      return serverError();
    }

    const appUrl = getAppUrl();

    const params = new URLSearchParams();
    // Product controls the Stripe checkout mode.
    params.append("mode", product.checkoutMode);
    params.append(
      "success_url",
      `${appUrl}/order/success?session_id={CHECKOUT_SESSION_ID}`,
    );
    params.append("cancel_url", `${appUrl}/marketplace?canceled=true`);
    // Product controls promotion-code permission.
    params.append(
      "allow_promotion_codes",
      product.allowPromotionCodes ? "true" : "false",
    );
    params.append("billing_address_collection", "auto");
    params.append("automatic_tax[enabled]", "false");

    buildLineItems(product, params);

    // All metadata is built server-side from auth + catalog. No client
    // metadata is ever merged.
    const metadata: Record<string, string> = {
      clerk_id: clerkId,
      product_id: product.id,
      product_type: product.type,
      checkout_version: CHECKOUT_VERSION,
    };
    if (product.type === "coin_pack" && product.credits !== undefined) {
      metadata.coin_amount = String(product.credits);
    }
    if (product.type === "plan" && product.planId) {
      metadata.plan_id = product.planId;
    }
    for (const [key, value] of Object.entries(metadata)) {
      params.append(`metadata[${key}]`, value);
    }

    // No customer_email from the browser — let Stripe collect it.

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );

    if (!stripeResponse.ok) {
      // Log server-side, return sanitized public error.
      console.error(
        "[stripe/checkout] Stripe returned non-2xx",
        stripeResponse.status,
      );
      return stripeFailure();
    }

    const session = (await stripeResponse.json()) as {
      url?: string;
      id?: string;
    };

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    // getAppUrl throws for invalid production URLs — surface as 500.
    if (err instanceof Error) {
      console.error("[stripe/checkout] server error:", err.message);
    }
    return serverError();
  }
}
