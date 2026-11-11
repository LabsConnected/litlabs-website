"use client";

/**
 * StudioPrimeLanding — Studio's home base (ART-20261110-029).
 *
 * Studio is the one prime signed-in surface; there is no separate
 * dashboard/home page anymore (/dashboard redirects here). This is
 * what a signed-in user with projects sees on a bare /studio visit:
 *
 *   1. The universal "What do you want to make?" create launcher —
 *      the SAME BuildConsole the retired dashboard carried, with its
 *      intent routing and creation-type chips, unchanged. Submitting
 *      navigates to a parameterized /studio URL, which swaps this
 *      landing for the CommandStudio workspace.
 *   2. Recent projects — the SAME RecentWork list, fed by
 *      useCanonicalProjects, whose states come from the canonical
 *      describeProjectState derivation (no second source of truth).
 *
 * The deep-green stage matches Studio's intentionally-dark surfaces
 * (terminal, CLI panel); the launcher and list carry the approved
 * lime-on-dark design language they were built with.
 */

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BuildConsole } from "@/components/dashboard/v3/BuildConsole";
import { RecentWork } from "@/components/dashboard/v3/RecentWork";
import { useCanonicalProjects } from "@/components/dashboard/v3/useDashboardData";

export default function StudioPrimeLanding() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canonicalProjects = useCanonicalProjects();

  const handleOpenTerminal = useCallback(() => {
    router.push("/studio?tool=terminal");
  }, [router]);

  return (
    <div
      className="relative flex min-h-full flex-col overflow-y-auto"
      style={{ background: "#0b120d" }}
      data-testid="studio-prime-landing"
    >
      <main className="relative z-10 flex-1 px-4 pb-16 pt-6 md:px-6 md:pt-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 md:gap-7">
          <BuildConsole initialPrompt={searchParams.get("prompt") ?? ""} />
          <RecentWork
            projects={canonicalProjects.projects}
            loading={canonicalProjects.loading}
            onOpenTerminal={handleOpenTerminal}
          />
        </div>
      </main>
    </div>
  );
}
