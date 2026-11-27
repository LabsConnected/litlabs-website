"use client";

import Link from "next/link";
import { ArrowRight, Check, MessageSquareText, Sparkles } from "lucide-react";
import { useState } from "react";
import { MarketingFrame } from "@/components/ProductPageFrame";
import "@/app/public-pages-tlc.css";

const HELP_AREAS = [
  {
    title: "Website or landing page",
    copy: "A focused page or small site around a clear goal, with room to iterate in LiTT Studio after launch.",
  },
  {
    title: "AI workflow automation",
    copy: "Repeatable intake, routing, follow-up, or internal workflow help—scoped only after we confirm the tools and outcome.",
  },
  {
    title: "Brand and creative direction",
    copy: "Positioning, visual direction, launch copy, and creative assets that can carry into product and marketing work.",
  },
];

const PROCESS_STEPS = [
  {
    title: "Share the goal",
    copy: "Tell us what you are trying to make, who it is for, and what done looks like.",
  },
  {
    title: "Confirm scope and price",
    copy: "We reply with what is realistic, what is not included, and the next step before anything starts.",
  },
  {
    title: "Approve, then build",
    copy: "Work begins only after you approve the scope. Ongoing edits can continue inside LiTT Studio.",
  },
];

const INTEREST_OPTIONS = [
  { value: "", label: "What kind of help do you need? (optional)" },
  { value: "website", label: "Website or landing page" },
  { value: "automation", label: "AI workflow automation" },
  { value: "brand", label: "Brand or creative direction" },
  { value: "other", label: "Something else" },
];

