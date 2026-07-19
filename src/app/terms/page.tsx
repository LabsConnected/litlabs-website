export const metadata = {
  title: "Terms",
  description: "Terms of service for LiTTree LabStudios.",
};

const UPDATED = "July 2, 2026";

export default function TermsPage() {
  return (
    <main
      className="min-h-dvh px-4 py-16"
      style={{ backgroundColor: "#08080c", color: "#e2e2e9" }}
    >
      <article className="mx-auto max-w-3xl">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.28em] text-cyan-300">
          Terms
        </p>
        <h1 className="mb-3 text-4xl font-black tracking-tight text-slate-50">
          Terms of Service
        </h1>
        <p className="mb-10 text-sm opacity-55">Last updated {UPDATED}</p>

        <div className="space-y-8 text-sm leading-relaxed opacity-75">
          <section>
            <h2 className="mb-2 text-lg font-black text-slate-50">
              Use of the Platform
            </h2>
            <p>
              LiTTree LabStudios provides creative AI tools, agent workflows,
              gallery features, marketplace experiences, and related services.
              Use the platform lawfully and do not attempt to disrupt, abuse, or
              bypass security controls.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black text-slate-50">
              Accounts and Content
            </h2>
            <p>
              You are responsible for activity under your account and for the
              prompts, assets, agents, posts, and other content you create or
              publish. Keep credentials private and only upload content you have
              the right to use.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black text-slate-50">AI Output</h2>
            <p>
              AI-generated output can be inaccurate, incomplete, or unsuitable
              for some uses. Review important output before relying on it,
              especially for legal, financial, medical, safety, or production
              decisions.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black text-slate-50">
              Payments and Credits
            </h2>
            <p>
              Paid plans, credits, marketplace listings, and generation costs
              may change as the platform evolves. Any paid feature should
              clearly show its cost before purchase or use.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
