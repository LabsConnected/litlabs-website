import Link from "next/link";
import { AGENT_DEFINITIONS } from "@/lib/agent-registry";

export function AgentsCatalog({ signedIn }: { signedIn: boolean }) {
  const agents = AGENT_DEFINITIONS.filter((agent) => agent.enabled && agent.studioVisible);
  return (
    <main id="main-content" className="min-h-dvh bg-[#03050a] px-5 pb-20 pt-32 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="litt-eyebrow">The operator stack</div>
        <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">One LiTT. Specialist support.</h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-white/65">Tell LiTT what you want to make. Specialist agents support the work inside Studio, with your project context and permissions. Review the preview and approve before going live.</p>
        <p className="mt-4 text-sm text-white/55">Describe → LiTT works → Preview → Approve → Live</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/studio?tool=agents" className="rounded-xl bg-lime-400 px-5 py-3 font-bold text-black">Open agents in Studio</Link>
          <Link href="/pricing" className="rounded-xl border border-white/20 px-5 py-3 font-bold">View plans</Link>
        </div>
        <p className="mt-3 text-sm text-white/55" data-testid="agents-session-note">
          {signedIn
            ? "You're signed in. Open agents in Studio to run them with your project context and plan entitlements."
            : "Sign in or create an account to use agents. Availability depends on your plan and connected tools."}
        </p>
        <section aria-label="Specialist agents" className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <article key={agent.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <p className="text-xs font-bold uppercase tracking-wider text-lime-300">{agent.role}</p>
              <h2 className="mt-3 text-xl font-bold">{agent.name}</h2>
              <p className="mt-3 text-sm leading-6 text-white/65">{agent.description}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
