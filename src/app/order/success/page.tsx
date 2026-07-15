"use client";

/**
 * /order/success — Post-purchase "Thank you" page.
 *
 * Customers land here after a successful Stripe checkout (the checkout route
 * configures Stripe `success_url` to `${origin}/order/success?session_id={CHECKOUT_SESSION_ID}`).
 *
 * Behaviour:
 *   - If `?session_id=...` is present, we hit `/api/stripe/session` to pull
 *     real receipt data (amount, currency, email, line items).
 *   - If the request fails or no session_id is present, we render a graceful
 *     "thanks for your order" fallback so the page never looks broken.
 *   - We also surface clear next-steps (Dashboard, Marketplace, Docs) so the
 *     user keeps moving instead of bouncing.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  Mail,
  Receipt,
  Sparkles,
  Terminal,
  Loader2,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";

type LineItem = {
  description: string;
  amount: number; // cents
  currency: string;
  quantity: number;
};

type SessionDetails = {
  id: string;
  amount_total: number; // cents
  currency: string;
  customer_email: string | null;
  payment_status: string;
  status: string;
  line_items: LineItem[];
  created: number; // unix seconds
};

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; session: SessionDetails }
  | { kind: "error"; message: string };

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(unixSeconds: number): string {
  try {
    return new Date(unixSeconds * 1000).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

function ThankYouContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [state, setState] = useState<FetchState>({ kind: "idle" });

  useEffect(() => {
    if (!sessionId) {
      setState({ kind: "idle" });
      return;
    }

    const ac = new AbortController();
    setState({ kind: "loading" });

    fetch(`/api/stripe/session?session_id=${encodeURIComponent(sessionId)}`, {
      signal: ac.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            res.status === 404
              ? "We couldn\u2019t find that order. If you were just charged, please check your email for a receipt."
              : text || `Request failed (${res.status})`,
          );
        }
        return res.json();
      })
      .then((data: SessionDetails) => setState({ kind: "ok", session: data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error
            ? err.message
            : "We couldn\u2019t load your order details.";
        setState({ kind: "error", message });
      });

    return () => ac.abort();
  }, [sessionId]);

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-[#06060e] text-[#e2e2e9]">
      {/* Background glows */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 h-[400px] w-[400px] rounded-full bg-fuchsia-500/10 blur-[120px]" />
        <div className="absolute bottom-1/4 -left-40 h-[400px] w-[400px] rounded-full bg-emerald-500/8 blur-[120px]" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 border-b border-white/5">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-black text-white"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-br from-cyan-400 to-fuchsia-500">
              <Sparkles size={14} className="text-black" />
            </div>
            LiTT Labs
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white transition hover:border-white/20 hover:bg-white/10"
          >
            Dashboard <ArrowRight size={12} />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-4 pb-12 pt-16 md:pt-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_40px_rgba(34,197,94,0.25)]">
            <CheckCircle2 size={32} className="text-emerald-400" />
          </div>

          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
            <ShieldCheck size={10} /> Payment received
          </div>

          <h1 className="mb-4 text-4xl font-black leading-[1.1] tracking-tight text-white md:text-5xl">
            <span>Thank you for your order</span>
            <span
              className="ml-2 bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #22d3ee 0%, #a855f7 50%, #ec4899 100%)",
              }}
            >
              {"\uD83C\uDF89"}
            </span>
          </h1>

          <p className="mx-auto max-w-xl text-base leading-relaxed text-neutral-400">
            {"Your purchase is confirmed. We\u2019ve emailed your receipt and your account has been updated. You can dive back in below."}
          </p>
        </div>
      </section>

      {/* Receipt / session card */}
      <section className="relative z-10 px-4 pb-16">
        <div className="mx-auto max-w-2xl">
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a14] shadow-[0_0_80px_rgba(34,211,238,0.06),0_0_0_1px_rgba(255,255,255,0.04)]">
            {/* Window chrome */}
            <div className="flex items-center gap-2 border-b border-white/6 bg-white/2 px-4 py-2.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
              <div className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
              <div className="ml-3 flex items-center gap-1.5 rounded-md bg-white/4 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-400">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Order confirmed
              </div>
            </div>

            <div className="p-6 md:p-8">
              {state.kind === "loading" && (
                <div className="flex items-center justify-center gap-3 py-10 text-sm text-neutral-400">
                  <Loader2 size={16} className="animate-spin text-cyan-400" />
                  {"Loading your receipt\u2026"}
                </div>
              )}

              {state.kind === "error" && (
                <div className="space-y-3 py-4 text-sm text-neutral-300">
                  <p className="text-amber-300">{state.message}</p>
                  <p className="text-xs text-neutral-500">
                    {"Your payment went through \u2014 we just couldn\u2019t load the receipt here. Check your email for confirmation, or visit your dashboard."}
                  </p>
                </div>
              )}

              {(state.kind === "ok" || state.kind === "idle") && (
                <ReceiptDetails
                  session={state.kind === "ok" ? state.session : null}
                />
              )}
            </div>
          </div>

          {/* Next steps */}
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <NextStep
              href="/studio"
              icon={<WandSparkles size={14} className="text-cyan-400" />}
              title="Open Studio"
              desc="Start a new project with your AI crew."
            />
            <NextStep
              href="/marketplace"
              icon={<Coins size={14} className="text-amber-300" />}
              title="Marketplace"
              desc="Browse and install more agents."
            />
            <NextStep
              href="/docs"
              icon={<Terminal size={14} className="text-fuchsia-400" />}
              title="Read the docs"
              desc="Get the most out of LiTT Labs."
            />
          </div>

          {/* Receipt email hint */}
          <div className="mt-8 flex items-start gap-3 rounded-xl border border-white/5 bg-white/2 p-4 text-xs text-neutral-400">
            <Mail size={14} className="mt-0.5 shrink-0 text-cyan-400" />
            <p>
              {"A confirmation email is on its way. Didn\u2019t get one? Check your spam folder, or contact support and we\u2019ll resend it."}
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

