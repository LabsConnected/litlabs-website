// Stripe health endpoint — verifies Stripe configuration and API connectivity.
//
// GET /api/stripe/health
//
// Returns:
//   200 { status: "ready", stripe: true, webhookSecret: true, publishableKey: true }
//   200 { status: "degraded", ... } — some config missing but Stripe API reachable
//   200 { status: "not_configured", stripe: false, ... } — Stripe not configured
//   502 { status: "error", error: "..." } — Stripe API unreachable
//
// This endpoint is public (no auth) so monitoring systems can poll it.
// It never exposes secret values — only boolean presence indicators.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  const hasStripeKey = Boolean(stripeKey);
  const hasWebhookSecret = Boolean(webhookSecret);
  const hasPublishableKey = Boolean(publishableKey);

  // If no Stripe key at all, return not_configured without making API calls
  if (!hasStripeKey) {
    return NextResponse.json({
      status: "not_configured",
      stripe: false,
      webhookSecret: hasWebhookSecret,
      publishableKey: hasPublishableKey,
      timestamp: new Date().toISOString(),
    });
  }

  // Test Stripe API connectivity by fetching account info
  try {
    const resp = await fetch("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${stripeKey}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      return NextResponse.json({
        status: "error",
        stripe: false,
        webhookSecret: hasWebhookSecret,
        publishableKey: hasPublishableKey,
        error: `Stripe API returned ${resp.status}`,
        timestamp: new Date().toISOString(),
      }, { status: 502 });
    }

    const account = await resp.json() as { id?: string; email?: string };
    const fullyConfigured = hasStripeKey && hasWebhookSecret && hasPublishableKey;

    return NextResponse.json({
      status: fullyConfigured ? "ready" : "degraded",
      stripe: true,
      webhookSecret: hasWebhookSecret,
      publishableKey: hasPublishableKey,
      accountId: account.id ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({
      status: "error",
      stripe: false,
      webhookSecret: hasWebhookSecret,
      publishableKey: hasPublishableKey,
      error: message,
      timestamp: new Date().toISOString(),
    }, { status: 502 });
  }
}