export default function HireClient() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    interest: "",
    message: "",
  });

  async function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/leads/service-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          company: form.company || null,
          serviceId: null,
          message: form.message || null,
          metadata: form.interest ? { interest: form.interest } : {},
        }),
      });
      if (!response.ok) {
        throw new Error(`Lead request failed with ${response.status}`);
      }
      setSubmitted(true);
    } catch {
      setSubmitError("We could not send that request. Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="litt-public-light min-h-screen bg-white pt-[68px] text-[#0e1510] selection:bg-[#8fd14f]/60">
      <section className="relative overflow-hidden px-5 pb-16 pt-16 lg:px-10">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/5 to-transparent" />
        <MarketingFrame className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-accent">
            <Sparkles size={12} /> Hire LiTTree LabStudios
          </div>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
            Tell us what you need <span className="text-accent">built.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-[#0e1510]/65">
            Share the outcome you are trying to create. We will confirm scope,
            availability, and pricing before any work starts—no checkout or
            fixed package is required on this page.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="#inquiry"
              className="rounded-xl bg-accent px-6 py-3 text-sm font-black text-on-accent shadow-accent-glow transition hover:scale-[1.02] hover:bg-accent-strong"
            >
              Start an inquiry
            </a>
            <a
              href="#how-it-works"
              className="rounded-xl border border-[#0c5a26]/30 px-6 py-3 text-sm font-bold text-[#0c5a26] transition hover:bg-[#f2f7ea]"
            >
              How it works
            </a>
          </div>
        </MarketingFrame>
      </section>

      <section className="px-5 py-16 lg:px-10">
        <MarketingFrame>
          <div className="mb-10 max-w-2xl">
            <h2 className="text-2xl font-black">What we can help with</h2>
            <p className="mt-3 text-sm leading-6 text-[#0e1510]/60">
              These are starting points, not fixed packages. The right scope
              depends on the goal, the tools involved, and what you already have.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {HELP_AREAS.map((area) => (
              <article
                key={area.title}
                className="rounded-2xl border border-[#cfdec4] bg-white p-6 shadow-[0_20px_54px_rgba(14,60,26,0.08)]"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-[#0c5a26]">
                  <MessageSquareText size={20} />
                </div>
                <h3 className="text-lg font-black">{area.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#0e1510]/65">{area.copy}</p>
              </article>
            ))}
          </div>
        </MarketingFrame>
      </section>

      <section id="how-it-works" className="px-5 py-16 lg:px-10">
        <MarketingFrame>
          <div className="rounded-2xl border border-[#cfdec4] bg-[#f2f7ea] p-8">
            <h2 className="text-2xl font-black">How hiring works</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {PROCESS_STEPS.map((step, index) => (
                <div key={step.title} className="text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-sm font-black text-accent">
                    {index + 1}
                  </div>
                  <div className="text-sm font-bold">{step.title}</div>
                  <div className="mt-1 text-xs leading-5 text-[#0e1510]/60">{step.copy}</div>
                </div>
              ))}
            </div>
            <div className="mt-8 flex items-start gap-3 rounded-xl border border-accent/20 bg-white p-4 text-sm text-[#0e1510]/70">
              <Check size={16} className="mt-0.5 shrink-0 text-accent" />
              <span>
                Nothing on this page charges you. If the request is a better fit
                for self-serve software, we will say so and point you to Studio.
              </span>
            </div>
          </div>
        </MarketingFrame>
      </section>

      <section id="inquiry" className="px-5 py-16 lg:px-10">
        <MarketingFrame>
          <div className="rounded-2xl border border-[#cfdec4] bg-[#f2f7ea] p-8">
            <h2 className="text-2xl font-black">Tell us about the work</h2>
            <p className="mt-2 text-sm text-[#0e1510]/60">
              A short description is enough. We will follow up with questions only
              if we need them to scope the work honestly.
            </p>

            {submitted ? (
              <div className="mt-6 rounded-xl border border-accent/30 bg-accent/5 p-6 text-center">
                <div className="text-2xl">✓</div>
                <div className="mt-2 font-bold text-accent">
                  Thanks — we will review your request and follow up.
                </div>
                <Link href="/" className="mt-4 inline-block text-xs text-[#0e1510]/55 hover:text-[#0c5a26]">
                  Back to home
                </Link>
              </div>
            ) : (
              <form onSubmit={handleLeadSubmit} className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <input
                    type="text"
                    required
                    aria-label="Your name"
                    placeholder="Your name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="rounded-xl border border-[#cfdec4] bg-white px-4 py-3 text-sm text-[#0e1510] placeholder:text-[#0e1510]/40 outline-none focus:border-accent/50"
                  />
                  <input
                    type="email"
                    required
                    aria-label="Email address"
                    placeholder="Email address"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="rounded-xl border border-[#cfdec4] bg-white px-4 py-3 text-sm text-[#0e1510] placeholder:text-[#0e1510]/40 outline-none focus:border-accent/50"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <input
                    type="tel"
                    aria-label="Phone number, optional"
                    placeholder="Phone (optional)"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="rounded-xl border border-[#cfdec4] bg-white px-4 py-3 text-sm text-[#0e1510] placeholder:text-[#0e1510]/40 outline-none focus:border-accent/50"
                  />
                  <input
                    type="text"
                    aria-label="Company, optional"
                    placeholder="Company (optional)"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    className="rounded-xl border border-[#cfdec4] bg-white px-4 py-3 text-sm text-[#0e1510] placeholder:text-[#0e1510]/40 outline-none focus:border-accent/50"
                  />
                </div>
                <select
                  aria-label="Interest"
                  value={form.interest}
                  onChange={(e) => setForm({ ...form, interest: e.target.value })}
                  className="w-full rounded-xl border border-[#cfdec4] bg-white px-4 py-3 text-sm text-[#0e1510] outline-none focus:border-accent/50"
                >
                  {INTEREST_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <textarea
                  required
                  aria-label="Project details"
                  placeholder="What are you trying to build or fix?"
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full rounded-xl border border-[#cfdec4] bg-white px-4 py-3 text-sm text-[#0e1510] placeholder:text-[#0e1510]/40 outline-none focus:border-accent/50"
                />
                {submitError ? (
                  <p className="text-sm font-bold text-[#b42318]" role="alert">
                    {submitError}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-black text-on-accent transition hover:bg-accent-strong hover:scale-[1.01] disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Send inquiry"} <ArrowRight size={15} />
                </button>
              </form>
            )}
          </div>
        </MarketingFrame>
      </section>
    </div>
  );
}
