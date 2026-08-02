// Stripe configuration health check.
// Reports which Stripe env vars are configured WITHOUT leaking values.
// Used to verify production wiring without making a test purchase.
import { NextResponse } from "next/server";
import { PLANS, getStripePriceId } from "@/config/plans";

export const runtime = "nodejs";

export async function GET() {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  const report = {
    timestamp: new Date().toISOString(),
    secretKey: secretKey.length > 10,
    publishableKey: publishableKey.length > 10,
    webhookSecret: webhookSecret.length > 10,
    plans: Object.fromEntries(
      Object.values(PLANS)
        .filter((p) => p.billingType !== "free")
        .map((p) => {
          const priceId = getStripePriceId(p);
          return [
            p.id,
            {
              name: p.name,
              priceIdConfigured: !!priceId && priceId.startsWith("price_"),
              envVar: p.stripePriceIdEnv ?? null,
            },
          ];
        }),
    ),
  };

  const allConfigured =
    report.secretKey &&
    report.publishableKey &&
    report.webhookSecret &&
    Object.values(report.plans).every(
      (p: { priceIdConfigured: boolean }) => p.priceIdConfigured,
    );

  return NextResponse.json(
    { ...report, ready: allConfigured },
    { status: allConfigured ? 200 : 503 },
  );
}
