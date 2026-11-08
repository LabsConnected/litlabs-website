import Link from "next/link";
import { AGENT_DEFINITIONS, SPECIALIST_AGENTS } from "@/lib/agent-registry";

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  creator_beta: "Creator Beta",
  pro_builder_beta: "Pro Builder",
};

function planLabel(minimumPlan: string): string {
  const label = PLAN_LABEL[minimumPlan];
  return label ? `${label} plan` : "Paid plan";
}

export function AgentsCatalog({ signedIn }: { signedIn: boolean }) {
  const operators = AGENT_DEFINITIONS.filter(
    (agent) => agent.enabled && agent.studioVisible,
  );
  const specialists = SPECIALIST_AGENTS.filter((agent) => agent.enabled);
  return (
    <main id="main-content" className="min-h-dvh bg-[#03050a] px-5 pb-20 pt-32 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="litt-eyebrow">The operator stack</div>
        <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">One LiTT. Specialist support.</h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-white/65">Tell LiTT what you want to make. Inside Studio, LiTT delegates the work to the right specialist — with your project context and permissions. Review the preview and approve before going live.</p>
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

        <section aria-label="Your operator" className="mt-14">
          <h2 className="text-xs font-bold uppercase tracking-widest text-white/40">Your operator</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {operators.map((agent) => (
              <article key={agent.id} className="rounded-2xl border border-lime-400/30 bg-lime-400/[0.05] p-6">
                <p className="text-xs font-bold uppercase tracking-wider text-lime-300">{agent.role}</p>
                <h3 className="mt-3 text-xl font-bold">{agent.name}</h3>
                <p className="mt-3 text-sm leading-6 text-white/65">{agent.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-label="Specialist support" className="mt-14">
          <h2 className="text-xs font-bold uppercase tracking-widest text-white/40">Specialist support</h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/55">
            These specialists aren&apos;t separate chatbots — LiTT delegates to them inside
            Studio as skills, with your project context and permissions. Included with
            paid plans.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {specialists.map((agent) => (
              <article key={agent.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: agent.color }}>{agent.role}</p>
                <h3 className="mt-3 text-xl font-bold">{agent.name}</h3>
                <p className="mt-3 text-sm leading-6 text-white/65">{agent.description}</p>
                <p className="mt-4 text-xs text-white/40">Delegated by LiTT · {planLabel(agent.minimumPlan)}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
