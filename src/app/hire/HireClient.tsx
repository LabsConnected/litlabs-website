"use client";

import Link from "next/link";
import { Check, ArrowRight, Sparkles } from "lucide-react";
import { useState } from "react";

type OfferData = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  price: string;
  deliverables: string[];
  exclusions: string[];
  turnaround: string;
  icon: string;
  accent: string;
  featured: boolean;
  enabled: boolean;
  paymentLink: string | null;
};

export default function HireClient({ offers }: { offers: OfferData[] }) {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    serviceId: "",
    message: "",
    referralCode: "",
  });

  async function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/leads/service-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          company: form.company || null,
          serviceId: form.serviceId || null,
          message: form.message || null,
          referralCode: form.referralCode || null,
        }),
      });
    } catch {
      // best-effort — don't block the user
    }
    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    <div className="min-h-screen bg-[#03050a] text-white">
      {/* Hero */}
      <section className="relative overflow-hidden px-5 pt-32 pb-16 lg:px-10">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#a8ff2f]/5 to-transparent" />
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#a8ff2f]/30 bg-[#a8ff2f]/5 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-[#a8ff2f]">
            <Sparkles size={12} /> Hire LiTTree LabStudios
          </div>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
            Get it <span className="text-[#a8ff2f]">done</span> for you
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-white/60">
            Don&apos;t want to DIY it? We&apos;ll build your site, set up your AI automation,
            or design your brand — then hand you the keys to LiTTree for ongoing work.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="#offers" className="rounded-xl bg-[#a8ff2f] px-6 py-3 text-sm font-black text-black transition hover:scale-[1.02]">
              See offers
            </a>
            <a href="#inquiry" className="rounded-xl border border-white/20 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/5">
              Talk to us first
            </a>
          </div>
        </div>
      </section>

      {/* Service Offers */}
      <section id="offers" className="px-5 py-16 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-2 text-2xl font-black">Productized services</h2>
          <p className="mb-10 text-sm text-white/50">
            Clear scope. Clear price. No surprises. Pick the one that fits.
          </p>

          <div className="grid gap-6 md:grid-cols-3">
            {offers.map((offer) => (
              <div
                key={offer.id}
                className="relative flex flex-col rounded-2xl border-2 p-6 transition hover:scale-[1.01]"
                style={{
                  borderColor: offer.featured ? offer.accent : "rgba(255,255,255,0.1)",
                  backgroundColor: offer.featured ? `${offer.accent}08` : "rgba(255,255,255,0.02)",
                }}
              >
                {offer.featured && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider text-black"
                    style={{ backgroundColor: offer.accent }}
                  >
                    Most popular
                  </div>
                )}

                <div className="mb-3 text-3xl">{offer.icon}</div>
                <h3 className="text-lg font-black">{offer.name}</h3>
                <p className="mt-1 text-xs text-white/50">{offer.tagline}</p>

                <div className="mt-4 text-3xl font-black" style={{ color: offer.accent }}>
                  {offer.price}
                </div>
                <div className="text-[10px] text-white/40">one-time · {offer.turnaround}</div>

                <p className="mt-4 text-xs text-white/60">{offer.description}</p>

                <div className="mt-4 flex-1 space-y-1.5">
                  {offer.deliverables.map((d) => (
                    <div key={d} className="flex items-start gap-2 text-[11px] text-white/70">
                      <Check size={12} className="mt-0.5 shrink-0" style={{ color: offer.accent }} />
                      <span>{d}</span>
                    </div>
                  ))}
                </div>

                {offer.exclusions.length > 0 && (
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-white/30">
                      Not included
                    </div>
                    {offer.exclusions.map((x) => (
                      <div key={x} className="mt-1 text-[10px] text-white/40">
                        · {x}
                      </div>
                    ))}
                  </div>
                )}

                {offer.paymentLink ? (
                  <a
                    href={offer.paymentLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-black transition hover:scale-[1.02]"
                    style={{ backgroundColor: offer.accent }}
                  >
                    Get started <ArrowRight size={14} />
                  </a>
                ) : (
                  <div className="mt-6 flex items-center justify-center rounded-xl border border-white/10 py-3 text-sm font-bold text-white/40">
                    Coming soon
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* How it works */}
          <div className="mt-16 rounded-2xl border border-white/10 bg-white/[0.02] p-8">
            <h3 className="mb-6 text-lg font-black">How it works</h3>
            <div className="grid gap-6 md:grid-cols-4">
              {[
                { step: "1", title: "Pick your offer", desc: "Choose the service that fits your need" },
                { step: "2", title: "Pay securely", desc: "Stripe checkout — one-time, no subscription required" },
                { step: "3", title: "We deliver", desc: "We build and launch within the stated turnaround" },
                { step: "4", title: "You get the keys", desc: "Ongoing edits via LiTTree — add a subscription anytime" },
              ].map((s) => (
                <div key={s.step} className="text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#a8ff2f]/10 text-sm font-black text-[#a8ff2f]">
                    {s.step}
                  </div>
                  <div className="text-sm font-bold">{s.title}</div>
                  <div className="mt-1 text-xs text-white/50">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Lead Capture / Inquiry Form */}
      <section id="inquiry" className="px-5 py-16 lg:px-10">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8">
            <h2 className="text-2xl font-black">Not sure which fits?</h2>
            <p className="mt-2 text-sm text-white/50">
              Tell us what you need and we&apos;ll point you to the right service — or build a custom quote.
            </p>

            {submitted ? (
              <div className="mt-6 rounded-xl border border-[#a8ff2f]/30 bg-[#a8ff2f]/5 p-6 text-center">
                <div className="text-2xl">✅</div>
                <div className="mt-2 font-bold text-[#a8ff2f]">Thanks — we&apos;ll be in touch within 24 hours.</div>
                <Link href="/" className="mt-4 inline-block text-xs text-white/50 hover:text-white">
                  Back to home
                </Link>
              </div>
            ) : (
              <form onSubmit={handleLeadSubmit} className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <input
                    type="text"
                    required
                    placeholder="Your name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-[#a8ff2f]/50"
                  />
                  <input
                    type="email"
                    required
                    placeholder="Email address"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-[#a8ff2f]/50"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <input
                    type="tel"
                    placeholder="Phone (optional)"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-[#a8ff2f]/50"
                  />
                  <input
                    type="text"
                    placeholder="Company (optional)"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-[#a8ff2f]/50"
                  />
                </div>
                <select
                  value={form.serviceId}
                  onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-[#a8ff2f]/50"
                >
                  <option value="">Which service interests you? (optional)</option>
                  <option value="launch_sprint">LiTTree Launch Sprint ($449)</option>
                  <option value="automation_setup">AI Automation Setup ($899)</option>
                  <option value="brand_pack">Creator Brand Pack ($299)</option>
                </select>
                <textarea
                  placeholder="Tell us about your project..."
                  rows={4}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-[#a8ff2f]/50"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-[#a8ff2f] py-3 text-sm font-black text-black transition hover:scale-[1.01] disabled:opacity-50"
                >
                  {submitting ? "Sending..." : "Send inquiry"}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
