import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Terms of Service",
  description: "Terms of service for LiTTree LabStudios AI creative studio.",
  path: "/terms",
  index: true,
});

const UPDATED = "July 27, 2026";

const sections = [
  {
    id: "use-of-the-platform",
    title: "Use of the Platform",
    body: (
      <>
        <p>
          LiTTree LabStudios is an AI creative studio and social creation platform.
          It provides creative AI tools, agent workflows, gallery features, a
          community marketplace, remix and collaboration features, and related
          services (the &ldquo;Platform&rdquo;). You may use the Platform only for
          lawful purposes and in a way that does not infringe the rights of, restrict,
          or inhibit anyone else&apos;s use and enjoyment.
        </p>
        <p className="mt-4">
          You agree not to disrupt, abuse, or bypass security controls, rate limits,
          paywalls, or usage caps, and not to access the Platform through automated
          means other than the interfaces we provide. Permissive &ldquo;demo&rdquo; or
          trial access is provided in good faith and may be revoked for abuse.
        </p>
      </>
    ),
  },
  {
    id: "accounts-and-content",
    title: "Accounts and Content",
    body: (
      <>
        <p>
          You are responsible for all activity under your account and for the prompts,
          assets, agents, posts, remixes, and other content you create, upload, or
          publish. Keep your credentials private and only upload content you have the
          right to use.
        </p>
        <p className="mt-4">
          You retain ownership of content you create on the Platform to the extent
          allowed by applicable law. By publishing a public creation, you grant
          LiTTree a worldwide, non-exclusive license to host, display, and allow
          others to remix it through the Platform&apos;s social features. You may
          remove your content or make it private at any time.
        </p>
      </>
    ),
  },
  {
    id: "ai-output",
    title: "AI Output",
    body: (
      <>
        <p>
          AI-generated output can be inaccurate, incomplete, biased, or unsuitable
          for some uses. Output is provided to assist your creative process, not as
          professional advice. Review important output before relying on it,
          especially for legal, financial, medical, safety, or production decisions.
        </p>
        <p className="mt-4">
          You are responsible for reviewing and validating AI-generated content
          before publishing or shipping it. LiTTree does not guarantee that any
          output is unique, original, or free of third-party rights.
        </p>
      </>
    ),
  },
  {
    id: "credits-and-payments",
    title: "Payments and Credits",
    body: (
      <>
        <p>
          The Platform offers a free tier with starter credits and optional paid
          plans, credit packs, and marketplace listings. Generation costs, credit
          values, plan pricing, and marketplace fees may change as the Platform
          evolves. Any paid feature will clearly show its cost before purchase or use.
        </p>
        <p className="mt-4">
          Credits have no cash value, are non-refundable unless required by law, and
          do not expire unless stated at the time of purchase. Refunds for paid
          plans, where applicable, are handled per the plan&apos;s terms and
          applicable consumer law.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use",
    body: (
      <>
        <p>You agree not to use the Platform to create, store, or distribute:</p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Content that is illegal, infringing, or violates third-party rights.</li>
          <li>Harassment, hate, threats, or content sexualizing minors (CSAM).</li>
          <li>Malware, spyware, or tools designed to harm or exploit others.</li>
          <li>Scraping, credential harvesting, or bulk automated access.</li>
          <li>Content that impersonates others or deceives users about its origin.</li>
        </ul>
        <p className="mt-4">
          We may remove content and suspend access for violations, with or without
          notice. Report abuse to support@litlabs.net.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    title: "Termination and Suspension",
    body: (
      <>
        <p>
          You may close your account at any time. We may suspend or terminate access
          if you violate these Terms, create legal risk, or harm the Platform or its
          community. On termination, your right to use the Platform ends, though
          your content and data rights under our Privacy Policy continue to apply.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers and Limitations",
    body: (
      <>
        <p>
          The Platform is provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo;
          To the extent permitted by law, LiTTree disclaims warranties of
          merchantability, fitness for a particular purpose, and non-infringement,
          and is not liable for indirect, incidental, or consequential damages
          arising from your use of the Platform.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to These Terms",
    body: (
      <>
        <p>
          We may update these Terms as the Platform evolves. We will post the new
          Terms on this page and update the &ldquo;Last updated&rdquo; date. Material
          changes will be surfaced through the Platform or by email where practical.
          Continued use after changes take effect means you accept the updated Terms.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Contact Us",
    body: (
      <>
        <p>
          Questions about these Terms? Email{" "}
          <a
            href="mailto:support@litlabs.net"
            className="font-bold text-[#a8ff2f] underline-offset-4 hover:underline"
          >
            support@litlabs.net
          </a>{" "}
          and we&apos;ll get back to you.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#03050a] text-white selection:bg-[#a970ff] selection:text-white">
      {/* Hero header band */}
      <section className="relative border-b border-white/10 px-5 pt-28 pb-14 lg:px-10 lg:pt-32 lg:pb-16">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_30%,rgba(168,255,47,.12),transparent_32%),radial-gradient(circle_at_82%_60%,rgba(169,112,255,.14),transparent_34%)]" />
        <div className="relative mx-auto max-w-screen-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#a8ff2f]/25 bg-[#a8ff2f]/8 px-4 py-2 text-xs font-black uppercase tracking-[.18em] text-[#a8ff2f]">
            <Sparkles size={13} /> Terms
          </div>
          <h1 className="max-w-4xl text-4xl font-black leading-[.95] tracking-[-.045em] sm:text-5xl lg:text-6xl">
            Terms of Service
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/60">
            The rules of the road for LiTTree LabStudios—our AI creative studio and
            social creation platform. Build apps, make art, launch projects, and
            remix with your AI crew, all under terms that keep the community fair
            and your work yours.
          </p>
          <p className="mt-6 text-xs font-bold uppercase tracking-[.22em] text-white/40">
            Last updated {UPDATED}
          </p>
        </div>
      </section>

      {/* Body: TOC sidebar + prose */}
      <section className="px-5 py-14 lg:px-10 lg:py-20">
        <div className="mx-auto grid max-w-screen-2xl gap-10 lg:grid-cols-[16rem_1fr] lg:gap-16">
          {/* Sticky TOC — desktop only */}
          <aside className="hidden lg:block">
            <div className="sticky top-10">
              <div className="mb-4 text-xs font-black uppercase tracking-[.2em] text-[#65f4ff]">
                On this page
              </div>
              <nav className="space-y-2 text-sm">
                {sections.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="block rounded-lg px-3 py-2 text-white/55 transition hover:bg-white/5 hover:text-[#a8ff2f]"
                  >
                    {s.title}
                  </a>
                ))}
              </nav>
              <Link
                href="/sign-up"
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-[#a8ff2f] to-[#62f6c4] px-4 py-3 text-sm font-black text-[#03050a] shadow-[0_0_28px_rgba(168,255,47,.2)] transition hover:scale-[1.02] hover:shadow-[0_0_38px_rgba(168,255,47,.35)]"
              >
                Create your free space <ArrowRight size={14} />
              </Link>
            </div>
          </aside>

          {/* Prose column — readable width */}
          <article className="max-w-3xl space-y-10">
            {sections.map((s) => (
              <section
                key={s.id}
                id={s.id}
                className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/[.02] p-6 sm:p-8"
              >
                <h2 className="mb-3 text-xl font-black tracking-tight text-slate-50 sm:text-2xl">
                  {s.title}
                </h2>
                <div className="space-y-4 text-sm leading-7 text-white/65 sm:text-[15px] sm:leading-8">
                  {s.body}
                </div>
              </section>
            ))}

            <p className="rounded-2xl border border-[#a8ff2f]/20 bg-[#a8ff2f]/4 p-5 text-xs leading-6 text-white/45">
              This document is a summary of the terms that govern use of LiTTree
              LabStudios. It is not legal advice. If something here conflicts with a
              signed agreement, that agreement controls where it applies.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
