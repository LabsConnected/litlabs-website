"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";

type Receipt = {
  id: string;
  customerEmail: string | null;
  currency: string | null;
  total: number | null;
  items: Array<{ id: string; description: string; quantity: number | null; amountTotal: number }>;
};

function money(amount: number | null, currency: string | null) {
  if (amount === null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(amount / 100);
}

function SuccessContent() {
  const sessionId = useSearchParams().get("session_id");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [unavailable, setUnavailable] = useState(!sessionId);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    fetch(`/api/stripe/session?session_id=${encodeURIComponent(sessionId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("receipt unavailable");
        return response.json() as Promise<Receipt>;
      })
      .then(setReceipt)
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError") setUnavailable(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [sessionId]);

  return (
    <main className="relative z-10 min-h-screen px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <section className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-green-500/40 bg-green-500/10 text-green-400">
            <Check size={28} aria-hidden="true" />
          </div>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-green-400">Order confirmed</p>
          <h1 className="text-3xl font-bold sm:text-5xl">Thank you for your purchase.</h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-[var(--text-muted)]">Your payment was received. Your purchase is being applied to your LitLabs account.</p>
        </section>

        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)] sm:p-7">
          <div className="mb-6 border-b border-[var(--border-color)] pb-4">
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Receipt</p>
            <h2 className="mt-1 text-lg">Purchase details</h2>
          </div>
          {loading && <div className="flex items-center gap-3 py-10 text-[var(--text-muted)]"><LoaderCircle className="animate-spin" /> Loading your receipt…</div>}
          {receipt && !loading && (
            <div className="space-y-5">
              <div className="space-y-3">
                {receipt.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-4">
                    <div><p className="font-medium">{item.description}</p>{item.quantity && item.quantity > 1 ? <p className="text-xs text-[var(--text-muted)]">Qty {item.quantity}</p> : null}</div>
                    <p className="font-mono">{money(item.amountTotal, receipt.currency)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-[var(--border-color)] pt-4">
                <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{money(receipt.total, receipt.currency)}</span></div>
                {receipt.customerEmail && <p className="mt-3 text-sm text-[var(--text-muted)]">Confirmation sent to {receipt.customerEmail}</p>}
                <p className="mt-1 break-all font-mono text-xs text-[var(--text-muted)]">Order {receipt.id}</p>
              </div>
            </div>
          )}
          {unavailable && !loading && !receipt && (
            <div className="py-5"><h2 className="text-lg">Your purchase is recorded.</h2><p className="mt-2 text-[var(--text-muted)]">We could not display the receipt here. Your payment confirmation will arrive by email. Contact support if anything looks wrong.</p></div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="mb-4 text-lg">What would you like to do next?</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {[["Open Studio", "/studio"], ["Browse Marketplace", "/marketplace"], ["Read the Docs", "/docs"]].map(([label, href]) => (
              <Link key={href} href={href} className="group flex items-center justify-between rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] px-4 py-4 transition hover:border-[var(--accent-color)]">
                <span className="font-medium">{label}</span><ArrowRight size={16} className="transition group-hover:translate-x-1" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function OrderSuccessPage() {
  return <Suspense fallback={<main className="min-h-screen" />}><SuccessContent /></Suspense>;
}
