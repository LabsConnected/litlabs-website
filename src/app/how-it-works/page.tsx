import { Metadata } from "next";
import Link from "next/link";
import { Rocket, Eye, Shield, Wrench, Check, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "How It Works — LiTTree Lab Studios",
  description: "Describe the outcome, review the plan, approve important actions, receive the result, keep improving it.",
};

const STEPS = [
  {
    icon: <Rocket className="h-6 w-6" />,
    title: "Describe the outcome",
    description: "Tell LiTT what you want to build, create, grow, or fix. No technical setup required.",
  },
  {
    icon: <Eye className="h-6 w-6" />,
    title: "Review the plan",
    description: "LiTT proposes a plan with specific steps. You see what files will change and what tools will be used.",
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: "Approve important actions",
    description: "File writes and deployments require your explicit approval. Nothing happens without your say-so.",
  },
  {
    icon: <Wrench className="h-6 w-6" />,
    title: "Watch the work happen",
    description: "LiTT writes files, runs builds, starts previews, and validates the result in real time.",
  },
  {
    icon: <Check className="h-6 w-6" />,
    title: "Receive the result",
    description: "Get a live URL, a content calendar, a growth plan, or a site repair report. Real results, not simulations.",
  },
  {
    icon: <ArrowRight className="h-6 w-6" />,
    title: "Keep improving it",
    description: "Every result ends with a useful next step. Launch leads to growth. Growth leads to content. Content leads to maintenance.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-black text-white">How It Works</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Six steps from idea to finished result.
        </p>

        <div className="mt-12 space-y-8">
          {STEPS.map((step, i) => (
            <div key={i} className="flex gap-6">
              <div className="flex flex-col items-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-600/10 text-cyan-400">
                  {step.icon}
                </div>
                {i < STEPS.length - 1 && (
                  <div className="mt-2 h-full w-px flex-1 bg-neutral-800" />
                )}
              </div>
              <div className="flex-1 pb-8">
                <div className="text-xs font-bold text-neutral-600">Step {i + 1}</div>
                <h2 className="mt-1 text-lg font-bold text-white">{step.title}</h2>
                <p className="mt-1 text-sm text-neutral-400">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-neutral-800 pt-8">
          <Link
            href="/start"
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-6 py-3 text-sm font-bold text-white hover:bg-cyan-500"
          >
            <Rocket className="h-4 w-4" />
            Get started
          </Link>
        </div>
      </div>
    </div>
  );
}
