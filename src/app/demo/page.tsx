import type { Metadata } from "next";

import { getDemoConfig } from "@/lib/demo/config";
import DemoStudio from "./DemoStudio";

export const metadata: Metadata = {
  title: "Try LiTT — AI Project Operator Demo | LiTTree LabStudios",
  description:
    "Try LiTT, the AI Project Operator, in a limited chat-only demo. Building, previews, agents, and deploys unlock after signup.",
  robots: { index: false, follow: false },
};

/**
 * /demo — the anonymous limited demo lane.
 *
 * Server component: reads the demo config (kill switch / enabled) and renders
 * the dedicated DemoStudio client component. Never renders CommandStudio and
 * never touches authenticated routes.
 */
export default function DemoPage() {
  const cfg = getDemoConfig();
  const disabled = !cfg.enabled || cfg.killSwitch;
  return (
    <DemoStudio
      maxMessages={cfg.maxMessages}
      disabled={disabled}
      killSwitch={cfg.killSwitch}
    />
  );
}