function ReceiptDetails({ session }: { session: SessionDetails | null }) {
  if (!session) {
    return (
      <div className="space-y-4 py-2 text-sm text-neutral-400">
        <p>
          {"We\u2019ve recorded your purchase. To see itemized details, head to your dashboard or check your email receipt."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-r from-cyan-500 to-cyan-400 px-3 py-1.5 text-xs font-bold text-black shadow-[0_0_16px_rgba(34,211,238,0.4)] transition hover:shadow-[0_0_24px_rgba(34,211,238,0.6)]"
          >
            Go to dashboard <ArrowRight size={12} />
          </Link>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:border-white/20 hover:bg-white/10"
          >
            Back to marketplace
          </Link>
        </div>
      </div>
    );
  }

  const {
    id,
    amount_total,
    currency,
    customer_email,
    payment_status,
    line_items,
    created,
  } = session;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-500">
          <Receipt size={12} /> Receipt
        </div>
        <div className="rounded-md border border-white/8 bg-white/3 px-2 py-1 font-mono text-[10px] text-neutral-500">
          {id}
        </div>
      </div>

      <ul className="divide-y divide-white/5 rounded-xl border border-white/5 bg-white/2">
        {line_items.length === 0 ? (
          <li className="px-4 py-3 text-sm text-neutral-400">
            Order details unavailable
          </li>
        ) : (
          line_items.map((item, i) => (
            <li
              key={`${item.description}-${i}`}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">
                  {item.description}
                </div>
                {item.quantity > 1 && (
                  <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                    Qty {item.quantity}
                  </div>
                )}
              </div>
              <div className="shrink-0 font-mono text-sm font-bold text-cyan-300">
                {formatMoney(item.amount * item.quantity, currency)}
              </div>
            </li>
          ))
        )}
      </ul>

      <div className="flex items-center justify-between rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3">
        <div className="text-xs font-bold uppercase tracking-widest text-emerald-300">
          Total paid
        </div>
        <div className="font-mono text-lg font-black text-white">
          {formatMoney(amount_total, currency)}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-xs text-neutral-400 sm:grid-cols-2">
        <Meta label="Status" value={payment_status || "paid"} mono />
        <Meta
          label="Date"
          value={created ? formatDate(created) : "Just now"}
        />
        {customer_email && (
          <Meta label="Email" value={customer_email} wide />
        )}
      </dl>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Link
          href="/studio"
          className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-r from-cyan-500 to-cyan-400 px-4 py-2 text-xs font-black text-black shadow-[0_0_16px_rgba(34,211,238,0.4)] transition hover:shadow-[0_0_24px_rgba(34,211,238,0.6)]"
        >
          Open Studio <ArrowRight size={12} />
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/20 hover:bg-white/10"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-white/5 bg-white/2 px-3 py-2 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-sm text-white ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function NextStep({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-white/6 bg-white/2 p-4 transition hover:border-cyan-500/20 hover:bg-white/4"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-sm font-bold text-white">
          {title}
          <ArrowRight
            size={11}
            className="translate-x-0 text-neutral-500 transition group-hover:translate-x-0.5 group-hover:text-cyan-300"
          />
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-neutral-500">
          {desc}
        </div>
      </div>
    </Link>
  );
}
function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/5 px-4 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-xs text-neutral-600 md:flex-row">
        <div className="flex items-center gap-2 text-sm font-black text-white">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-linear-to-br from-cyan-400 to-fuchsia-500">
            <Sparkles size={11} className="text-black" />
          </div>
          LiTT Labs
        </div>
        <div className="flex items-center gap-6">
          <Link href="/docs" className="transition hover:text-white">
            Docs
          </Link>
          <Link href="/privacy" className="transition hover:text-white">
            Privacy
          </Link>
          <Link href="/terms" className="transition hover:text-white">
            Terms
          </Link>
        </div>
        <div>{("\u00A9 " + new Date().getFullYear() + " LiTTree Labs. Beta.")}</div>
      </div>
    </footer>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-[#06060e] text-neutral-400">
          <div className="flex items-center gap-3 text-sm">
            <Loader2 size={16} className="animate-spin text-cyan-400" />
            {"Loading\u2026"}
          </div>
        </main>
      }
    >
      <ThankYouContent />
    </Suspense>
  );
}

