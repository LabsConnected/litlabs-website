import Link from "next/link";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "What LiTT Can Do",
  description:
    "What LiTT can do: describe your idea once and watch your AI project operator plan, build, preview, and ship it — then keep improving it by chatting.",
  path: "/capabilities",
});

const CAPABILITIES = [
  {
    title: "Describe it once",
    body: "Tell LiTT what you need in plain words — a roofing company site, a booking page, a dashboard. LiTT plans the build and gets to work.",
  },
  {
    title: "Watch it build",
    body: "LiTT writes real code, creates real files, and shows you what it's doing as it works — no black box, no fake progress.",
  },
  {
    title: "Preview instantly",
    body: "See your project running live as it's built. What you see in preview is what ships.",
  },
  {
    title: "Fix it by chatting",
    body: "Something off? Just say so. LiTT edits the real project and shows you the result — iterate in conversation.",
  },
  {
    title: "Publish for real",
    body: "Ship to production hosting with your own domain. Client sites go live as real, independent websites.",
  },
  {
    title: "Capture leads & take bookings",
    body: "Forms, contact flows, and booking that actually collect customer information — the last mile, not a demo.",
  },
  {
    title: "Take payments",
    body: "Connect Stripe and sell — products, services, subscriptions — with real checkout on your site.",
  },
  {
    title: "Create media",
    body: "Generate images, music, and video for your project right inside the workspace.",
  },
  {
    title: "Extend with the marketplace",
    body: "Install agents, skills, and workflows from the marketplace to give LiTT new abilities.",
  },
];

export default function CapabilitiesPage() {
  return (
    <main id="main-content" className="bg-[#03050b] text-white">
      <section className="mx-auto max-w-4xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-lime-300">
          Capabilities
        </p>
        <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">
          What LiTT Can Do
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/60">
          LiTT is an AI project operator. You describe the outcome you want —
          LiTT plans it, builds it, shows it working, and ships it. One
          workspace, one conversation, real results.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/sign-up"
            className="rounded-xl bg-lime-300 px-6 py-3 text-sm font-black text-black transition hover:scale-[1.02]"
          >
            Start building
          </Link>
          <Link
            href="/marketplace"
            className="rounded-xl border border-white/15 px-6 py-3 text-sm font-bold text-white/80 transition hover:bg-white/5"
          >
            Browse the marketplace
          </Link>
        </div>
      </section>

      <section
        aria-label="LiTT capabilities"
        className="mx-auto max-w-4xl px-4 pb-24 sm:px-6"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((cap) => (
            <article
              key={cap.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
            >
              <h2 className="text-lg font-black tracking-tight">{cap.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/55">
                {cap.body}
              </p>
            </article>
          ))}
        </div>
        <p className="mx-auto mt-12 max-w-2xl text-center text-sm text-white/40">
          The first agents and workflows are being added now. Contact us for
          early marketplace access.
        </p>
      </section>
    </main>
  );
}
