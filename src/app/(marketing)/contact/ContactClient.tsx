"use client";

import { useState } from "react";
import {
  Phone,
  MessageCircle,
  Clock,
  Check,
  Send,
  Sparkles,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { MarketingFrame } from "@/components/ProductPageFrame";

/** Business contact constants — real values from the Google Business Profile. */
const BUSINESS_PHONE_DISPLAY = "(231) 428-5411";
const BUSINESS_PHONE_TEL = "+12314285411";

const PROJECT_TYPES = [
  "Website Design",
  "Web Development",
  "AI Website Development",
  "Small Business Websites",
  "Landing Page Design",
  "E-commerce Website Development",
  "Website Redesign",
  "Website Maintenance",
  "SEO / Local SEO",
  "Booking & Payment Integration",
] as const;

const BUDGET_RANGES = ["<$1k", "$1k–$2.5k", "$2.5k–$5k", "$5k+"] as const;

const HOURS = [
  { days: "Monday – Friday", time: "9:00 AM – 6:00 PM" },
  { days: "Saturday", time: "10:00 AM – 3:00 PM" },
  { days: "Sunday", time: "Closed" },
] as const;

type SubmitState = "idle" | "sending" | "sent" | "error";

const inputClass =
  "w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/30";

const labelClass =
  "mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50";

export default function ContactClient() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    projectType: "",
    budget: "",
    message: "",
  });
  const [submitState, setSubmitState] = useState<SubmitState>("idle");

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitState === "sending") return;
    setSubmitState("sending");
    try {
      const res = await fetch("/api/leads/service-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          company: null,
          serviceId: null,
          message: form.message.trim() || null,
          referralCode: null,
          metadata: {
            form: "contact_page",
            projectType: form.projectType,
            budgetRange: form.budget,
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
      } | null;
      if (res.ok && data?.success) {
        setSubmitState("sent");
      } else {
        setSubmitState("error");
      }
    } catch {
      setSubmitState("error");
    }
  }

  return (
    <div className="min-h-screen bg-[#03050a] text-white">
      {/* Hero */}
      <section className="relative overflow-hidden px-5 pb-12 pt-32 lg:px-10">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/5 to-transparent" />
        <MarketingFrame className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-accent">
            <Sparkles size={12} /> Work with LiTTree LabStudios
          </div>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
            Let&apos;s build <span className="text-accent">your website</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-white/60">
            Tell us about your project and we&apos;ll get back to you. Prefer to
            talk? Call or text — we pick up during business hours.
          </p>
        </MarketingFrame>
      </section>

      {/* Contact options + hours */}
      <section className="px-5 pb-4 lg:px-10">
        <MarketingFrame>
          <div className="grid gap-4 md:grid-cols-3">
            <a
              href={`tel:${BUSINESS_PHONE_TEL}`}
              className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-accent/40 hover:bg-accent/5"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent shadow-accent-glow">
                <Phone size={22} />
              </span>
              <span>
                <span className="block text-xs font-bold uppercase tracking-wider text-white/50">
                  Call us
                </span>
                <span className="block text-lg font-black text-white">
                  {BUSINESS_PHONE_DISPLAY}
                </span>
              </span>
            </a>
            <a
              href={`sms:${BUSINESS_PHONE_TEL}`}
              className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-accent/40 hover:bg-accent/5"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/40 bg-accent/10 text-accent">
                <MessageCircle size={22} />
              </span>
              <span>
                <span className="block text-xs font-bold uppercase tracking-wider text-white/50">
                  Text us
                </span>
                <span className="block text-lg font-black text-white">
                  {BUSINESS_PHONE_DISPLAY}
                </span>
              </span>
            </a>
            <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white/70">
                <Clock size={22} />
              </span>
              <div>
                <span className="block text-xs font-bold uppercase tracking-wider text-white/50">
                  Business hours
                </span>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {HOURS.map((h) => (
                    <li key={h.days} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                      <span className="text-white/70">{h.days}</span>
                      <span className="font-bold text-white">{h.time}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </MarketingFrame>
      </section>

      {/* Lead form */}
      <section className="px-5 py-12 lg:px-10">
        <MarketingFrame>
          <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
            {submitState === "sent" ? (
              <div className="py-8 text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Check size={28} />
                </span>
                <h2 className="mt-4 text-2xl font-black">
                  Message received
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
                  Thanks, {form.name.split(" ")[0] || "there"} — your inquiry is
                  on its way. We&apos;ll be in touch soon. Need us faster? Call{" "}
                  <a
                    href={`tel:${BUSINESS_PHONE_TEL}`}
                    className="font-bold text-accent"
                  >
                    {BUSINESS_PHONE_DISPLAY}
                  </a>
                  .
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-black">Send a project inquiry</h2>
                <p className="mt-1 text-sm text-white/50">
                  A few details helps us reply with something useful.
                </p>
                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className={labelClass}>
                        Name *
                      </label>
                      <input
                        id="contact-name"
                        type="text"
                        required
                        maxLength={200}
                        autoComplete="name"
                        className={inputClass}
                        placeholder="Your name"
                        value={form.name}
                        onChange={(e) => set("name", e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-email" className={labelClass}>
                        Email *
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        required
                        maxLength={320}
                        autoComplete="email"
                        className={inputClass}
                        placeholder="you@business.com"
                        value={form.email}
                        onChange={(e) => set("email", e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="contact-phone" className={labelClass}>
                      Phone <span className="normal-case text-white/35">(optional)</span>
                    </label>
                    <input
                      id="contact-phone"
                      type="tel"
                      maxLength={30}
                      autoComplete="tel"
                      className={inputClass}
                      placeholder="(555) 123-4567"
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-project" className={labelClass}>
                        Project type *
                      </label>
                      <select
                        id="contact-project"
                        required
                        className={`${inputClass} appearance-none [&>option]:bg-[#0a0f1a]`}
                        value={form.projectType}
                        onChange={(e) => set("projectType", e.target.value)}
                      >
                        <option value="" disabled>
                          Select a service
                        </option>
                        {PROJECT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="contact-budget" className={labelClass}>
                        Budget range *
                      </label>
                      <select
                        id="contact-budget"
                        required
                        className={`${inputClass} appearance-none [&>option]:bg-[#0a0f1a]`}
                        value={form.budget}
                        onChange={(e) => set("budget", e.target.value)}
                      >
                        <option value="" disabled>
                          Select a range
                        </option>
                        {BUDGET_RANGES.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="contact-message" className={labelClass}>
                      Project details
                    </label>
                    <textarea
                      id="contact-message"
                      rows={5}
                      maxLength={5000}
                      className={`${inputClass} resize-y`}
                      placeholder="What are you looking to build? Any timeline or must-haves?"
                      value={form.message}
                      onChange={(e) => set("message", e.target.value)}
                    />
                  </div>
                  {submitState === "error" && (
                    <p className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      Something went wrong sending your inquiry. Please try
                      again, or call us directly at{" "}
                      <a
                        href={`tel:${BUSINESS_PHONE_TEL}`}
                        className="font-bold underline"
                      >
                        {BUSINESS_PHONE_DISPLAY}
                      </a>
                      .
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={submitState === "sending"}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-sm font-black text-on-accent shadow-accent-glow transition hover:scale-[1.01] hover:bg-accent-strong disabled:cursor-wait disabled:opacity-70"
                  >
                    {submitState === "sending" ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        Send inquiry
                      </>
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        </MarketingFrame>
      </section>
    </div>
  );
}
