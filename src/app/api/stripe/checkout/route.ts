// Stripe checkout — server-owned product catalog.
//
// POST /api/stripe/checkout
//
// The browser may only send a `productId`. Every financial field (price,
// currency, mode, credits, metadata) is resolved from the server-owned
// PRODUCT_CATALOG. The browser cannot set price, amount, metadata, email,
// or return URL.
//
// Agent purchases use the separate /api/marketplace/agents/[id]/checkout route.
// Plan/subscription purchases use the separate /api/billing/checkout route.
//
// The catalog is intentionally empty until real products are approved.
// Until then, every request is rejected with 404.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getProductById,
  CHECKOUT_VERSION,
} from "@/config/stripe-products";

export const runtime = "nodejs";

function getAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://litlabs.net");
  const url = raw.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production" && !url.startsWith("https://")) {
    throw new Error("Production app URL must use HTTPS");
  }
  return url;
}

export async function POST(req: NextRequest) {
  try {
    const { clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { productId } = body as { productId?: string };

    if (!productId || typeof productId !== "string") {
      return NextResponse.json(
        { error: "Missing productId" },
        { status: 400 },
      );
    }

    // Resolve product from the server-owned catalog.
    const product = getProductById(productId);
    if (!product) {
      return NextResponse.json(
        { error: `Unknown product: ${productId}` },
        { status: 404 },
      );
    }

    if (!product.active) {
      return NextResponse.json(
        { error: `Product is not available: ${productId}` },
        { status: 409 },
      );
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { error: "Stripe is not configured", setup_required: true },
        { status: 501 },
      );
    }

    let appUrl: string;
    try {
      appUrl = getAppUrl();
    } catch {
      return NextResponse.json(
        { error: "Server URL misconfiguration" },
        { status: 500 },
      );
    }

    const params = new URLSearchParams();
    params.append("mode", product.checkoutMode);
    params.append(
      "success_url",
      `${appUrl}/order/success?session_id={CHECKOUT_SESSION_ID}`,
    );
    params.append("cancel_url", `${appUrl}/marketplace?canceled=true`);
    params.append(
      "allow_promotion_codes",
      product.allowPromotionCodes ? "true" : "false",
    );
    params.append("billing_address_collection", "auto");
    // Automatic tax is disabled by default. Enable only after Stripe Tax
    // is fully configured (registrations, product tax codes, tax behavior).
    // See docs/STRIPE_CATALOG_WIRING.md for the configuration checklist.
    const autoTaxEnabled = process.env.STRIPE_AUTOMATIC_TAX_ENABLED === "true";
    params.append("automatic_tax[enabled]", autoTaxEnabled ? "true" : "false");

    // Line items — server-controlled, never client-supplied.
    if (product.stripePriceId) {
      params.append("line_items[0][price]", product.stripePriceId);
      params.append("line_items[0][quantity]", "1");
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
      params.append("line_items[0][quantity]", "1");
    }

    // Server-generated metadata — the browser cannot override these.
    params.append("metadata[checkout_version]", CHECKOUT_VERSION);
    params.append("metadata[product_type]", product.type);
    params.append("metadata[clerk_id]", clerkId);
    if (product.type === "credit_pack" && product.credits) {
      params.append("metadata[coin_amount]", String(product.credits));
    }
    if (product.type === "plan" && product.planId) {
      params.append("metadata[plan_id]", product.planId);
    }

    // Also propagate metadata to the PaymentIntent for refund classification.
    params.append("payment_intent_data[metadata][product_type]", product.type);
    params.append("payment_intent_data[metadata][clerk_id]", clerkId);
    if (product.type === "credit_pack" && product.credits) {
      params.append(
        "payment_intent_data[metadata][coin_amount]",
        String(product.credits),
      );
    }
    if (product.type === "plan" && product.planId) {
      params.append("payment_intent_data[metadata][plan_id]", product.planId);
    }

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

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return NextResponse.json(
        { error: session.error?.message || "Stripe error" },
        { status: stripeResponse.status },
      );
    }

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}