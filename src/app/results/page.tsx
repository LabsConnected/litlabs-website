import { Metadata } from "next";
import Link from "next/link";
import { Rocket, PenTool, TrendingUp, Wrench, ArrowRight } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase";

export const metadata: Metadata = {
  title: "Results — LiTTree Lab Studios",
  description: "Real examples of websites launched, content created, and sites maintained with LiTT agents.",
};

export const dynamic = "force-dynamic";

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  development: { label: "Website Launches", icon: <Rocket className="h-5 w-5" />, color: "text-cyan-400" },
  creative: { label: "Brand & Content", icon: <PenTool className="h-5 w-5" />, color: "text-violet-400" },
  growth: { label: "Growth Campaigns", icon: <TrendingUp className="h-5 w-5" />, color: "text-green-400" },
  automation: { label: "Site Maintenance", icon: <Wrench className="h-5 w-5" />, color: "text-amber-400" },
};

export default async function ResultsPage() {
  // Fetch completed runs with deployment URLs
  const { data: runs } = await supabaseAdmin
    .from("revenue_agent_runs")
    .select(`
      id, prompt, status, deployment_url, deployment_status,
      created_at, completed_at, files_changed,
      agent:agents(name, slug, category)
    `)
    .eq("status", "completed")
    .not("deployment_url", "is", null)
    .order("completed_at", { ascending: false })
    .limit(20);

  const results = runs ?? [];

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-3xl font-black text-white">Results</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Real finished projects from LiTT agents. Not simulations.
        </p>

        {results.length === 0 ? (
          <div className="mt-12 rounded-xl border border-neutral-800 bg-neutral-900 p-12 text-center">
            <p className="text-sm text-neutral-400">
              No public results yet. Be the first to launch a project with LiTT.
            </p>
            <Link
              href="/start"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-6 py-3 text-sm font-bold text-white hover:bg-cyan-500"
            >
              <Rocket className="h-4 w-4" />
              Start a Launch
            </Link>
          </div>
        ) : (
          <div className="mt-12 space-y-6">
            {results.map((run) => {
              const agent = run.agent as unknown as { name: string; slug: string; category: string } | null;
              const category = agent?.category ?? "development";
              const meta = CATEGORY_META[category] ?? CATEGORY_META.development;
              const filesChanged = (run.files_changed as string[] | null) ?? [];

              return (
                <div
                  key={run.id}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 p-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className={`flex items-center gap-2 text-xs font-bold ${meta.color}`}>
                        {meta.icon}
                        {meta.label}
                      </div>
                      <h2 className="mt-2 text-sm font-bold text-white">
                        {run.prompt.slice(0, 100)}
                      </h2>
                      {agent && (
                        <p className="mt-1 text-xs text-neutral-500">
                          Agent: {agent.name}
                        </p>
                      )}
                      {filesChanged.length > 0 && (
                        <p className="mt-1 text-xs text-neutral-500">
                          {filesChanged.length} files changed
                        </p>
                      )}
                    </div>
                    {run.deployment_url && (
                      <a
                        href={run.deployment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-cyan-400 hover:bg-neutral-800"
                      >
                        <ArrowRight className="h-3 w-3" />
                        Visit
                      </a>
                    )}
                  </div>
                  {run.completed_at && (
                    <p className="mt-3 text-xs text-neutral-600">
                      Completed {new Date(run.completed_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
